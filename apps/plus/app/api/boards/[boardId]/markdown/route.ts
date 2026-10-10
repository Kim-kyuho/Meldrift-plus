import { getDb } from "@/lib/db";
import { db_boards, db_boardSync } from "@/lib/db/schema";
import { tableSourceSchema, tableSourceToMarkdown } from "@meldrift/core/table-card";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import TurndownService from "turndown";
import { loadSavedBoardSnapshot } from "@/lib/saved-board-snapshot";
import { loadBoardState } from "@/lib/board-state-store";
import { compileBoardMarkdown } from "@meldrift/board-data/board-markdown";

type CompiledCardRow = {
    memo_id: number;
    memo_content: string;
    corner_order: number | null;
    card_type: "image" | "mermaid" | "table" | null;
    card_id: number | null;
    card_content: string | null;
    card_label: string | null;
};

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
});

turndown.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => `~~${content}~~`,
});

const escapeImageLabel = (label: string) => label.replaceAll("[", "\\[").replaceAll("]", "\\]");

const compileMarkdown = (rows: CompiledCardRow[]) => {
    const markdownParts: string[] = [];
    const renderedCards = new Set<string>();
    let currentMemoId: number | null = null;

    rows.forEach((row) => {
        if (row.memo_id !== currentMemoId) {
            currentMemoId = row.memo_id;

            const memoMarkdown = turndown.turndown(row.memo_content).trim();
            if (memoMarkdown) {
                markdownParts.push(memoMarkdown);
            }
        }

        if (!row.card_type || row.card_id === null || !row.card_content) {
            return;
        }

        const cardKey = `${row.card_type}:${row.card_id}`;
        if (renderedCards.has(cardKey)) {
            return;
        }
        renderedCards.add(cardKey);

        if (row.card_type === "image") {
            const imageLabel = escapeImageLabel(row.card_label?.trim() || "Image");
            markdownParts.push(`![${imageLabel}](${row.card_content})`);
            return;
        }

        if (row.card_type === "table") {
            try {
                const parsedSource = tableSourceSchema.safeParse(JSON.parse(row.card_content));
                if (parsedSource.success) {
                    markdownParts.push(tableSourceToMarkdown(parsedSource.data));
                }
            } catch {
                return;
            }
            return;
        }

        markdownParts.push(`\`\`\`mermaid\n${row.card_content.trim()}\n\`\`\``);
    });

    return markdownParts.join("\n\n");
};

export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
    try {
        const boardId = Number((await params).boardId);

        if (!Number.isInteger(boardId) || boardId <= 0) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "Invalid board id.",
                },
                { status: 400 },
            );
        }

        const db = getDb();
        const targetBoard = await db
            .select()
            .from(db_boards)
            .where(eq(db_boards.boardId, boardId))
            .limit(1);

        if (!targetBoard[0]) {
            return NextResponse.json(
                {
                    ok: false,
                    message: "This board does not exist.",
                },
                { status: 404 },
            );
        }

        const basePath = process.env.PLUS_STANDALONE === "true" ? "" : "/plus";
        const [sync] = await db.select().from(db_boardSync).where(eq(db_boardSync.boardId, boardId)).limit(1);
        if (sync?.mode === "delta") {
            const board = targetBoard[0];
            const state = await loadBoardState({
                boardId: board.boardId, title: board.title, width: board.width, height: board.height,
            });
            const markdown = compileBoardMarkdown({
                ...state,
                images: state.images.map((image) => ({
                    ...image, data: null,
                    url: image.assetId
                        ? `${basePath}/api/boards/${boardId}/assets/${image.assetId}/bytes`
                        : image.url,
                })),
            });
            return NextResponse.json({ ok: true, markdown }, { headers: { "Cache-Control": "no-store" } });
        }

        const snapshot = await loadSavedBoardSnapshot(boardId);
        if (snapshot) {
            const markdown = compileBoardMarkdown({
                ...snapshot,
                images: snapshot.images.map((image) => ({
                    ...image, data: null,
                    url: `${basePath}/api/boards/${boardId}/snapshot/images/${image.imageId}`,
                })),
            });
            return NextResponse.json({ ok: true, markdown }, { headers: { "Cache-Control": "no-store" } });
        }

        const result = await db.execute<CompiledCardRow>(sql`
            WITH ordered_memos AS (
                SELECT
                    id AS memo_id,
                    content AS memo_content,
                    sort_order AS memo_sort_order,
                    x,
                    y,
                    width,
                    height
                FROM memos
                WHERE board_id = ${boardId}
            ),
            memo_contact_points AS (
                SELECT
                    memo.memo_id,
                    memo.memo_content,
                    corner.corner_order,
                    corner.corner_x,
                    corner.corner_y
                FROM ordered_memos memo
                CROSS JOIN LATERAL (
                    VALUES
                        (1, memo.x,              memo.y),
                        (2, memo.x + memo.width, memo.y),
                        (3, memo.x,              memo.y + memo.height),
                        (4, memo.x + memo.width, memo.y + memo.height)
                ) AS corner(corner_order, corner_x, corner_y)
            ),
            board_cards AS (
                SELECT
                    'image'::text AS card_type,
                    image_id AS card_id,
                    secure_url AS card_content,
                    filename AS card_label,
                    x,
                    y,
                    z,
                    width,
                    height
                FROM images
                WHERE board_id = ${boardId}

                UNION ALL

                SELECT
                    'mermaid'::text AS card_type,
                    mermaid_id AS card_id,
                    source AS card_content,
                    NULL::text AS card_label,
                    x,
                    y,
                    z,
                    width,
                    height
                FROM mermaids
                WHERE board_id = ${boardId}

                UNION ALL

                SELECT
                    'table'::text AS card_type,
                    table_id AS card_id,
                    source::text AS card_content,
                    NULL::text AS card_label,
                    x,
                    y,
                    z,
                    width,
                    height
                FROM tables
                WHERE board_id = ${boardId}
            ),
            ranked_cards AS (
                SELECT
                    corner.memo_id,
                    corner.corner_order,
                    card.card_type,
                    card.card_id,
                    card.card_content,
                    card.card_label,
                    ROW_NUMBER() OVER (
                        PARTITION BY corner.memo_id, corner.corner_order
                        ORDER BY
                            card.z DESC,
                            card.card_type ASC,
                            card.card_id ASC
                    ) AS corner_rank
                FROM memo_contact_points corner
                INNER JOIN board_cards card
                    ON card.x < corner.corner_x
                    AND corner.corner_x < card.x + card.width
                    AND card.y < corner.corner_y
                    AND corner.corner_y < card.y + card.height
            ),
            selected_cards AS (
                SELECT
                    memo_id,
                    corner_order,
                    card_type,
                    card_id,
                    card_content,
                    card_label
                FROM ranked_cards
                WHERE corner_rank = 1
            )
            SELECT
                memo.memo_id,
                memo.memo_content,
                card.corner_order,
                card.card_type,
                card.card_id,
                card.card_content,
                card.card_label
            FROM ordered_memos memo
            LEFT JOIN selected_cards card
                ON card.memo_id = memo.memo_id
            ORDER BY
                memo.memo_sort_order ASC,
                memo.memo_id ASC,
                card.corner_order ASC
        `);

        return NextResponse.json({
            ok: true,
            markdown: compileMarkdown(result.rows),
        });
    } catch (error) {
        console.error("Error compiling board markdown:", error);
        return NextResponse.json(
            {
                ok: false,
                message: "Markdown document could not be generated.",
            },
            { status: 500 },
        );
    }
}
