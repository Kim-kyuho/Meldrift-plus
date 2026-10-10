import type { BoardImage, BoardMemo, BoardMermaid, BoardSnapshot, BoardTable } from "./board-state";
import type { BoardStroke } from "@meldrift/core/board-stroke";

export type BoardOperationType = "memo" | "image" | "mermaid" | "table" | "stroke";

export const maxOperationsPerRequest = 500;
export const maxChangeBytes = 1024 * 1024;
export const changeEnvelopeBytes = 1024;
export const maxStagedChangeBytes = 4 * 1024 * 1024;
export const maxStagedOperations = 2000;
export const stagedChangeMimeType = "application/json";
export const assetChunkBytes = 1024 * 1024;
export type BoardOperationAction = "create" | "update" | "delete";

export type BoardOperation = {
    type: BoardOperationType;
    syncId: string;
    action: BoardOperationAction;
    changes: Record<string, unknown>;
    asset?: boolean;
};

const geometryFields = ["x", "y", "z", "width", "height"] as const;

export const boardOperationFields = {
    memo: [...geometryFields, "content", "color", "sortOrder"],
    image: [...geometryFields, "url", "label", "assetId"],
    mermaid: [...geometryFields, "source"],
    table: [...geometryFields, "source"],
    stroke: ["color", "width", "points"],
} as const satisfies Record<BoardOperationType, readonly string[]>;

const sameJsonValue = (left: unknown, right: unknown): boolean => {
    if (left === right) {
        return true;
    }
    if (typeof left !== "object" || typeof right !== "object" || !left || !right) {
        return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false;
    }
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) =>
        key in right && sameJsonValue(
            (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
};

type Comparators = Record<string, (left: unknown, right: unknown) => boolean>;

type CollectionDiff<T> = {
    type: BoardOperationType;
    previous: T[];
    next: T[];
    syncIdOf: (item: T) => string;
    comparators?: Comparators;
    assetChanged?: (previous: T, next: T) => boolean;
    hasAsset?: (item: T) => boolean;
};

function diffCollection<T extends Record<string, unknown>>({
    type, previous, next, syncIdOf, comparators, assetChanged, hasAsset,
}: CollectionDiff<T>): BoardOperation[] {
    const fields = boardOperationFields[type] as readonly string[];
    const equals = (field: string, left: unknown, right: unknown) =>
        comparators?.[field] ? comparators[field](left, right) : left === right;

    const operations: BoardOperation[] = [];
    const previousBySyncId = new Map(previous.map((item) => [syncIdOf(item), item]));
    const nextSyncIds = new Set<string>();

    for (const item of next) {
        const syncId = syncIdOf(item);
        nextSyncIds.add(syncId);
        const before = previousBySyncId.get(syncId);

        if (!before) {
            const changes: Record<string, unknown> = {};
            for (const field of fields) {
                changes[field] = item[field];
            }
            operations.push({
                type, syncId, action: "create", changes,
                ...(hasAsset?.(item) ? { asset: true } : {}),
            });
            continue;
        }

        const changes: Record<string, unknown> = {};
        for (const field of fields) {
            if (!equals(field, before[field], item[field])) {
                changes[field] = item[field];
            }
        }
        const asset = assetChanged?.(before, item) ?? false;
        if (Object.keys(changes).length === 0 && !asset) {
            continue;
        }
        operations.push({ type, syncId, action: "update", changes, ...(asset ? { asset: true } : {}) });
    }

    for (const item of previous) {
        const syncId = syncIdOf(item);
        if (!nextSyncIds.has(syncId)) {
            operations.push({ type, syncId, action: "delete", changes: {} });
        }
    }

    return operations;
}

type Indexed<T> = T & Record<string, unknown>;

export function diffBoardSnapshots(previous: BoardSnapshot, next: BoardSnapshot): BoardOperation[] {
    return [
        ...diffCollection<Indexed<BoardMemo>>({
            type: "memo",
            previous: previous.memos as Indexed<BoardMemo>[],
            next: next.memos as Indexed<BoardMemo>[],
            syncIdOf: (memo) => memo.syncId,
        }),
        ...diffCollection<Indexed<BoardImage>>({
            type: "image",
            previous: previous.images as Indexed<BoardImage>[],
            next: next.images as Indexed<BoardImage>[],
            syncIdOf: (image) => image.syncId,
            assetChanged: (before, after) => before.assetId !== after.assetId && after.assetId !== "",
            hasAsset: (image) => image.assetId !== "",
        }),
        ...diffCollection<Indexed<BoardMermaid>>({
            type: "mermaid",
            previous: previous.mermaids as Indexed<BoardMermaid>[],
            next: next.mermaids as Indexed<BoardMermaid>[],
            syncIdOf: (mermaid) => mermaid.syncId,
        }),
        ...diffCollection<Indexed<BoardTable>>({
            type: "table",
            previous: previous.tables as Indexed<BoardTable>[],
            next: next.tables as Indexed<BoardTable>[],
            syncIdOf: (table) => table.syncId,
            comparators: { source: sameJsonValue },
        }),
        ...diffCollection<Indexed<BoardStroke>>({
            type: "stroke",
            previous: previous.strokes as Indexed<BoardStroke>[],
            next: next.strokes as Indexed<BoardStroke>[],
            syncIdOf: (stroke) => stroke.id,
            comparators: { points: sameJsonValue },
        }),
    ];
}

const operationKey = (operation: BoardOperation) => `${operation.type}:${operation.syncId}`;

export function mergeBoardOperations(pending: BoardOperation[], incoming: BoardOperation[]): BoardOperation[] {
    const merged = new Map(pending.map((operation) => [operationKey(operation), operation]));

    for (const operation of incoming) {
        const key = operationKey(operation);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, operation);
            continue;
        }

        if (operation.action === "delete") {
            if (existing.action === "create") {
                merged.delete(key);
            }
            else {
                merged.set(key, operation);
            }
            continue;
        }

        merged.set(key, {
            ...existing,
            changes: { ...existing.changes, ...operation.changes },
            ...(existing.asset || operation.asset ? { asset: true } : {}),
        });
    }

    return [...merged.values()];
}
