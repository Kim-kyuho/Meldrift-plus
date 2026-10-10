import type { BoardDatabaseClient } from "@meldrift/board-data/browser-db/client";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import { maxSnapshotBytes, snapshotDelayMs } from "./snapshot";

export type SyncStatus = "saved" | "local" | "saving" | "error" | "blocked";

export class SnapshotSync {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private queue = Promise.resolve();
    private uploading = false;
    private stopped = false;
    private lastChange = 0;
    private flight: Promise<void> | undefined;
    private uploadController: AbortController | undefined;
    constructor(
        private database: BoardDatabaseClient,
        private endpoint: string,
        private onStatus: (status: SyncStatus, message?: string) => void,
        private onSaved: () => void = () => {},
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
                if (!this.uploading) {
                    this.flight = this.upload();
                }
            }, delay);
        }
    }

    private async upload() {
        if (this.stopped || this.uploading) {
            return;
        }
        this.uploading = true;
        let retryDelay = snapshotDelayMs;
        try {
            await this.queue;
            const record = await this.database.record();
            if (!record.sync.dirty || this.stopped) {
                return;
            }
            const remaining = record.sync.changedAt + snapshotDelayMs - Date.now();
            if (remaining > 0) {
                this.schedule(remaining);
                return;
            }
            if (record.bytes.byteLength > maxSnapshotBytes) {
                this.onStatus("error", "Saved locally. The board exceeds the 4 MiB server snapshot limit.");
                return;
            }
            this.onStatus("saving");
            this.uploadController = new AbortController();
            const response = await fetch(this.endpoint, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/vnd.sqlite3",
                    "X-Snapshot-Revision": String(record.sync.revision),
                    "X-Snapshot-Mutation": record.sync.mutationId ?? "",
                },
                body: record.bytes,
                signal: AbortSignal.any([this.uploadController.signal, AbortSignal.timeout(60000)]),
            });
            const data = await response.json();
            if (!response.ok) {
                if ([401, 403, 409, 404].includes(response.status)) {
                    this.stop();
                    this.onStatus("blocked", data.message ?? "Editing authorization changed.");
                    return;
                }
                throw new Error(data.message ?? "Server save failed.");
            }
            await this.database.acknowledge(record.sync.generation, data.revision);
            const latest = await this.database.record();
            this.onStatus(latest.sync.dirty ? "local" : "saved");
            this.onSaved();
            if (latest.sync.dirty) {
                this.schedule(Math.max(0, this.lastChange + snapshotDelayMs - Date.now()));
            }
            retryDelay = 0;
        } catch (error) {
            if (!this.stopped) {
                this.onStatus("error", error instanceof Error ? error.message : "Server save failed.");
            }
            retryDelay = 10000;
        } finally {
            this.uploading = false;
            // A pending local save owns its own timer; transient errors retry without discarding it.
            if (retryDelay === 10000) {
                this.schedule(retryDelay);
            }
        }
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.uploadController?.abort();
    }

    async pause() {
        this.stop();
        await this.queue;
        await this.flight;
    }

    async close() {
        await this.pause();
        this.database.close();
    }
}
