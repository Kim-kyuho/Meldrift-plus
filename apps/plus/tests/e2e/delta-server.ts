import { createHash } from "node:crypto";
import { expect, type BrowserContext } from "@playwright/test";
import type { BoardOperation } from "@meldrift/board-data/board-delta";

type Change = { mutationId: string; baseRevision: number; operations: BoardOperation[] };
type Asset = {
    assetId: string; digest: string; byteLength: number; mimeType: string;
    chunks: Map<number, Buffer>; complete: boolean;
};

const chunkBytes = 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// The page reads real board metadata; browser writes never reach Neon.
export function createDeltaServer() {
    let revision = 0;
    let offline = false;
    let loseResponse = false;
    let failChunk: number | null = null;
    let nextId = 1;
    const cards = new Map<string, Record<string, unknown>>();
    const assets = new Map<string, Asset>();
    const applied = new Map<string, number>();
    const changes: Change[] = [];
    const attempts: Change[] = [];
    const chunkUploads: Buffer[] = [];
    const chunkDownloads: string[] = [];
    const previews: { bytes: Buffer; mimeType: string }[] = [];
    const unexpected: string[] = [];

    async function install(context: BrowserContext) {
        await context.exposeBinding("recordBoardPreview", (_source, file: { base64: string; mimeType: string }) => {
            previews.push({ bytes: Buffer.from(file.base64, "base64"), mimeType: file.mimeType });
        });
        // WebKit's intercepted multipart body omits file bytes. Observe the real Blob before fetch.
        await context.addInitScript(() => {
            const originalFetch = window.fetch;
            window.fetch = async (input, init) => {
                if (String(input).endsWith("/preview") && init?.body instanceof FormData) {
                    const file = init.body.get("file");
                    if (file instanceof Blob) {
                        const base64 = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result).split(",")[1]);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        await (window as unknown as {
                            recordBoardPreview: (file: { base64: string; mimeType: string }) => Promise<void>;
                        }).recordBoardPreview({ base64, mimeType: file.type });
                    }
                }
                return originalFetch(input, init);
            };
        });
        await context.route("**/api/**", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const path = url.pathname.replace(/^\/plus/, "");
            const method = request.method();
            if (path === "/api/me") {
                return route.fulfill({ json: {
                    user: { id: 1, email: "delta-e2e@example.test", isApproved: true, role: "user" },
                } });
            }
            const match = path.match(/^\/api\/boards\/(\d+)\/(.*)$/);
            if (match) {
                const boardId = Number(match[1]);
                const endpoint = match[2];
                if (endpoint === "snapshot" && method === "GET") {
                    return route.fulfill({ headers: { "X-Storage-Mode": "delta" }, json: { revision } });
                }
                if (endpoint === "state" && method === "GET") {
                    const collection = (type: string) => [...cards.entries()]
                        .filter(([key]) => key.startsWith(`${type}:`)).map(([, card]) => card);
                    return route.fulfill({ json: { revision, snapshot: {
                        board: { boardId, title: "Delta test", width: 7680, height: 4320 },
                        memos: collection("memo"), images: collection("image"),
                        mermaids: collection("mermaid"), tables: collection("table"), strokes: collection("stroke"),
                    } } });
                }
                if (endpoint === "changes" && method === "GET") {
                    const saved = applied.get(url.searchParams.get("mutationId") ?? "");
                    return route.fulfill({ json: { applied: saved !== undefined, revision: saved ?? null } });
                }
                if (endpoint === "changes" && method === "POST") {
                    const change = request.postDataJSON() as Change;
                    attempts.push(change);
                    if (offline) {
                        return route.fulfill({ status: 503, json: { message: "Simulated offline storage" } });
                    }
                    if (applied.has(change.mutationId)) {
                        return route.fulfill({ json: { ok: true, revision: applied.get(change.mutationId) } });
                    }
                    expect(change.baseRevision).toBe(revision);
                    expect(change.operations.length).toBeGreaterThan(0);
                    for (const operation of change.operations) {
                        const key = `${operation.type}:${operation.syncId}`;
                        if (operation.action === "delete") {
                            cards.delete(key);
                            continue;
                        }
                        if (operation.asset) {
                            expect(assets.get(String(operation.changes.assetId))?.complete).toBe(true);
                        }
                        if (operation.action === "create") {
                            expect(cards.has(key)).toBe(false);
                            cards.set(key, {
                                [operation.type === "image" ? "imageId" : "id"]: nextId++,
                                boardId, syncId: operation.syncId,
                                ...(operation.type === "image" ? { data: null, mimeType: null } : {}),
                                ...operation.changes,
                            });
                        } else {
                            expect(cards.has(key)).toBe(true);
                            Object.assign(cards.get(key)!, operation.changes);
                        }
                    }
                    revision += 1;
                    applied.set(change.mutationId, revision);
                    changes.push(change);
                    if (loseResponse) {
                        loseResponse = false;
                        return route.abort("failed");
                    }
                    return route.fulfill({ json: { ok: true, revision } });
                }
                if (endpoint === "uploads" && method === "POST") {
                    const meta = request.postDataJSON() as Omit<Asset, "chunks" | "complete">;
                    const asset = assets.get(meta.assetId) ?? { ...meta, chunks: new Map(), complete: false };
                    assets.set(meta.assetId, asset);
                    return route.fulfill({ json: {
                        uploadId: meta.assetId, complete: asset.complete,
                        chunkCount: Math.ceil(meta.byteLength / chunkBytes), received: [...asset.chunks.keys()],
                    } });
                }
                const upload = endpoint.match(/^uploads\/([^/]+)\/(?:chunks\/(\d+)|(complete))$/);
                if (upload) {
                    const asset = assets.get(upload[1])!;
                    expect(asset).toBeDefined();
                    if (upload[3]) {
                        const bytes = Buffer.concat([...asset.chunks.entries()].sort(([a], [b]) => a - b).map(([, data]) => data));
                        expect(bytes.length).toBe(asset.byteLength);
                        expect(digest(bytes)).toBe(asset.digest);
                        asset.complete = true;
                    } else {
                        if (Number(upload[2]) === failChunk) {
                            failChunk = null;
                            return route.fulfill({ status: 503, json: { message: "Simulated chunk failure" } });
                        }
                        const bytes = request.postDataBuffer()!;
                        expect(bytes.length).toBeLessThanOrEqual(chunkBytes);
                        expect(digest(bytes)).toBe(request.headers()["x-chunk-digest"]);
                        asset.chunks.set(Number(upload[2]), bytes);
                        chunkUploads.push(bytes);
                    }
                    return route.fulfill({ json: { ok: true } });
                }
                const download = endpoint.match(/^assets\/([^/]+)(?:\/chunks\/(\d+))?$/);
                if (download) {
                    const asset = assets.get(download[1])!;
                    expect(asset?.complete).toBe(true);
                    if (download[2] !== undefined) {
                        chunkDownloads.push(download[1]);
                        return route.fulfill({ body: asset.chunks.get(Number(download[2]))!, contentType: "application/octet-stream" });
                    }
                    return route.fulfill({ json: {
                        ...asset, chunks: undefined, chunkCount: Math.ceil(asset.byteLength / chunkBytes),
                    } });
                }
                if (endpoint === "preview" && method === "PUT") {
                    return route.fulfill({ json: { ok: true } });
                }
            }
            if (path.includes("/ai") && method === "GET") {
                return route.fulfill({ json: { unlocked: false } });
            }
            unexpected.push(`${method} ${path}`);
            return route.fulfill({ status: 501, json: { message: `Unexpected test request: ${method} ${path}` } });
        });
    }

    return {
        install, changes, attempts, chunkUploads, chunkDownloads, previews, unexpected,
        setOffline: (value: boolean) => { offline = value; },
        loseNextResponse: () => { loseResponse = true; },
        failNextChunk: (index: number) => { failChunk = index; },
    };
}
