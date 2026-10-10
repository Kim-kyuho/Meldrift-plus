import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { schemaSql } from "@meldrift/board-data/sqlite-codec";
import { decodeSnapshot } from "@/lib/snapshot-codec";

async function fixture() {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(schemaSql);
    db.run("INSERT INTO boards (board_id, title, width, height) VALUES (7, 'Board', 7680, 4320)");
    return db;
}

describe("SQLite server validation", () => {
    it("round-trips a board and binary image", async () => {
        const db = await fixture();
        db.run("INSERT INTO images (board_id, image_data, mime_type, width, height) VALUES (7, ?, 'image/png', 100, 100)", [new Uint8Array([1, 2, 3])]);
        try {
            const snapshot = await decodeSnapshot(db.export(), 7);
            expect(snapshot.board.boardId).toBe(7);
            expect(Array.from(snapshot.images[0].data!)).toEqual([1, 2, 3]);
        } finally { db.close(); }
    });
    it("rejects a board ID mismatch", async () => {
        const db = await fixture();
        try { await expect(decodeSnapshot(db.export(), 8)).rejects.toThrow(); }
        finally { db.close(); }
    });
    it("rejects multiple boards", async () => {
        const db = await fixture();
        db.run("INSERT INTO boards (board_id, title, width, height) VALUES (8, 'Other', 100, 100)");
        try { await expect(decodeSnapshot(db.export(), 7)).rejects.toThrow("one board"); }
        finally { db.close(); }
    });
    it("rejects URL-only images in a server snapshot", async () => {
        const db = await fixture();
        db.run("INSERT INTO images (board_id, url) VALUES (7, 'https://example.com/image.png')");
        try { await expect(decodeSnapshot(db.export(), 7)).rejects.toThrow("binary data"); }
        finally { db.close(); }
    });
    it("rejects malformed and oversized uploads", async () => {
        await expect(decodeSnapshot(new Uint8Array([1, 2, 3]), 7)).rejects.toThrow("Invalid SQLite");
        await expect(decodeSnapshot(new Uint8Array(4 * 1024 * 1024 + 1), 7)).rejects.toThrow("4 MiB");
    });
});
