# 보드 줌과 패닝

## 줌 값

보드 자체는 scale로 확대/축소하고, wrapper는 실제 스크롤 영역을 확보한다.

```tsx
<div
  style={{
    width: `${boardWidth * boardZoom}px`,
    height: `${boardHeight * boardZoom}px`,
  }}
>
  <div
    className="meldrift-board"
    style={{
      width: `${boardWidth}px`,
      height: `${boardHeight}px`,
      transform: `scale(${boardZoom})`,
      transformOrigin: "top left",
    }}
  />
</div>
```

이유:

- `transform: scale()`은 실제 레이아웃 크기를 바꾸지 않는다.
- 스크롤 영역은 wrapper가 `width * zoom`, `height * zoom`으로 확보한다.

## 좌표 변환

화면 좌표를 보드 좌표로 변환할 때 zoom으로 나눈다.

```tsx
const getBoardPoint = (clientX: number, clientY: number) => {
  const board = document.querySelector(".meldrift-board");
  const rect = board?.getBoundingClientRect();

  return {
    x: rect ? (clientX - rect.left) / boardZoom : clientX,
    y: rect ? (clientY - rect.top) / boardZoom : clientY,
  };
};
```

## 보드 패닝

포인터 시작점과 스크롤 시작점을 ref에 저장하고, 이동량만큼 scroll 위치를 바꾼다.

```tsx
type BoardPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  moved: boolean;
};

const boardPanRef = useRef<BoardPanState | null>(null);
const suppressBoardClickRef = useRef(false);
```

```tsx
const handleBoardPanStart = (event: ReactPointerEvent<HTMLElement>) => {
  const scrollElement = event.currentTarget;

  boardPanRef.current = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: scrollElement.scrollLeft,
    scrollTop: scrollElement.scrollTop,
    moved: false,
  };
};
```

```tsx
const handleBoardPanMove = (event: ReactPointerEvent<HTMLElement>) => {
  const panState = boardPanRef.current;
  if (!panState || panState.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - panState.startX;
  const deltaY = event.clientY - panState.startY;

  if (Math.hypot(deltaX, deltaY) > 4) {
    panState.moved = true;
    suppressBoardClickRef.current = true;
  }

  event.currentTarget.scrollLeft = panState.scrollLeft - deltaX;
  event.currentTarget.scrollTop = panState.scrollTop - deltaY;
};
```

Meldrift 적용 위치:

- `packages/ui/src/hooks/useBoardZoom.ts`
- `packages/ui/src/hooks/useBoardScroll.ts`
- `packages/ui/src/features/board/BoardClient.tsx`
