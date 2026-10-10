import { defaultBoard, type BoardInfo, type BoardSnapshot } from "../board-state";
import type {
    BrowserDbPayload, BrowserDbRequest, BrowserDbResponse, OutboxBatch, OutboxState, StoredAsset, StoredBoard,
} from "./protocol";

export function createBoardDatabase(storageName: string, board: BoardInfo) {
    let worker: Worker | null = null;
    let nextRequestId = 1;
    let resetInProgress = false;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    function close() {
        worker?.terminate();
        worker = null;
        pending.forEach(({ reject }) => reject(new Error("Board database was closed.")));
        pending.clear();
    }

    function request<T>(payload: BrowserDbPayload, transfer: Transferable[] = []) {
        return new Promise<T>((resolve, reject) => {
            const id = nextRequestId++;
            try {
                if (!worker) {
                    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
                    worker.addEventListener("message", (event: MessageEvent<BrowserDbResponse>) => {
                        const response = event.data;
                        const entry = pending.get(response.id);
                        if (!entry) {
                            return;
                        }
                        pending.delete(response.id);
                        if (response.ok) {
                            entry.resolve(response.value);
                        }
                        else {
                            entry.reject(new Error(response.error));
                        }
                    });
                    worker.addEventListener("error", close);
                    void navigator.storage?.persist?.().catch(() => false);
                }
                pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
                worker.postMessage({ ...payload, id, storageName, board } as BrowserDbRequest, transfer);
            } catch (error) {
                pending.delete(id);
                reject(error);
            }
        });
    }

    return {
        load: () => request<BoardSnapshot>({ type: "load" }),
        replace: (snapshot: BoardSnapshot, dirty = false) => resetInProgress
            ? Promise.resolve()
            : request<void>({ type: "replace", snapshot, dirty }),
        export: () => request<ArrayBuffer>({ type: "export" }),
        encode: (snapshot: BoardSnapshot) => request<ArrayBuffer>({ type: "encode", snapshot }),
        decode: (bytes: ArrayBuffer) => request<BoardSnapshot>({ type: "decode", bytes }, [bytes]),
        import: (bytes: ArrayBuffer, revision = 0) =>
            request<BoardSnapshot>({ type: "import", bytes, revision }, [bytes]),
        record: () => request<StoredBoard>({ type: "record" }),
        acknowledge: (generation: number, revision: number) =>
            request<void>({ type: "acknowledge", generation, revision }),
        seed: (snapshot: BoardSnapshot, revision: number) =>
            request<BoardSnapshot>({ type: "seed", snapshot, revision }),
        commitOutbox: (claim: number, generation: number, revision: number) =>
            request<void>({ type: "commitOutbox", claim, generation, revision }),
        asset: (assetId: string) => request<StoredAsset | null>({ type: "asset", assetId }),
        outbox: () => request<OutboxState>({ type: "outbox" }),
        claimOutbox: (limit: number) => request<OutboxBatch>({ type: "claimOutbox", limit }),
        releaseOutbox: (claim: number) => request<void>({ type: "releaseOutbox", claim }),
        clearOutbox: (claim: number) => request<void>({ type: "clearOutbox", claim }),
        reset: async () => {
            if (resetInProgress) {
                return;
            }
            resetInProgress = true;
            try { await request<void>({ type: "reset" }); }
            catch (error) { resetInProgress = false; throw error; }
        },
        close,
    };
}

export type BoardDatabaseClient = ReturnType<typeof createBoardDatabase>;
const freeDatabase = createBoardDatabase("meldrift-free", defaultBoard);
export const loadBoardState = freeDatabase.load;
export const replaceBoardState = (snapshot: BoardSnapshot) => freeDatabase.replace(snapshot);
export const exportBoardDatabase = freeDatabase.export;
export const importBoardDatabase = freeDatabase.import;
export const resetBoardDatabase = freeDatabase.reset;
