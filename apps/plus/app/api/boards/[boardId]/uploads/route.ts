import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { assetChunkBytes } from "@meldrift/board-data/board-delta";
import { getDb } from "@/lib/db";
import { db_assets, db_uploadSessions } from "@/lib/db/schema";
import { editorFromRequest, editorSessionGuard } from "@/lib/editor-guard";
import {
    chunkCountFor, receivedChunks, uploadRequestFailure, uploadRequestSchema, uploadSessionTtlMs,
} from "@/lib/assets";

type Context = { params: Promise<{ boardId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
    const boardId = Number((await params).boardId);
    const gate = await editorFromRequest(request, boardId);
    if (!gate.identity) {
        return gate.failure;
    }

    const parsed = uploadRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ message: uploadRequestFailure(parsed.error) }, { status: 400 });
    }
    const { assetId, digest, byteLength, mimeType } = parsed.data;
    const chunkCount = chunkCountFor(byteLength);
    const db = getDb();

    const [stored] = await db.select().from(db_assets)
        .where(and(eq(db_assets.boardId, boardId), eq(db_assets.assetId, assetId))).limit(1);
    if (stored) {
        if (stored.digest !== digest) {
            return NextResponse.json({ message: "This asset id already holds different bytes." }, { status: 409 });
        }
        return NextResponse.json({ ok: true, assetId, complete: true });
    }

    const [open] = await db.select().from(db_uploadSessions)
        .where(and(eq(db_uploadSessions.boardId, boardId), eq(db_uploadSessions.assetId, assetId))).limit(1);
    if (open) {
        if (open.digest !== digest || open.byteLength !== byteLength) {
            return NextResponse.json({ message: "This asset id already holds different bytes." }, { status: 409 });
        }
        await db.execute(sql`
            UPDATE upload_sessions SET expires_at = now() + ${`${uploadSessionTtlMs} milliseconds`}::interval
            WHERE upload_id = ${open.uploadId} AND ${editorSessionGuard(gate.identity)}`);
        return NextResponse.json({
            ok: true, uploadId: open.uploadId, chunkSize: open.chunkSize, chunkCount: open.chunkCount,
            received: await receivedChunks(db, boardId, assetId),
        });
    }

    const uploadId = randomUUID();
    const result = await db.execute(sql`
        INSERT INTO upload_sessions (upload_id, board_id, user_id, asset_id, digest, byte_length,
            mime_type, chunk_size, chunk_count, expires_at)
        SELECT ${uploadId}, ${boardId}, ${gate.identity.userId}, ${assetId}, ${digest}, ${byteLength},
            ${mimeType}, ${assetChunkBytes}, ${chunkCount},
            now() + ${`${uploadSessionTtlMs} milliseconds`}::interval
        WHERE ${editorSessionGuard(gate.identity)} AND EXISTS (SELECT 1 FROM boards WHERE board_id = ${boardId})
        RETURNING upload_id`);
    if (!result.rows.length) {
        return NextResponse.json(
            { message: "The session or board is no longer available." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, uploadId, chunkSize: assetChunkBytes, chunkCount, received: [] });
}
