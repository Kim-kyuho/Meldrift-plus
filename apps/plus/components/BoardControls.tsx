"use client";

import { useCallback, type ComponentProps } from "react";
import { useBoardPersistence } from "@meldrift/ui/useBoardPersistence";
import type { BoardControls as SharedBoardControls } from "@meldrift/ui/BoardClient";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import ConfirmDialog from "@meldrift/ui/ConfirmDialog";
import { useBoardTransfer, type BoardFileActions } from "@/hooks/useBoardTransfer";
import BoardMenu from "./BoardMenu";

type Props = BoardFileActions & {
    controls: SharedBoardControls;
    canEdit: boolean;
    onSnapshotChange: (snapshot: BoardSnapshot) => void;
    auth: Pick<ComponentProps<typeof BoardMenu>,
        "currentUser" | "setSignInOpen" | "setSignUpOpen" | "onSignOut">;
};

export default function BoardControls({ controls, canEdit, onSnapshotChange, auth, ...files }: Props) {
    const { snapshot, savePaused, setMessage } = controls;
    const {
        importInputRef, transferring, resetDialogOpen, handleExport, handleImport,
        handleImportClick, handleResetClick, handleResetConfirm, handleResetCancel,
    } = useBoardTransfer({
        ...files, snapshot, savePaused, canEdit,
        canExport: Boolean(auth.currentUser),
        replaceSnapshot: controls.replaceSnapshot, setMessage,
    });
    const onError = useCallback((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "The board could not be saved.");
    }, [setMessage]);
    useBoardPersistence({
        snapshot, savePaused: !canEdit || savePaused, onSave: onSnapshotChange,
        onError, skipInitialSave: true,
    });

    return <>
        <input ref={importInputRef} type="file" aria-label="Import board database"
            className="hidden" onChange={handleImport} />
        <BoardMenu
            {...auth}
            menuOpen={controls.menuOpen}
            setMenuOpen={controls.setMenuOpen}
            currentBoard={snapshot.board}
            onCompileMarkdown={controls.onCompileMarkdown}
            reorderOpen={controls.reorderOpen}
            onReorder={controls.onReorder}
            onAbout={controls.onAbout}
            transfer={{
                exportDisabled: savePaused, mutationDisabled: !canEdit || savePaused,
                transferring, resetting: false,
                onExport: handleExport, onImport: handleImportClick,
                onReset: handleResetClick,
            }}
        />
        {resetDialogOpen && <ConfirmDialog
            title="Reset this board?"
            message="All cards and drawings on this board will be removed. This change will sync to the server."
            onConfirm={handleResetConfirm} onCancel={handleResetCancel}
        />}
    </>;
}
