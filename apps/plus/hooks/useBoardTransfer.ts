import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createEmptyBoardSnapshot, reissueSyncIds, type BoardSnapshot } from "@meldrift/board-data/board-state";
import { maxSnapshotBytes } from "@/lib/snapshot";

export type BoardFileActions = {
    exportSnapshot: (snapshot: BoardSnapshot) => Promise<ArrayBuffer>;
    readSnapshotFile: (bytes: ArrayBuffer) => Promise<BoardSnapshot>;
};

type Options = BoardFileActions & {
    snapshot: BoardSnapshot;
    canExport: boolean;
    canEdit: boolean;
    savePaused: boolean;
    replaceSnapshot: (snapshot: BoardSnapshot) => void;
    setMessage: (message: string) => void;
};

export function useBoardTransfer(options: Options) {
    const latest = useRef(options);
    const active = useRef(true);
    const busy = useRef(false);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [transferring, setTransferring] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    useEffect(() => { latest.current = options; });
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);

    const canModify = () => active.current && latest.current.canEdit && !latest.current.savePaused;
    const reportError = (error: unknown) => {
        if (active.current) {
            latest.current.setMessage(error instanceof Error ? error.message : "The board transfer failed.");
        }
    };
    const finish = () => {
        busy.current = false;
        if (active.current) {
            setTransferring(false);
        }
    };

    const handleExport = async () => {
        if (!latest.current.canExport || latest.current.savePaused || busy.current) {
            return;
        }
        busy.current = true;
        setTransferring(true);
        try {
            const snapshot = latest.current.snapshot;
            const bytes = await latest.current.exportSnapshot(snapshot);
            if (!active.current || !latest.current.canExport) {
                return;
            }
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.sqlite3" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `meldrift-board-${snapshot.board.boardId}.sqlite`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (error) { reportError(error); }
        finally { finish(); }
    };

    const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !canModify() || busy.current) {
            return;
        }
        if (file.size > maxSnapshotBytes) {
            latest.current.setMessage("The SQLite save file must be 4 MiB or smaller.");
            return;
        }
        busy.current = true;
        setTransferring(true);
        try {
            const imported = await latest.current.readSnapshotFile(await file.arrayBuffer());
            if (!canModify()) {
                return;
            }
            if (imported.images.some((image) => !image.data)) {
                throw new Error("The save file must include image binaries.");
            }
            if (!window.confirm("Importing this save file will replace the current board contents. Continue?")) {
                return;
            }
            const board = latest.current.snapshot.board;
            const copy = reissueSyncIds(imported);
            latest.current.replaceSnapshot({
                ...copy, board,
                memos: copy.memos.map((card) => ({ ...card, boardId: board.boardId })),
                images: copy.images.map((card) => ({ ...card, boardId: board.boardId })),
                mermaids: copy.mermaids.map((card) => ({ ...card, boardId: board.boardId })),
                tables: copy.tables.map((card) => ({ ...card, boardId: board.boardId })),
            });
        } catch (error) { reportError(error); }
        finally { finish(); }
    };

    return {
        importInputRef,
        transferring,
        resetDialogOpen,
        handleExport,
        handleImport,
        handleImportClick: () => {
            if (canModify() && !busy.current) {
                importInputRef.current?.click();
            }
        },
        handleResetClick: () => {
            if (canModify() && !busy.current) {
                setResetDialogOpen(true);
            }
        },
        handleResetCancel: () => setResetDialogOpen(false),
        handleResetConfirm: () => {
            setResetDialogOpen(false);
            if (!canModify() || busy.current) {
                return;
            }
            latest.current.replaceSnapshot({ ...createEmptyBoardSnapshot(), board: latest.current.snapshot.board });
        },
    };
}
