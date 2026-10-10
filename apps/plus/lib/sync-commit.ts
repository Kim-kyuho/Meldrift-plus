import { sql, type SQL } from "drizzle-orm";
import { boardOperationFields, type BoardOperation, type BoardOperationType } from "@meldrift/board-data/board-delta";
import { editorSessionGuard, type EditorIdentity } from "./editor-guard";
import type { ChangeRequest } from "./sync-operations";

type CommitTarget = { table: string; columns: Record<string, string>; json: readonly string[] };

export const commitTargets = {
    memo: {
        table: "memos",
        columns: {
            x: "x", y: "y", z: "z", width: "width", height: "height",
            content: "content", color: "color", sortOrder: "sort_order",
        },
        json: [],
    },
    mermaid: {
        table: "mermaids",
        columns: { x: "x", y: "y", z: "z", width: "width", height: "height", source: "source" },
        json: [],
    },
    table: {
        table: "tables",
        columns: { x: "x", y: "y", z: "z", width: "width", height: "height", source: "source" },
        json: ["source"],
    },
    image: {
        table: "images",
        columns: {
            x: "x", y: "y", z: "z", width: "width", height: "height",
            url: "secure_url", label: "filename", assetId: "asset_id",
        },
        json: [],
    },
    stroke: {
        table: "drawing_strokes",
        columns: { color: "color", width: "width", points: "points" },
        json: ["points"],
    },
} as const satisfies Record<BoardOperationType, CommitTarget>;

export type CommitContext = EditorIdentity & {
    boardId: number;
    baseRevision: number;
    mutationId: string;
    digest: string;
};

function guardOf(context: CommitContext) {
    return sql`${editorSessionGuard(context)} AND EXISTS (
        SELECT 1 FROM board_sync s
        WHERE s.board_id = ${context.boardId} AND s.revision = ${context.baseRevision}
            AND s.mode = 'delta'
            AND NOT EXISTS (
                SELECT 1 FROM sync_mutations m
                WHERE m.board_id = ${context.boardId} AND m.mutation_id = ${context.mutationId}))`;
}

const bind = (target: CommitTarget, field: string, value: unknown) =>
    target.json.includes(field) ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`;

const identifiers = (names: readonly string[]) => sql.raw(names.join(", "));

function createStatement(operation: BoardOperation, target: CommitTarget, context: CommitContext, guard: SQL) {
    const fields = boardOperationFields[operation.type] as readonly string[];
    const columns = fields.map((field) => target.columns[field]);
    const values = fields.map((field) => bind(target, field, operation.changes[field]));
    const assignments = columns.map((column) => `${column} = excluded.${column}`);

    return sql`
        INSERT INTO ${sql.raw(target.table)} (board_id, sync_id, ${identifiers(columns)})
        SELECT ${context.boardId}, ${operation.syncId}, ${sql.join(values, sql`, `)}
        WHERE ${guard}
        ON CONFLICT (board_id, sync_id) DO UPDATE SET ${sql.raw(assignments.join(", "))}, updated_at = now()`;
}

function updateStatement(operation: BoardOperation, target: CommitTarget, context: CommitContext, guard: SQL) {
    const assignments = Object.entries(operation.changes).map(([field, value]) =>
        sql`${sql.raw(target.columns[field])} = ${bind(target, field, value)}`);

    return sql`
        UPDATE ${sql.raw(target.table)} SET ${sql.join(assignments, sql`, `)}, updated_at = now()
        WHERE board_id = ${context.boardId} AND sync_id = ${operation.syncId} AND ${guard}`;
}

function deleteStatement(operation: BoardOperation, target: CommitTarget, context: CommitContext, guard: SQL) {
    return sql`
        DELETE FROM ${sql.raw(target.table)}
        WHERE board_id = ${context.boardId} AND sync_id = ${operation.syncId} AND ${guard}`;
}

function operationStatement(operation: BoardOperation, context: CommitContext, guard: SQL) {
    const target = commitTargets[operation.type] as CommitTarget;
    if (operation.action === "create") {
        return createStatement(operation, target, context, guard);
    }
    if (operation.action === "update") {
        return updateStatement(operation, target, context, guard);
    }
    return deleteStatement(operation, target, context, guard);
}

const lockStatement = (context: CommitContext) => sql`
    INSERT INTO board_sync (board_id)
    SELECT board_id FROM boards WHERE board_id = ${context.boardId}
    ON CONFLICT (board_id) DO UPDATE SET updated_at = board_sync.updated_at
    RETURNING revision`;

const commitStatement = (context: CommitContext) => sql`
    WITH bumped AS (
        UPDATE board_sync SET revision = board_sync.revision + 1, updated_at = now()
        WHERE board_id = ${context.boardId} AND ${guardOf(context)}
        RETURNING revision)
    INSERT INTO sync_mutations (board_id, mutation_id, digest, revision)
    SELECT ${context.boardId}, ${context.mutationId}, ${context.digest}, revision FROM bumped
    RETURNING revision`;

export const referencedAssetIds = (request: ChangeRequest) => [...new Set(request.operations
    .filter((operation) => operation.asset)
    .map((operation) => String(operation.changes.assetId ?? "")))];

export function buildCommitStatements(request: ChangeRequest, context: CommitContext): SQL[] {
    const guard = guardOf(context);
    return [
        lockStatement(context),
        ...request.operations.map((operation) => operationStatement(operation, context, guard)),
        commitStatement(context),
    ];
}
