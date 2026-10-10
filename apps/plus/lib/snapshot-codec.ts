import initSqlJs from "sql.js/dist/sql-asm.js";
import type { Database as SqlDatabase } from "sql.js";
import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import { isSupportedVersion, readSnapshot } from "@meldrift/board-data/sqlite-codec";
import { maxSnapshotBytes } from "./snapshot";

let sqlite: ReturnType<typeof initSqlJs> | undefined;

function adapter(db: SqlDatabase): Database {
    const selectObjects = (sql: string, bind: SqlValue[] = []) => {
        const statement = db.prepare(sql);
        try {
            statement.bind(bind as Parameters<typeof statement.bind>[0]);
            const rows = [];
            while (statement.step()) {
                rows.push(statement.getAsObject());
            }
            return rows;
        } finally { statement.free(); }
    };
    return {
        selectObjects,
        selectObject: (sql: string, bind?: SqlValue[]) => selectObjects(sql, bind)[0],
    } as unknown as Database;
}

export async function decodeSnapshot(bytes: Uint8Array, boardId: number) {
    if (bytes.byteLength > maxSnapshotBytes) {
        throw new Error("Board snapshots must be 4 MiB or smaller.");
    }
    if (new TextDecoder().decode(bytes.slice(0, 16)) !== "SQLite format 3\0") {
        throw new Error("Invalid SQLite snapshot.");
    }
    const SQL = await (sqlite ??= initSqlJs());
    const db = new SQL.Database(bytes);
    try {
        const scalar = (sql: string) => db.exec(sql)[0]?.values[0]?.[0];
        if (scalar("PRAGMA integrity_check") !== "ok" || !isSupportedVersion(Number(scalar("PRAGMA user_version")))) {
            throw new Error("Unsupported or corrupt snapshot.");
        }
        if (scalar("SELECT count(*) FROM boards") !== 1) {
            throw new Error("A snapshot must contain one board.");
        }
        for (const table of ["memos", "images", "mermaids", "tables", "drawings"]) {
            const statement = db.prepare(`SELECT count(*) FROM ${table} WHERE board_id != ? OR board_id IS NULL`);
            try {
                statement.bind([boardId]);
                statement.step();
                if (statement.get()[0] !== 0) {
                    throw new Error("Snapshot contains another board.");
                }
            } finally { statement.free(); }
        }
        const snapshot = readSnapshot(adapter(db), boardId);
        if (snapshot.images.some((image) => !image.data)) {
            throw new Error("All snapshot images must contain their binary data.");
        }
        return snapshot;
    } finally { db.close(); }
}
