# MemoReorderPanel 상세설계

소스: `packages/ui/src/features/memo/MemoReorderPanel.tsx`, `packages/ui/src/features/memo/useMemoReorder.ts`, `packages/core/src/memo-order.ts`

## 역할

보드의 메모를 순서대로 한 줄씩 세우고, 손잡이를 끌어 그 순서를 바꾼다. 여기서 정한 순서는 `BoardNavigator`의 연번, `BoardSearchPanel`의 결과 순회 차례, 그리고 Markdown 문서 순서에 쓰인다. 문서 순서를 바꾸는 곳은 여기뿐이다 — 카드를 보드에서 옮기거나 AI가 재배치해도 바뀌지 않는다.

`BoardMenu`의 `Reorder Memos` 항목으로 열고 닫는다.

## Props

| Prop | 타입 | 사용처 |
| --- | --- | --- |
| `memos` | `BoardMemo[]` | 이미 정렬된 목록. 끄는 동안에는 놓을 자리로 옮겨 둔 미리보기가 들어온다 |
| `listRef` | `RefObject<HTMLDivElement \| null>` | 포인터 위치를 줄 번호로 바꿀 때 기준이 되는 스크롤 컨테이너 |
| `draggingMemoId` | `number \| null` | 끌고 있는 줄의 강조와 `translateY` 적용 대상 |
| `dragOffsetY` | `number` | 놓일 자리에서 손가락까지의 거리(px) |
| `onDragStart` | `(event, memoId) => void` | 손잡이 `onPointerDown` |
| `onRowClick` | `(memoId: number) => void` | 줄 `onClick` — 끌지 않았을 때만 그 메모로 이동 |
| `onClose` | `() => void` | 닫기 버튼 |

## State

없음 — 패널 열림, 끌기 상태, 순서 저장은 모두 `useMemoReorder`가 소유한다.

## 렌더 구조

| 요소 | 스타일/속성 | 비고 |
| --- | --- | --- |
| 루트 `div` | `board-toolbar fixed left-5 top-20`, `z-50000`, `w-72`, `bg-white/75 rounded-xl shadow-md` | `.board-toolbar`라서 카드의 외부 저장 판정에서 제외된다 |
| 목록 `div` | `maxHeight = memoReorderRowHeight * memoReorderVisibleRows`, `overflow-y-auto` | 줄 높이의 정확한 배수라 다음 줄이 반쯤 걸쳐 보이지 않는다 |
| 줄 `div` | `memo-order-row`, 높이 `memoReorderRowHeight` | 끌고 있는 줄만 `translateY` + `position: relative` + `z-index: 10` |
| 손잡이 `span` | `role="button"`, `aria-label="Move memo N"`, `touch-action: none` | 여기서 시작한 터치만 끌기로 쓴다 |
| 연번 `span` | `w-5 text-center` | 배열 위치 + 1. 저장된 `sort_order` 값이 아니다 |
| 색 점 `span` | `h-3 w-3 rounded-full` | 메모 배경색 |
| 본문 `button` | `truncate` | HTML을 걷어낸 한 줄. 비어 있으면 `(empty memo)` |

`memoReorderRowHeight`(44)는 CSS의 줄 높이이면서 포인터 위치를 줄 번호로 바꾸는 나눗셈의 분모다. 둘 중 하나만 바꾸면 끌기 위치가 어긋난다.

## 끌기

- 4px 임계값을 넘지 않고 끝난 입력은 끌기가 아니라 누른 것으로 보고 그 메모를 포커스한다. `draggedRef`는 다음 `pointerdown`까지 유지해서, 끌고 난 뒤 따라오는 `click`이 메모 이동으로 새는 것을 막는다.
- `pointermove`와 `pointerup`은 `window`에서 듣는다. 줄에 `setPointerCapture`를 걸면 미리보기로 DOM 순서가 바뀔 때 캡처를 잃을 수 있고, 패널 밖으로 나간 뒤의 입력도 놓친다.
- 잡은 지점이 손가락에 붙도록 `grabOffsetRef`에 줄 안에서의 세로 위치를 기록하고 매 이동에서 빼 준다.
- 놓을 자리는 줄의 위쪽 끝을 기준으로 `Math.round(top / memoReorderRowHeight)`로 정한다. 포인터 위치가 아니라 줄 위치를 쓰므로 화면에 보이는 것과 판정이 같다.
- 끌고 있는 줄이 목록 밖으로 나가지 않도록 위치를 `0..(N-1) * 줄 높이`로 자른다.

## 순서 저장

순서 값은 브라우저가 정한다. 서버 왕복이 없다.

1. 놓는 순간 `setMemos((prev) => reorderMemos(prev, memoId, targetIndex))`로 확정한다.
2. 바뀐 `sortOrder`가 `snapshot.memos`에 실린다.
3. 저장 계층이 그 스냅샷을 통째로 쓴다 — Free는 브라우저 DB까지, Plus는 서버까지.

되돌릴 대상이 없다. 반영이 곧 결과이고, 실패는 저장 계층의 실패지 순서 계산의 실패가 아니다.

배열 순서는 그대로 두고 `sortOrder`만 바꾼다. 그래서 순서를 바꿔도 메모 객체의 배열 위치는 움직이지 않고, 화면 순서는 `sortMemosByOrder`가 매번 계산한다.

### reorderMemos

옮기는 메모의 `sort_order`를 목적지 값으로 바꾸고, 원래 자리와 목적지 사이에 낀 메모만 +1 또는 -1 한다. 나머지 메모는 건드리지 않으므로 전체를 다시 매기지 않는다.

- 화면에서 위로 올라가는 것은 `sort_order` 값이 작아지는 쪽이다. 코드에서는 `toSmallerOrder`라는 값 기준 이름을 쓴다.
- 삭제로 생긴 빈 번호가 있어도 상대 순서만 보므로 결과가 같고 값의 유일성도 유지된다.
- 배열 순서는 그대로 두고 `sortOrder`만 바꾼다.

## 순서 값의 출처

| 시점 | 값 |
| --- | --- |
| 새 메모 | 화면에서 `nextMemoOrder(memos)` — 현재 최댓값 + 1 |
| 재정렬 | `reorderMemos`의 계산 결과 |
| 불러올 때 | `rankMemoOrders`로 1..N 재번호 |

불러올 때 다시 매기는 이유는 순서 컬럼이 없던 시절의 저장 파일과 Plus의 구버전 카드 테이블을 둘 다 열 수 있어야 하기 때문이다. 저장값이 전부 0이어도 화면 연번은 항상 1..N이 된다.
