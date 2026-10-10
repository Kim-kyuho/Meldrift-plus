import {
    Dispatch,
    PointerEvent as ReactPointerEvent,
    SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { BoardMemo } from "@meldrift/board-data/board-state";
import { memoReorderRowHeight, reorderMemos, sortMemosByOrder } from "@meldrift/core/memo-order";

type UseMemoReorderOptions = {
    memos: BoardMemo[];
    setMemos: Dispatch<SetStateAction<BoardMemo[]>>;
    onFocusMemo: (memoId: number) => void;
};

// 이 안에서 끝난 입력은 끌기가 아니라 누른 것으로 본다.
const dragThreshold = 4;

export function useMemoReorder({ memos, setMemos, onFocusMemo }: UseMemoReorderOptions) {
    const [reorderOpen, setReorderOpen] = useState(false);
    const [draggingMemoId, setDraggingMemoId] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [dragOffsetY, setDragOffsetY] = useState(0);
    const reorderListRef = useRef<HTMLDivElement | null>(null);
    const dragStartYRef = useRef(0);
    // 줄의 위쪽 끝에서 얼마나 아래를 잡았는지. 잡은 지점을 손가락에 붙여 두는 데 쓴다.
    const grabOffsetRef = useRef(0);
    // 끌고 난 뒤 따라오는 click을 걸러야 해서 다음 pointerdown까지 유지한다.
    const draggedRef = useRef(false);

    const orderedMemos = useMemo(() => sortMemosByOrder(memos), [memos]);
    const memoCount = orderedMemos.length;

    // 놓기 전까지는 미리보기다.
    const reorderMemoList = useMemo(() => {
        if (draggingMemoId === null || dropIndex === null) {
            return orderedMemos;
        }

        const fromIndex = orderedMemos.findIndex((memo) => memo.id === draggingMemoId);
        if (fromIndex < 0 || fromIndex === dropIndex) {
            return orderedMemos;
        }

        const preview = [...orderedMemos];
        const [moved] = preview.splice(fromIndex, 1);
        preview.splice(dropIndex, 0, moved);

        return preview;
    }, [draggingMemoId, dropIndex, orderedMemos]);

    const getContentY = useCallback((clientY: number) => {
        const listElement = reorderListRef.current;
        if (!listElement) {
            return null;
        }

        return clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
    }, []);

    /** 놓일 자리와, 그 자리에서 손가락까지의 거리를 함께 구한다. */
    const getDragPosition = useCallback((clientY: number) => {
        const contentY = getContentY(clientY);
        if (contentY === null || memoCount === 0) {
            return null;
        }

        const lastIndex = memoCount - 1;
        // 줄의 위쪽 끝이 다음 칸의 절반을 넘어서면 자리를 넘겨준다.
        const top = contentY - grabOffsetRef.current;
        const index = Math.min(Math.max(Math.round(top / memoReorderRowHeight), 0), lastIndex);
        const clampedTop = Math.min(Math.max(top, 0), lastIndex * memoReorderRowHeight);

        return { index, offsetY: clampedTop - index * memoReorderRowHeight };
    }, [getContentY, memoCount]);

    // 끌기는 window에서 듣는다. 줄에 setPointerCapture를 걸면 미리보기로 DOM 순서가 바뀔 때
    // 캡처를 잃을 수 있고, 패널 밖으로 나간 뒤의 입력도 놓친다.
    useEffect(() => {
        if (draggingMemoId === null) {
            return;
        }

        const handleMove = (event: PointerEvent) => {
            if (!draggedRef.current && Math.abs(event.clientY - dragStartYRef.current) < dragThreshold) {
                return;
            }

            draggedRef.current = true;
            const position = getDragPosition(event.clientY);

            if (position) {
                setDropIndex(position.index);
                setDragOffsetY(position.offsetY);
            }
        };

        const handleEnd = (event: PointerEvent) => {
            const position = draggedRef.current ? getDragPosition(event.clientY) : null;

            setDraggingMemoId(null);
            setDropIndex(null);
            setDragOffsetY(0);

            if (position) {
                setMemos((prev) => reorderMemos(prev, draggingMemoId, position.index));
            }
        };

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleEnd);
        window.addEventListener("pointercancel", handleEnd);

        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleEnd);
            window.removeEventListener("pointercancel", handleEnd);
        };
    }, [draggingMemoId, getDragPosition, setMemos]);

    const handleToggleReorderPanel = () => setReorderOpen((prev) => !prev);

    const handleCloseReorderPanel = () => setReorderOpen(false);

    const handleReorderStart = (event: ReactPointerEvent<HTMLElement>, memoId: number) => {
        if (event.button !== 0) {
            return;
        }

        const fromIndex = orderedMemos.findIndex((memo) => memo.id === memoId);
        const contentY = getContentY(event.clientY);

        dragStartYRef.current = event.clientY;
        grabOffsetRef.current = contentY === null
            ? memoReorderRowHeight / 2
            : contentY - fromIndex * memoReorderRowHeight;
        draggedRef.current = false;
        setDraggingMemoId(memoId);
        setDropIndex(fromIndex);
        setDragOffsetY(0);
    };

    const handleRowClick = (memoId: number) => {
        if (draggedRef.current) {
            return;
        }

        onFocusMemo(memoId);
    };

    return {
        reorderOpen,
        reorderListRef,
        reorderMemoList,
        draggingMemoId,
        dragOffsetY,
        handleToggleReorderPanel,
        handleCloseReorderPanel,
        handleReorderStart,
        handleRowClick,
    };
}
