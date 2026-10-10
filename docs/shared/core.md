# `@meldrift/core` 상세설계

소스: `packages/core/src/cards.ts`, `packages/core/src/memo-order.ts`, `packages/core/src/table-card.ts`, `packages/core/src/board-stroke.ts`, `packages/core/src/board-plan.ts`

## 위치

React도 DOM도 쓰지 않는다. 그래서 브라우저 컴포넌트와 서버 Route Handler가 같은 모듈을 그대로 가져다 쓴다. Plus의 `app/api/cards/layer/route.ts`가 서버에서 `cardTypeOrder`를 쓰는 것이 그 예다.

여기에 React가 한 줄이라도 들어가면 서버 코드가 깨진다.

## `cards.ts` — 카드 종류와 쌓임

| 이름 | 값/형태 | 역할 |
| --- | --- | --- |
| `cardTypes` | `["memo", "image", "mermaid", "table"]` | 카드 종류 목록 |
| `CardType` | 위 배열의 유니온 | |
| `CardLayerAction` | `"front" \| "back"` | 레이어 이동 방향 |
| `CardLayer` | `{ type, id, z }` | 레이어 계산의 최소 단위 |
| `cardTypeOrder` | `memo:0, image:1, mermaid:2, table:3` | `z`가 같을 때의 tiebreak |
| `ACTIVE_CARD_Z` | `49999` | 편집 중인 카드의 임시 z |
| `isCardType` / `isCardLayerAction` | 타입 가드 | 서버가 요청 본문을 검사할 때 쓴다 |

### `cardTypeOrder`가 상시 동작하는 이유

새 카드는 두 Edition 모두 `z = 1`로 만들어진다. 스키마 기본값도 1이고 유니크 제약이 없다. 따라서 **`z` 동률은 예외가 아니라 기본 상태**이고, 정렬은 사실상 이 표가 결정한다.

동률을 못박지 않으면 배열에 넣은 순서(JS)나 행이 나온 순서(DB)에 따라 결과가 갈린다. 두 Edition이 같은 보드에서 같은 문서를 내려면 이 순서가 고정되어야 한다.

### 카드 데이터

`CardFrame`이 `id`·`boardId`·`x`·`y`·`z`·`width`·`height`를 담고, 여기에 종류별 필드가 붙는다.

| 타입 | 추가 필드 |
| --- | --- |
| `MemoCardData` | `content`, `color`, `sortOrder` |
| `MermaidCardData` | `source` |
| `TableCardData` | `source: TableSource` |

이미지 카드는 없다. 바이트와 MIME을 들고 다녀야 해서 `@meldrift/board-data`의 `board-state.ts`가 `BoardImage`로 따로 정의한다.

## `memo-order.ts` — 메모 순서

메모 순서는 보드 탐색 연번이자 Markdown 문서 순서의 기준이다.

| 이름 | 동작 |
| --- | --- |
| `memoReorderRowHeight` = 44 | 순서 패널의 줄 높이. **CSS 값과 반드시 같아야 한다** — 포인터 위치를 줄 번호로 바꾸는 기준이다 |
| `memoReorderVisibleRows` = 5 | 패널에 한 번에 보이는 줄 수 |
| `sortMemosByOrder(memos)` | `sortOrder` → `id` 순 정렬. 원본을 건드리지 않는다 |
| `nextMemoOrder(memos)` | 최대 `sortOrder` + 1 |
| `rankMemoOrders(memos)` | 저장값을 1..N 연번으로 다시 매긴 `Map` |
| `memoPlainText(content)` | 태그를 지우고 공백을 정리한 검색·요약용 문자열 |
| `reorderMemos(memos, memoId, targetIndex)` | 한 메모를 목표 위치로 옮기고 사이에 낀 메모를 반대로 민다 |

`rankMemoOrders`가 필요한 이유는 순서 컬럼이 없던 시절의 파일 때문이다. 그런 파일은 값이 전부 0이라 id 순서로 떨어지는데, 화면 연번은 언제나 1..N이어야 한다.

`reorderMemos`는 화면에서 위로 가는 것이 `sortOrder`가 작아지는 쪽이라 방향 이름이 반대다. 그래서 구현이 인덱스가 아니라 값을 기준으로 적혀 있다.

## `table-card.ts` — 표

| 이름 | 동작 |
| --- | --- |
| `tableSourceSchema` | 컬럼 1개 이상, 행 1개 이상. 컬럼은 `{ id, name, width? }`, 행은 `{ id, cells }` |
| `TableSource` | 위 스키마의 추론 타입 |
| `createTableItemId()` | 시간 + 난수 기반 문자열 id |
| `tableSourceToMarkdown(source)` | GFM 표로 변환 |
| `defaultTableSource` | 2열 × 2행 빈 표 |

`tableSourceToMarkdown`은 셀의 `|`를 이스케이프하고 줄바꿈을 `<br>`로 바꾼다. 표 안의 개행이 Markdown 표를 깨뜨리기 때문이다. 행에 없는 컬럼은 빈 칸으로 채운다.

## `board-stroke.ts` — 드로잉 데이터

| 이름 | 동작 |
| --- | --- |
| `boardStrokesSchema` | 획 배열. 획은 `{ id, color, width, points }`이고 점이 2개 이상이어야 한다 |
| `StrokePoint` | `[x, y]` 튜플 |
| `DrawingTool` | `"draw" \| "erase"` |
| `penColors` / `penWidths` | 팔레트 7색, 굵기 3단 |
| `defaultPenColor` / `defaultPenWidth` | 첫 색, 가운데 굵기 |
| `eraserScreenRadius` = 8 | 화면 기준 지우개 반지름 |
| `createStrokeId()` | 시간 + 난수 기반 문자열 id |
| `eraseStrokesAlongPath(strokes, start, end, radius)` | 선분에 걸친 부분을 잘라낸다 |
| `eraseStrokesInCircle(...)` | 원에 걸친 부분을 잘라낸다 |
| `strokeToPath(points)` | SVG `d` 문자열 |

지우개는 획을 통째로 지우지 않는다. 점과 선분 사이 거리를 제곱 상태로 비교해(제곱근을 쓰지 않는다) 살아남은 구간을 다시 획으로 만든다. 그래서 획 하나가 여러 조각으로 갈라질 수 있다.

## `board-plan.ts` — AI 보드 계획

AI 어시스턴트가 내놓는 계획과 그 계획을 실제 좌표로 배치하는 부분이다. 흐름은 [Plus](../plus/ai-assistant.md)와 [Free](../free/ai-assistant.md)의 어시스턴트 문서에서 다룬다. 여기서는 형태만 정리한다.

**AI에게 좌표를 계산시키지 않는다.** AI는 "어떤 메모에 어떤 카드가 붙는가"라는 논리 구조만 내놓고, 좌표는 이 파일의 배치 함수가 정한다. Markdown 컴파일이 메모 꼭짓점 포함 여부로 카드를 고르므로 배치가 어긋나면 문서가 통째로 달라진다.

| 스키마 | 내용 |
| --- | --- |
| `memoBlockSchema` | 메모 본문을 이루는 블록 |
| `planAttachmentSchema` | 메모에 붙는 첨부. Mermaid와 표뿐이다 |
| `planSectionSchema` | 블록 + 색 + 첨부 + `parentIndex`(tree 배치 전용) |
| `boardPlanSchema` | `layout` + `sections` (1~24개) |
| `boardArrangementSchema` | 이미 있는 카드를 다시 배치하는 계획 |
| `boardEditSchema` | 내용만 고치는 계획. 좌표·크기는 건드리지 않는다 |
| `boardDeletionSchema` | 지우는 계획 |

`layoutModes`는 `column`·`grid`·`tree`·`scatter` 넷이다. `planMemoColors`는 `MemoToolBar`가 제공하는 색과 같은 8색으로 제한한다.

| 함수 | 역할 |
| --- | --- |
| `memoBlocksToHtml(blocks)` | 블록을 메모 카드가 쓰는 HTML로 |
| `estimateMemoHeight(blocks)` | 배치 전에 메모 높이를 어림한다 |
| `planTableToSource(columns, rows)` | 계획의 표를 `TableSource`로 |
| `getPlanCapacity(bounds)` | 보드에 몇 개까지 놓을 수 있는지 |
| `layoutBoardPlan(...)` | 새 계획을 좌표로 |
| `layoutArrangement(...)` | 기존 카드 재배치를 좌표로 |
