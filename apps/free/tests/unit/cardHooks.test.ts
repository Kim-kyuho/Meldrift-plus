import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageCard, type ImageCardData } from "@meldrift/ui/useImageCard";
import { useMemoCard, type MemoCardData } from "@meldrift/ui/useMemoCard";
import { useMermaidCard, type MermaidCardData } from "@meldrift/ui/useMermaidCard";
import { useTableCard } from "@meldrift/ui/useTableCard";
import type { BoardTable } from "@meldrift/ui/useBoardTables";

function dispatchBoardPress(type: "pointerdown" | "pointerup") {
    const board = document.createElement("div");
    board.className = "board-scroll-layer";
    document.body.appendChild(board);
    board.dispatchEvent(new PointerEvent(type, { bubbles: true }));
    board.remove();
}

const memo: MemoCardData = {
    id: 1, boardId: 5, content: "memo", x: 10.4, y: 20.4, z: 3,
    width: 300, height: 200, color: "#fffadc", sortOrder: 1,
};
const image: ImageCardData = {
    imageId: 2, boardId: 5, url: "https://example.com/image.png", label: "image.png",
    data: null, mimeType: null,
    x: 10, y: 20, z: 4, width: 400, height: 300,
};
const mermaid: MermaidCardData = {
    id: 3, boardId: 5, source: "flowchart LR", x: 10, y: 20, z: 5,
    width: 480, height: 360,
};
const table: BoardTable = {
    id: 4, syncId: "table-4", boardId: 5, source: { columns: [{ id: "c", name: "C" }], rows: [] },
    x: 10, y: 20, z: 6, width: 560, height: 360,
};

describe("card hooks", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    describe("useMemoCard", () => {
        const setup = (overrides: Partial<Parameters<typeof useMemoCard>[0]> = {}) => {
            const callbacks = {
                onEditing: vi.fn(), onEditingClear: vi.fn(), onFocus: vi.fn(), onFocusClear: vi.fn(),
                onInsert: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(),
            };
            const hook = renderHook(() => useMemoCard({
                memo, isEditing: true, isFocused: true, ...callbacks, ...overrides,
            }));
            return { ...hook, ...callbacks };
        };

        it("enters edit mode directly", () => {
            const onEditing = vi.fn();
            const { result } = setup({ onEditing });
            act(() => result.current.editMemo());
            expect(onEditing).toHaveBeenCalledOnce();
        });

        it("saves the latest content and rounded geometry on an empty-board press", () => {
            const { result, onUpdate, onEditingClear } = setup();
            act(() => result.current.setMemoContent("updated"));
            act(() => result.current.handleDragStop({} as never, { x: 31.6, y: 42.4 } as never));
            act(() => {
                dispatchBoardPress("pointerdown");
                dispatchBoardPress("pointerup");
            });
            expect(onUpdate).toHaveBeenCalledWith(1, 5, "updated", 32, 42, 300, 200, "#fffadc");
            expect(onEditingClear).toHaveBeenCalledOnce();
        });

        it("inserts temporary memos and confirms deletion", () => {
            const onInsert = vi.fn();
            const onDelete = vi.fn();
            const onEditingClear = vi.fn();
            const { result } = setup({ memo: { ...memo, id: -1 }, onInsert, onDelete, onEditingClear });
            act(() => {
                dispatchBoardPress("pointerdown");
                dispatchBoardPress("pointerup");
            });
            expect(onInsert).toHaveBeenCalled();
            act(() => result.current.openDeleteDialog());
            expect(result.current.deleteDialogOpen).toBe(true);
            act(() => result.current.confirmDelete());
            expect(onDelete).toHaveBeenCalledWith(-1);
            expect(result.current.deleteDialogOpen).toBe(false);
        });
    });

    describe("useImageCard", () => {
        it("uses the latest drag state when saving a persisted image", () => {
            const onUpdate = vi.fn();
            const onEditingClear = vi.fn();
            const { result } = renderHook(() => useImageCard({
                image, isEditing: true, onEditing: vi.fn(), onEditingClear,
                onUpdate, onDelete: vi.fn(),
            }));
            act(() => result.current.handleDragStop({} as never, { x: 50.6, y: 60.4 } as never));
            act(() => dispatchBoardPress("pointerup"));
            act(() => vi.runAllTimers());
            expect(onUpdate).toHaveBeenCalledWith(2, 5, 51, 60, 400, 300);
            expect(onEditingClear).toHaveBeenCalledOnce();
        });

        it("deletes an image by id", () => {
            const onDelete = vi.fn();
            const { result } = renderHook(() => useImageCard({
                image, isEditing: true, onEditing: vi.fn(), onEditingClear: vi.fn(),
                onUpdate: vi.fn(), onDelete,
            }));
            act(() => result.current.confirmDelete());
            expect(onDelete).toHaveBeenCalledWith(2);
        });
    });

    describe("useMermaidCard", () => {
        it("inserts current source and geometry after a complete outside press", () => {
            const onInsert = vi.fn();
            const onEditingClear = vi.fn();
            const { result } = renderHook(() => useMermaidCard({
                mermaid: { ...mermaid, id: -3 }, isEditing: true,
                onEditing: vi.fn(), onEditingClear,
                onInsert, onUpdate: vi.fn(), onDelete: vi.fn(),
            }));
            act(() => result.current.setSource("sequenceDiagram"));
            act(() => result.current.handleDragStop({} as never, { x: 21.5, y: 30.5 } as never));
            act(() => {
                dispatchBoardPress("pointerdown");
                dispatchBoardPress("pointerup");
            });
            expect(onInsert).toHaveBeenCalledWith(-3, 5, "sequenceDiagram", 22, 31, 5, 480, 360);
            expect(onEditingClear).toHaveBeenCalledOnce();
        });

        it("does not save when the press starts inside the card", () => {
            const onUpdate = vi.fn();
            renderHook(() => useMermaidCard({
                mermaid, isEditing: true, onEditing: vi.fn(), onEditingClear: vi.fn(),
                onInsert: vi.fn(), onUpdate, onDelete: vi.fn(),
            }));
            const card = document.createElement("div");
            card.className = "mermaid-rnd-3";
            document.body.appendChild(card);
            card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            dispatchBoardPress("pointerup");
            expect(onUpdate).not.toHaveBeenCalled();
        });
    });

    describe("useTableCard", () => {
        it("updates a persisted table with the latest source and resized geometry", () => {
            const onUpdate = vi.fn();
            const { result } = renderHook(() => useTableCard({
                table, isEditing: true, onEditing: vi.fn(), onEditingClear: vi.fn(),
                onInsert: vi.fn(), onUpdate, onDelete: vi.fn(),
            }));
            const source = { columns: [{ id: "new", name: "New" }], rows: [] };
            act(() => result.current.setSource(source));
            const resized = { offsetWidth: 700, offsetHeight: 450 } as HTMLElement;
            act(() => result.current.handleResizeStop({} as never, "right" as never, resized, {} as never, { x: 25.5, y: 35.5 }));
            act(() => {
                dispatchBoardPress("pointerdown");
                dispatchBoardPress("pointerup");
            });
            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
                id: 4, source, x: 26, y: 36, width: 700, height: 450,
            }));
        });

        it("ignores confirm-dialog presses and confirms deletion explicitly", () => {
            const onUpdate = vi.fn();
            const onDelete = vi.fn();
            const onEditingClear = vi.fn();
            const { result } = renderHook(() => useTableCard({
                table, isEditing: true, onEditing: vi.fn(), onEditingClear,
                onInsert: vi.fn(), onUpdate, onDelete,
            }));
            const dialog = document.createElement("div");
            dialog.className = "confirm-dialog";
            document.body.appendChild(dialog);
            dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            dialog.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
            expect(onUpdate).not.toHaveBeenCalled();

            act(() => result.current.openDeleteDialog());
            act(() => result.current.confirmDelete());
            expect(onDelete).toHaveBeenCalledWith(4);
            expect(onEditingClear).toHaveBeenCalledOnce();
        });
    });
});
