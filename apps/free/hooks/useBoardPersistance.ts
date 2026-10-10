import { useCallback } from "react";
import { useBoardPersistence } from "@meldrift/ui/useBoardPersistence";
import type { BoardSnapshot } from "@/lib/board-state";
import { replaceBoardState } from "@/lib/browser-db/client";

export function useBoardPersistance({ snapshot, savePaused, setMessage }: {
    snapshot: BoardSnapshot;
    savePaused: boolean;
    setMessage: (message: string) => void;
}) {
    const onError = useCallback((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "The board could not be saved.");
    }, [setMessage]);

    useBoardPersistence({ snapshot, savePaused, onSave: replaceBoardState, onError });
}
