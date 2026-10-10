import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardSelection } from "@meldrift/ui/useBoardSelection";
import type { BoardImage, BoardMemo, BoardMermaid, BoardTable } from "@/lib/board-state";

const memo = (id: number, x: number, y: number): BoardMemo => ({ id, syncId: `memo-${id}`, boardId: 1, content: "memo", x, y, z: id, width: 100, height: 100, color: "#fff", sortOrder: id });
const image: BoardImage = { imageId: 2, syncId: "image-2", assetId: "", boardId: 1, url: "https://example.com/image.png", data: null, mimeType: null, label: null, x: 500, y: 500, z: 2, width: 100, height: 100 };

function createStateSetter<T>(initial: T[]) {
    let state = initial;
    const setter = vi.fn((update: React.SetStateAction<T[]>) => {
        state = typeof update === "function" ? update(state) : update;
    });
    return { setter, getState: () => state };
}

function setup(memos: BoardMemo[] = [memo(1, 0, 0), memo(3, 200, 0)], images: BoardImage[] = [image]) {
    const memoState = createStateSetter(memos);
    const imageState = createStateSetter(images);
    const mermaidState = createStateSetter<BoardMermaid>([]);
    const tableState = createStateSetter<BoardTable>([]);
    const onDeleteMemo = vi.fn();
    const onDeleteImage = vi.fn();
    const hook = renderHook(() => useBoardSelection({
        boardWidth: 1000,
        boardHeight: 800,
        memos, images, mermaids: [], tables: [],
        setMemos: memoState.setter,
        setImages: imageState.setter,
        setMermaids: mermaidState.setter,
        setTables: tableState.setter,
        onDeleteMemo,
        onDeleteImage,
        onDeleteMermaid: vi.fn(),
        onDeleteTable: vi.fn(),
    }));
    return { ...hook, memoState, imageState, mermaidState, tableState, onDeleteMemo, onDeleteImage };
}

describe("useBoardSelection", () => {
    it("selects every card the rectangle overlaps, even partially", () => {
        const state = setup();
        act(() => state.result.current.handleSelectCards({ x: 90, y: 90, width: 120, height: 20 }));
        expect(state.result.current.selectedCards).toEqual([
            { type: "memo", id: 1 },
            { type: "memo", id: 3 },
        ]);
        expect(state.result.current.selectionBounds).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    });

    it("selects nothing when the rectangle only touches an edge", () => {
        const state = setup();
        act(() => state.result.current.handleSelectCards({ x: 100, y: 0, width: 50, height: 50 }));
        expect(state.result.current.selectedCards).toEqual([]);
        expect(state.result.current.selectionBounds).toBeNull();
    });

    it("moves only the selected cards by the same offset", () => {
        const state = setup();
        act(() => state.result.current.handleSelectCards({ x: 0, y: 0, width: 10, height: 10 }));
        act(() => state.result.current.handleMoveSelection({ x: 40, y: 30 }));
        expect(state.memoState.getState()).toMatchObject([{ id: 1, x: 40, y: 30 }, { id: 3, x: 200, y: 0 }]);
        expect(state.imageState.setter).not.toHaveBeenCalled();
    });

    it("clamps the move so the group box stays on the board", () => {
        const state = setup();
        act(() => state.result.current.handleSelectCards({ x: 0, y: 0, width: 1000, height: 800 }));
        const offset = state.result.current.clampSelectionOffset({ x: -50, y: 900 });
        expect(offset.x).toBeCloseTo(0);
        expect(offset.y).toBe(200);
        act(() => state.result.current.handleMoveSelection({ x: -50, y: 900 }));
        expect(state.memoState.getState()).toMatchObject([{ x: 0, y: 200 }, { x: 200, y: 200 }]);
        expect(state.imageState.getState()[0]).toMatchObject({ x: 500, y: 700 });
    });

    it("deletes every selected card through its collection handler and clears the selection", () => {
        const state = setup();
        act(() => state.result.current.handleSelectCards({ x: 0, y: 0, width: 1000, height: 800 }));
        act(() => state.result.current.handleDeleteSelection());
        expect(state.onDeleteMemo.mock.calls).toEqual([[1], [3]]);
        expect(state.onDeleteImage).toHaveBeenCalledWith(2);
        expect(state.result.current.selectedCards).toEqual([]);
    });

    it("clears the selection when the mode is turned off", () => {
        const state = setup();
        act(() => state.result.current.handleToggleSelectionMode());
        act(() => state.result.current.handleSelectCards({ x: 0, y: 0, width: 10, height: 10 }));
        act(() => state.result.current.handleToggleSelectionMode());
        expect(state.result.current.selectionMode).toBe(false);
        expect(state.result.current.selectedCards).toEqual([]);
    });
});
