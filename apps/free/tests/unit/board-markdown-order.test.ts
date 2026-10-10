import { describe, expect, it } from "vitest";
import { compileBoardMarkdown } from "@meldrift/board-data/board-markdown";
import { createEmptyBoardSnapshot, type BoardMemo, type BoardSnapshot } from "@/lib/board-state";

// 문서 순서는 메모의 sortOrder다. 배열 순서(생성 순서)나 좌표가 아니다.

const memo = (id: number, sortOrder: number, text: string): BoardMemo => ({
    id,
    syncId: `memo-${id}`,
    boardId: 1,
    content: `<p>${text}</p>`,
    // 좌표를 순서와 반대로 흩어 놓아, 배치가 문서 순서에 끼어들지 않는지도 함께 본다.
    x: 1000 - id * 100,
    y: 1000 - id * 100,
    z: 1,
    width: 100,
    height: 100,
    color: "#fffadc",
    sortOrder,
});

const snapshotOf = (memos: BoardMemo[]): BoardSnapshot => ({
    ...createEmptyBoardSnapshot(),
    memos,
});

describe("compileBoardMarkdown 문서 순서", () => {
    it("생성 순서가 아니라 메모 순서대로 이어 붙인다", () => {
        const markdown = compileBoardMarkdown(snapshotOf([
            memo(1, 3, "Third"),
            memo(2, 1, "First"),
            memo(3, 2, "Second"),
        ]));

        expect(markdown).toBe("First\n\nSecond\n\nThird");
    });

    it("순서를 바꾸지 않은 보드에서는 생성 순서와 같다", () => {
        const markdown = compileBoardMarkdown(snapshotOf([
            memo(1, 1, "First"),
            memo(2, 2, "Second"),
            memo(3, 3, "Third"),
        ]));

        expect(markdown).toBe("First\n\nSecond\n\nThird");
    });

    it("순서 값이 같으면 id로 가른다", () => {
        const markdown = compileBoardMarkdown(snapshotOf([
            memo(9, 1, "Ninth"),
            memo(4, 1, "Fourth"),
        ]));

        expect(markdown).toBe("Fourth\n\nNinth");
    });
});
