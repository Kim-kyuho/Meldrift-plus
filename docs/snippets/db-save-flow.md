# 저장 흐름

보드는 카드 단위로 저장하지 않는다. **화면 전체가 스냅샷 하나**이고, 그 값이 저장 계층으로 간다.

## 스냅샷 한 값

```tsx
const snapshot = useMemo(
  () => ({ board, memos, images, mermaids, tables, strokes }),
  [board, memos, images, mermaids, tables, strokes],
);
```

카드 핸들러는 `setState`만 한다. 네트워크도 DB 접근도 없다.

```tsx
const handleUpdateMemo = (id, content, x, y, z, width, height, color) => {
  setMemos((prev) => prev.map((memo) =>
    memo.id === id ? { ...memo, content, x, y, z, width, height, color } : memo
  ));
};
```

## 임시 카드와 id

새 카드는 음수 id로 먼저 화면에 올라간다.

```tsx
const tempMemo = { id: -Date.now(), boardId, content: "", x, y, width: 300, height: 200, color: "#fffadc" };
setMemos((prev) => [...prev, tempMemo]);
```

- `id < 0`: 아직 확정되지 않은 카드
- `id > 0`: 스냅샷에 들어갈 수 있는 카드

첫 저장에서 `nextPositiveId(현재 id들)`로 양수 id를 받는다. `board-state`의 스키마가 양의 정수만 허용하므로, 음수 id가 남아 있는 스냅샷은 저장되지 않는다.

삭제는 양쪽 다 같다. 임시든 아니든 배열에서 빼기만 한다.

```tsx
setMemos((prev) => prev.filter((memo) => memo.id !== id));
```

## 저장 시점

확정되지 않은 상태를 쓰지 않도록 `savePaused`가 저장을 막는다.

```tsx
const savePaused = isEditing || drawingMode || hasPendingAiCards;
```

| Edition | 저장 |
| --- | --- |
| Free | `useBoardPersistance`가 150ms 뒤 `replaceBoardState(snapshot)` |
| Plus | `SnapshotPersistence`가 즉시 `SnapshotSync.save(snapshot)` → 마지막 로컬 쓰기 후 3초 디바운스로 업로드 |

Plus에 디바운스가 없는 이유는 카드 조작이 `onDragStop`·`onResizeStop`처럼 확정 시점에만 상태를 바꾸기 때문이다. 서버로 나가는 요청은 `SnapshotSync`가 묶는다.

## 부분 갱신이 없다

워커는 트랜잭션 하나에서 `DELETE FROM boards` 후 전부 다시 INSERT한다. 메모 한 글자를 고쳐도 DB 전체가 다시 쓰인다. IndexedDB가 값을 통째로만 넣고 빼기 때문이다.

id를 명시해 INSERT하므로 화면이 들고 있던 카드 id는 저장 후에도 바뀌지 않는다.

적용 위치:

- `packages/ui/src/features/board/BoardClient.tsx`
- `packages/ui/src/features/memo/useBoardMemos.ts`
- `packages/board-data/src/browser-db/worker.ts`
- `apps/free/hooks/useBoardPersistance.ts`
- `apps/plus/lib/snapshot-sync.ts`
