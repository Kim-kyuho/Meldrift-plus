import { describe, expect, it } from "vitest";
import { diffBoardSnapshots, mergeBoardOperations, type BoardOperation } from "../src/board-delta";
import { createEmptyBoardSnapshot, type BoardImage, type BoardMemo, type BoardSnapshot } from "../src/board-state";

const memo = (overrides: Partial<BoardMemo> = {}): BoardMemo => ({
    id: 1, syncId: "memo-1", boardId: 1, content: "<p>memo</p>",
    x: 0, y: 0, z: 1, width: 300, height: 200, color: "#fffadc", sortOrder: 1,
    ...overrides,
});

const image = (overrides: Partial<BoardImage> = {}): BoardImage => ({
    imageId: 1, syncId: "image-1", assetId: "asset-1", boardId: 1, url: "", data: new Uint8Array([1, 2, 3]),
    mimeType: "image/webp", label: "a.webp", x: 0, y: 0, z: 1, width: 400, height: 300,
    ...overrides,
});

const withMemos = (...memos: BoardMemo[]): BoardSnapshot => ({ ...createEmptyBoardSnapshot(), memos });
const withImages = (...images: BoardImage[]): BoardSnapshot => ({ ...createEmptyBoardSnapshot(), images });

describe("diffBoardSnapshots", () => {
    it("produces nothing when the snapshot is unchanged", () => {
        const snapshot = withMemos(memo());
        expect(diffBoardSnapshots(snapshot, snapshot)).toEqual([]);
    });

    it("sends only the moved coordinates", () => {
        const before = withMemos(memo());
        const after = withMemos(memo({ x: 120, y: 240 }));

        expect(diffBoardSnapshots(before, after)).toEqual([
            { type: "memo", syncId: "memo-1", action: "update", changes: { x: 120, y: 240 } },
        ]);
    });

    it("sends the full field set on create", () => {
        const [operation] = diffBoardSnapshots(createEmptyBoardSnapshot(), withMemos(memo()));

        expect(operation.action).toBe("create");
        expect(operation.changes).toEqual({
            x: 0, y: 0, z: 1, width: 300, height: 200,
            content: "<p>memo</p>", color: "#fffadc", sortOrder: 1,
        });
    });

    it("sends a delete with no fields", () => {
        expect(diffBoardSnapshots(withMemos(memo()), createEmptyBoardSnapshot())).toEqual([
            { type: "memo", syncId: "memo-1", action: "delete", changes: {} },
        ]);
    });

    it("does not mark the asset when only the image geometry changes", () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const before = withImages(image({ data: bytes }));
        const after = withImages(image({ data: bytes, x: 50, width: 200 }));

        expect(diffBoardSnapshots(before, after)).toEqual([
            { type: "image", syncId: "image-1", action: "update", changes: { x: 50, width: 200 } },
        ]);
    });

    it("marks the asset when the image points at new bytes", () => {
        const before = withImages(image());
        const after = withImages(image({ assetId: "asset-2", data: new Uint8Array([9, 9]) }));
        const [operation] = diffBoardSnapshots(before, after);

        expect(operation.asset).toBe(true);
    });

    it("compares the binary by asset id, not by array identity", () => {
        const before = withImages(image({ data: new Uint8Array([1, 2, 3]) }));
        const reloaded = withImages(image({ data: new Uint8Array([1, 2, 3]) }));

        expect(diffBoardSnapshots(before, reloaded)).toEqual([]);
    });

    it("compares the table source by value and carries the new one", () => {
        const source = { columns: [{ id: "c", name: "C" }], rows: [{ id: "r", cells: { c: "1" } }] };
        const base = { id: 1, syncId: "table-1", boardId: 1, x: 0, y: 0, z: 1, width: 100, height: 100 };
        const tables = (value: typeof source): BoardSnapshot =>
            ({ ...createEmptyBoardSnapshot(), tables: [{ ...base, source: value }] });
        const changed = structuredClone(source);
        changed.rows[0].cells.c = "2";

        expect(diffBoardSnapshots(tables(source), tables(structuredClone(source)))).toEqual([]);
        expect(diffBoardSnapshots(tables(source), tables(changed))).toEqual([
            { type: "table", syncId: "table-1", action: "update", changes: { source: changed } },
        ]);
    });

    it("ignores the key order Postgres jsonb gives back", () => {
        const source = { columns: [{ id: "c", name: "C" }], rows: [{ id: "r", cells: { c: "1" } }] };
        const reordered = { rows: source.rows, columns: source.columns };
        const base = { id: 1, syncId: "table-1", boardId: 1, x: 0, y: 0, z: 1, width: 100, height: 100 };
        const tables = (value: typeof source): BoardSnapshot =>
            ({ ...createEmptyBoardSnapshot(), tables: [{ ...base, source: value }] });

        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(source));
        expect(diffBoardSnapshots(tables(source), tables(reordered))).toEqual([]);
    });

    it("ignores stroke points that were only cloned", () => {
        const stroke = { id: "stroke-1", color: "#000", width: 4, points: [[0, 0], [1, 1]] as [number, number][] };
        const strokes = (value: typeof stroke): BoardSnapshot =>
            ({ ...createEmptyBoardSnapshot(), strokes: [value] });

        expect(diffBoardSnapshots(strokes(stroke), strokes(structuredClone(stroke)))).toEqual([]);
    });

    it("carries the redrawn stroke points instead of an asset flag", () => {
        const stroke = { id: "stroke-1", color: "#000", width: 4, points: [[0, 0], [1, 1]] as [number, number][] };
        const strokes = (points: [number, number][]): BoardSnapshot =>
            ({ ...createEmptyBoardSnapshot(), strokes: [{ ...stroke, points }] });
        const erased: [number, number][] = [[0, 0], [1, 1], [2, 2]];

        expect(diffBoardSnapshots(strokes(stroke.points), strokes(erased))).toEqual([
            { type: "stroke", syncId: "stroke-1", action: "update", changes: { points: erased } },
        ]);
    });

    it("carries the new asset id alongside the flag", () => {
        const before = withImages(image());
        const after = withImages(image({ assetId: "asset-2", data: new Uint8Array([9]) }));

        expect(diffBoardSnapshots(before, after)).toEqual([{
            type: "image", syncId: "image-1", action: "update",
            changes: { assetId: "asset-2" }, asset: true,
        }]);
    });
});

describe("mergeBoardOperations", () => {
    const move = (x: number): BoardOperation =>
        ({ type: "memo", syncId: "memo-1", action: "update", changes: { x } });

    it("keeps only the final position of repeated moves", () => {
        expect(mergeBoardOperations([move(10)], [move(80)])).toEqual([move(80)]);
    });

    it("merges a resize into a pending move", () => {
        const resize: BoardOperation = { type: "memo", syncId: "memo-1", action: "update", changes: { width: 400 } };

        expect(mergeBoardOperations([move(10)], [resize])).toEqual([
            { type: "memo", syncId: "memo-1", action: "update", changes: { x: 10, width: 400 } },
        ]);
    });

    it("folds an edit into a pending create", () => {
        const create: BoardOperation = {
            type: "memo", syncId: "memo-1", action: "create", changes: { x: 0, content: "" },
        };
        const edit: BoardOperation = {
            type: "memo", syncId: "memo-1", action: "update", changes: { content: "<p>hi</p>" },
        };

        expect(mergeBoardOperations([create], [edit])).toEqual([
            { type: "memo", syncId: "memo-1", action: "create", changes: { x: 0, content: "<p>hi</p>" } },
        ]);
    });

    it("cancels a create that is deleted before it is sent", () => {
        const create: BoardOperation = { type: "memo", syncId: "memo-1", action: "create", changes: {} };
        const remove: BoardOperation = { type: "memo", syncId: "memo-1", action: "delete", changes: {} };

        expect(mergeBoardOperations([create], [remove])).toEqual([]);
    });

    it("keeps only the delete when an existing card is edited then removed", () => {
        const remove: BoardOperation = { type: "memo", syncId: "memo-1", action: "delete", changes: {} };

        expect(mergeBoardOperations([move(10)], [remove])).toEqual([remove]);
    });

    it("keeps the asset flag once it is set", () => {
        const replace: BoardOperation = {
            type: "image", syncId: "image-1", action: "update", changes: {}, asset: true,
        };
        const nudge: BoardOperation = { type: "image", syncId: "image-1", action: "update", changes: { x: 5 } };

        expect(mergeBoardOperations([replace], [nudge])).toEqual([
            { type: "image", syncId: "image-1", action: "update", changes: { x: 5 }, asset: true },
        ]);
    });

    it("leaves unrelated cards untouched", () => {
        const other: BoardOperation = { type: "mermaid", syncId: "mermaid-2", action: "update", changes: { z: 3 } };

        expect(mergeBoardOperations([move(10)], [other])).toEqual([move(10), other]);
    });
});
