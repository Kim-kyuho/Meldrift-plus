import { afterEach, describe, expect, it, vi } from "vitest";
import {
    fitImageSize,
    imageBytesToPng,
    prepareImageFile,
} from "@meldrift/board-data/image-file";

// Safari has no canvas WebP encoder and answers the request with PNG, so the encoder map says what
// each requested type actually comes back as.
function stubBrowserImage(produced: Record<string, string>, alpha = 255) {
    const NativeURL = URL;
    class MockURL extends NativeURL {
        static createObjectURL = vi.fn().mockReturnValue("blob:source");
        static revokeObjectURL = vi.fn();
    }
    class MockImage {
        naturalWidth = 4000;
        naturalHeight = 2000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
            queueMicrotask(() => this.onload?.());
        }
    }

    vi.stubGlobal("URL", MockURL);
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) }),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
        const requested = String(type);
        callback(new Blob([new Uint8Array([1, 2, 3])], { type: produced[requested] ?? requested }));
    });
}

describe("local image preparation", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("fits image dimensions without changing the aspect ratio", () => {
        expect(fitImageSize(4000, 2000, 1920, 1920)).toEqual({ width: 1920, height: 960 });
        expect(fitImageSize(320, 200, 400, 300)).toEqual({ width: 320, height: 200 });
    });

    it("keeps stored PNG bytes unchanged during export", async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);

        await expect(imageBytesToPng(bytes, "image/png"))
            .resolves.toEqual(bytes);
    });

    it("converts stored JPEG or WebP bytes to PNG during export", async () => {
        const createObjectURL = vi.fn().mockReturnValue("blob:stored-image");
        const revokeObjectURL = vi.fn();
        const NativeURL = URL;

        class MockURL extends NativeURL {
            static createObjectURL = createObjectURL;
            static revokeObjectURL = revokeObjectURL;
        }
        class MockImage {
            naturalWidth = 640;
            naturalHeight = 480;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("URL", MockURL);
        vi.stubGlobal("Image", MockImage);
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
            callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
        });

        await expect(imageBytesToPng(new Uint8Array([1, 2, 3]), "image/webp"))
            .resolves.toEqual(new Uint8Array([137, 80, 78, 71]));
        expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:stored-image");
    });

    it("rejects unsupported local image formats before decoding", async () => {
        const file = new File(["svg"], "drawing.svg", { type: "image/svg+xml" });
        await expect(prepareImageFile(file)).rejects.toThrow(/JPEG, PNG, or WebP/i);
    });

    it("resizes and encodes a selected image before returning bytes", async () => {
        const createObjectURL = vi.fn().mockReturnValue("blob:source");
        const revokeObjectURL = vi.fn();
        const NativeURL = URL;

        class MockURL extends NativeURL {
            static createObjectURL = createObjectURL;
            static revokeObjectURL = revokeObjectURL;
        }
        class MockImage {
            naturalWidth = 4000;
            naturalHeight = 2000;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("URL", MockURL);
        vi.stubGlobal("Image", MockImage);
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
            clearRect: vi.fn(),
            drawImage,
            getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
        } as never);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
            callback(new Blob([new Uint8Array([1, 2, 3])], { type: type ?? "image/webp" }));
        });

        const result = await prepareImageFile(
            new File([new Uint8Array([9, 8, 7])], "photo.png", { type: "image/png" }),
        );

        expect(result).toEqual({
            data: new Uint8Array([1, 2, 3]),
            mimeType: "image/webp",
            label: "photo.png",
            width: 400,
            height: 200,
        });
        expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 1920, 960);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:source");
    });

    it("encodes as JPEG when the browser answers a WebP request with PNG", async () => {
        stubBrowserImage({ "image/webp": "image/png" });

        const result = await prepareImageFile(
            new File([new Uint8Array([9, 8, 7])], "photo.jpg", { type: "image/jpeg" }),
        );

        expect(result.mimeType).toBe("image/jpeg");
    });

    it("keeps PNG when the image carries alpha and WebP is unavailable", async () => {
        stubBrowserImage({ "image/webp": "image/png" }, 128);

        const result = await prepareImageFile(
            new File([new Uint8Array([9, 8, 7])], "logo.png", { type: "image/png" }),
        );

        expect(result.mimeType).toBe("image/png");
    });
});
