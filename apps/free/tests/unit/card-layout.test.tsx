import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageCard from "@meldrift/ui/ImageCard";
import MermaidCard from "@meldrift/ui/MermaidCard";
import TableCard from "@meldrift/ui/TableCard";

vi.mock("react-rnd", () => ({
    Rnd: ({ children, className }: { children: ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock("@meldrift/ui/useMermaidRenderer", () => ({
    useMermaidRenderer: () => ({ svg: "", renderError: null }),
}));

const callback = vi.fn();

afterEach(() => vi.unstubAllGlobals());

describe("card surface layout", () => {
    it("does not force a white background on image cards", () => {
        const { container } = render(
            <ImageCard
                image={{
                    imageId: 1,
                    boardId: 1,
                    url: "https://example.com/image.png",
                    data: null,
                    mimeType: null,
                    label: "Example",
                    x: 0,
                    y: 0,
                    z: 1,
                    width: 180,
                    height: 180,
                }}
                zoom={1}
                isEditing={false}
                onEditing={callback}
                onEditingClear={callback}
                onUpdate={callback}
                onDelete={callback}
                onBringToFront={callback}
                onSendToBack={callback}
            />
        );

        expect(container.querySelector(".image-rnd-1 > div")).not.toHaveClass("bg-white");
    });

    it("creates and revokes a Blob URL for a stored local image", async () => {
        const createObjectURL = vi.fn().mockReturnValue("blob:stored-image");
        const revokeObjectURL = vi.fn();
        const NativeURL = URL;
        class MockURL extends NativeURL {
            static createObjectURL = createObjectURL;
            static revokeObjectURL = revokeObjectURL;
        }
        vi.stubGlobal("URL", MockURL);

        const { unmount } = render(
            <ImageCard
                image={{
                    imageId: 4,
                    boardId: 1,
                    url: "",
                    data: new Uint8Array([1, 2, 3]),
                    mimeType: "image/webp",
                    label: "Stored image",
                    x: 0,
                    y: 0,
                    z: 1,
                    width: 180,
                    height: 180,
                }}
                zoom={1}
                isEditing={false}
                onEditing={callback}
                onEditingClear={callback}
                onUpdate={callback}
                onDelete={callback}
                onBringToFront={callback}
                onSendToBack={callback}
            />
        );

        await waitFor(() => expect(screen.getByAltText("Stored image")).toHaveAttribute("src", "blob:stored-image"));
        expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        unmount();
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:stored-image");
    });

    it("does not force a white background on Mermaid cards", () => {
        const { container } = render(
            <MermaidCard
                mermaid={{
                    id: 2,
                    boardId: 1,
                    source: "flowchart LR\nA --> B",
                    x: 0,
                    y: 0,
                    z: 1,
                    width: 180,
                    height: 180,
                }}
                zoom={1}
                isEditing={false}
                onEditing={callback}
                onEditingClear={callback}
                onInsert={callback}
                onUpdate={callback}
                onDelete={callback}
                onBringToFront={callback}
                onSendToBack={callback}
            />
        );

        expect(container.querySelector(".mermaid-rnd-2 > div")).not.toHaveClass("bg-white");
    });

    it("does not force a white background on table cards", () => {
        const { container } = render(
            <TableCard
                table={{
                    id: 3,
                    boardId: 1,
                    source: {
                        columns: [{ id: "name", name: "Name", width: 160 }],
                        rows: [{ id: "row-1", cells: { name: "Kyu" } }],
                    },
                    x: 0,
                    y: 0,
                    z: 1,
                    width: 360,
                    height: 180,
                }}
                zoom={1}
                isEditing={false}
                onEditing={callback}
                onEditingClear={callback}
                onInsert={callback}
                onUpdate={callback}
                onDelete={callback}
                onBringToFront={callback}
                onSendToBack={callback}
            />
        );

        expect(container.querySelector(".table-rnd-3 > div")).not.toHaveClass("bg-white");
    });
});
