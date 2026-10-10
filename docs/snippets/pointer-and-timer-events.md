# 포인터 이벤트와 타이머

## 롱프레스 메뉴

터치 시작 시 타이머를 설정하고, 손을 떼거나 움직이면 취소한다.

```tsx
const longPressRef = useRef<number | null>(null);

const handleLongPressStart = (event: ReactPointerEvent<HTMLElement>) => {
  if (event.pointerType !== "touch") return;

  longPressRef.current = window.setTimeout(() => {
    openContextMenu(event.clientX, event.clientY);
  }, 600);
};

const clearLongPress = () => {
  if (longPressRef.current) {
    window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }
};
```

사용 이벤트:

```tsx
onPointerDown={handleLongPressStart}
onPointerUp={clearLongPress}
onPointerMove={clearLongPress}
onPointerCancel={clearLongPress}
```

## 더블탭

마지막 탭 시간을 `ref`에 저장하고 일정 시간 안에 다시 들어오면 더블탭으로 판단한다.

```tsx
const lastTapRef = useRef(0);

const handleDoubleTap = (event: ReactPointerEvent<HTMLDivElement>) => {
  if (event.pointerType !== "touch") return;

  const now = event.timeStamp;
  const isDoubleTap = now - lastTapRef.current < 300;
  lastTapRef.current = now;

  if (isDoubleTap) {
    event.preventDefault();
    startEditing();
  }
};
```

## 전역 외부 클릭 감지

document 이벤트는 브라우저의 실제 이벤트 기준이다.

```tsx
useEffect(() => {
  const handlePressOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    const targetElement = target instanceof Element ? target : null;

    const isInsideMenu = menuRef.current?.contains(target);
    const isInsideTarget = targetElement?.closest(".target-class");

    if (!isInsideMenu && !isInsideTarget) {
      closeMenu();
    }
  };

  document.addEventListener("pointerdown", handlePressOutside);

  return () => {
    document.removeEventListener("pointerdown", handlePressOutside);
  };
}, []);
```

Meldrift 적용 위치:

- `packages/ui/src/features/memo/useMemoCard.ts`
- `packages/ui/src/features/image/useImageCard.ts`
- `hooks/useBoardList.ts`
