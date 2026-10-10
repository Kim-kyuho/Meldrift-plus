import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { maxChangeBytes, maxStagedOperations } from "@meldrift/board-data/board-delta";
import { getDb } from "@/lib/db";
import { db_assets, db_syncMutations } from "@/lib/db/schema";
import { discardAsset, readAssetBytes, stagedChangeMimeType } from "@/lib/assets";
import { getCurrentUserFromRequest, getCardPermissionMessage } from "@/lib/auth/current-user";
import { getSessionTokenHash, sessionCookieName } from "@/lib/auth/session";
import {
    ChangeRequestError, changeRequestDigest, maxOperationsPerRequest, parseChangeRequest,
} from "@/lib/sync-operations";
import { buildCommitStatements, referencedAssetIds } from "@/lib/sync-commit";

type Context = { params: Promise<{ boardId: string }> };
export const maxDuration = 60;

const tooLarge = () =>
    NextResponse.json({ message: "Change requests must be 1 MiB or smaller." }, { status: 413 });

export async function GET(request: NextRequest, { params }: Context) {
    const boardId = Number((await params).boardId);
    const mutationId = new URL(request.url).searchParams.get("mutationId") ?? "";
    if (!Number.isSafeInteger(boardId) || boardId <= 0 || !/^[a-zA-Z0-9:-]{1,160}$/.test(mutationId)) {
        return NextResponse.json({ message: "Invalid change lookup." }, { status: 400 });
    }

    const [applied] = await getDb().select().from(db_syncMutations)
        .where(and(eq(db_syncMutations.boardId, boardId), eq(db_syncMutations.mutationId, mutationId)))
        .limit(1);

    return NextResponse.json(
        { ok: true, applied: Boolean(applied), revision: applied?.revision ?? null },
        { headers: { "Cache-Control": "no-store" } },
    );
}

export async function POST(request: NextRequest, { params }: Context) {
    const user = await getCurrentUserFromRequest(request);
    const message = getCardPermissionMessage(user);
    if (message || !user) {
        return NextResponse.json({ message }, { status: 403 });
    }

    const boardId = Number((await params).boardId);
    if (!Number.isSafeInteger(boardId) || boardId <= 0) {
        return NextResponse.json({ message: "Invalid change request." }, { status: 400 });
    }
    if (Number(request.headers.get("Content-Length")) > maxChangeBytes) {
        return tooLarge();
    }

    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > maxChangeBytes) {
        return tooLarge();
    }

    const hash = getSessionTokenHash(request.cookies.get(sessionCookieName)?.value);
    const db = getDb();

    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { return NextResponse.json({ message: "Invalid change request." }, { status: 400 }); }

    const staged = (payload as { staged?: unknown })?.staged === true;
    const stagedId = String((payload as { mutationId?: unknown })?.mutationId ?? "");
    if (staged) {
        const stored = await readAssetBytes(db, boardId, stagedId);
        if (!stored || stored.mimeType !== stagedChangeMimeType) {
            const [applied] = await db.select().from(db_syncMutations)
                .where(and(eq(db_syncMutations.boardId, boardId), eq(db_syncMutations.mutationId, stagedId)))
                .limit(1);
            if (applied) {
                return NextResponse.json({ ok: true, revision: applied.revision });
            }
            return NextResponse.json(
                { message: "The staged changes are no longer available. Upload them again." }, { status: 409 });
        }
        try { payload = { ...(payload as object), operations: JSON.parse(stored.bytes.toString("utf8")) }; }
        catch { return NextResponse.json({ message: "Invalid change request." }, { status: 400 }); }
    }

    let digest: string;
    let statements;
    let changeRequest;
    try {
        changeRequest = parseChangeRequest(payload, staged ? maxStagedOperations : maxOperationsPerRequest);
        digest = changeRequestDigest(changeRequest);
        statements = buildCommitStatements(changeRequest, {
            boardId, userId: user.id, sessionHash: hash,
            baseRevision: changeRequest.baseRevision, mutationId: changeRequest.mutationId, digest,
        });
    } catch (error) {
        const reason = error instanceof ChangeRequestError ? error.message : "Invalid change request.";
        return NextResponse.json({ message: reason }, { status: 400 });
    }

    const assetIds = referencedAssetIds(changeRequest);
    if (assetIds.length > 0) {
        const stored = await db.select({ assetId: db_assets.assetId }).from(db_assets)
            .where(and(eq(db_assets.boardId, boardId), inArray(db_assets.assetId, assetIds)));
        if (stored.length !== assetIds.length) {
            return NextResponse.json(
                { message: "Upload the image bytes before committing the card." }, { status: 409 });
        }
    }

    const [lock, ...rest] = statements.map((statement) => db.execute(statement));
    const results = await db.batch([lock, ...rest]);
    const committed = results[results.length - 1];
    if (committed.rows.length) {
        if (staged) {
            await discardAsset(db, boardId, stagedId);
        }
        return NextResponse.json({ ok: true, revision: Number(committed.rows[0].revision) });
    }

    const [applied] = await db.select().from(db_syncMutations)
        .where(and(eq(db_syncMutations.boardId, boardId), eq(db_syncMutations.mutationId, changeRequest.mutationId)))
        .limit(1);
    if (applied) {
        if (staged) {
            await discardAsset(db, boardId, stagedId);
        }
        if (applied.digest !== digest) {
            return NextResponse.json({ message: "This request id already committed different changes." }, { status: 409 });
        }
        return NextResponse.json({ ok: true, revision: applied.revision });
    }
    return NextResponse.json(
        { message: "The session, board version or storage mode changed. Reload to recover." },
        { status: 409 },
    );
}
