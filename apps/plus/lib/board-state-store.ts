import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { db_memos, db_images, db_mermaids, db_tables, db_drawingStrokes } from "./db/schema";
import type { BoardInfo, BoardSnapshot } from "@meldrift/board-data/board-state";
import { rankMemoOrders } from "@meldrift/core/memo-order";

export async function loadBoardState(board: BoardInfo): Promise<BoardSnapshot> {
    const db = getDb();
    const [memos, images, mermaids, tables, strokes] = await Promise.all([
        db.select().from(db_memos).where(eq(db_memos.boardId, board.boardId)),
        db.select().from(db_images).where(eq(db_images.boardId, board.boardId)),
        db.select().from(db_mermaids).where(eq(db_mermaids.boardId, board.boardId)),
        db.select().from(db_tables).where(eq(db_tables.boardId, board.boardId)),
        db.select().from(db_drawingStrokes).where(eq(db_drawingStrokes.boardId, board.boardId))
            .orderBy(asc(db_drawingStrokes.seq)),
    ]);
    const orders = rankMemoOrders(memos.map((memo) => ({ id: memo.id, storedOrder: memo.sortOrder })));
    return {
        board,
        memos: memos.map((memo) => ({ ...memo, sortOrder: orders.get(memo.id) ?? 1 })),
        images: images.map((image) => ({
            ...image, url: image.secureUrl ?? "", assetId: image.assetId ?? "",
            label: image.fileName, data: null, mimeType: null,
        })),
        mermaids: mermaids.map((card) => ({ ...card, id: card.mermaidId })),
        tables: tables.map((card) => ({ ...card, id: card.tableId })),
        strokes: strokes.map((stroke) => ({
            id: stroke.syncId, color: stroke.color, width: stroke.width, points: stroke.points,
        })),
    };
}
