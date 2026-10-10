import { RefObject, useState } from "react";
import { createSyncId, nextPositiveId, type BoardMemo } from "@meldrift/board-data/board-state";
import { nextMemoOrder } from "@meldrift/core/memo-order";

export type { BoardMemo } from "@meldrift/board-data/board-state";

type UseBoardMemosOptions = {
    initialMemos: BoardMemo[];
    boardId: number;
    boardZoom: number;
    cardLocationRef: RefObject<HTMLDivElement | null>;
    getTopmostZ?: () => number;
};

export function useBoardMemos({
    initialMemos,
    boardId,
    boardZoom,
    cardLocationRef,
    getTopmostZ,
}: UseBoardMemosOptions) {
    const [memos, setMemos] = useState(initialMemos);
    const [editingMemoId, setEditingMemoId] = useState<number | null>(null);

    const getMemoAutoLocation = () => {
        const locationElement = cardLocationRef.current;
        if (!locationElement) {
            return { x: 0, y: 0 };
        }

        return {
            x: Math.max(0, (locationElement.scrollLeft + locationElement.clientWidth / 2) / boardZoom - 150),
            y: Math.max(0, (locationElement.scrollTop + locationElement.clientHeight / 2) / boardZoom - 100),
        };
    };

    const handleCreateTempMemo = () => {
        const { x, y } = getMemoAutoLocation();
        const z = getTopmostZ ? getTopmostZ() : 1;
        const tempMemo: BoardMemo = {
            id: -Date.now(),
            syncId: createSyncId(),
            boardId,
            content: "",
            x: Math.round(x),
            y: Math.round(y),
            z,
            width: 300,
            height: 200,
            color: "#fffadc",
            sortOrder: nextMemoOrder(memos),
        };
        setMemos((prev) => [...prev, tempMemo]);
        setEditingMemoId(tempMemo.id);
    };

    const handleInsertMemo = async (tempId: number, boardId: number, content: string, x: number, y: number, z: number, width: number, height: number, color: string) => {
        setMemos((prev) => {
            const id = nextPositiveId(prev.map((memo) => memo.id));
            return prev.map((memo) => memo.id === tempId
                ? { ...memo, id, boardId, content, x, y, z, width, height, color }
                : memo);
        });
    };

    const handleUpdateMemo = async (id: number, boardId: number, content: string, x: number, y: number, width: number, height: number, color: string) => {
        setMemos((prev) =>
            prev.map((memo) =>
                memo.id === id ? { ...memo, content, x, y, width, height, color } : memo
            )
        );
    };

    const handleDeleteMemo = async (id: number) => {
        setMemos((prev) => prev.filter((memo) => memo.id !== id));
        setEditingMemoId((prev) => prev === id ? null : prev);
    };

    return {
        memos,
        setMemos,
        editingMemoId,
        setEditingMemoId,
        handleCreateTempMemo,
        handleInsertMemo,
        handleUpdateMemo,
        handleDeleteMemo,
    };
}
