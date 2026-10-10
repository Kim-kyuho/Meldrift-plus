import { act, renderHook } from "@testing-library/react";
import { createRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAssistant } from "@meldrift/ui/useAiAssistant";
import { useBoardImages } from "@meldrift/ui/useBoardImages";
import { useBoardMemos } from "@meldrift/ui/useBoardMemos";
import { useBoardMermaids } from "@meldrift/ui/useBoardMermaids";
import { useBoardTables } from "@meldrift/ui/useBoardTables";
import { defaultBoard, type BoardImage, type BoardMemo } from "@/lib/board-state";

// 어시스턴트가 제안한 카드는 임시 ID(음수)로 올라가고, BoardClient의 자동 저장은 제안이
// 남아 있는 동안 멈춘다. 그 동안 파일에 아무것도 쓰이지 않는다는 것이 Free Edition 고유의 계약이라
// pending이 언제 서고 언제 풀리는지를 여기서 고정한다.

const locationRef = createRef<HTMLDivElement>();

const existingMemo: BoardMemo = {
    id: 1, syncId: "memo-1", boardId: defaultBoard.boardId, content: "<p>기존 메모</p>", x: 10, y: 20, z: 1,
    width: 300, height: 200, color: "#fffadc", sortOrder: 1,
};
const existingImage: BoardImage = {
    imageId: 1, syncId: "image-1", assetId: "", boardId: defaultBoard.boardId, url: "https://example.com/a.png", label: "a",
    data: null, mimeType: null,
    x: 10, y: 400, z: 1, width: 400, height: 300,
};

// BoardClient와 같은 방식으로 컬렉션 훅과 어시스턴트를 조립한다.
function useAssistantHarness() {
    const [message, setMessage] = useState("");
    const memos = useBoardMemos({
        initialMemos: [existingMemo], boardId: defaultBoard.boardId, boardZoom: 1, cardLocationRef: locationRef,
    });
    const images = useBoardImages({
        initialImages: [existingImage], boardId: defaultBoard.boardId, boardZoom: 1, cardLocationRef: locationRef,
        setMessage,
    });
    const mermaids = useBoardMermaids({
        initialMermaids: [], boardId: defaultBoard.boardId, boardZoom: 1, cardLocationRef: locationRef,
    });
    const tables = useBoardTables({
        initialTables: [], boardId: defaultBoard.boardId, boardZoom: 1, cardLocationRef: locationRef,
    });

    const assistant = useAiAssistant({
        boardId: defaultBoard.boardId,
        boardWidth: defaultBoard.width,
        boardHeight: defaultBoard.height,
        boardZoom: 1,
        cardLocationRef: locationRef,
        setMessage,
        memos: memos.memos,
        mermaids: mermaids.mermaids,
        tables: tables.tables,
        images: images.images,
        setMemos: memos.setMemos,
        setMermaids: mermaids.setMermaids,
        setTables: tables.setTables,
        setImages: images.setImages,
        onInsertMemo: memos.handleInsertMemo,
        onInsertMermaid: mermaids.handleInsertMermaid,
        onInsertTable: tables.handleInsertTable,
        onUpdateMemo: memos.handleUpdateMemo,
        onUpdateMermaid: mermaids.handleUpdateMermaid,
        onUpdateTable: tables.handleUpdateTable,
        onDeleteMemo: memos.handleDeleteMemo,
        onDeleteMermaid: mermaids.handleDeleteMermaid,
        onDeleteTable: tables.handleDeleteTable,
        onDeleteImage: images.handleDeleteImage,
    });

    return { assistant, memos: memos.memos, mermaids: mermaids.mermaids, tables: tables.tables, images: images.images, message };
}

const plan = {
    layout: "column",
    sections: [
        {
            blocks: [{ type: "heading", level: 2, text: "요약" }],
            attachment: { type: "mermaid", source: "flowchart LR\nA-->B" },
        },
        { blocks: [{ type: "paragraph", text: "본문" }] },
    ],
};

/** status는 항상 열린 상태로, chat은 테스트가 정한 결과 하나로 답한다. */
const mockAi = (chatResult: Record<string, unknown>) => {
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input);

        if (url.endsWith("/api/ai/status")) {
            return { json: async () => ({ ok: true, configured: true, unlocked: true }) };
        }
        if (url.endsWith("/api/ai/unlock")) {
            return { json: async () => ({ ok: init?.method !== "DELETE" }) };
        }

        return { json: async () => ({ ok: true, reply: "done", ...chatResult }) };
    });

    vi.stubGlobal("fetch", fetchMock);

    return fetchMock;
};

const openAndSend = async (
    result: { current: ReturnType<typeof useAssistantHarness> },
    text = "문서 만들어줘",
) => {
    await act(async () => {
        await result.current.assistant.handleToggleAiPanel();
    });
    await act(async () => {
        await result.current.assistant.handleSendMessage(text);
    });
};

describe("useAiAssistant", () => {
    beforeEach(() => {
        const element = document.createElement("div");
        Object.defineProperties(element, {
            scrollLeft: { configurable: true, value: 0 },
            scrollTop: { configurable: true, value: 0 },
            clientWidth: { configurable: true, value: 1200 },
            clientHeight: { configurable: true, value: 800 },
            scrollTo: { configurable: true, value: vi.fn() },
        });
        locationRef.current = element;
    });

    it("adds the planned cards as temporary cards and marks them pending", async () => {
        mockAi({ plan });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result);

        expect(result.current.assistant.hasPendingCards).toBe(true);
        expect(result.current.memos).toHaveLength(3);
        expect(result.current.mermaids).toHaveLength(1);

        // 저장 전에는 반드시 음수 ID다. 양수가 섞이면 자동 저장이 미승인 카드를 파일에 쓴다.
        const added = result.current.memos.filter((memo) => memo.id !== existingMemo.id);
        expect(added.every((memo) => memo.id < 0)).toBe(true);

        // 임시 ID는 증가 방향이어야 저장 전에도 탐색 순서가 문서 순서와 같다.
        expect(added[1].id).toBeGreaterThan(added[0].id);

        // 모델이 준 blocks는 HTML로 변환돼 들어간다. HTML 문자열을 그대로 받지 않는다.
        expect(added[0].content).toBe("<h2>요약</h2>");
    });

    it("removes the proposal and clears pending on discard", async () => {
        mockAi({ plan });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result);

        act(() => {
            result.current.assistant.discardPendingCards();
        });

        expect(result.current.assistant.hasPendingCards).toBe(false);
        expect(result.current.memos).toEqual([existingMemo]);
        expect(result.current.mermaids).toHaveLength(0);
    });

    it("gives the cards positive ids on save so the board can persist again", async () => {
        mockAi({ plan });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result);

        await act(async () => {
            await result.current.assistant.handleSavePendingCards();
        });

        expect(result.current.assistant.hasPendingCards).toBe(false);
        expect(result.current.memos).toHaveLength(3);
        expect(result.current.memos.every((memo) => memo.id > 0)).toBe(true);
        expect(result.current.mermaids[0].id).toBeGreaterThan(0);

        // 메모 ID 순서가 곧 Markdown 문서 순서다. 기존 메모 뒤에 순서대로 붙어야 한다.
        expect(result.current.memos.map((memo) => memo.id)).toEqual([1, 2, 3]);
    });

    it("hides deleted cards but restores them untouched on discard", async () => {
        mockAi({ deletion: { memoIds: [existingMemo.id], imageIds: [existingImage.imageId] } });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result, "메모랑 이미지 지워줘");

        expect(result.current.assistant.hasPendingCards).toBe(true);
        expect(result.current.memos).toHaveLength(0);
        expect(result.current.images).toHaveLength(0);

        act(() => {
            result.current.assistant.discardPendingCards();
        });

        expect(result.current.assistant.hasPendingCards).toBe(false);
        expect(result.current.memos).toEqual([existingMemo]);
        expect(result.current.images).toEqual([existingImage]);
    });

    it("keeps the earliest version of a card that is edited twice", async () => {
        mockAi({ edit: { memos: [{ id: existingMemo.id, blocks: [{ type: "paragraph", text: "첫 수정" }] }] } });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result, "메모 고쳐줘");

        expect(result.current.memos[0].content).toBe("<p>첫 수정</p>");

        mockAi({ edit: { memos: [{ id: existingMemo.id, blocks: [{ type: "paragraph", text: "두 번째 수정" }] }] } });
        await act(async () => {
            await result.current.assistant.handleSendMessage("다시 고쳐줘");
        });

        expect(result.current.memos[0].content).toBe("<p>두 번째 수정</p>");

        // Discard는 AI가 손대기 전 상태로 돌아간다. 중간 버전으로 멈추지 않는다.
        act(() => {
            result.current.assistant.discardPendingCards();
        });

        expect(result.current.memos).toEqual([existingMemo]);
    });

    it("refuses to close or lock while a proposal is unsaved", async () => {
        mockAi({ plan });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result);

        await act(async () => {
            await result.current.assistant.handleToggleAiPanel();
        });

        // 닫히면 Save/Discard 바가 사라지고 보드가 저장을 멈춘 채로 잊힌다.
        expect(result.current.assistant.aiPanelOpen).toBe(true);
        expect(result.current.message).toMatch(/Save or discard/);

        await act(async () => {
            await result.current.assistant.handleLock();
        });

        expect(result.current.assistant.aiPanelOpen).toBe(true);
        expect(result.current.assistant.unlocked).toBe(true);
    });

    it("asks for the password again when the server says the session expired", async () => {
        mockAi({ plan });
        const { result } = renderHook(useAssistantHarness);
        await openAndSend(result);
        act(() => {
            result.current.assistant.discardPendingCards();
        });

        vi.stubGlobal("fetch", vi.fn(async () => ({
            json: async () => ({ ok: false, locked: true, message: "locked" }),
        })));
        await act(async () => {
            await result.current.assistant.handleSendMessage("또 해줘");
        });

        expect(result.current.assistant.unlocked).toBe(false);
        expect(result.current.assistant.unlockError).toMatch(/locked again/);
        expect(result.current.assistant.hasPendingCards).toBe(false);
    });
});
