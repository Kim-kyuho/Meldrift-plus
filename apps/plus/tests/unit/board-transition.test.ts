import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { TransitionError, transitionBoard } from "@/lib/board-transition";
import { createEmptyBoardSnapshot, type BoardSnapshot } from "@meldrift/board-data/board-state";

const mocks = vi.hoisted(() => ({
    execute: vi.fn(), limit: vi.fn(), batch: vi.fn(), values: vi.fn(),
    saved: vi.fn(), state: vi.fn(),
}));
vi.mock("@/lib/saved-board-snapshot", () => ({ loadSavedBoardSnapshot: mocks.saved }));
vi.mock("@/lib/board-state-store", () => ({ loadBoardState: mocks.state }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
    execute: mocks.execute,
    batch: mocks.batch,
    delete: () => ({ where: () => ({}) }),
    insert: () => ({ values: mocks.values }),
}) }));

const board = { boardId: 7, title: "Board", width: 100, height: 80 };
const dialect = new PgDialect();
const statements = () => mocks.execute.mock.calls
    .map((call) => dialect.sqlToQuery(call[0] as SQL).sql.replace(/\s+/g, " ").trim());

const withImage = (): BoardSnapshot => ({
    ...createEmptyBoardSnapshot(),
    memos: [{ id: 1, syncId: "memo-1", boardId: 7, content: "<p>a</p>", sortOrder: 1, x: 0, y: 0, z: 1, width: 10, height: 10, color: "#fff" }],
    images: [{
        imageId: 1, syncId: "image-1", assetId: "asset-1", boardId: 7, url: "",
        data: new Uint8Array([1, 2, 3]), mimeType: "image/webp", label: "a.webp",
        x: 0, y: 0, z: 1, width: 10, height: 10,
    }],
    strokes: [{ id: "stroke-1", color: "#000", width: 4, points: [[0, 0], [1, 1]] }],
});

const digest = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

describe("transitionBoard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.limit.mockResolvedValue([{ boardId: 7, mode: "snapshot", revision: 4 }]);
        mocks.batch.mockResolvedValue([]);
        mocks.values.mockResolvedValue(undefined);
        mocks.saved.mockResolvedValue(null);
        mocks.state.mockResolvedValue(createEmptyBoardSnapshot());
        mocks.execute.mockResolvedValue({ rows: [] });
    });

    it("refuses to move a board back from change sync", async () => {
        mocks.limit.mockResolvedValue([{ boardId: 7, mode: "delta", revision: 9 }]);

        await expect(transitionBoard(board)).rejects.toThrow(TransitionError);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("uses the card tables when the board never stored a snapshot", async () => {
        const report = await transitionBoard(board);

        expect(report.source).toBe("tables");
        expect(mocks.batch).not.toHaveBeenCalled();
        expect(statements()[0]).toContain("INSERT INTO board_sync");
        expect(statements()[0]).toContain("'migrating'");
        expect(statements().at(-1)).toContain("SET mode = 'delta'");
    });

    it("blocks both writers while it moves the board", async () => {
        mocks.saved.mockResolvedValue(withImage());
        mocks.state.mockResolvedValue(withImage());
        mocks.execute.mockResolvedValue({
            rows: [{ declared: digest, byte_length: 3, actual: digest, stored_length: "3" }],
        });

        const report = await transitionBoard(board);

        expect(report).toMatchObject({ source: "snapshot", revision: 4, assets: 1 });
        expect(statements()[0]).toContain("'migrating'");
        expect(statements().some((sql) => sql.includes("INSERT INTO asset_chunks"))).toBe(true);
        expect(statements().some((sql) => sql.includes("INSERT INTO assets"))).toBe(true);
        expect(statements().at(-1)).toContain("mode = 'migrating'");
    });

    it("stops when a card is missing after the move", async () => {
        mocks.saved.mockResolvedValue(withImage());
        mocks.state.mockResolvedValue({ ...withImage(), memos: [] });

        await expect(transitionBoard(board)).rejects.toThrow("Moved 0 memos but the source had 1");
        expect(statements().some((sql) => sql.includes("SET mode = 'delta'"))).toBe(false);
    });

    it("stops when the stored image bytes do not hash to the source", async () => {
        mocks.saved.mockResolvedValue(withImage());
        mocks.state.mockResolvedValue(withImage());
        mocks.execute.mockResolvedValue({
            rows: [{ declared: digest, byte_length: 3, actual: "f".repeat(64), stored_length: "3" }],
        });

        await expect(transitionBoard(board)).rejects.toThrow("do not match the source image");
        expect(statements().some((sql) => sql.includes("SET mode = 'delta'"))).toBe(false);
    });
});
