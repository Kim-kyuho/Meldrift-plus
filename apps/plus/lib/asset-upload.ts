import { assetChunkBytes } from "@meldrift/board-data/board-delta";

export class AssetUploadError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

const hexDigest = async (bytes: ArrayBuffer) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new AssetUploadError("Editing images needs an HTTPS connection to this board.", 400);
    }
    return [...new Uint8Array(await subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function send(input: string, init: RequestInit) {
    const response = await fetch(input, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new AssetUploadError(data.message ?? "The image could not be uploaded.", response.status);
    }
    return data;
}

export type AssetUpload = {
    boardEndpoint: string;
    assetId: string;
    data: ArrayBuffer;
    mimeType: string;
    signal?: AbortSignal;
};

export async function uploadAsset({ boardEndpoint, assetId, data, mimeType, signal }: AssetUpload) {
    const digest = await hexDigest(data);
    const started = await send(`${boardEndpoint}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, digest, byteLength: data.byteLength, mimeType }),
        signal,
    });
    if (started.complete) {
        return;
    }

    const received = new Set<number>(started.received ?? []);
    for (let index = 0; index < started.chunkCount; index += 1) {
        if (received.has(index)) {
            continue;
        }
        const chunk = data.slice(index * assetChunkBytes, (index + 1) * assetChunkBytes);
        await send(`${boardEndpoint}/uploads/${started.uploadId}/chunks/${index}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/octet-stream",
                "X-Chunk-Digest": await hexDigest(chunk),
            },
            body: chunk,
            signal,
        });
    }

    await send(`${boardEndpoint}/uploads/${started.uploadId}/complete`, { method: "POST", signal });
}
