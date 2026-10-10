import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/boards/[boardId]/state/route";
import { createEmptyBoardSnapshot } from "@meldrift/board-data/board-state";

const mocks = vi.hoisted(() => ({
    getDb: vi.fn(),
    boardRows: vi.fn(),
    syncRows: vi.fn(),
    loadSavedBoardSnapshot: vi.fn(),
    loadBoardState: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/saved-board-snapshot", () => ({ loadSavedBoardSnapshot: mocks.loadSavedBoardSnapshot }));
vi.mock("@/lib/board-state-store", () => ({ loadBoardState: mocks.loadBoardState }));

const params = (boardId: string) => Promise.resolve({ boardId });
const board = { boardId: 7, title: "Board", width: 100, height: 80 };
const image = {
    imageId: 1, syncId: "image-1", assetId: "", boardId: 1, label: "a",
    x: 0, y: 0, z: 1, width: 10, height: 10,
};
const state = (boardId = "7") => GET(new Request("http://localhost"), { params: params(boardId) });

describe("GET /api/boards/[boardId]/state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.boardRows.mockResolvedValue([board]);
        mocks.syncRows.mockResolvedValue([{ boardId: 7, revision: 12, mode: "snapshot" }]);
        mocks.loadSavedBoardSnapshot.mockResolvedValue(createEmptyBoardSnapshot());
        mocks.loadBoardState.mockResolvedValue(createEmptyBoardSnapshot());

        let call = 0;
        mocks.getDb.mockReturnValue({
            select: () => ({
                from: () => ({
                    where: () => ({ limit: () => (call++ === 0 ? mocks.boardRows() : mocks.syncRows()) }),
                }),
            }),
        });
    });

    it("보드 상태와 현재 판 번호를 함께 돌려준다", async () => {
        const response = await state();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.revision).toBe(12);
        expect(body.snapshot.board.boardId).toBe(1);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("동기화 행이 없으면 판 번호 0에서 시작한다", async () => {
        mocks.syncRows.mockResolvedValue([]);

        expect((await (await state()).json()).revision).toBe(0);
    });

    it("전환한 보드는 카드 테이블만 읽는다", async () => {
        mocks.syncRows.mockResolvedValue([{ boardId: 7, revision: 12, mode: "delta" }]);
        mocks.loadBoardState.mockResolvedValue({
            ...createEmptyBoardSnapshot(),
            images: [{ ...image, assetId: "asset-1", url: "" }],
        });

        const body = await (await state()).json();

        expect(body.mode).toBe("delta");
        expect(mocks.loadSavedBoardSnapshot).not.toHaveBeenCalled();
        expect(body.snapshot.images[0]).toMatchObject({ assetId: "asset-1", url: "", data: null });
    });

    it("저장된 스냅샷이 있으면 낡은 카드 테이블을 읽지 않는다", async () => {
        mocks.loadSavedBoardSnapshot.mockResolvedValue({
            ...createEmptyBoardSnapshot(),
            memos: [{ id: 1, syncId: "memo-1", boardId: 1, content: "<p>snapshot</p>", sortOrder: 1, x: 0, y: 0, z: 1, width: 10, height: 10, color: "#fff" }],
        });

        const body = await (await state()).json();

        expect(body.snapshot.memos[0].content).toBe("<p>snapshot</p>");
        expect(mocks.loadBoardState).not.toHaveBeenCalled();
    });

    it("스냅샷이 없는 보드만 카드 테이블로 되돌아간다", async () => {
        mocks.loadSavedBoardSnapshot.mockResolvedValue(null);

        await state();

        expect(mocks.loadBoardState).toHaveBeenCalledWith({
            boardId: 7, title: "Board", width: 100, height: 80,
        });
    });

    it("이미지 바이너리 대신 조회 경로를 내려준다", async () => {
        mocks.loadSavedBoardSnapshot.mockResolvedValue({
            ...createEmptyBoardSnapshot(),
            images: [{ ...image, assetId: "asset-1", url: "", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
        });

        const body = await (await state()).json();

        expect(body.snapshot.images[0]).toMatchObject({
            data: null, mimeType: null, url: "/api/boards/7/snapshot/images/1",
        });
    });

    it("이미 주소가 있는 이미지는 그대로 둔다", async () => {
        mocks.loadSavedBoardSnapshot.mockResolvedValue(null);
        mocks.loadBoardState.mockResolvedValue({
            ...createEmptyBoardSnapshot(),
            images: [{ ...image, url: "https://example.com/a.png", data: null, mimeType: null }],
        });

        const body = await (await state()).json();

        expect(body.snapshot.images[0].url).toBe("https://example.com/a.png");
    });

    it("잘못된 보드 id와 없는 보드를 가른다", async () => {
        expect((await state("0")).status).toBe(400);
        expect((await state("x")).status).toBe(400);

        mocks.boardRows.mockResolvedValue([]);
        expect((await state()).status).toBe(404);
    });
});
