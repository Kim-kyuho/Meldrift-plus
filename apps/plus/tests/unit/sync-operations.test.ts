import { describe, expect, it } from "vitest";
import { boardOperationFields } from "@meldrift/board-data/board-delta";
import {
    ChangeRequestError, changeFieldSchemas, changeRequestDigest, parseChangeRequest,
} from "@/lib/sync-operations";
import { commitTargets } from "@/lib/sync-commit";

const request = (operations: unknown[]) => ({ baseRevision: 3, mutationId: "m-1", operations });
const parse = (operations: unknown[]) => parseChangeRequest(request(operations));

const memoCreate = {
    type: "memo", syncId: "memo-1", action: "create",
    changes: {
        x: 0, y: 0, z: 1, width: 300, height: 200,
        content: "<p>a</p>", color: "#fffadc", sortOrder: 1,
    },
};

describe("허용 필드 목록", () => {
    it("변경 비교와 서버 검증이 같은 필드를 안다", () => {
        for (const [type, fields] of Object.entries(boardOperationFields)) {
            expect(Object.keys(changeFieldSchemas[type as keyof typeof changeFieldSchemas]).sort())
                .toEqual([...fields].sort());
        }
    });

    it("커밋 대상 테이블이 같은 필드를 컬럼으로 갖는다", () => {
        for (const type of Object.keys(commitTargets) as (keyof typeof commitTargets)[]) {
            expect(Object.keys(commitTargets[type].columns).sort())
                .toEqual([...boardOperationFields[type]].sort());
        }
    });
});

describe("parseChangeRequest", () => {
    it("바뀐 필드만 담은 갱신을 받는다", () => {
        const parsed = parse([{ type: "memo", syncId: "memo-1", action: "update", changes: { x: 40 } }]);

        expect(parsed.operations).toEqual([
            { type: "memo", syncId: "memo-1", action: "update", changes: { x: 40 } },
        ]);
    });

    it("모르는 필드를 거부한다", () => {
        expect(() => parse([{ type: "memo", syncId: "memo-1", action: "update", changes: { boardId: 9 } }]))
            .toThrow(ChangeRequestError);
    });

    it("타입이 어긋난 값을 거부한다", () => {
        expect(() => parse([{ type: "memo", syncId: "memo-1", action: "update", changes: { x: "40" } }]))
            .toThrow(ChangeRequestError);
        expect(() => parse([{ type: "memo", syncId: "memo-1", action: "update", changes: { width: -1 } }]))
            .toThrow(ChangeRequestError);
    });

    it("생성은 모든 필드를 요구한다", () => {
        expect(parse([memoCreate]).operations).toHaveLength(1);

        const { sortOrder, ...partial } = memoCreate.changes;
        expect(() => parse([{ ...memoCreate, changes: partial }])).toThrow(ChangeRequestError);
        expect(sortOrder).toBe(1);
    });

    it("삭제는 필드를 싣지 않는다", () => {
        expect(parse([{ type: "memo", syncId: "memo-1", action: "delete", changes: {} }]).operations)
            .toHaveLength(1);
        expect(() => parse([{ type: "memo", syncId: "memo-1", action: "delete", changes: { x: 1 } }]))
            .toThrow(ChangeRequestError);
    });

    it("아무것도 바꾸지 않는 갱신을 거부한다", () => {
        expect(() => parse([{ type: "memo", syncId: "memo-1", action: "update", changes: {} }]))
            .toThrow(ChangeRequestError);
    });

    it("이미지는 바이너리만 바뀐 갱신을 허용한다", () => {
        const parsed = parse([
            { type: "image", syncId: "image-1", action: "update", changes: {}, asset: true },
        ]);

        expect(parsed.operations[0].asset).toBe(true);
    });

    it("이미지가 아닌 카드의 바이너리 표시를 거부한다", () => {
        expect(() => parse([
            { type: "memo", syncId: "memo-1", action: "update", changes: { x: 1 }, asset: true },
        ])).toThrow(ChangeRequestError);
    });

    it("한 요청에 같은 카드가 두 번 오는 것을 거부한다", () => {
        expect(() => parse([
            { type: "memo", syncId: "memo-1", action: "update", changes: { x: 1 } },
            { type: "memo", syncId: "memo-1", action: "delete", changes: {} },
        ])).toThrow(ChangeRequestError);
    });

    it("종류가 다르면 같은 syncId를 허용한다", () => {
        expect(parse([
            { type: "memo", syncId: "same", action: "update", changes: { x: 1 } },
            { type: "mermaid", syncId: "same", action: "update", changes: { y: 2 } },
        ]).operations).toHaveLength(2);
    });

    it("모르는 종류와 잘못된 mutationId를 거부한다", () => {
        expect(() => parse([{ type: "drawing", syncId: "a", action: "update", changes: {} }]))
            .toThrow(ChangeRequestError);
        expect(() => parseChangeRequest({ ...request([memoCreate]), mutationId: "잘못된 값" }))
            .toThrow(ChangeRequestError);
    });

    it("표 소스는 코어 스키마로 검증한다", () => {
        const source = { columns: [{ id: "c", name: "C" }], rows: [{ id: "r", cells: { c: "1" } }] };

        expect(parse([{ type: "table", syncId: "table-1", action: "update", changes: { source } }])
            .operations[0].changes).toEqual({ source });
        expect(() => parse([{ type: "table", syncId: "table-1", action: "update", changes: { source: {} } }]))
            .toThrow(ChangeRequestError);
    });
});

describe("changeRequestDigest", () => {
    it("같은 요청은 같은 값, 다른 요청은 다른 값", () => {
        const first = parse([memoCreate]);
        const same = parse([memoCreate]);
        const moved = parse([{ ...memoCreate, changes: { ...memoCreate.changes, x: 5 } }]);

        expect(changeRequestDigest(first)).toBe(changeRequestDigest(same));
        expect(changeRequestDigest(first)).not.toBe(changeRequestDigest(moved));
    });

    it("mutationId가 같아도 baseRevision이 다르면 다른 값", () => {
        const first = parseChangeRequest(request([memoCreate]));
        const later = parseChangeRequest({ ...request([memoCreate]), baseRevision: 4 });

        expect(changeRequestDigest(first)).not.toBe(changeRequestDigest(later));
    });
});
