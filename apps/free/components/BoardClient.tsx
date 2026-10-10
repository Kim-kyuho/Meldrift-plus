"use client";

import SharedBoardClient from "@meldrift/ui/BoardClient";
import { useBoardLoad } from "@/hooks/useBoardLoad";
import { isBoardContentEmpty } from "@/lib/help";
import BoardControls from "./BoardControls";

export default function BoardClient() {
    const { initialSnapshot, databaseError } = useBoardLoad();

    if (databaseError) {
        return (
            <main className="flex h-screen w-screen items-center justify-center bg-neutral-100 p-6">
                <div className="max-w-lg rounded-xl bg-white p-6 shadow-md">
                    <h1 className="text-lg font-bold text-neutral-900">Browser SQLite could not start</h1>
                    <p className="mt-2 text-sm text-neutral-600">{databaseError}</p>
                    <p className="mt-3 text-sm text-neutral-500">
                        Use a current browser with IndexedDB enabled and open this page over HTTPS or localhost.
                    </p>
                </div>
            </main>
        );
    }

    if (!initialSnapshot) {
        return (
            <main className="flex min-h-screen w-full items-center justify-center bg-neutral-100 px-6 py-10 text-center">
                <div className="w-full max-w-xl">
                    <h1 className="text-3xl font-bold text-neutral-900">Meldrift</h1>
                    <p className="mt-4 text-base leading-relaxed text-neutral-700">
                        Meldrift is a canvas-based Markdown compiler. Freely arrange memos,
                        images, tables, and Mermaid diagrams on your board, then compile them into a
                        single Markdown document.
                    </p>
                    <p role="status" className="mt-6 text-sm text-neutral-500">
                        Loading...
                    </p>
                </div>
            </main>
        );
    }

    return (
        <SharedBoardClient
            initialSnapshot={initialSnapshot}
            renderControls={(controls) => (
                <BoardControls {...controls} initialHelpOpen={isBoardContentEmpty(initialSnapshot)} />
            )}
        />
    );
}
