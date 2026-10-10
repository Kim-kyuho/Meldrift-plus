"use client";

import { useEffect, useRef } from "react";
import SharedBoardClient, { type BoardControls as SharedBoardControls } from "@meldrift/ui/BoardClient";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import { useBoardAuth } from "@/hooks/useBoardAuth";
import { useBoardPreview } from "@/hooks/useBoardPreview";
import BoardControls from "./BoardControls";
import type { BoardFileActions } from "@/hooks/useBoardTransfer";
import SignInModal from "./SignInModal";
import SignUpModal from "./SignUpModal";

type BoardClientProps = BoardFileActions & {
    initialSnapshot: BoardSnapshot;
    editingAllowed: boolean;
    onSnapshotChange: (snapshot: BoardSnapshot) => void;
    serverSaveVersion: number;
};

export default function BoardClient({
    initialSnapshot,
    editingAllowed,
    onSnapshotChange,
    serverSaveVersion,
    exportSnapshot,
    readSnapshotFile,
}: BoardClientProps) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const {
        signInOpen, setSignInOpen,
        signUpOpen, setSignUpOpen,
        currentUser, setCurrentUser,
        canEditCard,
        handleSignOut,
    } = useBoardAuth({
        onSignOutComplete: () => window.location.reload(),
    });
    const canEdit = canEditCard && editingAllowed;
    const { schedulePreviewUpdate } = useBoardPreview({
        boardId: initialSnapshot.board.boardId,
        boardViewportRef: viewportRef,
    });

    useEffect(() => {
        if (serverSaveVersion > 0 && canEdit) {
            schedulePreviewUpdate();
        }
    }, [serverSaveVersion, canEdit, schedulePreviewUpdate]);

    const renderControls = (controls: SharedBoardControls) => (
        <>
            <BoardControls
                controls={controls}
                canEdit={canEdit}
                onSnapshotChange={onSnapshotChange}
                exportSnapshot={exportSnapshot}
                readSnapshotFile={readSnapshotFile}
                auth={{ currentUser, setSignInOpen, setSignUpOpen, onSignOut: handleSignOut }}
            />
            {signInOpen && (
                <SignInModal
                    onClose={() => setSignInOpen(false)}
                    onSignIn={(user) => { setCurrentUser(user); window.location.reload(); }}
                />
            )}
            {signUpOpen && <SignUpModal onClose={() => setSignUpOpen(false)} />}
        </>
    );

    return (
        <SharedBoardClient
            initialSnapshot={initialSnapshot}
            canEdit={canEdit}
            permissionMessage={currentUser
                ? "Your account is waiting for administrator approval."
                : "Please sign in before editing cards."}
            viewportRef={viewportRef}
            renderControls={renderControls}
        />
    );
}
