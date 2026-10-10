import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardImages, type BoardImage } from "@meldrift/ui/useBoardImages";
import { useBoardMemos, type BoardMemo } from "@meldrift/ui/useBoardMemos";
import { useBoardMermaids, type BoardMermaid } from "@meldrift/ui/useBoardMermaids";
import { useBoardTables, type BoardTable } from "@meldrift/ui/useBoardTables";
import { prepareImageFile } from "@meldrift/board-data/image-file";

vi.mock("@meldrift/board-data/image-file", async (importOriginal) => ({
    ...await importOriginal<typeof import("@meldrift/board-data/image-file")>(),
    prepareImageFile: vi.fn(),
}));

const locationRef = createRef<HTMLDivElement>();

function setLocation() {
    const element = document.createElement("div");
    Object.defineProperties(element, {
        scrollLeft: { configurable: true, value: 400 },
        scrollTop: { configurable: true, value: 200 },
        clientWidth: { configurable: true, value: 800 },
        clientHeight: { configurable: true, value: 600 },
    });
    locationRef.current = element;
}

const memo: BoardMemo = {
    id: 1, syncId: "memo-1", boardId: 5, content: "memo", x: 10, y: 20, z: 1,
    width: 300, height: 200, color: "#fffadc", sortOrder: 1,
};
const image: BoardImage = {
    imageId: 2, syncId: "image-2", assetId: "", boardId: 5, url: "https://example.com/image.png", label: "image.png",
    data: null, mimeType: null,
    x: 10, y: 20, z: 2, width: 400, height: 300,
};
const mermaid: BoardMermaid = {
    id: 3, syncId: "mermaid-3", boardId: 5, source: "flowchart LR", x: 10, y: 20, z: 3,
    width: 480, height: 360,
};
const table: BoardTable = {
    id: 4, syncId: "table-4", boardId: 5,
    source: { columns: [{ id: "c", name: "C" }], rows: [] },
    x: 10, y: 20, z: 4, width: 560, height: 360,
};

describe("board card collection hooks", () => {
    beforeEach(() => {
        setLocation();
        vi.spyOn(Date, "now").mockReturnValue(1000);
        vi.mocked(prepareImageFile).mockResolvedValue({
            data: new Uint8Array([1, 2, 3]),
            mimeType: "image/webp",
            label: "image.png",
            width: 400,
            height: 300,
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it("creates and persists memos without an authentication gate", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { result } = renderHook(() => useBoardMemos({
            initialMemos: [memo], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
        }));

        act(() => result.current.handleCreateTempMemo());
        expect(result.current.memos[1]).toMatchObject({ id: -1000, x: 250, y: 150 });
        await act(async () => result.current.handleInsertMemo(-1000, 5, "created", 1, 2, 3, 300, 200, "#fff"));
        expect(result.current.memos.some((item) => item.id === 2 && item.content === "created")).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses getTopmostZ when creating a temporary memo", () => {
        const getTopmostZ = vi.fn().mockReturnValue(99);
        const { result } = renderHook(() => useBoardMemos({
            initialMemos: [memo], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef, getTopmostZ,
        }));
        act(() => result.current.handleCreateTempMemo());
        expect(getTopmostZ).toHaveBeenCalledOnce();
        expect(result.current.memos[1].z).toBe(99);
    });

    it("creates Mermaid and table drafts in the visible center", () => {
        const mermaids = renderHook(() => useBoardMermaids({
            initialMermaids: [mermaid], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
        }));
        const tables = renderHook(() => useBoardTables({
            initialTables: [table], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
        }));

        act(() => mermaids.result.current.handleCreateTempMermaid());
        act(() => tables.result.current.handleCreateTempTable());
        expect(mermaids.result.current.mermaids[1]).toMatchObject({ id: -1000, x: 160, y: 70 });
        expect(tables.result.current.tables[1]).toMatchObject({ id: -1000, x: 120, y: 70 });
    });

    it("uses getTopmostZ when creating Mermaid and table drafts", () => {
        const getTopmostZ = vi.fn().mockReturnValue(99);
        const mermaids = renderHook(() => useBoardMermaids({
            initialMermaids: [mermaid], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef, getTopmostZ,
        }));
        const tables = renderHook(() => useBoardTables({
            initialTables: [table], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef, getTopmostZ,
        }));

        act(() => mermaids.result.current.handleCreateTempMermaid());
        act(() => tables.result.current.handleCreateTempTable());
        expect(mermaids.result.current.mermaids[1].z).toBe(99);
        expect(tables.result.current.tables[1].z).toBe(99);
    });

    it("creates an image card from compressed local bytes", async () => {
        const setMessage = vi.fn();
        const { result } = renderHook(() => useBoardImages({
            initialImages: [], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
            setMessage,
        }));

        await act(async () => {
            await result.current.handleUploadImage({
                target: {
                    files: [new File(["image"], "image.png", { type: "image/png" })],
                    value: "image.png",
                },
            } as never);
        });
        expect(result.current.images).toEqual([{
            ...image,
            imageId: 1, syncId: expect.any(String), assetId: expect.any(String),
            url: "",
            data: new Uint8Array([1, 2, 3]),
            mimeType: "image/webp",
            x: 200,
            y: 100,
            z: 1,
        }]);
        expect(result.current.editingImageId).toBe(1);
        expect(setMessage).toHaveBeenCalledWith("");
    });

    it("updates geometry and deletes a persisted image", async () => {
        const { result } = renderHook(() => useBoardImages({
            initialImages: [image], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
            setMessage: vi.fn(),
        }));

        await act(async () => result.current.handleUpdateImage(2, 5, 1, 2, 4, 5));
        expect(result.current.images[0]).toMatchObject({ url: image.url, label: image.label, z: 2 });
        await act(async () => result.current.handleDeleteImage(2));
        expect(result.current.images).toEqual([]);
    });

    it("handles dropped image files and adds images at drop location", async () => {
        const { result } = renderHook(() => useBoardImages({
            initialImages: [], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
            setMessage: vi.fn(),
        }));

        const file = new File(["image"], "dropped.png", { type: "image/png" });
        await act(async () => {
            await result.current.handleDropImageFiles([file], { x: 300, y: 200 });
        });

        expect(result.current.images.length).toBe(1);
        expect(result.current.images[0].x).toBe(100);
        expect(result.current.images[0].y).toBe(50);
    });

    it("uses getTopmostZ when uploading/dropping images", async () => {
        const getTopmostZ = vi.fn().mockReturnValue(99);
        const { result } = renderHook(() => useBoardImages({
            initialImages: [], boardId: 5, boardZoom: 2,
            cardLocationRef: locationRef,
            setMessage: vi.fn(),
            getTopmostZ,
        }));

        const file = new File(["image"], "dropped.png", { type: "image/png" });
        await act(async () => {
            await result.current.handleDropImageFiles([file], { x: 300, y: 200 });
        });

        expect(getTopmostZ).toHaveBeenCalled();
        expect(result.current.images[0].z).toBe(99);
    });
});
