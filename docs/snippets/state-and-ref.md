# 상태와 Ref 패턴

## State

화면에 표시되거나 UI 조건에 영향을 주는 값은 `useState`로 관리한다.

```tsx
const [contextMenuOpen, setContextMenuOpen] = useState(false);
const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
const [isEditing, setIsEditing] = useState(false);
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
```

사용 기준:

- 메뉴 표시 여부
- 모달 표시 여부
- 선택/편집 상태
- 카드 위치/크기
- 검색어, 검색 인덱스
- 줌 값
- 메시지 표시

## Ref

렌더링이 필요 없는 값은 `useRef`로 관리한다.

```tsx
const menuRef = useRef<HTMLDivElement | null>(null);
const longPressRef = useRef<number | null>(null);
const lastTapRef = useRef(0);
const suppressClickRef = useRef(false);
```

사용 기준:

- DOM 요소 참조
- 타이머 ID 저장
- 마지막 터치 시간 저장
- 클릭 억제 플래그
- 패닝 중 임시 좌표

## 상태 객체

서로 항상 같이 움직이는 값은 객체 state로 묶는다.

```tsx
const [memoState, setMemoState] = useState({
  x: memo.x,
  y: memo.y,
  width: memo.width,
  height: memo.height,
});
```

부분 갱신:

```tsx
setMemoState((prev) => ({
  ...prev,
  x: data.x,
  y: data.y,
}));
```

전체 갱신:

```tsx
setMemoState({
  x: position.x,
  y: position.y,
  width: ref.offsetWidth,
  height: ref.offsetHeight,
});
```

Meldrift 적용 위치:

- `packages/ui/src/features/memo/useMemoCard.ts`
- `packages/ui/src/features/image/useImageCard.ts`
- `packages/ui/src/hooks/useBoardZoom.ts`
- `packages/ui/src/hooks/useBoardScroll.ts`
