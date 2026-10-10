# AI 어시스턴트 상세설계 (Free)

소스: `lib/ai/assistant.ts`, `lib/ai/meldrift-guide.ts`, `app/api/ai/chat/route.ts`, `packages/ui/src/features/ai/useAiAssistant.ts`, `packages/ui/src/features/ai/AiChatPanel.tsx`, `packages/ui/src/features/ai/AiUnlockPanel.tsx`

어시스턴트 본체 — 도구 정의, Gemini 호출, 모델 폴백, 프롬프트 뼈대 — 는 `@meldrift/ai/assistant`가 가진다. 보드 계획 계산은 `packages/core/src/board-plan.ts`다. 잠금 자체는 [AI 잠금 상세설계](./ai-unlock.md)에 있다. 아래는 Free만 다른 부분이다.

## Plus와 갈리는 지점

| | Plus | Free |
| --- | --- | --- |
| 접근 제어 | 로그인 사용자와 권한 | 공유 비밀번호 + 서명 토큰 쿠키 |
| 이미지 생성 | 지원 | 지원하지 않음 |
| 저장 | 승인 시 카드별 API 호출 | 승인 시 로컬 상태만. 스냅샷 자동 저장에 실림 |
| 채팅 헤더 | 닫기 | 잠그기 + 닫기 |

## Edition 문구 (`lib/ai/assistant.ts`)

39줄짜리 얇은 파일이다. `AssistantProduct` 하나를 만들어 `runBoardAssistant`에 넘기고, 본체의 타입과 도구 이름을 다시 내보낸다.

| 필드 | 내용 |
| --- | --- |
| `intro` | Free Edition은 보드가 하나, 로그인이 없고, 데이터가 브라우저 SQLite에 있다고 알린다 |
| `imageRules` | AI로 그림을 만들 수 없다고 못박는다. 다이어그램이면 Mermaid를, 그림이면 카메라 버튼으로 로컬 파일을 고르라고 안내하게 한다 |
| `usageRules` | 사용법 질문에는 함수를 호출하지 말고 아래 가이드를 근거로 말로 답하게 한다 |
| `guide` | `meldrift-guide.ts`의 조작법 문서 |

무료 등급 API로는 이미지 생성이 불가능하다. 그래서 이미지 카드는 어시스턴트가 **지우기 대상으로만** 다룬다.

`meldrift-guide.ts`는 Plus의 같은 파일과 내용이 다르다. 세이브 파일 백업처럼 Free에만 있는 조작이 들어가고, 보드 목록처럼 Free에 없는 조작이 빠진다.

## `POST /api/ai/chat`

`maxDuration = 60`이다. 카드를 여러 장 만들면 모델 응답이 20초를 넘기도 해서 기본 타임아웃으로는 잘린다.

| 순서 | 검사 | 실패 응답 |
| --- | --- | --- |
| 1 | 세션 쿠키의 토큰이 유효한가 | 401 + `locked: true` |
| 2 | `AI_API_KEY`가 있는가 | 503 |
| 3 | `messages`가 1개 이상 20개 이하이고 모두 형식에 맞는가 | 400 |

요금이 서버 주인에게 청구되므로 **요청마다 쿠키를 다시 확인한다.** 잠금은 상태가 아니라 매 요청의 검사다.

메시지 하나는 `role`이 `user`/`assistant`이고 `content`가 1자 이상 4000자 이하여야 한다.

### 스냅샷 정규화

클라이언트가 보낸 보드 요약을 신뢰하지 않는다. `toSnapshotCards`가 배열이 아니면 빈 배열로 만들고, 앞에서 200개만 취하고, `{ id: 정수, summary: 문자열 }` 형태만 남기고, `summary`를 120자로 자른다.

`capacity`는 정수일 때만 받고 0~64로 자른다.

응답은 `reply`와 함께 `plan`·`arrangement`·`edit`·`deletion` 네 제안을 그대로 돌려준다. `AssistantUnavailableError`는 503, 나머지 예외는 500이다.

## `useAiAssistant`의 잠금 흐름

| 상태 | 역할 |
| --- | --- |
| `unlocked` | 서버가 확인해 준 잠금 해제 여부 |
| `unlocking` | 해제 요청 진행 중 |
| `unlockError` | 해제 실패 문구 |

쿠키가 `HttpOnly`라 브라우저 JS가 읽을 수 없다. 그래서 상태는 항상 서버에 묻는다.

1. 어시스턴트 버튼을 누르면 `GET /api/ai/status`로 `configured`/`unlocked`를 확인한다.
2. `configured`가 아니면 보드 메시지로 안내하고 끝낸다.
3. `unlocked`가 아니면 `AiUnlockPanel`을 띄운다.
4. 비밀번호를 받으면 `POST /api/ai/unlock`을 호출하고 성공 시 `unlocked`를 세운다.
5. 채팅 중 `POST /api/ai/chat`이 `locked: true`로 401을 주면 `unlocked`를 내리고 `The assistant was locked again. Enter the password to continue.`를 띄운다.
6. 잠그기 버튼은 `DELETE /api/ai/unlock`으로 쿠키를 비우고 `unlocked`를 내린다.

## `AiChatPanel`

Plus의 같은 컴포넌트에 `onLock` prop과 자물쇠 버튼이 추가된 형태다. 헤더에 잠그기(`Lock the assistant and clear this conversation`)와 닫기 두 버튼이 있다.

미저장 제안이 남아 있을 때의 안내 문구도 다르다.

| | 문구 |
| --- | --- |
| Plus | `You have unsaved changes.` |
| Free | `The board stops saving until you decide.` |

Free는 AI 제안이 남아 있는 동안 **자동 저장 자체가 멈춘다.** 임시 카드가 음수 id라 스키마 검증에 걸리기 때문이다. 문구가 그 동작을 그대로 알린다.
