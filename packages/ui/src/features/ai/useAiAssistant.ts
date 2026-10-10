import { Dispatch, RefObject, SetStateAction, useCallback, useState } from "react";
import {
    getPlanCapacity,
    memoBlocksToHtml,
    planTableToSource,
    layoutArrangement,
    layoutBoardPlan,
    type BoardArrangement,
    type BoardBounds,
    type BoardDeletion,
    type BoardEdit,
    type BoardPlan,
} from "@meldrift/core/board-plan";
import { nextMemoOrder } from "@meldrift/core/memo-order";
import { createSyncId } from "@meldrift/board-data/board-state";
import type { BoardImage } from "@meldrift/board-data/board-state";
import type { BoardMemo } from "@meldrift/board-data/board-state";
import type { BoardMermaid } from "@meldrift/board-data/board-state";
import type { BoardTable } from "@meldrift/board-data/board-state";

export type AiChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type PendingCards = {
    memoIds: number[];
    mermaidIds: number[];
    tableIds: number[];
};

const emptyPendingCards: PendingCards = { memoIds: [], mermaidIds: [], tableIds: [] };

type MovedCard = { id: number; x: number; y: number; previousX: number; previousY: number };

type PendingMoves = {
    memos: MovedCard[];
    mermaids: MovedCard[];
    tables: MovedCard[];
};

const emptyPendingMoves: PendingMoves = { memos: [], mermaids: [], tables: [] };

type PendingEdits = {
    memos: BoardMemo[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
};

const emptyPendingEdits: PendingEdits = { memos: [], mermaids: [], tables: [] };

type PendingDeletions = {
    memos: BoardMemo[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
    images: BoardImage[];
};

const emptyPendingDeletions: PendingDeletions = { memos: [], mermaids: [], tables: [], images: [] };

type BoardCards = {
    memos: BoardMemo[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
    images: BoardImage[];
};

const newColumnGap = 120;

const boardMarginOrigin = 40;

type UseAiAssistantOptions = {
    boardId: number;
    boardWidth: number;
    boardHeight: number;
    boardZoom: number;
    cardLocationRef: RefObject<HTMLDivElement | null>;
    setMessage: (message: string) => void;
    canEdit?: boolean;
    onPermissionDenied?: () => void;
    memos: BoardMemo[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
    images: BoardImage[];
    setMemos: Dispatch<SetStateAction<BoardMemo[]>>;
    setMermaids: Dispatch<SetStateAction<BoardMermaid[]>>;
    setTables: Dispatch<SetStateAction<BoardTable[]>>;
    setImages: Dispatch<SetStateAction<BoardImage[]>>;
    onInsertMemo: (
        tempId: number, boardId: number, content: string,
        x: number, y: number, z: number, width: number, height: number, color: string,
    ) => Promise<void>;
    onInsertMermaid: (
        tempId: number, boardId: number, source: string,
        x: number, y: number, z: number, width: number, height: number,
    ) => Promise<void>;
    onInsertTable: (table: BoardTable) => Promise<void>;
    onUpdateMemo: (
        id: number, boardId: number, content: string,
        x: number, y: number, width: number, height: number, color: string,
    ) => Promise<void>;
    onUpdateMermaid: (
        id: number, boardId: number, source: string,
        x: number, y: number, width: number, height: number,
    ) => Promise<void>;
    onUpdateTable: (table: BoardTable) => Promise<void>;
    onDeleteMemo: (id: number) => Promise<void>;
    onDeleteMermaid: (id: number) => Promise<void>;
    onDeleteTable: (id: number) => Promise<void>;
    onDeleteImage: (imageId: number) => Promise<void>;
};

export function useAiAssistant({
    boardId,
    boardWidth,
    boardHeight,
    boardZoom,
    cardLocationRef,
    setMessage,
    canEdit = true,
    onPermissionDenied,
    memos,
    mermaids,
    tables,
    images,
    setMemos,
    setMermaids,
    setTables,
    setImages,
    onInsertMemo,
    onInsertMermaid,
    onInsertTable,
    onUpdateMemo,
    onUpdateMermaid,
    onUpdateTable,
    onDeleteMemo,
    onDeleteMermaid,
    onDeleteTable,
    onDeleteImage,
}: UseAiAssistantOptions) {
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [unlocking, setUnlocking] = useState(false);
    const [unlockError, setUnlockError] = useState("");
    const [messages, setMessages] = useState<AiChatMessage[]>([]);
    const [sending, setSending] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pendingCards, setPendingCards] = useState<PendingCards>(emptyPendingCards);
    const [pendingMoves, setPendingMoves] = useState<PendingMoves>(emptyPendingMoves);
    const [pendingEdits, setPendingEdits] = useState<PendingEdits>(emptyPendingEdits);
    const [pendingDeletions, setPendingDeletions] = useState<PendingDeletions>(emptyPendingDeletions);

    const hasPendingCards =
        pendingCards.memoIds.length > 0 ||
        pendingCards.mermaidIds.length > 0 ||
        pendingCards.tableIds.length > 0 ||
        pendingMoves.memos.length > 0 ||
        pendingMoves.mermaids.length > 0 ||
        pendingMoves.tables.length > 0 ||
        pendingEdits.memos.length > 0 ||
        pendingEdits.mermaids.length > 0 ||
        pendingEdits.tables.length > 0 ||
        pendingDeletions.memos.length > 0 ||
        pendingDeletions.mermaids.length > 0 ||
        pendingDeletions.tables.length > 0 ||
        pendingDeletions.images.length > 0;

    const boardBounds: BoardBounds = { width: boardWidth, height: boardHeight };

    const currentCards = (): BoardCards => ({ memos, mermaids, tables, images });

    const commitCards = (cards: BoardCards) => {
        setMemos(cards.memos);
        setMermaids(cards.mermaids);
        setTables(cards.tables);
        setImages(cards.images);
    };

    const clearPending = () => {
        setPendingCards(emptyPendingCards);
        setPendingMoves(emptyPendingMoves);
        setPendingEdits(emptyPendingEdits);
        setPendingDeletions(emptyPendingDeletions);
    };

    const restoreCards = (cards: BoardCards): BoardCards => {
        const restore = <T extends { id: number; x: number; y: number }>(list: T[], moves: MovedCard[]) => {
            if (moves.length === 0) {
                return list;
            }
            const moveById = new Map(moves.map((move) => [move.id, move]));

            return list.map((card) => {
                const move = moveById.get(card.id);
                return move ? { ...card, x: move.previousX, y: move.previousY } : card;
            });
        };

        const revert = <T extends { id: number }>(list: T[], previous: T[], removed: T[]) => {
            const previousById = new Map(previous.map((card) => [card.id, card]));
            const reverted = list.map((card) => previousById.get(card.id) ?? card);

            return removed.length > 0 ? [...reverted, ...removed] : reverted;
        };

        return {
            memos: revert(
                restore(cards.memos.filter((memo) => !pendingCards.memoIds.includes(memo.id)), pendingMoves.memos),
                pendingEdits.memos,
                pendingDeletions.memos
            ),
            mermaids: revert(
                restore(cards.mermaids.filter((card) => !pendingCards.mermaidIds.includes(card.id)), pendingMoves.mermaids),
                pendingEdits.mermaids,
                pendingDeletions.mermaids
            ),
            tables: revert(
                restore(cards.tables.filter((card) => !pendingCards.tableIds.includes(card.id)), pendingMoves.tables),
                pendingEdits.tables,
                pendingDeletions.tables
            ),
            images: pendingDeletions.images.length > 0
                ? [...cards.images, ...pendingDeletions.images]
                : cards.images,
        };
    };

    const discardPendingCards = useCallback(() => {
        commitCards(restoreCards(currentCards()));
        clearPending();
        // restoreCards/commitCards는 매 렌더 새로 만들어짐 - 의존성에는 그 안에서 읽는 값만 적음
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        memos,
        mermaids,
        tables,
        images,
        pendingCards,
        pendingMoves,
        pendingEdits,
        pendingDeletions,
        setMemos,
        setMermaids,
        setTables,
        setImages,
    ]);

    const refreshAiStatus = useCallback(async () => {
        const response = await fetch("/api/ai/status");
        const data = await response.json();

        if (!data.ok) {
            return null;
        }

        setUnlocked(Boolean(data.unlocked));

        return { configured: Boolean(data.configured), message: data.message as string | null };
    }, []);

    const handleToggleAiPanel = async () => {
        if (!canEdit) {
            onPermissionDenied?.();
            return;
        }
        if (aiPanelOpen) {
            // 안 정한 채로 닫으면 자동 저장이 멈춘 걸 모르고 넘어감 - 먼저 결정하게 함
            if (hasPendingCards) {
                setMessage("Save or discard the assistant's changes first.");
                return;
            }

            setAiPanelOpen(false);
            return;
        }

        const status = await refreshAiStatus();

        if (!status?.configured) {
            setMessage(status?.message ?? "The AI assistant is unavailable.");
            return;
        }

        setUnlockError("");
        setAiPanelOpen(true);
    };

    const handleUnlock = async (password: string) => {
        if (!password || unlocking) {
            return;
        }

        setUnlocking(true);

        try {
            const response = await fetch("/api/ai/unlock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            const data = await response.json();

            if (!data.ok) {
                setUnlockError(data.message ?? "The assistant could not be unlocked.");
                return;
            }

            setUnlockError("");
            setUnlocked(true);
        } catch (error) {
            console.error("Error unlocking AI assistant:", error);
            setUnlockError("The assistant could not be unlocked.");
        } finally {
            setUnlocking(false);
        }
    };

    const handleLock = async () => {
        if (hasPendingCards) {
            setMessage("Save or discard the assistant's changes first.");
            return;
        }

        try {
            await fetch("/api/ai/unlock", { method: "DELETE" });
        } catch (error) {
            console.error("Error locking AI assistant:", error);
        }

        setUnlocked(false);
        setMessages([]);
        setAiPanelOpen(false);
    };

    const getPlanOrigin = (base: BoardCards) => {
        const rightEdges = [
            ...base.memos.map((memo) => memo.x + memo.width),
            ...base.mermaids.map((mermaid) => mermaid.x + mermaid.width),
            ...base.tables.map((table) => table.x + table.width),
        ];
        const locationElement = cardLocationRef.current;
        const viewportTop = locationElement ? locationElement.scrollTop / boardZoom : 0;

        return {
            x: rightEdges.length > 0 ? Math.max(...rightEdges) + newColumnGap : newColumnGap,
            y: viewportTop + 80,
        };
    };

    const applyPlan = (plan: BoardPlan, base: BoardCards) => {
        const planned = layoutBoardPlan(plan, getPlanOrigin(base), boardBounds);
        const idBase = -Date.now();
        let idOffset = 0;
        const nextTempId = () => idBase + idOffset++;
        const orderBase = nextMemoOrder(base.memos);

        const allExistingZ = [
            ...base.memos.map((m) => m.z),
            ...base.images.map((i) => i.z),
            ...base.mermaids.map((m) => m.z),
            ...base.tables.map((t) => t.z),
        ];
        let currentZ = allExistingZ.length > 0 ? Math.max(...allExistingZ) + 1 : 1;

        const newMemos: BoardMemo[] = planned.memos.map((memo, index) => ({
            id: nextTempId(),
            syncId: createSyncId(),
            boardId,
            content: memo.content,
            x: memo.x,
            y: memo.y,
            z: currentZ++,
            width: memo.width,
            height: memo.height,
            color: memo.color,
            sortOrder: orderBase + index,
        }));
        const newMermaids: BoardMermaid[] = planned.mermaids.map((mermaid) => ({
            id: nextTempId(),
            syncId: createSyncId(),
            boardId,
            source: mermaid.source,
            x: mermaid.x,
            y: mermaid.y,
            z: currentZ++,
            width: mermaid.width,
            height: mermaid.height,
        }));
        const newTables: BoardTable[] = planned.tables.map((table) => ({
            id: nextTempId(),
            syncId: createSyncId(),
            boardId,
            source: table.source,
            x: table.x,
            y: table.y,
            z: currentZ++,
            width: table.width,
            height: table.height,
        }));

        const next: BoardCards = {
            memos: [...base.memos, ...newMemos],
            mermaids: [...base.mermaids, ...newMermaids],
            tables: [...base.tables, ...newTables],
            images: base.images,
        };

        commitCards(next);
        setPendingCards({
            memoIds: newMemos.map((memo) => memo.id),
            mermaidIds: newMermaids.map((mermaid) => mermaid.id),
            tableIds: newTables.map((table) => table.id),
        });

        const locationElement = cardLocationRef.current;
        if (locationElement && newMemos[0]) {
            locationElement.scrollTo({
                left: Math.max(0, newMemos[0].x * boardZoom - 120),
                top: Math.max(0, newMemos[0].y * boardZoom - 120),
                behavior: "smooth",
            });
        }

        return { droppedSections: planned.droppedSections, placed: newMemos.length, cards: next };
    };

    const applyArrangement = (arrangement: BoardArrangement, base: BoardCards) => {
        const arranged = layoutArrangement(
            arrangement,
            { memos: base.memos, mermaids: base.mermaids, tables: base.tables },
            { x: boardMarginOrigin, y: boardMarginOrigin },
            boardBounds
        );

        const toMoves = <T extends { id: number; x: number; y: number }>(
            cards: T[],
            moves: { id: number; x: number; y: number }[]
        ): MovedCard[] => {
            const cardById = new Map(cards.map((card) => [card.id, card]));

            return moves.flatMap((move) => {
                const card = cardById.get(move.id);
                if (!card || (card.x === move.x && card.y === move.y)) {
                    return [];
                }
                return [{ ...move, previousX: card.x, previousY: card.y }];
            });
        };

        const memoMoves = toMoves(base.memos, arranged.memos);
        const mermaidMoves = toMoves(base.mermaids, arranged.mermaids);
        const tableMoves = toMoves(base.tables, arranged.tables);

        const applyMoves = <T extends { id: number; x: number; y: number }>(cards: T[], moves: MovedCard[]) => {
            if (moves.length === 0) {
                return cards;
            }
            const moveById = new Map(moves.map((move) => [move.id, move]));

            return cards.map((card) => {
                const move = moveById.get(card.id);
                return move ? { ...card, x: move.x, y: move.y } : card;
            });
        };

        const next: BoardCards = {
            memos: applyMoves(base.memos, memoMoves),
            mermaids: applyMoves(base.mermaids, mermaidMoves),
            tables: applyMoves(base.tables, tableMoves),
            images: base.images,
        };

        commitCards(next);
        setPendingMoves({ memos: memoMoves, mermaids: mermaidMoves, tables: tableMoves });

        const locationElement = cardLocationRef.current;
        if (locationElement && arranged.memos[0]) {
            locationElement.scrollTo({
                left: Math.max(0, arranged.memos[0].x * boardZoom - 120),
                top: Math.max(0, arranged.memos[0].y * boardZoom - 120),
                behavior: "smooth",
            });
        }

        return { droppedSections: arranged.droppedSections, moved: memoMoves.length, cards: next };
    };

    const getBoardSnapshot = () => {
        const stripHtml = (html: string) =>
            html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

        return {
            memos: memos
                .filter((memo) => memo.id > 0)
                .map((memo) => ({ id: memo.id, summary: stripHtml(memo.content).slice(0, 120) || "(empty memo)" })),
            mermaids: mermaids
                .filter((card) => card.id > 0)
                .map((card) => ({ id: card.id, summary: card.source.split("\n")[0].slice(0, 120) })),
            tables: tables
                .filter((card) => card.id > 0)
                .map((card) => ({
                    id: card.id,
                    summary: card.source.columns.map((column) => column.name).join(", ").slice(0, 120),
                })),
            images: images
                .filter((image) => image.imageId > 0)
                .map((image) => ({
                    id: image.imageId,
                    summary: ((image.label ?? image.url) || "Local image").slice(0, 120),
                })),
            capacity: getPlanCapacity(boardBounds),
        };
    };

    const applyEdit = (edit: BoardEdit, base: BoardCards) => {
        const memoEdits = new Map((edit.memos ?? []).map((item) => [item.id, item]));
        const mermaidEdits = new Map((edit.mermaids ?? []).map((item) => [item.id, item]));
        const tableEdits = new Map((edit.tables ?? []).map((item) => [item.id, item]));

        const changedMemos = base.memos.filter((memo) => memoEdits.has(memo.id));
        const changedMermaids = base.mermaids.filter((card) => mermaidEdits.has(card.id));
        const changedTables = base.tables.filter((card) => tableEdits.has(card.id));
        const changedCount = changedMemos.length + changedMermaids.length + changedTables.length;

        if (changedCount === 0) {
            return { changed: 0, cards: base };
        }

        const next: BoardCards = {
            memos: base.memos.map((memo) => {
                const change = memoEdits.get(memo.id);

                if (!change) {
                    return memo;
                }

                return {
                    ...memo,
                    content: change.blocks ? memoBlocksToHtml(change.blocks) : memo.content,
                    color: change.color ?? memo.color,
                };
            }),
            mermaids: base.mermaids.map((card) => {
                const change = mermaidEdits.get(card.id);
                return change ? { ...card, source: change.source } : card;
            }),
            tables: base.tables.map((card) => {
                const change = tableEdits.get(card.id);
                return change
                    ? { ...card, source: planTableToSource(change.columns, change.rows) }
                    : card;
            }),
            images: base.images,
        };

        commitCards(next);

        setPendingEdits((prev) => {
            const keep = <T extends { id: number }>(previous: T[], candidates: T[]) => {
                const known = new Set(previous.map((card) => card.id));
                return [...previous, ...candidates.filter((card) => !known.has(card.id))];
            };

            return {
                memos: keep(prev.memos, changedMemos),
                mermaids: keep(prev.mermaids, changedMermaids),
                tables: keep(prev.tables, changedTables),
            };
        });

        return { changed: changedCount, cards: next };
    };

    const applyDeletion = (deletion: BoardDeletion, base: BoardCards) => {
        const memoIds = new Set(deletion.memoIds ?? []);
        const mermaidIds = new Set(deletion.mermaidIds ?? []);
        const tableIds = new Set(deletion.tableIds ?? []);
        const imageIds = new Set(deletion.imageIds ?? []);

        const removedMemos = base.memos.filter((memo) => memoIds.has(memo.id));
        const removedMermaids = base.mermaids.filter((card) => mermaidIds.has(card.id));
        const removedTables = base.tables.filter((card) => tableIds.has(card.id));
        const removedImages = base.images.filter((image) => imageIds.has(image.imageId) && image.imageId > 0);
        const removedCount =
            removedMemos.length + removedMermaids.length + removedTables.length + removedImages.length;

        if (removedCount === 0) {
            return { removed: 0, cards: base };
        }

        const next: BoardCards = {
            memos: base.memos.filter((memo) => !memoIds.has(memo.id)),
            mermaids: base.mermaids.filter((card) => !mermaidIds.has(card.id)),
            tables: base.tables.filter((card) => !tableIds.has(card.id)),
            images: base.images.filter((image) => !imageIds.has(image.imageId)),
        };

        commitCards(next);
        setPendingDeletions((prev) => ({
            memos: [...prev.memos, ...removedMemos],
            mermaids: [...prev.mermaids, ...removedMermaids],
            tables: [...prev.tables, ...removedTables],
            images: [...prev.images, ...removedImages],
        }));

        return { removed: removedCount, cards: next };
    };

    const handleSendMessage = async (text: string) => {
        if (!canEdit) {
            onPermissionDenied?.();
            return;
        }
        const content = text.trim();

        if (!content || sending) {
            return;
        }

        const nextMessages: AiChatMessage[] = [...messages, { role: "user", content }];
        setMessages(nextMessages);
        setSending(true);

        try {
            const response = await fetch("/api/ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: nextMessages.slice(-20),
                    snapshot: getBoardSnapshot(),
                }),
            });
            const data = await response.json();

            if (!data.ok) {
                if (data.locked) {
                    setUnlocked(false);
                    setUnlockError("The assistant was locked again. Enter the password to continue.");
                } else {
                    setMessage(data.message ?? "The AI assistant could not respond.");
                }

                setMessages(nextMessages);
                return;
            }

            const notes: string[] = [];

            let cards = currentCards();

            if (data.plan || data.arrangement || data.edit || data.deletion) {
                if (hasPendingCards) {
                    cards = restoreCards(cards);
                    commitCards(cards);
                    clearPending();
                }
            }

            if (data.plan) {
                const result = applyPlan(data.plan, cards);
                cards = result.cards;

                if (result.droppedSections > 0) {
                    notes.push(
                        `Could not place ${result.droppedSections} section(s) because the board is full. Clear some space first.`
                    );
                }
            }

            if (data.edit) {
                const result = applyEdit(data.edit, cards);
                cards = result.cards;

                if (result.changed === 0) {
                    notes.push("Could not find those cards on this board.");
                }
            }

            if (data.deletion) {
                const result = applyDeletion(data.deletion, cards);
                cards = result.cards;

                if (result.removed === 0) {
                    notes.push("Could not find those cards on this board.");
                }
            }

            if (data.arrangement) {
                const result = applyArrangement(data.arrangement, cards);
                cards = result.cards;

                if (result.moved === 0) {
                    notes.push("There was nothing to move.");
                }
                if (result.droppedSections > 0) {
                    notes.push(`Left ${result.droppedSections} card(s) in place because the board is full.`);
                }
            }

            setMessages([
                ...nextMessages,
                { role: "assistant", content: [data.reply, ...notes].filter(Boolean).join("\n\n") },
            ]);
        } catch (error) {
            console.error("Error sending AI message:", error);
            setMessage("The AI assistant could not respond.");
        } finally {
            setSending(false);
        }
    };

    const handleSavePendingCards = async () => {
        if (!canEdit) {
            onPermissionDenied?.();
            return;
        }
        if (!hasPendingCards || saving) {
            return;
        }

        setSaving(true);

        try {
            for (const memoId of pendingCards.memoIds) {
                const memo = memos.find((item) => item.id === memoId);
                if (!memo) {
                    continue;
                }
                await onInsertMemo(
                    memo.id, memo.boardId, memo.content,
                    memo.x, memo.y, memo.z, memo.width, memo.height, memo.color,
                );
            }

            for (const mermaidId of pendingCards.mermaidIds) {
                const mermaid = mermaids.find((item) => item.id === mermaidId);
                if (!mermaid) {
                    continue;
                }
                await onInsertMermaid(
                    mermaid.id, mermaid.boardId, mermaid.source,
                    mermaid.x, mermaid.y, mermaid.z, mermaid.width, mermaid.height,
                );
            }

            for (const tableId of pendingCards.tableIds) {
                const table = tables.find((item) => item.id === tableId);
                if (!table) {
                    continue;
                }
                await onInsertTable(table);
            }

            for (const previous of pendingEdits.memos) {
                const memo = memos.find((item) => item.id === previous.id);
                if (!memo) {
                    continue;
                }
                await onUpdateMemo(
                    memo.id, memo.boardId, memo.content,
                    memo.x, memo.y, memo.width, memo.height, memo.color,
                );
            }

            for (const previous of pendingEdits.mermaids) {
                const mermaid = mermaids.find((item) => item.id === previous.id);
                if (!mermaid) {
                    continue;
                }
                await onUpdateMermaid(
                    mermaid.id, mermaid.boardId, mermaid.source,
                    mermaid.x, mermaid.y, mermaid.width, mermaid.height,
                );
            }

            for (const previous of pendingEdits.tables) {
                const table = tables.find((item) => item.id === previous.id);
                if (!table) {
                    continue;
                }
                await onUpdateTable(table);
            }

            for (const memo of pendingDeletions.memos) {
                await onDeleteMemo(memo.id);
            }
            for (const mermaid of pendingDeletions.mermaids) {
                await onDeleteMermaid(mermaid.id);
            }
            for (const table of pendingDeletions.tables) {
                await onDeleteTable(table.id);
            }
            for (const image of pendingDeletions.images) {
                await onDeleteImage(image.imageId);
            }

            for (const move of pendingMoves.memos) {
                const memo = memos.find((item) => item.id === move.id);
                if (!memo) {
                    continue;
                }
                await onUpdateMemo(
                    memo.id, memo.boardId, memo.content,
                    move.x, move.y, memo.width, memo.height, memo.color,
                );
            }

            for (const move of pendingMoves.mermaids) {
                const mermaid = mermaids.find((item) => item.id === move.id);
                if (!mermaid) {
                    continue;
                }
                await onUpdateMermaid(
                    mermaid.id, mermaid.boardId, mermaid.source,
                    move.x, move.y, mermaid.width, mermaid.height,
                );
            }

            for (const move of pendingMoves.tables) {
                const table = tables.find((item) => item.id === move.id);
                if (!table) {
                    continue;
                }
                await onUpdateTable({ ...table, x: move.x, y: move.y });
            }

            setPendingCards(emptyPendingCards);
            setPendingMoves(emptyPendingMoves);
            setPendingEdits(emptyPendingEdits);
            setPendingDeletions(emptyPendingDeletions);
        } finally {
            setSaving(false);
        }
    };

    return {
        aiPanelOpen,
        unlocked,
        unlocking,
        unlockError,
        messages,
        sending,
        saving,
        hasPendingCards,
        refreshAiStatus,
        handleToggleAiPanel,
        handleUnlock,
        handleLock,
        handleSendMessage,
        handleSavePendingCards,
        discardPendingCards,
    };
}
