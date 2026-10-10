# 보드 반출입 상세설계

소스: `hooks/useBoardTransfer.ts`, `packages/board-data/src/browser-db/client.ts`

## 목적

브라우저 안에만 있는 보드를 사용자의 파일로 꺼내고 되돌린다. IndexedDB는 사용자가 찾을 수도 백업할 수도 없으므로, `.sqlite` 파일이 Free Edition의 유일한 백업 수단이다.

## 입력

| 값 | 타입 | 역할 |
| --- | --- | --- |
| `exportDisabled` | `boolean` | 카드 편집 중에는 내보내기를 막는다 |
| `setMessage` | `(message: string) => void` | 실패 문구를 보드 메시지로 띄운다 |
| `getSnapshot` | `() => BoardSnapshot` | 현재 화면 상태를 읽어 온다 |

## 상태

| 값 | 초기값 | 역할 |
| --- | --- | --- |
| `transferring` | `false` | 내보내기/불러오기 진행 중 |
| `resetting` | `false` | 리셋 진행 중 |
| `resetDialogOpen` | `false` | 리셋 확인 대화상자 |
| `importInputRef` | `null` | 숨긴 `input[type=file]` |

세 동작은 서로를 막는다. `transferring` 또는 `resetting`이면 다른 동작은 시작하지 않는다.

## 내보내기

1. `exportDisabled`이거나 다른 동작 중이면 종료한다.
2. `replaceBoardState(getSnapshot())`로 **현재 화면 상태를 먼저 DB에 반영한다.** 이 단계가 없으면 마지막 편집이 빠진 파일이 나간다.
3. `exportBoardDatabase()`로 바이트를 받는다.
4. `application/vnd.sqlite3` Blob으로 만들어 `<a download>`를 클릭한다. 파일명은 `meldrift-free.sqlite`다.
5. object URL을 해제한다.

실패 문구는 워커가 던진 메시지를 그대로 쓰고, 없으면 `The board could not be exported.`다.

## 불러오기

1. 파일 선택 직후 `event.target.value`를 비운다. 같은 파일을 다시 골라도 `change`가 발생하게 한다.
2. 50 MiB를 넘으면 워커까지 가지 않고 여기서 막는다. 워커도 같은 한도를 다시 검사한다.
3. `window.confirm`으로 현재 보드가 교체된다는 것을 확인받는다.
4. `importBoardDatabase(await file.arrayBuffer())`를 호출한다. 검증은 전부 워커가 한다.
5. 성공하면 `window.location.reload()`로 화면을 새로 띄운다.

새로고침으로 끝내는 이유는 보드 전체가 교체되기 때문이다. 화면 상태를 부분적으로 맞추지 않는다.

## 리셋

확인 대화상자를 거쳐 `resetBoardDatabase()`를 호출하고 새로고침한다.

클라이언트의 `resetInProgress` 플래그가 서면 이후 `replaceBoardState`는 아무 일도 하지 않는다. 새로고침 전에 화면이 남은 상태를 다시 저장해 되살리는 것을 막는다.

리셋에 실패하면 문구를 띄우고 `resetting`을 되돌린다. 성공 경로에서는 새로고침이 일어나므로 되돌리지 않는다.

## 반환값

`importInputRef`, `transferring`, `resetting`, `resetDialogOpen`과 핸들러 여섯 개(`handleExport`, `handleImportClick`, `handleImport`, `handleResetClick`, `handleResetCancel`, `handleResetConfirm`)를 돌려준다.
