import TurndownService from "turndown";
import { cardTypeOrder, type CardType } from "@meldrift/core/cards";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import { sortMemosByOrder } from "@meldrift/core/memo-order";
import { tableSourceToMarkdown } from "@meldrift/core/table-card";

export type BoardMarkdownImageAsset = {
    path: string;
    data: Uint8Array;
    mimeType: string;
};

export type BoardMarkdownDocument = {
    markdown: string;
    imageAssets: BoardMarkdownImageAsset[];
};

type BoardCard = {
    // 메모는 문서의 뼈대라 카드 후보가 아니다. 카드 종류가 늘면 여기서 컴파일 에러로 잡힌다.
    type: Exclude<CardType, "memo">;
    id: number;
    content: string;
    label: string | null;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    imageAsset: BoardMarkdownImageAsset | null;
};

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
});

turndown.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => `~~${content}~~`,
});

const escapeImageLabel = (label: string) => label.replaceAll("[", "\\[").replaceAll("]", "\\]");

function renderCard(card: BoardCard) {
    if (card.type === "image") {
        return `![${escapeImageLabel(card.label?.trim() || "Image")}](${card.content})`;
    }
    if (card.type === "mermaid") {
        return `\`\`\`mermaid\n${card.content.trim()}\n\`\`\``;
    }
    return tableSourceToMarkdown(JSON.parse(card.content));
}

export function compileBoardMarkdown(snapshot: BoardSnapshot) {
    return compileBoardMarkdownDocument(snapshot).markdown;
}

export function compileBoardMarkdownDocument(snapshot: BoardSnapshot): BoardMarkdownDocument {
    const cards: BoardCard[] = [
        ...snapshot.images.map((image) => {
            const imageAsset = image.data && image.mimeType
                ? {
                    path: `images/image-${image.imageId}.png`,
                    data: image.data,
                    mimeType: image.mimeType,
                }
                : null;

            return {
                type: "image" as const,
                id: image.imageId,
                content: imageAsset ? `./${imageAsset.path}` : image.url,
                label: image.label,
                x: image.x, y: image.y, z: image.z, width: image.width, height: image.height,
                imageAsset,
            };
        }),
        ...snapshot.mermaids.map((mermaid) => ({
            type: "mermaid" as const, id: mermaid.id, content: mermaid.source, label: null,
            x: mermaid.x, y: mermaid.y, z: mermaid.z, width: mermaid.width, height: mermaid.height,
            imageAsset: null,
        })),
        ...snapshot.tables.map((table) => ({
            type: "table" as const, id: table.id, content: JSON.stringify(table.source), label: null,
            x: table.x, y: table.y, z: table.z, width: table.width, height: table.height,
            imageAsset: null,
        })),
    ];
    const markdownParts: string[] = [];
    const imageAssets: BoardMarkdownImageAsset[] = [];

    const renderedCards = new Set<string>();

    sortMemosByOrder(snapshot.memos).forEach((memo) => {
        const memoMarkdown = turndown.turndown(memo.content).trim();
        if (memoMarkdown) {
            markdownParts.push(memoMarkdown);
        }

        const corners = [
            [memo.x, memo.y],
            [memo.x + memo.width, memo.y],
            [memo.x, memo.y + memo.height],
            [memo.x + memo.width, memo.y + memo.height],
        ];

        corners.forEach(([cornerX, cornerY]) => {
            const card = cards
                .filter((candidate) =>
                    candidate.x < cornerX && cornerX < candidate.x + candidate.width &&
                    candidate.y < cornerY && cornerY < candidate.y + candidate.height)
                .sort((left, right) => right.z - left.z || cardTypeOrder[left.type] - cardTypeOrder[right.type] || left.id - right.id)[0];
            if (!card) {
                return;
            }

            const key = `${card.type}:${card.id}`;
            if (renderedCards.has(key)) {
                return;
            }
            renderedCards.add(key);
            markdownParts.push(renderCard(card));
            if (card.imageAsset) {
                imageAssets.push(card.imageAsset);
            }
        });
    });

    return {
        markdown: markdownParts.filter(Boolean).join("\n\n"),
        imageAssets,
    };
}
