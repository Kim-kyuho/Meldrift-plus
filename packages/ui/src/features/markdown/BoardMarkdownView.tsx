"use client";

import BoardMarkdownPreview from "./BoardMarkdownPreview";
import { useBoardMarkdown } from "./useBoardMarkdown";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";

type BoardMarkdownViewProps = {
    snapshot: BoardSnapshot;
    onClose: () => void;
};

export default function BoardMarkdownView({ snapshot, onClose }: BoardMarkdownViewProps) {
    const {
        markdown,
        previewImageUrls,
        errorMessage,
        loading,
        downloading,
        handleMarkdownDownload,
    } = useBoardMarkdown(snapshot);

    return (
        <BoardMarkdownPreview
            markdown={markdown}
            previewImageUrls={previewImageUrls}
            errorMessage={errorMessage}
            loading={loading}
            downloading={downloading}
            downloadTitle="Download Markdown archive"
            onDownload={handleMarkdownDownload}
            onClose={onClose}
        />
    );
}
