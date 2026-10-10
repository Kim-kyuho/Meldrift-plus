import { RefObject, useState } from "react";
import { defaultTableSource } from "@meldrift/core/table-card";
import { createSyncId, nextPositiveId, type BoardTable } from "@meldrift/board-data/board-state";

export type { BoardTable } from "@meldrift/board-data/board-state";

type UseBoardTablesOptions = {
    initialTables: BoardTable[];
    boardId: number;
    boardZoom: number;
    cardLocationRef: RefObject<HTMLDivElement | null>;
    getTopmostZ?: () => number;
};

export function useBoardTables({
    initialTables,
    boardId,
    boardZoom,
    cardLocationRef,
    getTopmostZ,
}: UseBoardTablesOptions) {
    const [tables, setTables] = useState<BoardTable[]>(initialTables);
    const [editingTableId, setEditingTableId] = useState<number | null>(null);

    const handleCreateTempTable = () => {
        const locationElement = cardLocationRef.current;
        const width = 560;
        const height = 360;
        const x = locationElement
            ? Math.max(0, (locationElement.scrollLeft + locationElement.clientWidth / 2) / boardZoom - width / 2)
            : 0;
        const y = locationElement
            ? Math.max(0, (locationElement.scrollTop + locationElement.clientHeight / 2) / boardZoom - height / 2)
            : 0;
        const z = getTopmostZ ? getTopmostZ() : 1;
        const tempTable: BoardTable = {
            id: -Date.now(),
            syncId: createSyncId(),
            boardId,
            source: structuredClone(defaultTableSource),
            x: Math.round(x),
            y: Math.round(y),
            z,
            width,
            height,
        };

        setTables((prev) => [...prev, tempTable]);
        setEditingTableId(tempTable.id);
    };

    const handleInsertTable = async (table: BoardTable) => {
        setTables((prev) => {
            const id = nextPositiveId(prev.map((item) => item.id));
            return prev.map((item) => item.id === table.id ? { ...table, id } : item);
        });
    };

    const handleUpdateTable = async (table: BoardTable) => {
        setTables((prev) => prev.map((item) => item.id === table.id ? { ...table, z: item.z } : item));
    };

    const handleDeleteTable = async (id: number) => {
        setTables((prev) => prev.filter((table) => table.id !== id));
        setEditingTableId((prev) => prev === id ? null : prev);
    };

    return {
        tables,
        setTables,
        editingTableId,
        setEditingTableId,
        handleCreateTempTable,
        handleInsertTable,
        handleUpdateTable,
        handleDeleteTable,
    };
}
