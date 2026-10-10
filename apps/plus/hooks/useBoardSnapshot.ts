import { useCallback, useEffect, useRef, useState } from "react";
import { createBoardDatabase, type BoardDatabaseClient } from "@meldrift/board-data/browser-db/client";
import { createAssetId, type BoardInfo, type BoardSnapshot } from "@meldrift/board-data/board-state";
import { prepareImageFile } from "@meldrift/board-data/image-file";
import { SnapshotSync, type SyncStatus } from "@/lib/snapshot-sync";
import { ChangeSync, lookupChange } from "@/lib/change-sync";
import { downloadAsset } from "@/lib/asset-download";
import type { StoredBoard } from "@meldrift/board-data/browser-db/protocol";

type BoardSync = SnapshotSync | ChangeSync;

async function loadServerState(
    database: BoardDatabaseClient, boardEndpoint: string, initial: StoredBoard, signal: AbortSignal,
) {
    const response = await fetch(`${boardEndpoint}/state`, { signal, cache: "no-store" });
    if (!response.ok) {
        throw new Error("The board could not be loaded.");
    }
    const { revision, snapshot } = await response.json() as { revision: number; snapshot: BoardSnapshot };

    let local = initial;
    const [inFlight] = (await database.outbox()).claimed;
    if (inFlight?.mutationId && local.sync.revision !== revision) {
        const result = await lookupChange(boardEndpoint, inFlight.mutationId, signal);
        if (result.applied && result.revision !== null) {
            await database.commitOutbox(inFlight.claim, local.sync.generation, result.revision);
            local = await database.record();
        }
    }

    const outbox = await database.outbox();
    if (outbox.pending.length + outbox.claimed.length > 0) {
        if (local.sync.revision !== revision) {
            throw new Error("Local unsaved changes conflict with the server. Download the local backup before restoring the server version.");
        }
        return database.load();
    }
    if (local.sync.seeded && local.sync.revision === revision) {
        return database.load();
    }

    const images = [];
    for (const image of snapshot.images) {
        if (!image.assetId) {
            images.push(image);
            continue;
        }
        const cached = await database.asset(image.assetId);
        const bytes = cached
            ? { data: new Uint8Array(cached.data), mimeType: cached.mimeType }
            : await downloadAsset(boardEndpoint, image.assetId, signal);
        images.push({ ...image, url: "", data: bytes.data, mimeType: bytes.mimeType });
    }

    return database.seed({ ...snapshot, images }, revision);
}

type State = {
    snapshot: BoardSnapshot | null;
    status: SyncStatus;
    message: string;
    canEdit: boolean;
};

// Route transitions in this tab must finish closing the previous worker before the next opens
// the same browser database.
let editorCleanup = Promise.resolve();

export function useBoardSnapshot(board: BoardInfo) {
    const [serverSaveVersion, setServerSaveVersion] = useState(0);
    const [state, setState] = useState<State>({ snapshot: null, status: "saved", message: "", canEdit: false });
    const managerRef = useRef<BoardSync | null>(null);
    const databaseRef = useRef<BoardDatabaseClient | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        let blocked = false;
        let database: BoardDatabaseClient | undefined;
        let manager: BoardSync | undefined;
        const controller = new AbortController();
        const update = (status: SyncStatus, message = "") => {
            if (blocked && status !== "blocked") {
                return;
            }
            if (active) {
                setState((prev) => ({ ...prev, status, message, canEdit: status === "blocked" ? false : prev.canEdit }));
            }
        };
        const block = (message: string) => {
            blocked = true;
            manager?.stop();
            update("blocked", message);
        };

        async function initialize() {
            await editorCleanup;
            if (!active) {
                return;
            }
            const authResponse = await fetch("/api/me", { signal: controller.signal, cache: "no-store" });
            if (!authResponse.ok) {
                throw new Error("Authentication could not be checked.");
            }
            const { user } = await authResponse.json();
            const canEdit = user?.isApproved === true;
            if (!active) {
                return;
            }
            database = createBoardDatabase(`meldrift-plus:${encodeURIComponent(user?.email ?? "guest")}:${board.boardId}`, board);
            databaseRef.current = database;
            const local = await database.record();
            const boardEndpoint = `/api/boards/${board.boardId}`;
            const response = await fetch(`${boardEndpoint}/snapshot`, { signal: controller.signal, cache: "no-store" });
            if (!active) {
                return;
            }
            if (!response.ok) {
                throw new Error("The board snapshot could not be loaded.");
            }
            const storageMode = response.headers.get("X-Storage-Mode") ?? "snapshot";
            if (storageMode === "migrating") {
                throw new Error("This board is being moved to change sync. Open it again in a moment.");
            }
            const revision = Number(response.headers.get("X-Snapshot-Revision") ?? 0);
            const mutationId = response.headers.get("X-Snapshot-Mutation");
            let snapshot: BoardSnapshot;
            if (storageMode === "delta") {
                snapshot = await loadServerState(database, boardEndpoint, local, controller.signal);
            } else if (local.sync.dirty) {
                if (revision === local.sync.revision + 1 && mutationId === local.sync.mutationId) {
                    await database.acknowledge(local.sync.generation, revision);
                } else if (revision !== local.sync.revision) {
                    throw new Error("Local unsaved changes conflict with the server. Download the local backup before restoring the server version.");
                }
                snapshot = await database.load();
            } else if (response.headers.get("Content-Type")?.includes("application/vnd.sqlite3")) {
                snapshot = local.sync.revision === revision && revision > 0
                    ? await database.load()
                    : await database.import(await response.arrayBuffer(), revision);
            } else {
                const data = await response.json();
                snapshot = data.legacy;
                // Existing Cloudinary originals remain untouched until migration succeeds.
                if (canEdit) {
                    snapshot.images = await Promise.all(snapshot.images.map(async (image) => {
                        const response = await fetch(image.url, { signal: controller.signal });
                        if (!response.ok) {
                            throw new Error("An existing image could not be migrated.");
                        }
                        const blob = await response.blob();
                        const prepared = await prepareImageFile(new File([blob], image.label ?? "image", { type: blob.type }));
                        return {
                            ...image, url: "", assetId: createAssetId(),
                            data: prepared.data, mimeType: prepared.mimeType,
                        };
                    }));
                }
                await database.replace(snapshot, canEdit);
            }
            // Neon owns board metadata even when a local snapshot predates a rename.
            snapshot = { ...snapshot, board };
            if (!active || blocked) {
                database.close();
                return;
            }
            if (canEdit) {
                const onSaved = () => {
                    if (active) {
                        setServerSaveVersion((value) => value + 1);
                    }
                };
                manager = storageMode === "delta"
                    ? new ChangeSync(database, boardEndpoint, update, onSaved)
                    : new SnapshotSync(database, `${boardEndpoint}/snapshot`, update, onSaved);
                managerRef.current = manager;
                const pending = await database.record();
                const queued = storageMode === "delta" ? await database.outbox() : null;
                const unsent = queued ? queued.pending.length + queued.claimed.length > 0 : false;
                if (pending.sync.dirty || unsent) {
                    manager.resume(pending.sync.changedAt);
                }
            }
            const pending = await database.record();
            if (active && !blocked) {
                setState({ snapshot, status: pending.sync.dirty ? "local" : "saved", message: "", canEdit });
            }
        }
        void initialize().catch((error) => {
            if (active) {
                block(error instanceof Error ? error.message : "Board initialization failed.");
            }
        });
        return () => {
            active = false;
            controller.abort();
            managerRef.current = null;
            databaseRef.current = null;
            const previousCleanup = editorCleanup;
            editorCleanup = (async () => {
                await previousCleanup;
                if (manager) {
                    await manager.close();
                }
                else {
                    database?.close();
                }
            })().catch(() => {});
        };
    }, [board, attempt]);

    const save = useCallback((snapshot: BoardSnapshot) => {
        return managerRef.current?.save(snapshot);
    }, []);
    const exportSnapshot = useCallback(async (snapshot: BoardSnapshot) => {
        if (!databaseRef.current) {
            throw new Error("The board is not ready.");
        }
        return databaseRef.current.encode(snapshot);
    }, []);
    const readSnapshotFile = useCallback(async (bytes: ArrayBuffer) => {
        if (!databaseRef.current) {
            throw new Error("The board is not ready.");
        }
        return databaseRef.current.decode(bytes);
    }, []);
    const downloadLocal = useCallback(async () => {
        const bytes = await databaseRef.current?.export();
        if (!bytes) {
            return;
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.sqlite3" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `board-${board.boardId}-local.sqlite`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, [board.boardId]);
    const restoreServer = useCallback(async () => {
        try {
            if (!databaseRef.current) {
                throw new Error("Open the board in the active editor tab first.");
            }
            const response = await fetch(`/api/boards/${board.boardId}/snapshot`, { cache: "no-store" });
            if (response.headers.get("X-Storage-Mode") === "delta") {
                await managerRef.current?.pause();
                await databaseRef.current.reset();
                setState({ snapshot: null, status: "saved", message: "", canEdit: false });
                setAttempt((value) => value + 1);
                return;
            }
            if (!response.ok || !response.headers.get("Content-Type")?.includes("application/vnd.sqlite3")) {
                throw new Error("No server snapshot is available to restore.");
            }
            await managerRef.current?.pause();
            await databaseRef.current.import(await response.arrayBuffer(), Number(response.headers.get("X-Snapshot-Revision")));
            setState({ snapshot: null, status: "saved", message: "", canEdit: false });
            setAttempt((value) => value + 1);
        } catch (error) {
            setState((prev) => ({ ...prev, message: error instanceof Error ? error.message : "Restore failed." }));
        }
    }, [board.boardId]);
    return { ...state, save, downloadLocal, restoreServer, serverSaveVersion, exportSnapshot, readSnapshotFile };
}
