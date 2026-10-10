import { useEffect, useMemo, useState } from "react";
import { strToU8, zipSync } from "fflate";
import {
    compileBoardMarkdownDocument,
    type BoardMarkdownDocument,
} from "@meldrift/board-data/board-markdown";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import {
    imageBytesToBlob,
    imageBytesToPng,
} from "@meldrift/board-data/image-file";

type PreviewImageState = {
    document: BoardMarkdownDocument;
    urls: Record<string, string>;
    errorMessage: string;
};

export function useBoardMarkdown(snapshot: BoardSnapshot) {
    const compiledDocument = useMemo(() => compileBoardMarkdownDocument(snapshot), [snapshot]);
    const markdown = compiledDocument.markdown;
    const [previewState, setPreviewState] = useState<PreviewImageState | null>(null);
    const [downloadError, setDownloadError] = useState("");
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (compiledDocument.imageAssets.length === 0) {
            return;
        }

        const objectUrls: string[] = [];
        const urls: Record<string, string> = {};
        let active = true;
        let nextState: PreviewImageState;

        try {
            compiledDocument.imageAssets.forEach((asset) => {
                const objectUrl = URL.createObjectURL(imageBytesToBlob(asset.data, asset.mimeType));
                objectUrls.push(objectUrl);
                urls[`./${asset.path}`] = objectUrl;
            });
            nextState = { document: compiledDocument, urls, errorMessage: "" };
        } catch (error) {
            objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
            objectUrls.length = 0;
            nextState = {
                document: compiledDocument,
                urls: {},
                errorMessage: error instanceof Error
                    ? error.message
                    : "The image preview could not be created.",
            };
        }

        queueMicrotask(() => {
            if (active) {
                setPreviewState(nextState);
            }
        });

        return () => {
            active = false;
            objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
        };
    }, [compiledDocument]);

    const previewReady = compiledDocument.imageAssets.length === 0 || previewState?.document === compiledDocument;
    const previewImageUrls = previewState?.document === compiledDocument ? previewState.urls : {};
    const previewError = previewState?.document === compiledDocument ? previewState.errorMessage : "";

    const handleMarkdownDownload = async () => {
        setDownloadError("");
        setDownloading(true);

        try {
            const markdownFileName = `board-${snapshot.board.boardId}.md`;
            const files: Record<string, Uint8Array> = {
                [markdownFileName]: strToU8(markdown),
            };

            for (const asset of compiledDocument.imageAssets) {
                files[asset.path] = await imageBytesToPng(asset.data, asset.mimeType);
            }

            const archive = zipSync(files, { level: 6 });
            const fileUrl = URL.createObjectURL(imageBytesToBlob(archive, "application/zip"));
            const downloadLink = window.document.createElement("a");
            downloadLink.href = fileUrl;
            downloadLink.download = `meldrift-board-${snapshot.board.boardId}.zip`;
            window.document.body.appendChild(downloadLink);
            downloadLink.click();
            downloadLink.remove();
            URL.revokeObjectURL(fileUrl);
        } catch (error) {
            setDownloadError(error instanceof Error ? error.message : "The Markdown archive could not be created.");
        } finally {
            setDownloading(false);
        }
    };

    return {
        markdown,
        previewImageUrls,
        errorMessage: previewError || downloadError,
        loading: !previewReady,
        downloading,
        handleMarkdownDownload,
    };
}
