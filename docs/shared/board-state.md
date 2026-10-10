# 보드 상태와 검증 상세설계

소스: `packages/board-data/src/board-state.ts`

## 목적

보드 하나를 통째로 담는 값(`BoardSnapshot`)을 정의하고, 그 값이 SQLite와 화면 사이를 오갈 때마다 zod로 검증한다. 세이브 파일과 업로드된 스냅샷은 사용자가 손댈 수 있으므로 신뢰하지 않는다.

두 Edition이 같은 타입과 같은 검증을 쓴다. Free는 보드가 하나뿐이고 Plus는 여럿이라는 것만 다르다.

## 고정값

| 이름 | 값 | 의미 |
| --- | --- | --- |
| `defaultBoardId` | `1` | Free가 쓰는 보드 id. Plus는 서버가 발급한 id를 쓴다 |
| `schemaVersion` | `3` | 브라우저 DB의 `PRAGMA user_version` |
| `defaultBoard` | `{ 1, "Meldrift Free Edition", 4000, 3000 }` | Free 초기화 시 넣는 보드 |

## 타입

| 타입 | 정의 |
| --- | --- |
| `BoardInfo` | `boardId`, `title`, `width`, `height` |
| `BoardMemo` | `@meldrift/core`의 `MemoCardData` 그대로 |
| `BoardMermaid` | `@meldrift/core`의 `MermaidCardData` 그대로 |
| `BoardTable` | `@meldrift/core`의 `TableCardData` 그대로 |
| `BoardImage` | 보드 고유 — 아래 참조 |
| `BoardSnapshot` | `board` + `memos`/`images`/`mermaids`/`tables`/`strokes` |

메모·머메이드·표는 코어 타입을 그대로 쓴다. 이미지만 따로 정의한다.

```text
BoardImage = imageId, boardId, url, data, mimeType, label, x, y, z, width, height
```

`data`는 압축된 이미지 바이트(`Uint8Array`)이고 `mimeType`이 그 형식이다. `url`은 Cloudinary에 올려 두었던 Plus 구버전 이미지를 위한 자리이며, 스냅샷으로 옮겨진 뒤에는 빈 문자열이 된다.

## 검증 규칙

좌표는 정수, 크기는 양의 정수다. `boardId`도 양의 정수다. 보드 id를 고정하는 대신 **카드의 `boardId`가 스냅샷의 보드와 같은지**를 본다. 다른 보드의 카드가 섞여 들어오면 거부된다. 같은 검사가 서버의 스냅샷 수신부에도 한 번 더 있다.

| 대상 | 규칙 |
| --- | --- |
| `board.title` | 공백을 제외하고 1자 이상 |
| `memo.sortOrder` | 양의 정수 (0 이하 불가) |
| `memo.color` | 1자 이상 |
| `mermaid.source` | 공백 제외 1자 이상 |
| `table.source` | `@meldrift/core`의 `tableSourceSchema` |
| `strokes` | `@meldrift/core`의 `boardStrokesSchema` |

## 이미지의 두 가지 모드

`imageSchema`는 `superRefine`으로 **로컬 바이트**와 **구버전 URL** 둘 중 하나만 성립하도록 강제한다.

`data`가 있으면 로컬 바이트 모드다.

- `url`이 빈 문자열이어야 한다
- 바이트가 1 이상 `maxStoredImageBytes`(5 MiB) 이하여야 한다
- `mimeType`이 `supportedImageMimeTypes` 안에 있어야 한다

`data`가 없으면 구버전 URL 모드다.

- `url`이 `http:` 또는 `https:`로 파싱되어야 한다
- `mimeType`이 `null`이어야 한다

두 조건을 섞은 값(예: 바이트와 URL을 동시에 가진 행)은 어느 쪽으로도 통과하지 못한다.

## 함수

| 함수 | 동작 |
| --- | --- |
| `createEmptyBoardSnapshot()` | 기본 보드 하나에 카드·획이 전부 빈 스냅샷 |
| `parseBoardSnapshot(value)` | 통과하면 검증된 스냅샷, 실패하면 `The SQLite file contains invalid Meldrift Free Edition data.` |
| `nextPositiveId(ids)` | 양수 id 중 최댓값 + 1. 비어 있으면 1 |

`parseBoardSnapshot`은 실패 이유를 문구에 담지 않는다. 호출부는 워커의 읽기·쓰기·불러오기 세 곳과, Plus 서버가 업로드된 스냅샷을 해독하는 `decodeSnapshot`이다.
