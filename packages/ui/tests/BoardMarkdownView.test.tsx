import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BoardMarkdownView from "../src/features/markdown/BoardMarkdownPreview";

vi.mock("../src/features/mermaid/useMermaidRenderer", () => ({
    useMermaidRenderer: ({ source }: { source: string }) => ({
        svg: `<svg><text>${source}</text></svg>`,
        renderError: "",
    }),
}));

describe("BoardMarkdownView", () => {
    it("renders Markdown and Mermaid sections", () => {
        render(
            <BoardMarkdownView
                markdown={"# Title\n\n```mermaid\nflowchart LR\nA-->B\n```"}
                errorMessage=""
                loading={false}
                onDownload={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
        expect(screen.getByText(/flowchart LR/)).toBeInTheDocument();
    });

    it("maps preview images and dispatches view actions", () => {
        const onDownload = vi.fn();
        const onClose = vi.fn();
        render(
            <BoardMarkdownView
                markdown="![Preview](./images/image-1.png)"
                previewImageUrls={{ "./images/image-1.png": "blob:preview" }}
                errorMessage=""
                loading={false}
                onDownload={onDownload}
                onClose={onClose}
            />
        );

        expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:preview");
        fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
        expect(onDownload).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole("button", { name: "Close Markdown view" }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
