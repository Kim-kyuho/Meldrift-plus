# Meldrift 문서

Meldrift는 같은 보드 기능을 두 Edition으로 배포한다. 두 Edition이 공유하는 것과 각자 다른 것을 폴더로 갈라 둔다.

| 폴더 | 서술 대상 | 소스 위치 |
| --- | --- | --- |
| `shared/` | 두 Edition이 함께 쓰는 컴포넌트와 훅 | `packages/**` |
| `plus/` | Plus Edition 고유 화면과 서버 기능 | `apps/plus/**` |
| `free/` | Free Edition 고유 저장 구조와 화면 | `apps/free/**` |

## 소스 경로 표기

Meldrift는 npm workspace 모노레포라 문서에서 경로를 두 가지 형태로 쓴다.

- **앱이 소유한 코드**는 그 앱 기준 상대경로로 쓴다. `plus/` 문서의 `components/BoardClient.tsx`는 `apps/plus/components/BoardClient.tsx`를, `free/` 문서의 같은 표기는 `apps/free/components/BoardClient.tsx`를 가리킨다.
- **공유 코드**는 저장소 루트 기준 전체 경로로 쓴다. 예: `packages/ui/src/features/memo/MemoCard.tsx`

공유 패키지는 넷이다.

| 패키지 | 담는 것 |
| --- | --- |
| `@meldrift/core` | 프레임워크에 기대지 않는 규칙과 스키마 — 카드 타입, 메모 순서, 획 데이터, 표 소스, AI 보드 계획 |
| `@meldrift/ui` | 두 Edition이 함께 쓰는 React 컴포넌트와 훅 |
| `@meldrift/board-data` | 보드 데이터 — 브라우저 SQLite·IndexedDB, 스냅샷 타입과 검증, 변경분 모델, 이미지 변환, Markdown 컴파일 |
| `@meldrift/ai` | 어시스턴트 본체 — 도구 정의, Gemini 호출, 프롬프트 뼈대 |

`@meldrift/ui`는 보드 화면과 React 훅을 조립하고, `@meldrift/board-data`는 데이터·저장·변환을 제공한다. 의존 방향은 `ui → board-data → core`다.

두 Edition의 앱(`apps/free`, `apps/plus`)에 남은 것은 **껍데기와 저장 방식**뿐이다. 보드 화면은 양쪽이 같은 `BoardClient`를 쓴다.

## 두 Edition이 갈리는 지점

| 영역 | Plus | Free |
| --- | --- | --- |
| 저장소 | 브라우저 SQLite → Neon PostgreSQL에 스냅샷 파일로 업로드 | 브라우저 SQLite WASM, 워커에서 IndexedDB 스냅샷 |
| 저장 단위 | 보드 전체(SQLite 파일 한 장) | 같다 |
| 보드 수 | 여러 개, 소유자별 | 하나(`boardId = 1`) 고정 |
| 인증 | 세션 쿠키 로그인, 권한 플래그 | 없음. 카드 편집 권한 개념도 없다 |
| 이미지 | 브라우저에서 압축해 스냅샷 안 BLOB으로 저장 | 같다 |
| 반출 | Markdown 문서 | Markdown 문서 + `.sqlite` 세이브 파일 |
| AI 잠금 | 로그인 사용자 권한 | 서명 토큰 쿠키 + 비밀번호 |
| 보드 미리보기 | 있음(WebP를 Cloudinary에 업로드) | 없음 |
| 동시 편집 | 계정당 편집 탭 하나 | 해당 없음 |

Plus의 카드별 Route Handler와 Cloudinary 이미지 업로드는 [보드 스냅샷](./plus/board-snapshot.md)으로 대체됐다. 구버전 보드를 여는 마이그레이션 경로만 남아 있다.

## 어디서부터 읽나

| 알고 싶은 것 | 문서 |
| --- | --- |
| 보드 화면이 어떻게 조립되나 | [shared/board-client.md](./shared/board-client.md) |
| Plus가 어떻게 저장하나 | [plus/board-snapshot.md](./plus/board-snapshot.md) |
| Plus가 변경분만 어떻게 올리나 | [plus/change-sync.md](./plus/change-sync.md) |
| 브라우저 SQLite가 어떻게 도나 | [shared/browser-database.md](./shared/browser-database.md) |
| 보드 값의 형태와 검증 | [shared/board-state.md](./shared/board-state.md) |

## 그 밖의 문서

- `meldrift-basic-design.md`: 전체 동작과 아키텍처
- `snippets/`: 구현 패턴
- `DB/`: Plus 데이터베이스 스키마 참조
- `playwright-testing.md`: e2e 테스트 규약
