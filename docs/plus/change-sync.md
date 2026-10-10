# 변경분 동기화 상세설계

소스: `packages/board-data/src/board-delta.ts`, `packages/board-data/src/browser-db/worker.ts`, `lib/change-sync.ts`, `lib/sync-operations.ts`, `lib/sync-commit.ts`, `lib/editor-guard.ts`, `lib/assets.ts`, `lib/asset-upload.ts`, `lib/asset-download.ts`, `lib/board-transition.ts`, `lib/board-state-store.ts`, `hooks/useBoardSnapshot.ts`, `app/api/boards/[boardId]/state/route.ts`, `app/api/boards/[boardId]/changes/route.ts`, `app/api/boards/[boardId]/uploads/**`, `app/api/boards/[boardId]/assets/**`, `app/api/boards/[boardId]/transition/route.ts`

## 무엇이 바뀌나

[보드 스냅샷](./board-snapshot.md)은 보드 전체를 SQLite 파일 한 장으로 PUT한다. 좌표 하나만 바뀌어도 이미지까지 다시 올라가고, 보드가 4 MiB를 넘으면 저장 자체가 멈춘다. 변경분 동기화는 **바뀐 객체의 바뀐 필드만** 올린다.

```text
공통 편집 → 공통 로컬 저장
             ├─ Free: 완료
             └─ Plus: 변경분 서버 동기화
```

편집과 로컬 저장은 두 에디션이 같은 코드를 쓴다. Plus만 그 뒤에 전송 계층을 하나 더 붙인다.

## 동기화 식별자

숫자 PK는 서버가 발급하므로 브라우저가 만든 카드를 서버에서 다시 찾을 수 없다. 그래서 카드와 획마다 불변 `syncId`를 둔다. 서버는 `boardId + 종류 + syncId`로 대상을 고른다.

| 경로 | 값 |
| --- | --- |
| 새 카드 | `createSyncId()` (UUID) |
| SQLite v3→v4 마이그레이션 | `'memo-' || id` |
| 스냅샷 읽기 중 값이 비었을 때 | `fallbackSyncId(kind, id)` |
| Postgres 0003 마이그레이션 | `'memo-' || "id"` |

이미지 바이너리에는 `assetId`가 하나 더 붙는다. SQLite v5 마이그레이션과 `readSnapshot` 폴백이 모두 `'asset-' || image_id`를 쓴다.

**네 경로가 같은 카드에 같은 값을 내야 한다.** 어긋나면 브라우저로 이전한 보드와 서버로 이전한 보드가 서로 다른 카드를 갖는다.

## 로컬 변경 큐

워커는 로컬 저장마다 직전 스냅샷과 새 스냅샷을 `diffBoardSnapshots`로 비교해 연산 목록을 만들고, 카드 데이터와 같은 SQLite 파일 안의 `outbox` 테이블에 넣는다. 둘이 같은 파일이므로 IndexedDB에 한 번 저장되고, 데이터만 저장되거나 큐만 저장되는 상태가 없다.

| 요청 | 하는 일 |
| --- | --- |
| `outbox` | 미전송(`pending`)과 전송 중(`claimed`)을 함께 읽는다 |
| `claimOutbox(limit)` | 앞에서 `limit`개를 전송 중으로 표시하고 claim 번호와 `mutationId`를 발급한다 |
| `releaseOutbox(claim)` | 전송 중을 다시 미전송으로 되돌린다 |
| `clearOutbox(claim)` | 서버가 받은 묶음을 지운다 |
| `commitOutbox(claim, generation, revision)` | 묶음을 지우고 새 판 번호까지 한 요청에 기록한다 |

전송 중인 묶음은 불변이다. 전송 도중 생긴 편집은 `pending`에 남아 다음 묶음이 된다.

큐를 비우는 것과 판 번호를 올리는 것이 두 요청이면 그 사이에 탭이 닫혔을 때 큐는 비었는데 판 번호는 옛것인 로컬이 남는다. 다음에 열면 그 보드는 충돌로 보인다. `commitOutbox`는 둘을 한 요청 안에서 끝내고 IndexedDB에도 한 번만 저장한다.

비교는 전부 **값**으로 한다. 이미지 바이트를 다시 올릴지는 `assetId` 값이 정하고, 표의 `source`와 획의 `points`는 객체를 새로 만들어도 내용이 같으면 같은 것으로 본다. 참조로 비교하면 새로고침 한 번에 보드 전체가 변경으로 잡힌다.

## 전송 (`lib/change-sync.ts`)

`SnapshotSync`와 같은 모양이다. 3초 디바운스, 10초 재시도, 같은 `SyncStatus` 어휘. 보내는 내용만 다르다.

`mutationId`는 claim할 때 워커가 `crypto.randomUUID()`로 발급해 `outbox.mutation_id`에 적는다. 값이 SQLite 행에 있으므로 브라우저를 껐다 켜도 같은 묶음은 같은 `mutationId`로 나간다. 응답을 못 받은 요청이 실제로는 서버에 닿았더라도 재시도가 중복 적용되지 않는다.

**탭 id에서 유도하지 않는다.** 다음에 열 때는 탭 id가 달라서 같은 값을 다시 만들 수 없고, 서버에 그 묶음이 들어갔는지 물어볼 손잡이가 사라진다.

한 묶음은 연산 **개수**로 자른다. 상한은 `maxStagedOperations`(2000)다. 직렬화한 결과가 본문 한도(`maxChangeBytes` 1 MiB에서 봉투 몫을 뺀 값)에 들어가면 그대로 본문에 싣고, 넘으면 `application/json` 자산으로 먼저 올린 뒤 `staged: true`만 보낸다. 자산 id가 곧 그 묶음의 `mutationId`다.

바이트로 자르지 않는 이유는 연산 하나가 그 자체로 한도를 넘을 수 있기 때문이다. 큰 표 하나를 고친 변경도 자를 곳이 없어 통째로 스테이징 경로로 나간다. 0개를 claim하면 큐가 영원히 멈춘다.

400·401·403·404·409·413은 재시도하지 않고 `blocked`으로 멈추며, **묶음은 붙들고 있는다.** 놓으면 다음 저장 때 새 변경과 합쳐져 본문이 달라지고, 원래 요청이 서버에 닿았던 경우 중복 적용이 된다.

## 서버 검증 (`lib/sync-operations.ts`)

요청은 종류마다 허용 필드가 정해져 있다. 테이블명·컬럼명·SQL은 요청에서 오지 않는다.

- 모르는 필드, 타입 불일치 → 거절
- 생성인데 필드가 빠졌으면 → 거절
- 삭제인데 필드가 붙어 있으면 → 거절
- 아무것도 바꾸지 않는 갱신 → 거절
- 이미지가 아닌데 `asset` → 거절
- 한 요청에 같은 카드가 두 번 → 거절

`changeFieldSchemas`의 키가 `boardOperationFields`와 어긋나면 테스트가 깨진다. 비교 로직과 서버 검증이 다른 필드를 알면 변경이 조용히 사라진다.

## 커밋 (`lib/sync-commit.ts`)

`drizzle-orm/neon-http`는 대화형 트랜잭션을 못 쓴다. `db.batch()`는 쓸 수 있고, 그것은 실제로 하나의 Postgres 트랜잭션이다. 대신 중간 결과를 보고 분기할 수 없으므로, 모든 문장이 **같은 조건**을 직접 들고 간다.

```text
1. board_sync 행을 만들고 잠근다      INSERT ... ON CONFLICT DO UPDATE
2. 카드 문장들                        조건: revision = baseRevision AND 살아 있는 세션 AND 미적용 mutationId
3. 판 번호 증가 + mutation 기록        같은 조건, 한 문장(CTE)
```

조건이 참이면 전부 반영되고, 거짓이면 전부 아무 행도 건드리지 않는다. 조건을 이루는 값을 바꾸는 문장이 마지막 하나뿐이므로 **앞 문장이 뒤 문장의 조건을 흔들지 않는다.** 순서를 바꾸면 이 성질이 깨진다.

1번이 행을 잠그기 때문에 같은 보드로 동시에 들어온 두 요청은 여기서 줄을 선다. 뒤선 쪽은 앞선 쪽이 커밋한 뒤 판 번호가 이미 올라간 것을 보고 조건이 거짓이 되어, 카드 문장까지 전부 무효가 된다.

카드 생성은 `ON CONFLICT (board_id, sync_id) DO UPDATE`다. 응답을 못 받은 생성을 재전송해도 카드가 둘로 늘지 않는다.

### 응답

| 상황 | 응답 |
| --- | --- |
| 커밋 성공 | `200 { ok: true, revision }` |
| 같은 `mutationId`·같은 digest가 이미 적용됨 | `200 { ok: true, revision }` (그때의 판 번호) |
| 같은 `mutationId`·다른 digest | `409` |
| 판 번호·세션이 어긋남 | `409` |

마지막 문장이 행을 돌려주지 않았을 때만 `sync_mutations`를 다시 읽어 재전송과 충돌을 가른다. 정상 경로는 왕복이 한 번이다.

## 이미지 바이너리

이미지 카드는 위치·크기·`assetId`만 커밋에 싣는다. 바이트는 자산으로 따로 올린다.

`assetId`는 **바이너리를 가리키는 불변 손잡이**다. 새 바이트가 들어오면 새 `assetId`가 붙고, 기존 값은 다시 쓰이지 않는다. 그래서 변경 비교가 좌표를 저장할 때마다 이미지 전체를 다시 해시할 필요가 없고, 새로고침으로 `Uint8Array` 객체가 바뀌어도 같은 이미지로 인식한다.

```text
이미지 추가 → 로컬 저장 → 3초
        ↓
POST   /uploads                    자산 시작. 이미 있으면 complete로 끝
PUT    /uploads/:id/chunks/:index  1 MiB씩, 청크마다 체크섬
POST   /uploads/:id/complete       개수·연속성·총길이·해시 검증 후 자산 확정
        ↓
POST   /changes                    카드가 assetId를 가리킨다
```

- 자산 하나씩, 청크 하나씩 순서대로 올린다. 3초 안에 두 장이 들어와도 한 요청에 합치지 않는다.
- 자산 하나의 상한은 그 자산이 무엇이냐로 정한다. 이미지는 `maxStoredImageBytes`(5 MiB), 스테이징한 묶음은 `maxStagedChangeBytes`(4 MiB)다. **보드 전체 상한인 `maxSnapshotBytes`를 여기에 빌려 쓰지 않는다.** 한 장씩 올리는 경로에 보드 상한을 걸면 브라우저가 저장할 수 있는 이미지를 서버가 거절한다.
- 거절 응답은 어긋난 필드와 그 규칙을 말한다. 요청 내용은 싣지 않는다.
- 청크는 확정 전에도 `asset_chunks`에 그대로 쌓인다. 중단된 업로드는 받은 청크 다음부터 이어 간다.
- 검증은 전부 DB에서 한다. 완성한 바이너리를 클라이언트로 되돌려 보내지 않는다.
- 커밋 라우트는 묶음을 만들기 전에 참조된 자산이 모두 확정됐는지 먼저 본다. 이 검사를 문장 하나의 조건으로 넣으면 그 카드만 빠지고 나머지는 반영되어 묶음이 쪼개진다.
- 좌표나 크기만 바뀐 이미지는 `assetId`가 그대로이므로 업로드 요청이 아예 생기지 않는다.

## 저장 방식은 보드마다 하나뿐이다

`board_sync.mode`가 그 보드를 어느 쪽이 쓰는지 정한다.

| mode | 쓰는 쪽 | 읽는 원본 |
| --- | --- | --- |
| `snapshot` | `PUT /snapshot` | `board_snapshots`, 없으면 카드 테이블 |
| `migrating` | 아무도 못 쓴다 | — |
| `delta` | `POST /changes` | 카드 테이블 |

판정은 **쓰기 문장 안에** 있다. 스냅샷 PUT은 `NOT EXISTS (... mode <> 'snapshot')`을, 변경분 커밋은 `s.mode = 'delta'`를 조건에 달고 간다. 확인과 반영 사이에 mode가 바뀌어도 둘이 같은 보드를 함께 건드리지 못한다.

`GET /snapshot`은 `X-Storage-Mode`를 항상 붙인다. 클라이언트는 그걸 보고 `SnapshotSync`와 `ChangeSync` 중 하나를 만든다.

## 전환 (`lib/board-transition.ts`)

관리자가 `POST /api/boards/:boardId/transition`으로 보드 하나씩 옮긴다.

```text
1. mode를 migrating으로 → 두 저장 경로 모두 이 보드에서 막힌다
2. 원본을 고른다          board_snapshots가 있으면 그것, 없으면 카드 테이블
3. 스냅샷이 원본이면       카드 테이블을 스냅샷 내용으로 교체하고 이미지를 자산으로 쓴다
4. 확인                  카드 종류별 개수, 자산의 선언 해시·저장 바이트 해시·길이
5. mode를 delta로
```

- 새 serial id는 서버가 발급한다. 스냅샷의 로컬 id를 서버 PK로 강요하지 않는다.
- 획은 한 행씩 넣어 `seq`가 배열 순서를 따르게 한다.
- **확인에 실패하면 mode는 `migrating`으로 남는다.** 반쯤 옮긴 보드에 아무도 쓰지 못하는 상태가 실패의 기본값이다.
- 이미 `delta`인 보드는 거절한다. 새 방식으로 저장한 뒤 과거 스냅샷으로 되돌리는 경로를 만들지 않는다.
- 전환 후에도 `board_snapshots` 행은 그대로 남는다. `GET /snapshot`은 그 바이트를 더 이상 내려주지 않는다.

## 보드 열기

```text
GET /snapshot  → X-Storage-Mode
  snapshot  → 기존 경로 (SQLite 바이트 또는 카드 테이블 JSON) + SnapshotSync
  migrating → 잠시 뒤 다시 열라고 알린다
  delta     → GET /state + 자산 내려받기 + ChangeSync
```

판단하기 전에, 전송 중(`claimed`)으로 남은 묶음이 있고 판 번호가 서버와 다르면 `GET /changes?mutationId=`로 그 묶음의 운명을 먼저 확인한다. 이미 반영돼 있으면 `commitOutbox`로 로컬을 그 판 번호에 맞춘다. **이 확인이 없으면 응답만 놓친 전송이 전부 충돌로 보인다.**

그 뒤 로컬을 그대로 쓸지 서버 것으로 채울지는 큐와 판 번호가 정한다.

| 로컬 상태 | 하는 일 |
| --- | --- |
| 큐에 남은 변경이 있고 판 번호가 같다 | 로컬을 쓴다 |
| 큐에 남은 변경이 있고 판 번호가 다르다 | 충돌로 멈추고 로컬 백업 내려받기를 안내한다 |
| 큐가 비었고 `seeded`이며 판 번호가 같다 | 로컬을 쓴다 |
| 그 밖 | 서버 상태로 로컬을 교체한다 |

판 번호가 같다는 것만으로는 로컬을 믿을 수 없다. 서버 상태를 한 번도 받지 않은 로컬도 판 번호가 우연히 같을 수 있고, 그대로 열면 빈 보드로 서버를 덮어쓴다. `seeded`가 그 구분을 명시한다.

교체는 `seed`다. 카드를 바꾸고 `outbox`와 `outbox_assets`를 비우고 `seeded`를 세운 뒤 한 번 저장한다. 세이브 파일 불러오기와 같은 함수(`adoptSnapshot`)를 쓴다. **서버에서 받은 내용은 사용자 편집이 아니므로 큐를 만들지 않는다.**

이미지 바이트는 로컬에 있으면 그대로 쓰고, 없으면 자산 청크를 받아 이어 붙인다. 길이와 해시가 맞지 않으면 쓰지 않는다. 자산은 불변이라 한 번 받으면 다시 받지 않는다.

## 서버 저장 구조

| 테이블 | 역할 |
| --- | --- |
| `board_sync` | 보드별 `revision`, 저장 형식 버전 |
| `sync_mutations` | `(board_id, mutation_id)` PK, 요청 digest와 커밋 당시 판 번호 |
| `memos`/`mermaids`/`tables`/`images` | `sync_id` 컬럼과 `(board_id, sync_id)` 유니크 인덱스 |
| `assets` | 확정된 불변 자산의 해시·길이·타입·청크 수. 이미지 바이트와 스테이징한 변경 묶음이 같은 테이블을 쓴다 |
| `asset_chunks` | `(board_id, asset_id, chunk_index)` PK, 1 MiB 바이너리 |
| `upload_sessions` | 진행 중인 업로드의 계정·보드·선언된 모양·만료 시각 |
| `drawing_strokes` | 획 하나가 한 행. `(board_id, sync_id)` PK, `seq`가 그리는 순서 |
| `board_sync.mode` | 그 보드를 어느 저장 방식이 쓰는지 |

`sync_id`에 DB 기본값을 두지 않았다. 값을 빠뜨린 삽입은 조용히 정체불명의 카드를 만드는 대신 실패해야 한다.

## 획 순서

변경분에는 순서 필드가 없다. 로컬에서는 배열 순서가 곧 그리는 순서인데 그 정보는 연산에 실리지 않는다.

그래서 서버가 `drawing_strokes.seq`(bigserial)로 **받은 순서**를 기록한다. 커밋 묶음의 문장은 순서대로 실행되고 변경 비교는 배열 순서로 연산을 만들므로, 새로 그린 획은 로컬 순서 그대로 seq를 받는다. 읽을 때는 `ORDER BY seq`다.

정확하지 않은 경우가 하나 있다. 지우개가 획 하나를 여러 조각으로 나누면 첫 조각은 원래 seq를 유지하고 나머지 조각은 새 seq를 받아 맨 뒤로 간다. 조각들은 같은 색·두께의 서로 겹치지 않는 선분이라 겹침 순서가 눈에 띄지 않는다.

## 아직 아닌 것

- 만료된 업로드 세션과 아무 카드도 가리키지 않는 자산을 회수하는 정리 작업이 없다. 끝내 성공하지 못한 커밋이 남긴 스테이징 묶음도 여기에 섞인다.
- `sync_mutations`도 계속 쌓인다. `created_at` 인덱스만 있다.
- `drawings` 테이블은 그대로 남아 있다. 읽지도 쓰지도 않지만 지우지 않았다.
- 전환은 관리자가 보드마다 직접 부른다. 한 번에 도는 작업은 없다.
- `GET /state`의 페이지 분할은 응답 크기가 실제로 문제가 될 때 넣는다.
- 한 번에 2000개를 넘는 편집(대량 가져오기)은 여러 커밋으로 쪼개진다. 중간에 멈추면 절반만 올라간 보드가 남는다.
- `outbox_assets` 보관과 `seed`·`commitOutbox`의 원자성은 자동 테스트가 없다. 워커가 sqlite-wasm을 필요로 해서 유닛 테스트로 덮지 못했다.
- 아직 전환하지 않은 보드의 Neon 카드 테이블은 스냅샷 전환 이후로 갱신되지 않은 낡은 행이다. 0003의 `sync_id` 백필도 그 행에 붙는다. 전환이 `board_snapshots`를 원본으로 그것을 덮어쓴다.
