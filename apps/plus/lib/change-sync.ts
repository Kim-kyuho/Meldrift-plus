import type { BoardDatabaseClient } from "@meldrift/board-data/browser-db/client";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import type { OutboxBatch } from "@meldrift/board-data/browser-db/protocol";
import {
    changeEnvelopeBytes, maxChangeBytes, maxStagedOperations, stagedChangeMimeType,
} from "@meldrift/board-data/board-delta";
import { AssetUploadError, uploadAsset } from "./asset-upload";
import { snapshotDelayMs } from "./snapshot";
import type { SyncStatus } from "./snapshot-sync";

const retryDelayMs = 10000;

export async function lookupChange(boardEndpoint: string, mutationId: string, signal?: AbortSignal) {
    const response = await fetch(
        `${boardEndpoint}/changes?mutationId=${encodeURIComponent(mutationId)}`,
        { signal, cache: "no-store" },
    );
    if (!response.ok) {
        throw new Error("The board could not be checked for unfinished saves.");
    }
    return await response.json() as { applied: boolean; revision: number | null };
}
const terminalStatuses = [400, 401, 403, 404, 409, 413];
const encoder = new TextEncoder();

const inlineBudget = maxChangeBytes - changeEnvelopeBytes;

export class ChangeSync {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private queue = Promise.resolve();
    private committing = false;
    private stopped = false;
    private lastChange = 0;
    private flight: Promise<void> | undefined;
    private controller: AbortController | undefined;

    constructor(
        private database: BoardDatabaseClient,
        private boardEndpoint: string,
        private onStatus: (status: SyncStatus, message?: string) => void,
        private onCommitted: () => void = () => {},
    ) {}

    save(snapshot: BoardSnapshot) {
        this.queue = this.queue.then(async () => {
            await this.database.replace(snapshot, true);
            this.lastChange = Date.now();
            if (!this.stopped) {
                this.onStatus("local");
            }
            this.schedule(snapshotDelayMs);
        }).catch((error: unknown) => {
            this.onStatus("error", error instanceof Error ? error.message : "Local save failed.");
        });
        return this.queue;
    }

    resume(changedAt: number) {
        this.lastChange = changedAt;
        this.onStatus("local");
        this.schedule(Math.max(0, changedAt + snapshotDelayMs - Date.now()));
    }

    private schedule(delay: number) {
        clearTimeout(this.timer);
        if (!this.stopped) {
            this.timer = setTimeout(() => {
                if (!this.committing) {
                    this.flight = this.commit();
                }
            }, delay);
        }
    }

    private async uploadAssets(batch: OutboxBatch) {
        for (const operation of batch.operations) {
            if (!operation.asset || this.stopped) {
                continue;
            }
            const assetId = String(operation.changes.assetId ?? "");
            const asset = assetId ? await this.database.asset(assetId) : null;
            if (!asset) {
                throw new Error("The image bytes are missing from local storage.");
            }
            await uploadAsset({
                boardEndpoint: this.boardEndpoint, assetId,
                data: asset.data, mimeType: asset.mimeType, signal: this.controller?.signal,
            });
        }
    }

    private async nextBatch(): Promise<OutboxBatch | undefined> {
        const outbox = await this.database.outbox();
        if (outbox.claimed.length > 0) {
            return outbox.claimed[0];
        }
        if (outbox.pending.length === 0) {
            return undefined;
        }

        const record = await this.database.record();
        const remaining = record.sync.changedAt + snapshotDelayMs - Date.now();
        if (remaining > 0) {
            this.schedule(remaining);
            return undefined;
        }
        return this.database.claimOutbox(Math.min(outbox.pending.length, maxStagedOperations));
    }

    private async stage(mutationId: string, encoded: Uint8Array) {
        await uploadAsset({
            boardEndpoint: this.boardEndpoint, assetId: mutationId,
            data: encoded.buffer.slice(
                encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
            mimeType: stagedChangeMimeType, signal: this.controller?.signal,
        });
    }

    private async commit() {
        if (this.stopped || this.committing) {
            return;
        }
        this.committing = true;
        let retry = false;
        try {
            await this.queue;
            const record = await this.database.record();
            const batch = await this.nextBatch();
            if (!batch || batch.operations.length === 0 || this.stopped) {
                if (batch) {
                    await this.database.clearOutbox(batch.claim);
                }
                return;
            }

            this.onStatus("saving");
            this.controller = new AbortController();
            await this.uploadAssets(batch);

            const encoded = encoder.encode(JSON.stringify(batch.operations));
            const staged = encoded.byteLength > inlineBudget;
            if (staged) {
                await this.stage(batch.mutationId, encoded);
            }

            const response = await fetch(`${this.boardEndpoint}/changes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(staged
                    ? { baseRevision: record.sync.revision, mutationId: batch.mutationId, staged: true }
                    : {
                        baseRevision: record.sync.revision,
                        mutationId: batch.mutationId,
                        operations: batch.operations,
                    }),
                signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(60000)]),
            });
            const data = await response.json();

            if (!response.ok) {
                if (terminalStatuses.includes(response.status)) {
                    this.stop();
                    this.onStatus("blocked", data.message ?? "Editing authorization changed.");
                    return;
                }
                throw new Error(data.message ?? "Server save failed.");
            }

            await this.database.commitOutbox(batch.claim, record.sync.generation, data.revision);
            const outbox = await this.database.outbox();
            const pending = outbox.pending.length > 0;
            this.onStatus(pending ? "local" : "saved");
            this.onCommitted();
            if (pending) {
                this.schedule(0);
            }
        } catch (error) {
            if (error instanceof AssetUploadError && terminalStatuses.includes(error.status)) {
                this.stop();
                this.onStatus("blocked", error.message);
                return;
            }
            if (!this.stopped) {
                this.onStatus("error", error instanceof Error ? error.message : "Server save failed.");
            }
            retry = true;
        } finally {
            this.committing = false;
            if (retry) {
                this.schedule(retryDelayMs);
            }
        }
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.controller?.abort();
    }

    async settled() {
        await this.queue;
        await this.flight;
    }

    async pause() {
        this.stop();
        await this.settled();
    }

    async close() {
        await this.pause();
        this.database.close();
    }
}
