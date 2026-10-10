# 메모 순서 변경 상세설계

소스: `packages/ui/src/features/memo/useMemoReorder.ts`

순서 패널 자체(`packages/ui/src/features/memo/MemoReorderPanel.tsx`)와 순서 계산(`@meldrift/core`의 `reorderMemos`, `sortMemosByOrder`, `memoReorderRowHeight`)도 함께 쓴다. 이 문서는 끌기 상태를 소유한 훅을 다룬다.

## 서버 왕복이 없다

입력은 `memos`, `setMemos`, `onFocusMemo` 셋뿐이다. 놓는 순간 `setMemos`로 순서가 확정되고, 그 값이 `snapshot.memos`의 `sortOrder`로 들어가 저장 계층에 함께 실린다. 낙관적 반영도 롤백도 없다 — 반영이 곧 결과다.

권한은 훅이 모른다. 순서 패널을 여는 경로를 `BoardClient`가 막는다.

## 상태

| 값 | 초기값 | 역할 |
| --- | --- | --- |
| `reorderOpen` | `false` | 패널 열림 |
| `draggingMemoId` | `null` | 끌고 있는 메모 |
| `dropIndex` | `null` | 놓일 줄 번호 |
| `dragOffsetY` | `0` | 끌리는 줄의 시각적 어긋남 |
| `reorderListRef` | `null` | 목록 컨테이너 |
| `dragStartYRef` / `grabOffsetRef` / `draggedRef` | - | 시작 지점, 잡은 위치, 실제로 끌었는지 |

## 좌표 계산

`getContentY(clientY)`가 포인터 위치를 목록 내부 좌표로 바꾸고, `getDragPosition`이 이를 줄 번호와 잔여 오프셋으로 나눈다.

```text
index   = 목록 범위로 자른 뒤 memoReorderRowHeight로 나눈 값
offsetY = clampedTop - index * memoReorderRowHeight
```

`memoReorderRowHeight`(44)는 CSS의 줄 높이와 반드시 같아야 한다. 포인터 위치를 줄 번호로 바꾸는 기준이기 때문이다.

## 끌기

`handleReorderStart`에서 포인터를 잡고 `window`에 이동·종료 리스너를 붙인다. 줄에 `setPointerCapture`를 걸지 않는 이유는 [MemoReorderPanel](./memo-reorder-panel.md)에 적었다.

- 이동: `getDragPosition`으로 `dropIndex`와 `dragOffsetY`를 갱신하고 `draggedRef`를 세운다.
- 종료: `setMemos((prev) => reorderMemos(prev, draggingMemoId, position.index))`로 순서를 확정하고 끌기 상태를 초기화한다.

`draggedRef`가 서지 않은 채 끝나면 클릭으로 본다. `handleRowClick`이 `onFocusMemo`를 불러 해당 메모로 보드를 이동시킨다.

## 반환값

`reorderOpen`, `draggingMemoId`, `dropIndex`, `dragOffsetY`, `reorderListRef`와 핸들러(`handleToggleReorderPanel`, `handleCloseReorderPanel`, `handleReorderStart`, `handleRowClick`)를 돌려준다. `MemoReorderPanel`이 이 값을 그대로 받는다.
