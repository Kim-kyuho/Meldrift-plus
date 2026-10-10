# 보드 다중 선택 설계

소스: `packages/ui/src/features/selection/useBoardSelection.ts`, `packages/ui/src/features/selection/SelectionLayer.tsx`, `packages/ui/src/features/selection/useSelectionPointer.ts`, `packages/ui/src/features/selection/SelectionToolBar.tsx`

보드 툴바 맨 위의 `MousePointer` 버튼으로 선택 모드를 켠다. 선택 모드에서 드래그한 사각형에 걸치는 카드를 모두 선택하고, 선택된 카드 묶음을 한꺼번에 옮기거나 지운다.

## 동작

| 상황 | 결과 |
| --- | --- |
| `MousePointer` 버튼 | 선택 모드를 켜고 끈다. 켜진 동안 아이콘은 `#ec4899`로 표시한다 (검색·Compass 버튼과 같은 활성색) |
| 선택 모드에서 선택 상자 밖을 드래그 | 드래그 사각형을 그린다. 손을 떼면 사각형과 **겹치는** 카드를 모두 선택한다. 기존 선택은 새 선택으로 바뀐다 |
| 선택된 카드가 하나일 때 | 여러 개일 때와 똑같이 그룹 상자로 감싼다 |
| 선택 상자 안을 눌러 드래그 | 선택된 카드를 모두 같은 거리만큼 옮긴다 |
| 선택 상자 밖을 클릭(드래그 없음) | 선택을 해제한다. 선택 모드는 유지한다 |
| 카드 더블클릭·더블탭 | 기존처럼 그 카드의 편집을 시작한다. 이때 선택은 해제되고, 편집이 끝나면 선택된 카드가 없는 선택 모드로 돌아간다 |
| 선택이 있는 동안의 툴바 | 일반 도구를 숨기고 삭제 버튼 하나만 보인다 |
| 삭제 버튼 | `ConfirmDialog`로 확인한 뒤 선택된 카드를 모두 지운다 |
| 드로잉 버튼 | 선택 모드를 끄고 드로잉 모드로 들어간다. 두 모드는 동시에 켜지지 않는다 |

선택된 카드는 **이동만** 할 수 있다. 크기 조절, 색 변경, 레이어 변경은 하지 않는다.

## 이름

기존 기능과 같은 방식으로 이름을 짓는다. 모드를 켜고 끄는 방식이 드로잉과 같으므로 드로잉 쪽 이름을 그대로 따른다.

| 드로잉(기존) | 선택(신규) | 패키지 |
| --- | --- | --- |
| `useBoardDrawing` | `useBoardSelection` | `@meldrift/ui` — 카드 컬렉션과 선택 상태를 다루는 React 훅 |
| `useDrawingPointer` | `useSelectionPointer` | `@meldrift/ui` |
| `DrawingLayer` | `SelectionLayer` | `@meldrift/ui` |
| `DrawingToolBar` | `SelectionToolBar` | `@meldrift/ui` |
| `drawingMode` | `selectionMode` | |
| `handleToggleDrawingMode` | `handleToggleSelectionMode` | |
| `onDrawingToggleClick` | `onSelectionToggleClick` | `BoardToolBar` prop |
| `data-drawing-capture` | `data-selection-capture` | |

선택에 쓰는 타입은 `packages/core/src/cards.ts`에 둔다. `@meldrift/ui`와 `@meldrift/board-data`가 함께 쓰기 때문이다.

```ts
export type SelectedCard = { type: CardType; id: number };                    // CardLayer에서 z를 뺀 형태
export type SelectionRect = { x: number; y: number; width: number; height: number }; // 보드 좌표
export type SelectionOffset = { x: number; y: number };
```

## `useBoardSelection` (`@meldrift/ui`)

```ts
type UseBoardSelectionOptions = {
    boardWidth: number;
    boardHeight: number;
    memos: BoardMemo[];
    images: BoardImage[];
    mermaids: BoardMermaid[];
    tables: BoardTable[];
    setMemos: Dispatch<SetStateAction<BoardMemo[]>>;
    setImages: Dispatch<SetStateAction<BoardImage[]>>;
    setMermaids: Dispatch<SetStateAction<BoardMermaid[]>>;
    setTables: Dispatch<SetStateAction<BoardTable[]>>;
    onDeleteMemo: (id: number) => void;
    onDeleteImage: (imageId: number) => void;
    onDeleteMermaid: (id: number) => void;
    onDeleteTable: (id: number) => void;
};
```

### State

| 이름 | 초기값 | 용도 |
| --- | --- | --- |
| `selectionMode` | `false` | 선택 모드 여부 |
| `selectedCards` | `[]` | 선택된 카드 |

### 파생값

| 이름 | 계산 |
| --- | --- |
| `selectedCards` | 선택 중 지금도 컬렉션에 남아 있는 카드. 지워진 카드는 자동으로 빠진다 |
| `selectionBounds` | 선택된 카드 `x, y, width, height`의 합집합 사각형. 선택이 없으면 `null` |

### 핸들러

| 이름 | 동작 |
| --- | --- |
| `handleToggleSelectionMode` | 모드를 켜고 끈다. 끌 때 `selectedCards`를 비운다 |
| `handleSelectCards(rect)` | 보드 좌표 사각형과 겹치는 카드를 네 컬렉션에서 찾아 `selectedCards`에 넣는다 |
| `handleClearSelection` | `selectedCards`를 비운다 |
| `clampSelectionOffset(offset)` | 그룹 상자가 보드 밖으로 나가지 않도록 오프셋을 `[-bounds.x, boardWidth - bounds.right]`(y도 같다) 범위로 자르고 반올림한다. 드래그 중 표시와 확정에 같은 값을 쓴다 |
| `handleMoveSelection(offset)` | `clampSelectionOffset`을 거친 값을 선택된 카드의 `x, y`에 더한다. 선택된 카드가 있는 종류의 setter만 호출한다 |
| `handleDeleteSelection` | 선택된 카드마다 기존 `onDelete{Type}`을 호출하고 선택을 비운다 |

겹침 판정은 DOM이 아니라 컬렉션 값으로 한다. 카드 좌표가 이미 보드 좌표이므로 줌과 스크롤을 다시 계산하지 않아도 된다.

```ts
const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
```

### 저장과의 관계

이동과 삭제는 모두 하나의 이벤트 안에서 컬렉션 setter를 호출한다. React가 한 번에 묶어 렌더하므로 스냅샷은 한 번만 바뀐다.

- Free: 다음 저장에서 한 번 기록한다.
- Plus: `board-delta`가 이전·다음 스냅샷을 비교해 **변경 요청 하나에 카드 수만큼 operation**을 만든다. 이동은 카드마다 `changes: { x, y }`인 `update`, 삭제는 카드마다 `delete`가 된다. 선택되지 않은 카드는 operation에 들어가지 않는다.

선택 자체는 보드 데이터를 바꾸지 않으므로 `savePaused` 조건을 추가하지 않는다. 드래그 중의 이동량은 컬렉션이 아니라 `useSelectionPointer`의 상태에 있다가 손을 뗄 때 한 번만 반영된다.

## `useSelectionPointer` (`@meldrift/ui`)

선택 모드에서 보드 스크롤 레이어의 포인터 입력을 맡는다. 선택 모드에서는 `BoardClient`가 스크롤 레이어의 `onPointerDown/Move/Up`을 `useBoardScroll`의 패닝 핸들러 대신 이 훅의 핸들러에 연결한다.

```ts
onPointerDown={selectionActive ? handleSelectionPointerDown : handleBoardPanStart}
```

`selectionActive = selectionMode && !isEditing`이다. 카드를 편집하는 동안에는 선택 입력을 받지 않는다. 그래야 편집 중 텍스트 드래그가 기존처럼 동작한다.

### State/Ref

| 이름 | 종류 | 용도 |
| --- | --- | --- |
| `activePointerRef` | ref | 입력을 가진 `pointerId`. 첫 포인터만 인정한다 |
| `pressRef` | ref | 누른 지점(보드 좌표), 누른 곳이 선택 상자 안인지, 5px 기준을 넘었는지 |
| `marqueeRect` | state | 드래그 중인 선택 사각형(보드 좌표). 렌더용 |
| `selectionOffset` | state | 그룹 이동 중인 `{ x, y }`. 렌더용 |

### 흐름

1. **pointerdown**: `.board-toolbar`, `.confirm-dialog`, `button`에서 누른 것이면 무시한다. 누른 지점을 보드 좌표로 바꾸고, `selectionBounds` 안인지 기록한다.
2. **pointermove**: 5px를 넘기 전까지는 아무것도 하지 않는다. 넘으면 그때 `setPointerCapture`를 호출하고,
   - 상자 안에서 시작했으면 `selectionOffset`을 갱신한다.
   - 상자 밖에서 시작했으면 `marqueeRect`를 갱신한다.
3. **pointerup**:
   - 5px를 넘기지 않았고 상자 밖이면 `onClearSelection()`
   - 그룹 이동이었으면 `onMoveSelection(offset)` 후 오프셋 초기화
   - 사각형 드래그였으면 `onSelectCards(marqueeRect)` 후 사각형 초기화
4. **pointercancel**, 또는 입력 중에 두 번째 터치가 들어오면: 진행 중인 사각형이나 이동을 **버린다**. 두 손가락 입력은 `useBoardPinchZoom`에 맡긴다.

5px 기준과 "기준을 넘은 뒤에 capture" 규칙은 `useBoardScroll`의 패닝과 같다. 기준 아래의 누름은 카드까지 그대로 전달되므로, 더블클릭과 `handleDoubleTap`에 의한 편집 진입이 선택 모드에서도 바뀌지 않는다.

좌표 변환은 `useDrawingPointer.toBoardPoint`와 같은 식을 `.meldrift-board`의 `getBoundingClientRect()`에 적용한다.

```
x = (event.clientX - boardRect.left) / zoom
y = (event.clientY - boardRect.top) / zoom
```

### 터치

선택 모드가 켜져 있고 카드를 편집하고 있지 않으면 스크롤 레이어에 `touchAction: "none"`을 준다. 한 손가락 드래그가 네이티브 스크롤 대신 선택 사각형이 된다(드로잉 모드와 같은 방식). 선택 모드에서 보드를 스크롤하는 수단은 두 손가락 핀치·이동과 마우스 휠이다.

## `SelectionLayer` (`@meldrift/ui`)

`.meldrift-board` 안, `DrawingLayer` 옆에 둔다. 입력은 받지 않는다(`pointerEvents: "none"`). 입력은 전부 스크롤 레이어의 `useSelectionPointer`가 받는다.

| 요소 | 조건 | 모양 |
| --- | --- | --- |
| 드래그 사각형 `data-selection-marquee` | `marqueeRect !== null` | 반투명 핑크 채움 + 1px 테두리 |
| 그룹 상자 `data-selection-box` | `selectionBounds !== null` | `card-editing` 클래스(2px dashed `#ec4899`)를 그대로 쓴다. 위치는 `selectionBounds + clampSelectionOffset(selectionOffset)` |

`BoardClient`는 `selectionActive`일 때만 이 레이어를 그린다.

z-index는 `ACTIVE_CARD_Z`이다. 카드보다 위에 그려지지만 입력은 막지 않는다.

## 드래그 중 카드 표시

드래그 중에는 컬렉션을 바꾸지 않으므로, 선택된 카드는 오프셋만큼 따로 움직여 보여야 한다. 카드 네 종류에 선택적 prop 하나를 추가한다.

```ts
groupOffset?: { x: number; y: number };
```

`BoardClient`는 `clampSelectionOffset(selectionOffset)`을 선택된 카드에만 넘긴다. 카드는 이 값을 `Rnd`의 `style.translate`로 적용한다. CSS `translate` 속성은 `Rnd`가 위치 지정에 쓰는 `transform`과 따로 합성되므로 `Rnd`의 위치 계산을 건드리지 않는다. 선택되지 않은 카드에는 넘기지 않는다.

## 기존 카드 훅에 필요한 변경

`useMemoCard`의 `memoState`, `useImageCard`의 `imageState`, `useMermaidCard`/`useTableCard`의 `cardState`는 **마운트할 때 prop으로 한 번만** 초기화된다. 지금은 편집 중인 카드만 자기 위치를 바꾸므로 문제가 없다. 하지만 그룹 이동은 편집하지 않는 카드의 `x, y`를 컬렉션에서 바꾸므로, 이대로면 카드가 이전 위치에 남는다.

두 가지 방법이 있다.

| 방법 | 내용 | 비용 |
| --- | --- | --- |
| A. 위치 동기화 | 네 훅에서 편집 중이 아닐 때 prop의 `x, y`가 바뀌면 로컬 상태의 `x, y`를 따라가게 한다 | 훅 네 개 수정 |
| B. 다시 마운트 | 움직인 카드의 `key`를 바꿔 다시 마운트한다 | Mermaid 카드가 SVG를 다시 렌더한다 |

이 설계는 A를 기준으로 한다. 동기화는 effect가 아니라 렌더 중에 한다. effect로 하면 이동을 확정한 렌더에서 `groupOffset`은 이미 사라졌는데 로컬 위치는 아직 옛 값이라, 카드가 한 프레임 동안 원래 자리로 돌아갔다가 다시 이동한다.

```ts
const [syncedPosition, setSyncedPosition] = useState({ x: memo.x, y: memo.y });
if (!isEditing && (syncedPosition.x !== memo.x || syncedPosition.y !== memo.y)) {
    setSyncedPosition({ x: memo.x, y: memo.y });
    setMemoState((prev) => ({ ...prev, x: memo.x, y: memo.y }));
}
```

`useImageCard`는 저장할 때 `imageStateRef`를 읽는데, 이 ref를 지금까지 핸들러에서만 갱신했다. 동기화된 위치도 반영되도록 `useMermaidCard`/`useTableCard`처럼 `imageState`가 바뀔 때 effect로 ref를 맞춘다.

## `BoardToolBar` 변경

| 변경 | 내용 |
| --- | --- |
| 새 prop `selectionMode` | `MousePointer` 아이콘의 활성색과 `aria-pressed` |
| 새 prop `onSelectionToggleClick` | `MousePointer` 버튼. 다른 버튼처럼 `setMenuOpen(false)`도 함께 호출하고, 검색 패널과 메모 네비게이터를 닫는다 |
| 버튼 위치 | 세로 목록의 **맨 위**, `Compass` 위 |
| `cardEditing` 계산 | `BoardClient`에서 `isEditing \|\| drawingMode \|\| selectedCards.length > 0`으로 넘긴다. 선택이 있으면 일반 도구와 드로잉 버튼이 숨고, `#card-tool-portal`에 `SelectionToolBar`가 들어온다 |

aria-label: `Select cards`

## `SelectionToolBar` (`@meldrift/ui`)

`CardToolPortal` 안에 `CardToolButton` 하나만 둔다.

| 아이콘 | label | 동작 |
| --- | --- | --- |
| `Trash2` | `Delete selected cards` | `ConfirmDialog`(`Delete N cards?`)를 연 뒤 확인하면 `onDelete` |

## `BoardClient` 조립

- `useBoardSelection`은 컬렉션 훅들과 `useCardLayer` 사이에서 호출한다.
- 모드 버튼은 다른 도구처럼 `withPermission`으로 감싼다. Plus에서 `canEdit`이 false면 권한 문구만 띄운다.
- `selectionActive = selectionMode && !isEditing && !hasPendingAiCards`
- `BoardToolBar`의 `cardEditing`에는 `isEditing || drawingMode || cardsSelected`를 넘긴다. `cardsSelected = selectionActive && selectedCards.length > 0`
- 선택 모드에서는 보드 커서를 `grab` 대신 `default`로 둔다.
- 카드 `onEditing` 네 곳에서 `handleClearSelection()`을 함께 호출한다.
- `handleToggleDrawingMode`를 부를 때 선택 모드가 켜져 있으면 먼저 끈다.
- `replaceSnapshot`(가져오기·되돌리기)에서 선택을 비운다.

## AI 제안 카드

AI 제안 대기(`hasPendingAiCards`) 동안에는 선택 모드에 들어갈 수 없게 한다. 버튼을 누르면 어시스턴트가 쓰는 문구 `Save or discard the assistant's changes first.`를 띄운다. 선택 모드인 채로 제안이 생기면 `selectionActive`가 false가 되어 선택 입력·그룹 상자·삭제 툴바가 모두 멈춘다. 대기 중인 카드는 음수 id이고, 기존 카드의 이동도 `pendingMoves`로 추적한다. 이 상태에서 그룹 이동을 하면 Discard의 `restore()`가 사용자의 이동까지 되돌린다.

## 테스트

| 종류 | 대상 |
| --- | --- |
| 단위 (`@meldrift/ui`) | `useBoardSelection`: 겹침 판정(걸치기만 해도 선택), 합집합 상자, 보드 경계에서 `dx, dy` 자르기, 이동 시 선택 카드만 바뀌기, 삭제 후 선택 비우기 |
| 단위 (`@meldrift/ui`) | `useSelectionPointer`: 5px 미만 누름은 선택 해제만, 상자 안·밖 분기, 두 번째 터치에서 버리기 |
| E2E (`apps/plus/tests/e2e/board-delta.spec.ts`) | 메모 두 개를 선택해 옮기면 변경 요청 하나에 `changes`가 `x, y`뿐인 `update` 두 개, 선택 밖 카드는 operation 없음. 삭제하면 `delete` 두 개 |
| E2E (mobile/tablet safari) | 한 손가락 드래그로 선택되고, 더블탭 편집이 선택 모드에서도 열림 |

## 파일

| 파일 | 변경 |
| --- | --- |
| `packages/core/src/cards.ts` | `SelectedCard` 추가 |
| `packages/ui/src/features/selection/useBoardSelection.ts` | 신규 |
| `packages/ui/src/features/selection/useSelectionPointer.ts` | 신규 |
| `packages/ui/src/features/selection/SelectionLayer.tsx` | 신규 |
| `packages/ui/src/features/selection/SelectionToolBar.tsx` | 신규 |
| `packages/ui/package.json`, `packages/board-data/package.json` | export 추가 |
| `packages/ui/src/features/board/BoardToolBar.tsx` | 버튼과 prop 추가 |
| `packages/ui/src/features/{memo,image,mermaid,table}/*Card.tsx` | `groupOffset` prop |
| `useMemoCard`, `useImageCard`, `useMermaidCard`, `useTableCard` | 편집 중이 아닐 때 위치 동기화 |
| `packages/ui/src/features/board/BoardClient.tsx` | 조립 |
| `apps/{free,plus}/tests/unit/components.test.tsx` | `BoardToolBar` 새 prop 반영 |
| `apps/free/tests/unit/useBoardSelection.test.ts` | 신규 |
| `packages/ui/tests/useSelectionPointer.test.tsx` | 신규 |
