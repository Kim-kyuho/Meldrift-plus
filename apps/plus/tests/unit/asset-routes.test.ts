import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getTableName, type Table } from "drizzle-orm";
import { POST as startUpload } from "@/app/api/boards/[boardId]/uploads/route";
import { PUT as putChunk } from "@/app/api/boards/[boardId]/uploads/[uploadId]/chunks/[index]/route";
import { POST as completeUpload } from "@/app/api/boards/[boardId]/uploads/[uploadId]/complete/route";
import { GET as getChunk } from "@/app/api/boards/[boardId]/assets/[assetId]/chunks/[index]/route";
import { GET as getAssetBytes } from "@/app/api/boards/[boardId]/assets/[assetId]/bytes/route";
import { maxStoredImageBytes } from "@meldrift/board-data/image-file";

const mocks = vi.hoisted(() => ({
    user: vi.fn(), permission: vi.fn(), execute: vi.fn(), rows: vi.fn(), deleteWhere: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({
    getCurrentUserFromRequest: mocks.user, getCardPermissionMessage: mocks.permission,
}));
vi.mock("@/lib/auth/session", () => ({
    getSessionTokenHash: () => "current-session", sessionCookieName: "session",
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({
    select: () => ({ from: (table: Table) => ({
        where: () => Object.assign(
            Promise.resolve(mocks.rows(getTableName(table))),
            { limit: async () => mocks.rows(getTableName(table)), orderBy: async () => mocks.rows(getTableName(table)) },
        ),
    }) }),
    execute: mocks.execute,
    delete: () => ({ where: mocks.deleteWhere }),
}) }));

const dialect = new PgDialect();
const rendered = (call = 0) =>
    dialect.sqlToQuery(mocks.execute.mock.calls[call][0] as SQL).sql.replace(/\s+/g, " ").trim();

const session = {
    uploadId: "u1", boardId: 7, userId: 5, assetId: "asset-1", digest: "a".repeat(64),
    byteLength: 3, mimeType: "image/webp", chunkSize: 1024 * 1024, chunkCount: 1,
    expiresAt: new Date(Date.now() + 60000),
};

const start = (body: unknown) => startUpload(
    new NextRequest("http://localhost/api/boards/7/uploads", {
        method: "POST", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ boardId: "7" }) },
);

const chunk = (bytes: Buffer, digest = createHash("sha256").update(bytes).digest("hex")) => putChunk(
    new NextRequest("http://localhost/api/boards/7/uploads/u1/chunks/0", {
        method: "PUT", body: new Uint8Array(bytes),
        headers: { "X-Chunk-Digest": digest },
    }),
    { params: Promise.resolve({ boardId: "7", uploadId: "u1", index: "0" }) },
);

describe("asset upload routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.mockResolvedValue({ id: 5, isApproved: true });
        mocks.permission.mockReturnValue(null);
        mocks.rows.mockReturnValue([]);
        mocks.execute.mockResolvedValue({ rows: [{ upload_id: "u1", chunk_index: 0, asset_id: "asset-1" }] });
    });

    it("splits the asset into chunks and guards the session insert", async () => {
        const response = await start({
            assetId: "asset-1", digest: "a".repeat(64), byteLength: 3 * 1024 * 1024 + 1, mimeType: "image/webp",
        });

        expect(await response.json()).toMatchObject({ ok: true, chunkSize: 1024 * 1024, chunkCount: 4 });
        expect(rendered()).toContain("INSERT INTO upload_sessions");
        expect(rendered()).toContain("u.session_token_hash = $");
        expect(rendered()).toContain("EXISTS (SELECT 1 FROM boards WHERE board_id = $");
    });

    it.each([4 * 1024 * 1024 + 1, maxStoredImageBytes])(
        "accepts a prepared image of %i bytes for chunked upload",
        async (byteLength) => {
            const response = await start({
                assetId: "asset-large", digest: "a".repeat(64), byteLength, mimeType: "image/webp",
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ chunkSize: 1024 * 1024, chunkCount: 5 });
        },
    );

    it("accepts three independent images even when their combined size exceeds 4 MiB", async () => {
        for (let index = 0; index < 3; index += 1) {
            const response = await start({
                assetId: `asset-${index}`, digest: "a".repeat(64),
                byteLength: 2 * 1024 * 1024, mimeType: "image/png",
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ chunkCount: 2 });
        }
        expect(mocks.execute).toHaveBeenCalledTimes(3);
    });

    it("reports the image size policy when a prepared image is too large", async () => {
        const response = await start({
            assetId: "asset-large", digest: "a".repeat(64),
            byteLength: maxStoredImageBytes + 1, mimeType: "image/webp",
        });
        expect(response.status).toBe(400);
        expect((await response.json()).message).toContain("5 MiB");
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("identifies the invalid upload field without including the request contents", async () => {
        const response = await start({
            assetId: "asset-1", digest: "a".repeat(64), byteLength: 100, mimeType: null,
        });
        expect(response.status).toBe(400);
        expect((await response.json()).message).toContain("mimeType");
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("skips the upload when the server already holds those bytes", async () => {
        mocks.rows.mockImplementation((table: string) =>
            table === "assets" ? [{ assetId: "asset-1", digest: "a".repeat(64) }] : []);

        const response = await start({
            assetId: "asset-1", digest: "a".repeat(64), byteLength: 3, mimeType: "image/webp",
        });

        expect(await response.json()).toEqual({ ok: true, assetId: "asset-1", complete: true });
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("refuses to reuse an asset id for different bytes", async () => {
        mocks.rows.mockImplementation((table: string) =>
            table === "assets" ? [{ assetId: "asset-1", digest: "b".repeat(64) }] : []);

        const response = await start({
            assetId: "asset-1", digest: "a".repeat(64), byteLength: 3, mimeType: "image/webp",
        });

        expect(response.status).toBe(409);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it.each([
        ["an unsupported type", { assetId: "asset-1", digest: "a".repeat(64), byteLength: 3, mimeType: "image/gif" }],
        ["a short digest", { assetId: "asset-1", digest: "a", byteLength: 3, mimeType: "image/webp" }],
        ["an empty asset", { assetId: "asset-1", digest: "a".repeat(64), byteLength: 0, mimeType: "image/webp" }],
    ])("rejects %s", async (_label, body) => {
        expect((await start(body)).status).toBe(400);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("rejects a chunk that is not the declared length", async () => {
        mocks.rows.mockImplementation((table: string) => table === "upload_sessions" ? [session] : []);

        const response = await chunk(Buffer.from([1, 2]));

        expect(response.status).toBe(400);
        expect((await response.json()).message).toContain("declared length");
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("rejects a chunk that does not match its checksum", async () => {
        mocks.rows.mockImplementation((table: string) => table === "upload_sessions" ? [session] : []);

        const response = await chunk(Buffer.from([1, 2, 3]), "f".repeat(64));

        expect(response.status).toBe(400);
        expect((await response.json()).message).toContain("checksum");
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("stores a verified chunk and keeps the upload resumable", async () => {
        mocks.rows.mockImplementation((table: string) => table === "upload_sessions" ? [session] : []);

        expect((await chunk(Buffer.from([1, 2, 3]))).status).toBe(200);
        expect(rendered()).toContain("INSERT INTO asset_chunks");
        expect(rendered()).toContain("ON CONFLICT (board_id, asset_id, chunk_index) DO UPDATE SET bytes = excluded.bytes");
        expect(rendered()).toContain("expires_at > now()");
    });

    it("refuses a chunk once the upload expired", async () => {
        mocks.rows.mockImplementation((table: string) =>
            table === "upload_sessions" ? [{ ...session, expiresAt: new Date(Date.now() - 1) }] : []);

        expect((await chunk(Buffer.from([1, 2, 3]))).status).toBe(409);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("confirms the asset only after checking count, order, length and hash", async () => {
        mocks.rows.mockImplementation((table: string) => table === "upload_sessions" ? [session] : []);

        const response = await completeUpload(
            new NextRequest("http://localhost", { method: "POST" }),
            { params: Promise.resolve({ boardId: "7", uploadId: "u1" }) },
        );

        expect(await response.json()).toEqual({ ok: true, assetId: "asset-1", complete: true });
        const sql = rendered();
        expect(sql).toContain("encode(sha256(coalesce(string_agg(bytes, ''::bytea ORDER BY chunk_index)");
        expect(sql).toContain("p.chunk_count = $");
        expect(sql).toContain("p.last_index = $");
        expect(sql).toContain("p.byte_length = $");
        expect(sql).toContain("p.digest = $");
        expect(mocks.deleteWhere).toHaveBeenCalledOnce();
    });

    it("keeps the upload open when the chunks do not add up", async () => {
        mocks.rows.mockImplementation((table: string) => table === "upload_sessions" ? [session] : []);
        mocks.execute.mockResolvedValue({ rows: [] });

        const response = await completeUpload(
            new NextRequest("http://localhost", { method: "POST" }),
            { params: Promise.resolve({ boardId: "7", uploadId: "u1" }) },
        );

        expect(response.status).toBe(409);
        expect(mocks.deleteWhere).not.toHaveBeenCalled();
    });

    it("serves chunk bytes without letting the browser interpret them", async () => {
        mocks.rows.mockReturnValue([{ bytes: Buffer.from([1, 2, 3]) }]);

        const response = await getChunk(new Request("http://localhost"), {
            params: Promise.resolve({ boardId: "7", assetId: "asset-1", index: "0" }),
        });

        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it.each([
        ["Buffer", Buffer.from([1, 2, 3])],
        ["\\x 16진수 문자열", "\\x010203"],
    ])("이어 붙인 자산을 %s로 받아도 같은 바이트를 낸다", async (_label, bytes) => {
        mocks.execute.mockResolvedValue({ rows: [{ mime_type: "image/webp", bytes }] });

        const response = await getAssetBytes(new Request("http://localhost"), {
            params: Promise.resolve({ boardId: "7", assetId: "asset-1" }),
        });

        expect(response.headers.get("Content-Type")).toBe("image/webp");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("hides an unknown asset chunk", async () => {
        mocks.rows.mockReturnValue([]);

        const response = await getChunk(new Request("http://localhost"), {
            params: Promise.resolve({ boardId: "7", assetId: "asset-1", index: "0" }),
        });

        expect(response.status).toBe(404);
    });
});
