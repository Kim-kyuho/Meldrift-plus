import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { useCardLayer } from "@meldrift/ui/useCardLayer";
import { useBoardMemos } from "@meldrift/ui/useBoardMemos";
import { useBoardMermaids } from "@meldrift/ui/useBoardMermaids";
import { useBoardTables } from "@meldrift/ui/useBoardTables";
import type { BoardImage, BoardMemo, BoardMermaid, BoardTable } from "@/lib/board-state";

const memo: BoardMemo = { id: 1, syncId: "memo-1", boardId: 1, content: "memo", x: 0, y: 0, z: 1, width: 100, height: 100, color: "#fff", sortOrder: 1 };
const image: BoardImage = { imageId: 2, syncId: "image-2", assetId: "", boardId: 1, url: "https://example.com/image.png", data: null, mimeType: null, label: null, x: 0, y: 0, z: 2, width: 100, height: 100 };
const mermaid: BoardMermaid = { id: 3, syncId: "mermaid-3", boardId: 1, source: "flowchart LR", x: 0, y: 0, z: 3, width: 100, height: 100 };
const table: BoardTable = { id: 4, syncId: "table-4", boardId: 1, source: { columns: [{ id: "c", name: "C" }], rows: [{ id: "r", cells: { c: "" } }] }, x: 0, y: 0, z: 4, width: 100, height: 100 };

function createStateSetter<T>(initial: T[]) {
    let state = initial;
    const setter = vi.fn((update: React.SetStateAction<T[]>) => {
        state = typeof update === "function" ? update(state) : update;
    });
    return { setter, getState: () => state };
}

function setup() {
    const memos = createStateSetter([memo]);
    const images = createStateSetter([image]);
    const mermaids = createStateSetter([mermaid]);
    const tables = createStateSetter([table]);
    const hook = renderHook(() => useCardLayer({
        memos: [memo], images: [image], mermaids: [mermaid], tables: [table],
        setMemos: memos.setter, setImages: images.setter,
        setMermaids: mermaids.setter, setTables: tables.setter,
    }));
    return { ...hook, memos, images, mermaids, tables };
}

describe("useCardLayer", () => {
    it("moves a card to the front and normalizes every local z value", () => {
        const state = setup();
        act(() => state.result.current.handleCardLayer("memo", 1, "front"));
        expect(state.images.getState()[0].z).toBe(1);
        expect(state.mermaids.getState()[0].z).toBe(2);
        expect(state.tables.getState()[0].z).toBe(3);
        expect(state.memos.getState()[0].z).toBe(4);
    });

    it("moves a card to the back", () => {
        const state = setup();
        act(() => state.result.current.handleCardLayer("table", 4, "back"));
        expect(state.tables.getState()[0].z).toBe(1);
        expect(state.memos.getState()[0].z).toBe(2);
    });

    it("ignores unknown cards regardless of the sign of their IDs", () => {
        const state = setup();
        act(() => state.result.current.handleCardLayer("memo", -1, "front"));
        act(() => state.result.current.handleCardLayer("memo", 999, "front"));
        expect(state.memos.setter).not.toHaveBeenCalled();
    });

    it.each([
        ["memo", "front"], ["memo", "back"],
        ["mermaid", "front"], ["mermaid", "back"],
        ["table", "front"], ["table", "back"],
    ] as const)("keeps the draft %s layer when inserting after moving it to the %s", async (type, action) => {
        const { result } = renderHook(() => {
            const cardLocationRef = useRef<HTMLDivElement | null>(null);
            const options = { boardId: 1, boardZoom: 1, cardLocationRef };
            const memos = useBoardMemos({ ...options, initialMemos: [memo] });
            const mermaids = useBoardMermaids({ ...options, initialMermaids: [mermaid] });
            const tables = useBoardTables({ ...options, initialTables: [table] });
            const [images, setImages] = useState([image]);
            const layer = useCardLayer({
                memos: memos.memos, mermaids: mermaids.mermaids, tables: tables.tables, images,
                setMemos: memos.setMemos, setMermaids: mermaids.setMermaids,
                setTables: tables.setTables, setImages,
            });
            return { memos, mermaids, tables, images, ...layer };
        });

        act(() => {
            if (type === "memo") {
                result.current.memos.handleCreateTempMemo();
            }
            if (type === "mermaid") {
                result.current.mermaids.handleCreateTempMermaid();
            }
            if (type === "table") {
                result.current.tables.handleCreateTempTable();
            }
        });
        const cards = () => ({
            memo: result.current.memos.memos,
            mermaid: result.current.mermaids.mermaids,
            table: result.current.tables.tables,
        });
        const draftId = cards()[type].find((card) => card.id < 0)!.id;
        act(() => result.current.handleCardLayer(type, draftId, action));
        const expectedZ = action === "front" ? 5 : 1;
        expect(cards()[type].find((card) => card.id === draftId)?.z).toBe(expectedZ);

        await act(async () => {
            if (type === "memo") {
                const draft = result.current.memos.memos.find((card) => card.id === draftId)!;
                await result.current.memos.handleInsertMemo(
                    draft.id, draft.boardId, "Draft", draft.x, draft.y, draft.z,
                    draft.width, draft.height, draft.color,
                );
            } else if (type === "mermaid") {
                const draft = result.current.mermaids.mermaids.find((card) => card.id === draftId)!;
                await result.current.mermaids.handleInsertMermaid(
                    draft.id, draft.boardId, draft.source, draft.x, draft.y, draft.z,
                    draft.width, draft.height,
                );
            } else {
                const draft = result.current.tables.tables.find((card) => card.id === draftId)!;
                await result.current.tables.handleInsertTable(draft);
            }
        });
        expect(cards()[type]).toHaveLength(2);
        expect(cards()[type].every((card) => card.id > 0)).toBe(true);
        expect(cards()[type][1].z).toBe(expectedZ);
        const allZ = [
            ...result.current.memos.memos, ...result.current.mermaids.mermaids,
            ...result.current.tables.tables, ...result.current.images,
        ].map((card) => card.z).sort((a, b) => a - b);
        expect(allZ).toEqual([1, 2, 3, 4, 5]);
    });
});
