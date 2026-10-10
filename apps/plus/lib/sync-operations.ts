import { createHash } from "node:crypto";
import { z } from "zod";
import { tableSourceSchema } from "@meldrift/core/table-card";
import { boardOperationFields, maxOperationsPerRequest, type BoardOperation, type BoardOperationType } from "@meldrift/board-data/board-delta";

export { maxOperationsPerRequest };

const geometry = {
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
};

export const changeFieldSchemas = {
    memo: { ...geometry, content: z.string(), color: z.string().min(1), sortOrder: z.number().int().positive() },
    image: { ...geometry, url: z.string(), label: z.string().nullable(), assetId: z.string() },
    mermaid: { ...geometry, source: z.string().trim().min(1) },
    table: { ...geometry, source: tableSourceSchema },
    stroke: {
        color: z.string().min(1),
        width: z.number().positive(),
        points: z.array(z.tuple([z.number(), z.number()])).min(2),
    },
} satisfies Record<BoardOperationType, Record<string, z.ZodType>>;

const types = Object.keys(changeFieldSchemas) as BoardOperationType[];

const requestSchema = (maxOperations: number) => z.object({
    baseRevision: z.number().int().min(0),
    mutationId: z.string().regex(/^[a-zA-Z0-9:-]{1,160}$/),
    operations: z.array(z.object({
        type: z.enum(types as [BoardOperationType, ...BoardOperationType[]]),
        syncId: z.string().min(1).max(200),
        action: z.enum(["create", "update", "delete"]),
        changes: z.record(z.string(), z.unknown()),
        asset: z.boolean().optional(),
    })).min(1).max(maxOperations),
});

export type ChangeRequest = {
    baseRevision: number;
    mutationId: string;
    operations: BoardOperation[];
};

export class ChangeRequestError extends Error {}

function parseChanges(type: BoardOperationType, action: string, changes: Record<string, unknown>) {
    const shape = changeFieldSchemas[type] as Record<string, z.ZodType>;

    if (action === "delete") {
        if (Object.keys(changes).length > 0) {
            throw new ChangeRequestError("A delete carries no fields.");
        }
        return {};
    }

    const allowed = boardOperationFields[type] as readonly string[];
    for (const field of Object.keys(changes)) {
        if (!allowed.includes(field)) {
            throw new ChangeRequestError(`Unknown ${type} field: ${field}.`);
        }
    }
    if (action === "create") {
        for (const field of allowed) {
            if (!(field in changes)) {
                throw new ChangeRequestError(`A new ${type} is missing ${field}.`);
            }
        }
    }

    const parsed: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes)) {
        const result = shape[field].safeParse(value);
        if (!result.success) {
            throw new ChangeRequestError(`Invalid ${type} field: ${field}.`);
        }
        parsed[field] = result.data;
    }
    return parsed;
}

export function parseChangeRequest(value: unknown, maxOperations = maxOperationsPerRequest): ChangeRequest {
    const result = requestSchema(maxOperations).safeParse(value);
    if (!result.success) {
        throw new ChangeRequestError("Invalid change request.");
    }

    const seen = new Set<string>();
    const operations = result.data.operations.map((operation) => {
        const key = `${operation.type}:${operation.syncId}`;
        if (seen.has(key)) {
            throw new ChangeRequestError("A card appears twice in one request.");
        }
        seen.add(key);

        if (operation.asset && operation.type !== "image") {
            throw new ChangeRequestError("Only images carry binary data.");
        }

        const changes = parseChanges(operation.type, operation.action, operation.changes);
        if (operation.action === "update" && Object.keys(changes).length === 0 && !operation.asset) {
            throw new ChangeRequestError("An update must change something.");
        }

        return { ...operation, changes } as BoardOperation;
    });

    return { baseRevision: result.data.baseRevision, mutationId: result.data.mutationId, operations };
}

export function changeRequestDigest(request: ChangeRequest) {
    return createHash("sha256")
        .update(JSON.stringify([request.baseRevision, request.operations]))
        .digest("hex");
}
