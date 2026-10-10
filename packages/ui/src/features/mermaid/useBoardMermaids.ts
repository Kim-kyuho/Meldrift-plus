import { RefObject, useState } from "react";
import { createSyncId, nextPositiveId, type BoardMermaid } from "@meldrift/board-data/board-state";

export type { BoardMermaid } from "@meldrift/board-data/board-state";

type UseBoardMermaidsOptions = {
    initialMermaids: BoardMermaid[];
    boardId: number;
    boardZoom: number;
    cardLocationRef: RefObject<HTMLDivElement | null>;
    getTopmostZ?: () => number;
};

type BoardPoint = {
    x: number;
    y: number;
};

const defaultMermaidSource = `flowchart LR
    A["Start"] --> B["Mermaid Card"]`;

export function useBoardMermaids({
    initialMermaids,
    boardId,
    boardZoom,
    cardLocationRef,
    getTopmostZ,
}: UseBoardMermaidsOptions) {
    const [mermaids, setMermaids] = useState<BoardMermaid[]>(initialMermaids);
    const [editingMermaidId, setEditingMermaidId] = useState<number | null>(null);

    const getMermaidAutoLocation = (): BoardPoint => {
        const locationElement = cardLocationRef.current;
        if (!locationElement) {
            return { x: 0, y: 0 };
        }

        return {
            x: Math.max(0, (locationElement.scrollLeft + locationElement.clientWidth / 2) / boardZoom - 240),
            y: Math.max(0, (locationElement.scrollTop + locationElement.clientHeight / 2) / boardZoom - 180),
        };
    };

    const handleCreateTempMermaid = () => {
        const { x, y } = getMermaidAutoLocation();
        const z = getTopmostZ ? getTopmostZ() : 1;
        const tempMermaid: BoardMermaid = {
            id: -Date.now(),
            syncId: createSyncId(),
            boardId,
            source: defaultMermaidSource,
            x: Math.round(x),
            y: Math.round(y),
            z,
            width: 480,
            height: 360,
        };

        setMermaids((prev) => [...prev, tempMermaid]);
        setEditingMermaidId(tempMermaid.id);
    };

    const handleInsertMermaid = async (
        tempId: number,
        boardId: number,
        source: string,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
    ) => {
        setMermaids((prev) => {
            const id = nextPositiveId(prev.map((mermaid) => mermaid.id));
            return prev.map((mermaid) => mermaid.id === tempId
                ? { ...mermaid, id, boardId, source, x, y, z, width, height }
                : mermaid);
        });
    };

    const handleUpdateMermaid = async (
        id: number,
        boardId: number,
        source: string,
        x: number,
        y: number,
        width: number,
        height: number,
    ) => {
        setMermaids((prev) =>
            prev.map((mermaid) =>
                mermaid.id === id
                    ? { ...mermaid, boardId, source, x, y, width, height }
                    : mermaid
            )
        );
    };

    const handleDeleteMermaid = async (id: number) => {
        setMermaids((prev) => prev.filter((mermaid) => mermaid.id !== id));
        setEditingMermaidId((prev) => prev === id ? null : prev);
    };

    return {
        mermaids,
        setMermaids,
        editingMermaidId,
        setEditingMermaidId,
        handleCreateTempMermaid,
        handleInsertMermaid,
        handleUpdateMermaid,
        handleDeleteMermaid,
    };
}
