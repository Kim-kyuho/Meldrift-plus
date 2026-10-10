import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeSync } from "@/lib/change-sync";
import { createEmptyBoardSnapshot } from "@meldrift/board-data/board-state";
import type { BoardDatabaseClient } from "@meldrift/board-data/browser-db/client";
import type { BoardOperation } from "@meldrift/board-data/board-delta";
import type { OutboxBatch, StoredBoard } from "@meldrift/board-data/browser-db/protocol";

const move: BoardOperation = { type: "memo", syncId: "memo-1", action: "update", changes: { x: 40 } };
const resize: BoardOperation = { type: "memo", syncId: "memo-2", action: "update", changes: { width: 400 } };

const managers: ChangeSync[] = [];

function setup() {
    let record: StoredBoard = {
        bytes: new ArrayBuffer(0),
        sync: { revision: 4, generation: 0, dirty: false, changedAt: 0 },
    };
    let pending: BoardOperation[] = [];
    let claimed: OutboxBatch[] = [];
    let nextClaim = 1000;

    const database = {
        replace: vi.fn(async () => {
            record = { ...record, sync: { ...record.sync, generation: record.sync.generation + 1, dirty: true, changedAt: Date.now() } };
        }),
        record: vi.fn(async () => structuredClone(record)),
        acknowledge: vi.fn(async (generation: number, revision: number) => {
            record.sync = { ...record.sync, revision, dirty: generation !== record.sync.generation };
        }),
        outbox: vi.fn(async () => ({ pending: [...pending], claimed: structuredClone(claimed) })),
        claimOutbox: vi.fn(async (limit: number) => {
            const claim = nextClaim++;
            const batch = { claim, mutationId: `mutation-${claim}`, operations: pending.slice(0, limit) };
            pending = pending.slice(limit);
            claimed = [...claimed, batch];
            return structuredClone(batch);
        }),
        releaseOutbox: vi.fn(async (claim: number) => {
            const batch = claimed.find((entry) => entry.claim === claim);
            if (batch) {
                pending = [...batch.operations, ...pending];
            }
            claimed = claimed.filter((entry) => entry.claim !== claim);
        }),
        clearOutbox: vi.fn(async (claim: number) => {
            claimed = claimed.filter((entry) => entry.claim !== claim);
        }),
        commitOutbox: vi.fn(async (claim: number, generation: number, revision: number) => {
            claimed = claimed.filter((entry) => entry.claim !== claim);
            record.sync = { ...record.sync, revision, dirty: generation !== record.sync.generation };
        }),
        asset: vi.fn(async () => ({ data: new ArrayBuffer(3), mimeType: "image/webp" })),
        close: vi.fn(),
    };

    const status = vi.fn();
    const manager = new ChangeSync(
        database as unknown as BoardDatabaseClient, "/api/boards/1", status,
    );
    managers.push(manager);
    return {
        manager, database, status,
        queue: (...operations: BoardOperation[]) => { pending = [...pending, ...operations]; },
        claimedBatches: () => claimed,
    };
}

const calls = () => vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
const changeCalls = () => vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).endsWith("/changes"));
const body = (call = 0) => JSON.parse(changeCalls()[call][1]!.body as string);

const imageOperation = (assetId: string): BoardOperation => ({
    type: "image", syncId: "image-1", action: "update", asset: true, changes: { assetId },
});

const settle = () => Promise.all(managers.map((manager) => manager.settled()));

function respondByUrl(handlers: Record<string, unknown>) {
    vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        const key = Object.keys(handlers).find((part) => url.includes(part)) ?? "";
        return { ok: true, status: 200, json: async () => handlers[key] ?? { ok: true } } as Response;
    });
}

describe("변경분 전송", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, revision: 5 }) }));
    });
    afterEach(async () => {
        await Promise.all(managers.splice(0).map((manager) => manager.pause()));
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("마지막 로컬 저장 3초 뒤에 밀린 변경만 보낸다", async () => {
        const { manager, queue, database } = setup();
        queue(move, resize);
        await manager.save(createEmptyBoardSnapshot());

        await vi.advanceTimersByTimeAsync(2999);
        expect(fetch).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledOnce();
        expect(body()).toMatchObject({ baseRevision: 4, operations: [move, resize] });
        expect(database.commitOutbox).toHaveBeenCalledOnce();
    });

    it("보낼 변경이 없으면 요청하지 않는다", async () => {
        const { manager } = setup();
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);

        expect(fetch).not.toHaveBeenCalled();
    });

    it("응답을 못 받아도 같은 mutationId로 같은 묶음을 재시도한다", async () => {
        const { manager, queue, database } = setup();
        vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
        queue(move);
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);

        expect(fetch).toHaveBeenCalledOnce();
        const first = body(0);

        queue(resize);
        await vi.advanceTimersByTimeAsync(10000);

        expect(fetch).toHaveBeenCalledTimes(2);
        const second = body(1);
        expect(second.mutationId).toBe(first.mutationId);
        expect(second.operations).toEqual([move]);
        expect(database.claimOutbox).toHaveBeenCalledOnce();
    });

    it("남은 변경은 다음 묶음으로 이어서 보낸다", async () => {
        const { manager, queue } = setup();
        vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
        queue(move);
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);

        queue(resize);
        await vi.advanceTimersByTimeAsync(10000);
        await vi.advanceTimersByTimeAsync(3000);

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(body(2).operations).toEqual([resize]);
        expect(body(2).mutationId).not.toBe(body(1).mutationId);
    });

    it("판 번호가 어긋나면 막고 묶음을 붙들고 있는다", async () => {
        const { manager, queue, status, claimedBatches, database } = setup();
        vi.mocked(fetch).mockResolvedValue({
            ok: false, status: 409, json: async () => ({ message: "Reload to recover." }),
        } as Response);
        queue(move);
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);

        expect(status).toHaveBeenCalledWith("blocked", "Reload to recover.");
        expect(claimedBatches()).toHaveLength(1);
        expect(database.commitOutbox).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60000);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("요청 제한을 넘는 묶음은 임시 저장한 뒤 한 번에 커밋한다", async () => {
        const { manager, queue, database } = setup();
        respondByUrl({
            "/uploads": { ok: true, uploadId: "s1", chunkSize: 1048576, chunkCount: 2, received: [] },
            "/changes": { ok: true, revision: 5 },
        });
        const large = (syncId: string): BoardOperation => ({
            type: "memo", syncId, action: "update", changes: { content: "x".repeat(600 * 1024) },
        });
        queue(large("memo-1"), large("memo-2"));
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(database.claimOutbox).toHaveBeenCalledWith(2);
        expect(calls().filter((url) => url.endsWith("/uploads"))).toHaveLength(1);
        expect(changeCalls()).toHaveLength(1);
        expect(body(0)).toMatchObject({ staged: true, mutationId: "mutation-1000" });
        expect(body(0).operations).toBeUndefined();
    });

    it("제한 안에 들어오는 묶음은 본문에 그대로 싣는다", async () => {
        const { manager, queue } = setup();
        queue(move, resize);
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(calls()).toEqual(["/api/boards/1/changes"]);
        expect(body(0).operations).toEqual([move, resize]);
        expect(body(0).staged).toBeUndefined();
    });

    it("이미지 바이너리를 카드보다 먼저 올린다", async () => {
        const { manager, queue } = setup();
        respondByUrl({
            "/uploads": { ok: true, uploadId: "u1", chunkSize: 1048576, chunkCount: 1, received: [] },
            "/changes": { ok: true, revision: 5 },
        });
        queue(imageOperation("asset-1"));
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(calls()).toEqual([
            "/api/boards/1/uploads",
            "/api/boards/1/uploads/u1/chunks/0",
            "/api/boards/1/uploads/u1/complete",
            "/api/boards/1/changes",
        ]);
    });

    it("이미 서버에 있는 자산은 다시 올리지 않는다", async () => {
        const { manager, queue } = setup();
        respondByUrl({
            "/uploads": { ok: true, complete: true, assetId: "asset-1" },
            "/changes": { ok: true, revision: 5 },
        });
        queue(imageOperation("asset-1"));
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(calls()).toEqual(["/api/boards/1/uploads", "/api/boards/1/changes"]);
    });

    it("이미 받은 청크는 건너뛰고 나머지만 보낸다", async () => {
        const { manager, queue } = setup();
        respondByUrl({
            "/uploads": { ok: true, uploadId: "u1", chunkSize: 1048576, chunkCount: 3, received: [0, 2] },
            "/changes": { ok: true, revision: 5 },
        });
        queue(imageOperation("asset-1"));
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(calls().filter((url) => url.includes("/chunks/"))).toEqual([
            "/api/boards/1/uploads/u1/chunks/1",
        ]);
    });

    it("좌표만 바뀐 이미지는 업로드를 거치지 않는다", async () => {
        const { manager, queue } = setup();
        queue({ type: "image", syncId: "image-1", action: "update", changes: { x: 40 } });
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(calls()).toEqual(["/api/boards/1/changes"]);
    });

    it("업로드가 막히면 묶음을 붙들고 멈춘다", async () => {
        const { manager, queue, status, claimedBatches, database } = setup();
        vi.mocked(fetch).mockResolvedValue({
            ok: false, status: 409, json: async () => ({ message: "Reload to recover." }),
        } as Response);
        queue(imageOperation("asset-1"));
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);
        await settle();

        expect(status).toHaveBeenCalledWith("blocked", "Reload to recover.");
        expect(claimedBatches()).toHaveLength(1);
        expect(database.commitOutbox).not.toHaveBeenCalled();
    });

    it("성공하면 서버 판 번호를 로컬에 기록한다", async () => {
        const { manager, queue, database, status } = setup();
        queue(move);
        await manager.save(createEmptyBoardSnapshot());
        await vi.advanceTimersByTimeAsync(3000);

        expect(database.commitOutbox).toHaveBeenCalledWith(expect.any(Number), 1, 5);
        expect(status).toHaveBeenLastCalledWith("saved");
    });
});
