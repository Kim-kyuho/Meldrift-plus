import type { BoardInfo, BoardSnapshot } from "../board-state";
import type { BoardOperation } from "../board-delta";

export type SyncMetadata = {
    revision: number;
    generation: number;
    dirty: boolean;
    changedAt: number;
    mutationId?: string;
    seeded?: boolean;
};
export type StoredBoard = { bytes: ArrayBuffer; sync: SyncMetadata };
export type OutboxBatch = { claim: number; mutationId: string; operations: BoardOperation[] };
export type OutboxState = { pending: BoardOperation[]; claimed: OutboxBatch[] };
export type StoredAsset = { data: ArrayBuffer; mimeType: string };

export type BrowserDbPayload =
    | { type: "load" }
    | { type: "replace"; snapshot: BoardSnapshot; dirty?: boolean }
    | { type: "export" }
    | { type: "encode"; snapshot: BoardSnapshot }
    | { type: "decode"; bytes: ArrayBuffer }
    | { type: "import"; bytes: ArrayBuffer; revision?: number }
    | { type: "record" }
    | { type: "acknowledge"; generation: number; revision: number }
    | { type: "seed"; snapshot: BoardSnapshot; revision: number }
    | { type: "commitOutbox"; claim: number; generation: number; revision: number }
    | { type: "asset"; assetId: string }
    | { type: "outbox" }
    | { type: "claimOutbox"; limit: number }
    | { type: "releaseOutbox"; claim: number }
    | { type: "clearOutbox"; claim: number }
    | { type: "reset" };

export type BrowserDbRequest = BrowserDbPayload & { id: number; storageName: string; board: BoardInfo };
export type BrowserDbResponse =
    | { id: number; ok: true; value?: BoardSnapshot | ArrayBuffer | StoredBoard | OutboxState | OutboxBatch | StoredAsset | null }
    | { id: number; ok: false; error: string };
