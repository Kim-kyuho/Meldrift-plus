import { useEffect, useRef } from "react";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";

const localSaveDelayMs = 150;

type UseBoardPersistenceOptions = {
    snapshot: BoardSnapshot;
    savePaused: boolean;
    onSave: (snapshot: BoardSnapshot) => void | Promise<void>;
    onError: (error: unknown) => void;
    skipInitialSave?: boolean;
};

export function useBoardPersistence({
    snapshot,
    savePaused,
    onSave,
    onError,
    skipInitialSave = false,
}: UseBoardPersistenceOptions) {
    const lastRequestedRef = useRef<BoardSnapshot | null>(skipInitialSave ? snapshot : null);

    useEffect(() => {
        if (savePaused || snapshot === lastRequestedRef.current) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            lastRequestedRef.current = snapshot;
            void (async () => {
                try {
                    await onSave(snapshot);
                } catch (error) {
                    if (lastRequestedRef.current === snapshot) {
                        lastRequestedRef.current = null;
                    }
                    onError(error);
                }
            })();
        }, localSaveDelayMs);

        return () => window.clearTimeout(timeoutId);
    }, [snapshot, savePaused, onSave, onError]);
}
