# AI 어시스턴트 상세설계

소스: `packages/ui/src/features/ai/AiAssistantButton.tsx`, `packages/ui/src/features/ai/AiChatPanel.tsx`, `packages/ui/src/features/ai/GeminiIcon.tsx`, `packages/ui/src/features/ai/useAiAssistant.ts`, `packages/core/src/board-plan.ts`, `lib/ai/assistant.ts`, `lib/ai/meldrift-guide.ts`, `app/api/ai/status/route.ts`, `app/api/ai/chat/route.ts`

## 역할

자연어 요청을 받아 다섯 가지 일을 한다. 보드를 바꾸는 네 가지는 모두 저장 여부를 사용자가 결정한다.

- **생성**: 메모와 선택적인 표·Mermaid·이미지 첨부 카드를 임시 카드로 만들어 보드에 올린다.
- **재배치**: 이미 보드에 있는 카드의 위치를 다시 잡는다. 내용은 바꾸지 않고 좌표만 바꾼다.
- **고치기**: 이미 있는 카드의 내용을 바꾼다. 좌표와 크기는 건드리지 않는다.
- **지우기**: 이미 있는 카드를 지운다. 저장 전까지는 화면에서만 사라진다.
- **사용법 안내**: Meldrift 조작법 질문에 함수 호출 없이 말로 답한다.

이미지 카드는 사용자가 그림을 **명시적으로 요청했을 때만** 만든다. 그냥 문서를 만들어 달라는 요청에는 붙이지 않는다.

## AiAssistantButton

| Prop | 타입 | 사용처 |
| --- | --- | --- |
| `aiPanelOpen` | `boolean` | 아이콘 활성색(`#ec4899`)과 `aria-pressed` |
| `onToggle` | `() => void` | `useAiAssistant.handleToggleAiPanel` |

`fixed right-5 top-17 z-50000`으로 보드 메뉴 Ellipsis 버튼 바로 아래에 놓는다. `BoardMenu` 드롭다운은 같은 위치의 `z-50001`이므로 메뉴가 열리면 AI 버튼 위에 표시된다. 채팅 패널도 `z-50000`이다.

lucide-react에는 Gemini 아이콘이 없어 `GeminiIcon`에 별 모양 심볼을 인라인 SVG로 둔다. `fill="currentColor"`라서 버튼의 text 색상을 따라간다.

## AiChatPanel

| Prop | 타입 | 사용처 |
| --- | --- | --- |
| `messages` | `AiChatMessage[]` | 말풍선 목록 |
| `sending` / `saving` | `boolean` | 입력 비활성화와 진행 표시 |
| `hasPendingCards` | `boolean` | Save/Discard 바 표시 조건 |
| `onSend` / `onSave` / `onDiscard` / `onClose` | 콜백 | 훅의 동일 이름 핸들러 |

- `fixed bottom-5 left-1/2 -translate-x-1/2`, 최대 높이 `60vh`.
- 로컬 state는 입력 초안 `draft` 하나다.
- `messages`나 `sending`이 바뀌면 목록을 맨 아래로 스크롤한다.
- 패널은 `.board-scroll-layer` 바깥에 렌더링되므로 카드 훅의 "빈 보드 클릭" 판정과 보드 패닝에 걸리지 않는다.

## `useAiAssistant` State

| State | 초기값 | 역할 |
| --- | --- | --- |
| `aiPanelOpen` | `false` | 채팅 패널 표시 |
| `aiStatus` | `null` | `null`은 미조회. `{available, message}` |
| `messages` | `[]` | 대화 기록. 서버에는 최근 20건만 보낸다 |
| `sending` / `saving` | `false` | 중복 요청 방지 |
| `pendingCards` | 빈 배열 3종 | 아직 저장하지 않은 AI 카드의 임시 ID |
| `pendingImageIds` | `[]` | 아직 업로드하지 않은 AI 이미지 카드의 임시 ID |
| `pendingMoves` | 빈 배열 3종 | 재배치 전후의 메모·Mermaid·표 좌표. Discard가 이전 좌표로 복원한다 |
| `pendingEdits` | 빈 배열 3종 | 고치기 전 카드 원본. Discard가 이 값으로 되돌린다 |
| `pendingDeletions` | 빈 배열 4종 | 지운 카드 원본. Discard가 그대로 되살린다 |

카드 컬렉션은 소유하지 않는다. 네 카드 컬렉션과 setter를 주입받고, 메모·Mermaid·표의 insert/update/delete 및 이미지 insert/delete 핸들러를 사용한다. 기존 이미지의 내용 수정과 재배치는 지원하지 않는다.

## API 키

키는 사용자가 등록하지 않는다. 서버 환경변수 `AI_API_KEY` 하나를 쓰며, 배포 환경에서는 Vercel 프로젝트 설정에 넣는다. 키는 서버에만 존재하고 클라이언트로 내려가지 않는다.

호출 비용이 서버 소유자에게 청구되므로 접근 게이트가 곧 비용 통제 수단이다. 채팅은 카드 편집과 같은 조건, 즉 로그인과 관리자 승인을 요구한다.

## 진입 판정 (`handleToggleAiPanel`)

1. 이미 열려 있으면 닫는다.
2. `canEditCard`가 false면 `showPermissionMessage()`로 거부한다.
3. `aiStatus`가 없으면 `GET /api/ai/status`로 한 번 조회한다.
4. 쓸 수 없으면 그 이유를 권한 메시지로 띄우고, 쓸 수 있으면 채팅 패널을 연다.

## 배치 원점

- 생성(`getPlanOrigin`): 기존 메모·Mermaid·표의 오른쪽 끝 최댓값 + `newColumnGap`(120)을 x로 잡는다. 기존 이미지의 오른쪽 끝은 이 계산에 포함하지 않는다. y는 현재 보이는 화면 상단 + 80이다.
- 재배치: 보드 전체를 다시 정리하므로 항상 보드 왼쪽 위(40, 40)에서 시작한다.

원점이 보드 밖을 가리켜도 `placeItems`가 보드 안으로 잘라 넣는다. 배치 후에는 첫 메모 위치로 `scrollTo`한다.

## 배치 방식 (`placeItems`)

모델이 `layout` 필드로 네 가지 중 하나를 고른다. 생략하면 `column`이다. 좌표는 어떤 방식에서도 모델이 정하지 않는다.

| layout | 흐름 | 쓰는 상황 |
| --- | --- | --- |
| `column` | 세로로 쌓다가 열이 차면 옆 열로 | 처음부터 끝까지 한 줄기로 읽는 문서 |
| `grid` | 좌에서 우로 채우고 줄바꿈 | 서로 대등한 항목 나열 |
| `tree` | 깊이를 x축, 형제를 y축 | 상위-하위 구조가 있는 설계 |
| `scatter` | grid 칸 안에서 무작위로 흔들기 | 순서·계층이 없는 브레인스토밍 |

### scatter

칸은 `grid`와 같이 잡고, 각 섹션을 **자기 칸 안에서만** 무작위로 옮긴다. 좌표를 완전히 무작위로 뽑고 겹치면 다시 뽑는 거부 샘플링과 달리 재시도가 없고 결과가 항상 유효하다.

- 지터 범위는 `min(칸 여유 - scatterMinGap(24), maxScatterJitter(120))`이다.
- 섹션이 칸을 벗어나지 않고 칸끼리 겹치지 않으므로 **메모끼리 겹칠 수 없다**. 첨부 카드도 마찬가지다.
- 칸 사이에 최소 `scatterMinGap`이 남으므로 카드가 맞닿지도 않는다.
- 지터가 칸 여유로 제한되니 "특정 간격 이내의 무작위"라는 성질이 자동으로 지켜진다.
- 난수는 `layoutBoardPlan`/`layoutArrangement`의 마지막 인자로 주입할 수 있다. 기본값은 `Math.random`이고, 테스트는 시드 고정 PRNG를 넣어 결과를 재현한다.

`tests/unit/ai-board-plan.test.ts`의 `scatter layout`이 60개 시드에 대해 메모 비겹침, 카드가 정확히 메모 하나에만 걸림, 보드 이탈 없음을 전수 검증한다.

`tree`는 각 섹션의 `parentIndex`로 상위 섹션을 가리킨다. **자기보다 앞선 인덱스만 부모로 인정**하므로 순환이 생길 수 없다. 앞을 가리키거나 자기 자신을 가리키면 최상위로 취급한다.

`tree`는 잎만 세로 자리를 소비하고 부모를 자식들의 가운데에 놓는다. 같은 깊이끼리 겹치면 아래로 밀어 분리한다. 덕분에 같은 섹션 수라도 `column`보다 세로를 덜 쓴다.

`grid`는 행 높이를 가장 큰 섹션에 맞춰 하나로 통일한다. 그래야 줄이 어긋나지 않고, 아래 줄 메모의 꼭짓점을 위 줄 첨부 카드가 덮지 않는다.

네 방식 모두 같은 두 불변식 위에서 동작한다.

- 가로 간격 `pitchX`가 (메모 폭 - 겹침 + 첨부 폭)보다 크다 → 첨부 카드가 옆 칸 메모에 닿지 않는다.
- `sectionGap > attachmentOverlap` → 첨부 카드가 위 칸 메모의 아래 꼭짓점에 닿지 않는다.

`tests/unit/ai-board-plan.test.ts`의 `layout modes`가 네 방식 각각에 대해 "카드 하나가 정확히 메모 하나에만 걸린다"와 "보드를 벗어나지 않는다"를 전수 검증한다.

## 보드 경계 (`placeItems`)

**카드를 보드 밖에 두지 않는다.** 한 열을 아래로 쌓다가 남은 높이가 부족하면 다음 열로 넘어가고, 열도 더 못 만들면 남은 섹션을 배치하지 않고 `droppedSections`로 돌려준다. 채팅 패널이 그 수를 사용자에게 알린다.

열 간격은 `가장 넓은 (메모 폭 - 겹침 + 첨부 폭) + columnGap`이다. 이 값이 첨부 카드의 오른쪽 끝보다 크므로 첨부 카드가 옆 열 메모의 꼭짓점에 닿지 않는다.

`getPlanCapacity(bounds)`는 보드에 들어갈 수 있는 섹션 수를 추정해 모델에게 상한으로 알려준다.

> 초기 구현에는 이 경계 처리가 없어 한 열로 계속 아래로만 쌓았고, 3840x2160 보드에서 카드가 y=3322까지 내려가 보드 밖에 배치되는 버그가 있었다. `tests/unit/ai-board-plan.test.ts`의 `layoutBoardPlan board bounds`가 이 회귀를 막는다.

## 고치기와 지우기

둘 다 **이미 저장된 카드(양수 ID)만** 대상이다. 스키마가 ID를 양수로 제한하므로 아직 저장되지 않은 임시 카드는 모델이 지목할 수 없다.

- 고치기는 부분 수정이 아니라 **전체 교체**다. 메모 본문을 바꿀 때 모델은 그 메모의 blocks 전체를 다시 보낸다. 일부만 보내면 나머지가 사라지므로 프롬프트에서 명시적으로 막는다.
- 고치기는 좌표와 크기를 건드리지 않는다. 사용자가 맞춰 둔 배치를 AI가 흔들지 않는다.
- 지우기는 저장 전까지 로컬 배열에서만 제거하고 원본을 `pendingDeletions`에 보관한다. Discard를 누르면 그대로 되살아난다.
- 저장 순서상 삭제는 내용 수정 뒤, 재배치 PATCH 앞에서 실행한다. 한 모델 응답에서 여러 함수가 오면 하나만 선택하므로 일반 흐름에서는 삭제와 재배치가 동시에 대기하지 않는다.
- 같은 카드를 연달아 고치면 `pendingEdits`는 맨 처음 값을 유지한다. Discard가 항상 AI가 손대기 전 상태로 돌아간다.
- 모델이 목록에 없는 ID를 지어내면 적용 단계에서 걸러지고 "찾지 못했습니다" 안내가 나간다.

## 이미지 생성

기본적으로 만들지 않는다. 사용자가 그림을 명시적으로 요청했을 때만 계획에 `image` 첨부가 붙는다.

1. 모델은 바이트를 만들 수 없으므로 `prompt`와 `alt`만 낸다.
2. 서버가 `assistantImageModels` 순서대로 이미지 모델을 호출해 base64를 받는다. 한 번에 최대 `maxGeneratedImages`(3)장이다.
3. 결과는 계획과 분리된 `GeneratedImage[]`로 내려가고, 섹션 인덱스로 다시 이어 붙는다.
4. 클라이언트가 base64를 `File`로 바꿔 임시 이미지 카드에 담는다. 미리보기는 수동 업로드와 같은 Object URL이다.
5. **압축과 스냅샷 반영은 저장을 눌렀을 때 일어난다.** Discard하면 아무것도 남지 않고 Object URL만 해제한다.

한 장이 실패해도 나머지는 살린다. 실패한 섹션은 첨부 없이 메모만 남고 채팅에 몇 장을 건너뛰었는지 알린다.

> 2026-08-17 실측: 무료 티어 키로는 이미지 모델이 429(quota exceeded)로 거절된다. 생성·게이팅·폴백 경로는 정상 동작하지만 실제 그림을 받으려면 결제가 설정된 계정이 필요하다.

## 사용법 안내

`lib/ai/meldrift-guide.ts`가 조작법을 사용자 관점으로 정리해 두고, 시스템 프롬프트 끝에 그대로 붙는다. 조작법 질문에는 함수를 호출하지 않고 이 내용을 근거로 답하게 하고, 여기 없는 기능은 없다고 답하도록 못박는다.

조작 방식이나 컴파일 규칙이 바뀌면 이 파일도 함께 고쳐야 한다. 코드와 자동으로 연결되지 않는다.

## 재배치 (`layoutArrangement`)

모델은 좌표가 아니라 `layout`과 `{ memoId, parentIndex?, attachment?: { type, cardId } }` 목록만 낸다. 좌표는 생성과 같은 `placeItems`가 정하므로 컴파일 접점 규칙이 그대로 지켜진다.

- 카드 크기는 사용자가 조절해 둔 현재 값을 그대로 쓰고 좌표만 바꾼다.
- 존재하지 않는 ID, 중복 ID는 조용히 건너뛴다. 이때 밀리는 인덱스에 맞춰 `parentIndex`를 다시 매핑하고, 부모가 걸러졌으면 최상위로 올린다.
- 이미 저장된 카드를 움직이므로 이전 좌표를 `pendingMoves`에 남긴다. Discard를 누르면 원래 자리로 되돌린다.
- 저장 시에는 INSERT가 아니라 각 카드의 PATCH로 좌표만 갱신한다.

**재배치로 문서 순서는 바꿀 수 없다.** Markdown 컴파일이 메모를 `sort_order ASC`로 정렬하는데 재배치는 좌표만 건드리기 때문에, 메모를 공간적으로 옮겨도 문서 순서는 그대로다. 재배치가 바꿀 수 있는 것은 표·다이어그램이 어느 메모에 붙는지와 보드 정돈 상태뿐이다. 문서 순서는 `MemoReorderPanel`에서만 바꾼다.

## 보드 스냅샷

재배치 대상을 모델이 고르려면 현재 보드에 무엇이 있는지 알아야 한다. 클라이언트가 저장된 카드(양수 ID)만 골라 ID와 요약을 만들어 `POST /api/ai/chat`에 함께 보낸다. 메모 요약은 HTML 태그를 제거한 앞부분이다. 서버는 이 목록을 신뢰하지 않고 형태와 길이만 검사한 뒤 시스템 프롬프트에 붙인다.

## 임시 ID

`-Date.now()`에서 시작해 1씩 **증가**시킨다. 기존 카드 생성 흐름과 달리 여러 장을 한 번에 만들기 때문에 값이 겹치면 안 된다. 저장 전 화면 순서는 임시 `sortOrder`가 정한다 — 보드의 `MAX(sortOrder) + 1`에서 시작해 섹션 순서대로 1씩 증가시킨다.

## 저장 (`handleSavePendingCards`)

실제 저장 순서는 다음과 같다.

1. 메모를 계획 순서대로 하나씩 INSERT
2. Mermaid, 표, 이미지 INSERT
3. 메모, Mermaid, 표 내용 UPDATE
4. 메모, Mermaid, 표, 이미지 DELETE
5. 메모, Mermaid, 표 좌표 UPDATE

서버가 INSERT마다 `MAX(sort_order) + 1`을 매기고 그 `sort_order`가 곧 Markdown 문서 순서이므로 메모 INSERT는 병렬 처리하지 않는다. 각 단계에서 호출하는 컬렉션 훅이 API 오류 메시지와 로컬 상태 교체를 담당한다.

## 서버 계약

| 경로 | 동작 |
| --- | --- |
| `GET /api/ai/status` | 서버에 키가 설정됐는지와 이 사용자가 쓸 수 있는지. 키 값은 다루지 않는다 |
| `POST /api/ai/chat` | 권한 확인 → 키 존재 확인 → 스냅샷 검사 → 모델 호출(폴백 포함) → 답변과 선택된 `plan`, `arrangement`, `edit`, `deletion` 중 하나 및 생성 이미지 반환 |

`POST /api/ai/chat`은 DB에 카드를 쓰지 않는다. 서버에 `AI_API_KEY`가 없거나 모든 모델이 혼잡하면 503으로 응답한다.

카드를 여러 장 만드는 응답은 20초를 넘기기도 해서 `export const maxDuration = 60`을 둔다. 기본 타임아웃으로는 배포 환경에서 잘린다.

## 모델 호출 (`lib/ai/assistant.ts`)

- 공급자는 Google Gemini(`@google/genai`)다.
- 모델은 `assistantModels` 순서대로 시도해 첫 성공을 쓴다. 기본 순서는 `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.7-flash` → `gemini-flash-latest`다. 최신 모델일수록 무료 티어 할당량이 작아 429가 먼저 나므로, 최신순이 아니라 할당량이 여유로운 순으로 둔다.
- `GEMINI_MODEL`을 지정하면 그 모델을 맨 앞에 두고, 나머지는 폴백으로 남긴다.
- 429·500·503·NOT_FOUND는 다음 모델로 넘어간다. 그 외 오류(잘못된 요청 등)는 재시도해도 같으므로 즉시 던진다.
- 모든 모델이 실패하면 `AssistantUnavailableError`를 던지고 라우트가 503과 안내 문구로 응답한다.
- 함수 선언은 `create_board_cards`, `rearrange_board_cards`, `edit_board_cards`, `delete_board_cards` 넷이고, 스키마는 `parametersJsonSchema`로 일반 JSON Schema를 그대로 넘긴다.
- 여러 함수가 동시에 호출되면 파괴적인 순서로 하나만 고른다. 지우기 > 고치기 > 재배치 > 생성.
- Gemini는 어시스턴트 역할을 `model`로 부르므로 `toGeminiContents`가 역할 이름을 변환한다.
- 함수 호출이 없으면 계획 없이 답변만 반환한다.
- 함수 인자는 종류에 따라 `boardPlanSchema`, `boardArrangementSchema`, `boardEditSchema`, `boardDeletionSchema`로 다시 검증한다. JSON Schema를 통과해도 모델 출력은 신뢰하지 않는다.

## 알려진 특이사항

- 대화 기록은 컴포넌트 state에만 있고 저장하지 않는다. 새로고침하면 사라진다.
- 새 보드 변경 응답(`plan`, `arrangement`, `edit`, `deletion`)이 오면 이전 미저장 변경을 먼저 원복한다. 한 번에 하나의 제안만 보드에 남는다.
- 저장 도중 일부 INSERT가 실패하면 성공한 카드는 남는다. 실패 메시지는 각 컬렉션 훅이 표시한다.
- 호출 횟수 제한이 없다. 승인된 사용자가 여러 명이 되면 요청 제한을 함께 검토해야 한다.
- 혼잡(503)은 모델과 시간대에 따라 다르다. 실측으로 순서를 정하고, 폴백 목록을 항상 함께 둔다.
- 이미지 생성 쿼터는 대화 모델과 별개다. 대화가 되는 키라도 그림은 429가 날 수 있다.
