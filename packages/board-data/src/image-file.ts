export const imageInputAccept = "image/jpeg,image/png,image/webp";
export const maxImageSourceBytes = 25 * 1024 * 1024;
export const maxStoredImageBytes = 5 * 1024 * 1024;
export const maxImageDimension = 1920;
export const imageCompressionQualities = [0.82, 0.7, 0.6, 0.5];
export const imageFitRounds = 12;

export const supportedImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageMimeType = (typeof supportedImageMimeTypes)[number];

const supportedImageMimeTypeSet = new Set<string>(supportedImageMimeTypes);

export type PreparedImage = {
    data: Uint8Array;
    mimeType: SupportedImageMimeType;
    label: string;
    width: number;
    height: number;
};

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
    return supportedImageMimeTypeSet.has(value);
}

export function fitImageSize(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number,
) {
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

export function imageBytesToBlob(data: Uint8Array, mimeType: string) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Blob([copy.buffer], { type: mimeType });
}

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const hasTransparency = (context: CanvasRenderingContext2D, width: number, height: number) => {
    try {
        const { data } = context.getImageData(0, 0, width, height);
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] !== 255) {
                return true;
            }
        }
        return false;
    } catch {
        // A canvas that refuses to be read cannot be shown to be opaque, and JPEG drops alpha.
        return true;
    }
};

// A browser without a canvas WebP encoder answers toBlob with a PNG rather than null, so the
// returned type is checked instead of trusted. Re-encoding a photo losslessly multiplies its size,
// and the shrink loop can only answer that by throwing away resolution. JPEG keeps the quality
// lever; it is skipped when the image carries alpha, which JPEG cannot store.
const encodeCanvas = async (canvas: HTMLCanvasElement, transparent: boolean, quality: number) => {
    const webp = await canvasToBlob(canvas, "image/webp", quality);
    if (webp?.type === "image/webp") {
        return webp;
    }
    if (!transparent) {
        const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
        if (jpeg?.type === "image/jpeg") {
            return jpeg;
        }
    }
    return webp ?? await canvasToBlob(canvas, "image/png");
};

const loadImageBlob = (blob: Blob, errorMessage: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    return new Promise<{ image: HTMLImageElement; objectUrl: string }>((resolve, reject) => {
        image.onload = () => resolve({ image, objectUrl });
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(errorMessage));
        };
        image.src = objectUrl;
    });
};

const loadImage = (file: File) =>
    loadImageBlob(file, "The selected image could not be decoded.");

export async function imageBytesToPng(data: Uint8Array, mimeType: string) {
    if (!isSupportedImageMimeType(mimeType) || data.byteLength < 1) {
        throw new Error("The stored image cannot be exported.");
    }

    if (mimeType === "image/png") {
        return new Uint8Array(data);
    }

    const { image, objectUrl } = await loadImageBlob(
        imageBytesToBlob(data, mimeType),
        "The stored image could not be decoded for export.",
    );

    try {
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
            throw new Error("The stored image has invalid dimensions.");
        }

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("PNG export is not available in this browser.");
        }

        context.drawImage(image, 0, 0);
        const png = await canvasToBlob(canvas, "image/png");
        if (!png || png.type !== "image/png") {
            throw new Error("The image could not be converted to PNG.");
        }

        return new Uint8Array(await png.arrayBuffer());
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export async function prepareImageFile(file: File): Promise<PreparedImage> {
    if (!isSupportedImageMimeType(file.type)) {
        throw new Error("Choose a JPEG, PNG, or WebP image.");
    }
    if (file.size === 0 || file.size > maxImageSourceBytes) {
        throw new Error("The source image must be 25 MiB or smaller.");
    }

    const { image, objectUrl } = await loadImage(file);
    try {
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
            throw new Error("The selected image has invalid dimensions.");
        }

        let outputSize = fitImageSize(
            image.naturalWidth,
            image.naturalHeight,
            maxImageDimension,
            maxImageDimension,
        );
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Image compression is not available in this browser.");
        }

        let compressed: Blob | null = null;
        let transparent = false;

        // The budget decides the picture, not the other way round. Quality is spent first because
        // it costs no pixels; resolution goes only once quality has nothing left to give. A
        // lossless encoder ignores quality, so there the first answer already settles the round.
        for (let round = 0; round < imageFitRounds && !compressed; round += 1) {
            canvas.width = outputSize.width;
            canvas.height = outputSize.height;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            if (round === 0 && file.type !== "image/jpeg") {
                transparent = hasTransparency(context, canvas.width, canvas.height);
            }

            for (const quality of imageCompressionQualities) {
                const encoded = await encodeCanvas(canvas, transparent, quality);
                if (!encoded) {
                    throw new Error("The image could not be compressed.");
                }
                if (encoded.size <= maxStoredImageBytes) {
                    compressed = encoded;
                    break;
                }
                if (encoded.type === "image/png") {
                    break;
                }
            }

            if (!compressed) {
                outputSize = {
                    width: Math.max(1, Math.round(outputSize.width * 0.8)),
                    height: Math.max(1, Math.round(outputSize.height * 0.8)),
                };
            }
        }

        if (!compressed) {
            throw new Error("The image is still too large after compression.");
        }
        if (!isSupportedImageMimeType(compressed.type)) {
            throw new Error("The browser returned an unsupported image format.");
        }

        const displaySize = fitImageSize(canvas.width, canvas.height, 400, 300);
        return {
            data: new Uint8Array(await compressed.arrayBuffer()),
            mimeType: compressed.type,
            label: file.name,
            ...displaySize,
        };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
