# BoardClient 상세설계

소스: `packages/ui/src/features/board/BoardClient.tsx`

보드 화면 전체다. 카드 네 종류, 드로잉, 검색, 탐색, 줌, 순서 패널, Markdown 뷰, AI 어시스턴트를 여기서 조립한다. 두 Edition이 같은 파일을 쓴다.

Edition마다 다른 것은 **저장 방식과 껍데기**뿐이라, 그 둘만 밖으로 뺐다.

## 계약

```ts
type BoardClientProps = {
    initialSnapshot: BoardSnapshot;
    canEdit?: boolean;
    permissionMessage?: string;
    viewportRef?: RefObject<HTMLDivElement | null>;
    renderControls: (controls: BoardControls) => ReactNode;
};
```

| Prop | 기본값 | 의미 |
| --- | --- | --- |
| `initialSnapshot` | 필수 | 화면을 채울 초기 보드. 이미 읽혀 있는 값이어야 한다 |
| `canEdit` | `true` | 카드 편집 허용 여부. Free는 넘기지 않고, Plus는 계정 권한과 보드가 열린 상태인지를 곱해 넘긴다 |
| `permissionMessage` | `Please sign in before editing cards.` | `canEdit`이 false일 때 띄울 문구 |
| `viewportRef` | 내부 ref | 보드 스크롤 레이어. Plus가 미리보기 캡처에 쓰려고 밖에서 받아 간다 |
| `renderControls` | 필수 | 메뉴와 저장 계층을 Edition이 그린다 |

`initialSnapshot`을 Promise나 `null`로 받지 않는다. **불러오기는 껍데기의 일이고**, 이 컴포넌트는 값이 있는 상태로만 마운트된다.

## `renderControls`

Edition이 그려 넣는 자리다. 넘겨받는 값은 이렇다.

| 값 | 의미 |
| --- | --- |
| `snapshot` | 현재 화면 전체를 담은 값 |
| `savePaused` | 지금 저장하면 안 되는 상태인가 |
| `setMessage` | 보드 메시지 띄우기 |
| `menuOpen`, `setMenuOpen` | 보드 메뉴 열림 상태 |
| `reorderOpen`, `onReorder` | 순서 패널 상태와 토글 |
| `onCompileMarkdown`, `onAbout` | Markdown 뷰·About 열기 |
| `closeOverlays` | 메뉴·About·Markdown 뷰를 한꺼번에 닫기 |

저장은 이 컴포넌트가 하지 않는다. `snapshot`과 `savePaused`를 내주기만 하고, 그것으로 무엇을 할지는 Edition이 정한다.

| Edition | `renderControls`가 그리는 것 |
| --- | --- |
| Free | `BoardControls` — 보드 메뉴, Help, 반출입, `useBoardPersistance`(브라우저 DB 저장) |
| Plus | 보드 메뉴, 로그인·가입 모달, `SnapshotPersistence`(서버 동기화로 스냅샷 전달) |

## 스냅샷

```ts
const snapshot = useMemo(() => ({ board, memos, images, mermaids, tables, strokes }), [...]);
```

카드 컬렉션 훅들이 소유한 상태가 여기 한 값으로 모인다. 저장·내보내기·Markdown 컴파일이 전부 이 값 하나를 본다.

## `savePaused`

```ts
const savePaused = isEditing || drawingMode || hasPendingAiCards;
```

| 조건 | 막는 이유 |
| --- | --- |
| 카드 편집 중 | 확정되지 않은 초안을 쓰지 않는다 |
| 드로잉 모드 | 같은 이유. 획은 모드를 끌 때 확정된다 |
| AI 제안 대기 | 임시 카드가 음수 id라 `board-state` 검증에 걸린다 |

`isEditing`은 네 종류의 `editing{Type}Id` 중 하나라도 있으면 참이다. 카드별 편집 id는 각 컬렉션 훅이 따로 소유하고, 여기서는 하나의 파생 플래그로만 합친다.

## 권한

`canEdit`이 false일 때 막는 자리는 전부 이 컴포넌트 안에 있다. 훅들은 권한을 모른다.

```ts
const withPermission = (action) => () => {
    if (!canEditCard) { showPermissionMessage(); return; }
    action();
};
```

카드 생성 버튼, 이미지 업로드·드롭, 순서 패널의 끌기 시작, 카드 컴포넌트의 `onPermissionDenied`, `useAiAssistant`의 `canEdit`이 같은 판정을 공유한다.

## 조립하는 훅

| 출처 | 훅 |
| --- | --- |
| `@meldrift/ui` | `useBoardMemos`, `useBoardImages`, `useBoardMermaids`, `useBoardTables`, `useCardLayer`, `useMemoReorder`, `useAiAssistant` |
| `@meldrift/ui` | `useBoardZoom`, `useBoardPinchZoom`, `useBoardScroll`, `useBoardSearch`, `useBoardMemoFocus`, `useBoardDrawing`, `useBoardImageDrop` |

보드 화면과 카드 상태를 다루는 React 훅은 `@meldrift/ui`에 둔다. 데이터 구조·저장·변환 코드는 `@meldrift/board-data`에서 가져온다.

## 렌더 구조

```text
hidden image input
renderControls(...)          ← Edition이 그리는 자리
BoardToolBar
DrawingToolBar (drawingMode)
BoardSearchPanel / BoardNavigator / MemoReorderPanel
BoardMarkdownView (markdownViewOpen)
AboutModal (aboutOpen)
AiAssistantButton / AiChatPanel / AiUnlockPanel
BoardMessage
BoardImageDropOverlay
main
└ board-scroll-layer      ← viewportRef
   └ board-size-layer     ← boardWidth * zoom
      └ meldrift-board    ← transform: scale(zoom)
         ├ ImageCard[] / MemoCard[] / MermaidCard[] / TableCard[]
         └ DrawingLayer
```

`DrawingLayer`는 드로잉 모드가 바뀔 때 `key`로 재마운트한다. `useDrawingPointer`가 들고 있는 포인터 소유권 Ref를 비우기 위해서다.

## 변경 시 확인 지점

- 새 카드 종류는 컬렉션 훅, 스냅샷 조립, 레이어 계산, Markdown 컴파일, `board-state` 스키마, SQLite 스키마를 함께 본다.
- `viewportRef`는 좌표 계산·패닝·Plus 미리보기 캡처가 공유한다. 다른 DOM으로 옮기면 셋의 기준이 동시에 바뀐다.
- `savePaused`에 조건을 더하면 Free의 자동 저장과 Plus의 서버 업로드가 같이 멈춘다.
