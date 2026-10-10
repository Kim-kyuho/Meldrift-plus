import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import SharedBoardClient from "@meldrift/ui/BoardClient";
import { createEmptyBoardSnapshot } from "@meldrift/board-data/board-state";
import BoardClient from "@/components/BoardClient";

const mocks = vi.hoisted(() => ({
    canEditCard: true,
    savePaused: false,
    changedSnapshot: null as unknown,
    schedulePreviewUpdate: vi.fn(),
    setMessage: vi.fn(),
}));

vi.mock("@meldrift/ui/BoardClient", () => ({
    default: vi.fn((props: ComponentProps<typeof SharedBoardClient>) => (
        <div data-testid="shared-board" data-can-edit={props.canEdit}>
            {props.renderControls({
                snapshot: (mocks.changedSnapshot ?? props.initialSnapshot) as typeof props.initialSnapshot,
                savePaused: mocks.savePaused,
                setMessage: mocks.setMessage,
                menuOpen: false,
                setMenuOpen: vi.fn(),
                reorderOpen: false,
                onReorder: vi.fn(),
                onCompileMarkdown: vi.fn(),
                onAbout: vi.fn(),
                closeOverlays: vi.fn(),
                replaceSnapshot: vi.fn(),
            })}
        </div>
    )),
}));
vi.mock("@/hooks/useBoardAuth", () => ({
    useBoardAuth: () => ({
        canEditCard: mocks.canEditCard,
        currentUser: { email: "editor@example.com", isApproved: mocks.canEditCard, role: "user" },
        signInOpen: false, signUpOpen: false,
        setSignInOpen: vi.fn(), setSignUpOpen: vi.fn(),
        setCurrentUser: vi.fn(), handleSignOut: vi.fn(),
    }),
}));
vi.mock("@/hooks/useBoardPreview", () => ({
    useBoardPreview: () => ({ schedulePreviewUpdate: mocks.schedulePreviewUpdate }),
}));
vi.mock("@/components/BoardMenu", () => ({ default: () => null }));
vi.mock("@/components/SignInModal", () => ({ default: () => null }));
vi.mock("@/components/SignUpModal", () => ({ default: () => null }));

describe("Plus shared board integration", () => {
    const files = {
        exportSnapshot: vi.fn(async () => new ArrayBuffer(16)),
        readSnapshotFile: vi.fn(async () => createEmptyBoardSnapshot()),
    };
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.canEditCard = true;
        mocks.savePaused = false;
        mocks.changedSnapshot = null;
    });
    afterEach(() => vi.useRealTimers());

    it("coalesces changes and does not save after unmount", async () => {
        const initialSnapshot = createEmptyBoardSnapshot();
        const onSnapshotChange = vi.fn();
        const props = { initialSnapshot, onSnapshotChange, editingAllowed: true, serverSaveVersion: 0, ...files };
        const { rerender, unmount } = render(<BoardClient {...props} />);
        mocks.changedSnapshot = { ...initialSnapshot, strokes: [] };
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(100));

        const latest = { ...initialSnapshot, strokes: [] };
        mocks.changedSnapshot = latest;
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(149));
        expect(onSnapshotChange).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(onSnapshotChange).toHaveBeenCalledExactlyOnceWith(latest);

        mocks.changedSnapshot = { ...latest, strokes: [] };
        rerender(<BoardClient {...props} />);
        unmount();
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    });

    it.each(["editing", "permission"])("cancels a queued save on %s changes and resumes with the latest snapshot", async (reason) => {
        const initialSnapshot = createEmptyBoardSnapshot();
        const onSnapshotChange = vi.fn();
        const props = { initialSnapshot, onSnapshotChange, editingAllowed: true, serverSaveVersion: 0, ...files };
        const { rerender } = render(<BoardClient {...props} />);
        mocks.changedSnapshot = { ...initialSnapshot, strokes: [] };
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(100));

        mocks.savePaused = reason === "editing";
        rerender(<BoardClient {...props} editingAllowed={reason !== "permission"} />);
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(onSnapshotChange).not.toHaveBeenCalled();

        const latest = { ...initialSnapshot, strokes: [] };
        mocks.changedSnapshot = latest;
        mocks.savePaused = false;
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(onSnapshotChange).toHaveBeenCalledExactlyOnceWith(latest);
    });

    it("does not reupload initial data and saves edited data 150ms after editing ends", async () => {
        const initialSnapshot = createEmptyBoardSnapshot();
        const onSnapshotChange = vi.fn();
        const props = { initialSnapshot, onSnapshotChange, editingAllowed: true, serverSaveVersion: 0, ...files };
        const { rerender } = render(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(onSnapshotChange).not.toHaveBeenCalled();

        const updated = { ...initialSnapshot, strokes: [...initialSnapshot.strokes] };
        mocks.changedSnapshot = updated;
        mocks.savePaused = true;
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(onSnapshotChange).not.toHaveBeenCalled();

        mocks.savePaused = false;
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(149));
        expect(onSnapshotChange).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(onSnapshotChange).toHaveBeenCalledExactlyOnceWith(updated);
        rerender(<BoardClient {...props} serverSaveVersion={1} />);
        expect(onSnapshotChange).toHaveBeenCalledTimes(1);
        expect(mocks.schedulePreviewUpdate).toHaveBeenCalledOnce();
    });

    it("passes both account and lease permissions to the shared editor and blocks saves", async () => {
        const initialSnapshot = createEmptyBoardSnapshot();
        const onSnapshotChange = vi.fn();
        const props = { initialSnapshot, onSnapshotChange, editingAllowed: false, serverSaveVersion: 0, ...files };
        const { rerender } = render(<BoardClient {...props} />);
        expect(screen.getByTestId("shared-board")).toHaveAttribute("data-can-edit", "false");

        mocks.changedSnapshot = { ...initialSnapshot, strokes: [] };
        rerender(<BoardClient {...props} />);
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(onSnapshotChange).not.toHaveBeenCalled();

        mocks.canEditCard = false;
        rerender(<BoardClient {...props} editingAllowed />);
        await act(async () => vi.advanceTimersByTimeAsync(150));
        expect(screen.getByTestId("shared-board")).toHaveAttribute("data-can-edit", "false");
        expect(onSnapshotChange).not.toHaveBeenCalled();
    });
});
