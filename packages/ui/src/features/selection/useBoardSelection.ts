import { Dispatch, SetStateAction, useState } from "react";
import type { CardType, SelectedCard, SelectionOffset, SelectionRect } from "@meldrift/core/cards";
import type { BoardImage, BoardMemo, BoardMermaid, BoardTable } from "@meldrift/board-data/board-state";

type UseBoardSelectionOptions = {
    boardWidth: number;
    boardHeight: number;
    memos: BoardMemo[];
    images: BoardImage[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
    setMemos: Dispatch<SetStateAction<BoardMemo[]>>;
    setImages: Dispatch<SetStateAction<BoardImage[]>>;
    setMermaids: Dispatch<SetStateAction<BoardMermaid[]>>;
    setTables: Dispatch<SetStateAction<BoardTable[]>>;
    onDeleteMemo: (id: number) => void;
    onDeleteImage: (imageId: number) => void;
    onDeleteMermaid: (id: number) => void;
    onDeleteTable: (id: number) => void;
};

type SelectableCard = SelectedCard & SelectionRect;

const cardKey = (type: CardType, id: number) => `${type}:${id}`;

const intersects = (a: SelectionRect, b: SelectionRect) =>
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function useBoardSelection({
    boardWidth,
    boardHeight,
    memos,
    images,
    mermaids,
    tables,
    setMemos,
    setImages,
    setMermaids,
    setTables,
    onDeleteMemo,
    onDeleteImage,
    onDeleteMermaid,
    onDeleteTable,
}: UseBoardSelectionOptions) {
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedCards, setSelectedCards] = useState<SelectedCard[]>([]);

    const cards: SelectableCard[] = [
        ...memos.map(({ id, x, y, width, height }) => ({ type: "memo" as const, id, x, y, width, height })),
        ...images.map(({ imageId, x, y, width, height }) => ({ type: "image" as const, id: imageId, x, y, width, height })),
        ...mermaids.map(({ id, x, y, width, height }) => ({ type: "mermaid" as const, id, x, y, width, height })),
        ...tables.map(({ id, x, y, width, height }) => ({ type: "table" as const, id, x, y, width, height })),
    ];
    const selectedKeys = new Set(selectedCards.map((card) => cardKey(card.type, card.id)));
    const selectedRects = cards.filter((card) => selectedKeys.has(cardKey(card.type, card.id)));

    const selectionBounds: SelectionRect | null = selectedRects.length === 0 ? null : (() => {
        const left = Math.min(...selectedRects.map((card) => card.x));
        const top = Math.min(...selectedRects.map((card) => card.y));
        const right = Math.max(...selectedRects.map((card) => card.x + card.width));
        const bottom = Math.max(...selectedRects.map((card) => card.y + card.height));
        return { x: left, y: top, width: right - left, height: bottom - top };
    })();

    const clampSelectionOffset = (offset: SelectionOffset): SelectionOffset => {
        if (!selectionBounds) {
            return { x: 0, y: 0 };
        }
        return {
            x: Math.round(clamp(offset.x, -selectionBounds.x, boardWidth - selectionBounds.x - selectionBounds.width)),
            y: Math.round(clamp(offset.y, -selectionBounds.y, boardHeight - selectionBounds.y - selectionBounds.height)),
        };
    };

    const handleToggleSelectionMode = () => {
        if (selectionMode) {
            setSelectedCards([]);
        }
        setSelectionMode((prev) => !prev);
    };

    const handleSelectCards = (rect: SelectionRect) => {
        setSelectedCards(cards
            .filter((card) => intersects(card, rect))
            .map(({ type, id }) => ({ type, id })));
    };

    const handleClearSelection = () => {
        setSelectedCards([]);
    };

    const handleMoveSelection = (offset: SelectionOffset) => {
        const { x: dx, y: dy } = clampSelectionOffset(offset);
        if (dx === 0 && dy === 0) {
            return;
        }

        const isSelected = (type: CardType, id: number) => selectedKeys.has(cardKey(type, id));
        const selectedTypes = new Set(selectedRects.map((card) => card.type));
        if (selectedTypes.has("memo")) {
            setMemos((prev) => prev.map((memo) => isSelected("memo", memo.id) ? { ...memo, x: memo.x + dx, y: memo.y + dy } : memo));
        }
        if (selectedTypes.has("image")) {
            setImages((prev) => prev.map((image) => isSelected("image", image.imageId) ? { ...image, x: image.x + dx, y: image.y + dy } : image));
        }
        if (selectedTypes.has("mermaid")) {
            setMermaids((prev) => prev.map((mermaid) => isSelected("mermaid", mermaid.id) ? { ...mermaid, x: mermaid.x + dx, y: mermaid.y + dy } : mermaid));
        }
        if (selectedTypes.has("table")) {
            setTables((prev) => prev.map((table) => isSelected("table", table.id) ? { ...table, x: table.x + dx, y: table.y + dy } : table));
        }
    };

    const handleDeleteSelection = () => {
        const onDelete: Record<CardType, (id: number) => void> = {
            memo: onDeleteMemo,
            image: onDeleteImage,
            mermaid: onDeleteMermaid,
            table: onDeleteTable,
        };
        selectedRects.forEach((card) => onDelete[card.type](card.id));
        setSelectedCards([]);
    };

    return {
        selectionMode,
        setSelectionMode,
        selectedCards: selectedRects.map(({ type, id }) => ({ type, id })),
        selectionBounds,
        clampSelectionOffset,
        handleToggleSelectionMode,
        handleSelectCards,
        handleClearSelection,
        handleMoveSelection,
        handleDeleteSelection,
    };
}
