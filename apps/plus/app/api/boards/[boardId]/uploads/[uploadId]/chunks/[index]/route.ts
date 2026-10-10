import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { assetChunkBytes } from "@meldrift/board-data/board-delta";
import { getDb } from "@/lib/db";
import { db_uploadSessions } from "@/lib/db/schema";
import { editorFromRequest, editorSessionGuard } from "@/lib/editor-guard";
import { chunkLengthFor } from "@/lib/assets";

type Context = { params: Promise<{ boardId: string; uploadId: string; index: string }> };
export const maxDuration = 60;

export async function PUT(request: NextRequest, { params }: Context) {
    const { boardId: rawBoardId, uploadId, index: rawIndex } = await params;
    const boardId = Number(rawBoardId);
    const index = Number(rawIndex);
    const gate = await editorFromRequest(request, boardId);
    if (!gate.identity) {
        return gate.failure;
    }
    if (!Number.isSafeInteger(index) || index < 0) {
        return NextResponse.json({ message: "Invalid chunk index." }, { status: 400 });
    }
    if (Number(request.headers.get("Content-Length")) > assetChunkBytes) {
        return NextResponse.json({ message: "Chunks must be 1 MiB or smaller." }, { status: 413 });
    }

    const db = getDb();
    const [session] = await db.select().from(db_uploadSessions)
        .where(and(eq(db_uploadSessions.uploadId, uploadId), eq(db_uploadSessions.boardId, boardId))).limit(1);
    if (!session || session.userId !== gate.identity.userId) {
        return NextResponse.json({ message: "This upload does not exist." }, { status: 404 });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
        return NextResponse.json({ message: "This upload expired. Start it again." }, { status: 409 });
    }
    if (index >= session.chunkCount) {
        return NextResponse.json({ message: "Invalid chunk index." }, { status: 400 });
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength !== chunkLengthFor(session.byteLength, index)) {
        return NextResponse.json({ message: "This chunk is not the declared length." }, { status: 400 });
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (request.headers.get("X-Chunk-Digest") !== digest) {
        return NextResponse.json({ message: "This chunk does not match its checksum." }, { status: 400 });
    }

    const result = await db.execute(sql`
        INSERT INTO asset_chunks (board_id, asset_id, chunk_index, bytes)
        SELECT ${boardId}, ${session.assetId}, ${index}, decode(${bytes.toString("hex")}, 'hex')
        WHERE ${editorSessionGuard(gate.identity)}
            AND EXISTS (SELECT 1 FROM upload_sessions WHERE upload_id = ${uploadId} AND expires_at > now())
        ON CONFLICT (board_id, asset_id, chunk_index) DO UPDATE SET bytes = excluded.bytes
        RETURNING chunk_index`);
    if (!result.rows.length) {
        return NextResponse.json(
            { message: "The session changed. Reload to recover." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, index });
}
