# 로컬 이미지 처리 상세설계

소스: `packages/board-data/src/image-file.ts`

## 목적

두 Edition 모두 이미지 저장소를 쓰지 않는다. 사용자가 고른 파일을 브라우저에서 압축해 SQLite BLOB으로 넣을 수 있는 크기까지 줄인다. 이미지가 DB 안에 들어가므로 한 장의 크기가 곧 스냅샷 크기다. 변경분 동기화를 쓰는 Plus 보드는 이미지를 자산으로 따로 올리므로 `maxStoredImageBytes`가 그대로 서버 상한이다.

## 상수

| 이름 | 값 | 의미 |
| --- | --- | --- |
| `imageInputAccept` | `image/jpeg,image/png,image/webp` | 파일 선택 필터 |
| `maxImageSourceBytes` | 25 MiB | 받아들이는 원본 상한 |
| `maxStoredImageBytes` | 5 MiB | DB에 넣는 결과물 상한 |
| `maxImageDimension` | 1920 | 긴 변 상한 |
| `imageCompressionQualities` | 0.82 → 0.5 | 손실 인코딩 품질 사다리 |
| `imageFitRounds` | 12 | 해상도를 줄이는 최대 회차 |

`supportedImageMimeTypes`는 JPEG·PNG·WebP 셋이다. `board-state.ts`의 이미지 검증도 이 목록과 `maxStoredImageBytes`를 그대로 쓴다.

## `prepareImageFile(file)`

1. MIME이 지원 목록에 없으면 `Choose a JPEG, PNG, or WebP image.`
2. 0바이트이거나 25 MiB를 넘으면 `The source image must be 25 MiB or smaller.`
3. object URL로 `Image`를 로드한다. 디코드 실패는 `The selected image could not be decoded.`
4. `naturalWidth`/`naturalHeight`가 1 미만이면 거부한다.
5. `fitImageSize`로 긴 변을 1920 이하로 맞춘다.
6. 아래 축소 루프를 최대 10회 돈다.
7. 결과가 여전히 5 MiB를 넘으면 `The image is still too large after compression.`
8. 표시 크기는 `fitImageSize(캔버스, 400, 300)`으로 정한다.

### 축소 루프

```text
canvas를 outputSize로 맞추고 다시 그린다
첫 회차에 알파 유무를 한 번 판정한다 (원본이 JPEG이면 생략)
품질 사다리를 0.82부터 내려가며:
  encodeCanvas(canvas, transparent, quality)
    → toBlob("image/webp", quality)
    → 돌아온 타입이 webp가 아니고 알파가 없으면 toBlob("image/jpeg", quality)
    → 그래도 아니면 앞서 받은 blob, 마지막으로 toBlob("image/png")
  예산 안에 들어오면 끝
  결과가 PNG면 품질 인자가 먹지 않으므로 사다리를 더 내려가지 않는다
사다리를 다 써도 안 들어오면 outputSize를 0.8배로 줄이고 다음 회차
```

**요청한 타입이 돌아왔는지 직접 확인한다.** 브라우저는 지원하지 않는 타입을 받으면 `null`이 아니라 PNG를 돌려준다. Safari에는 캔버스 WebP 인코더가 없어서 `null` 검사만으로는 폴백이 영원히 실행되지 않고, 사진이 무손실 PNG로 다시 싸여 5~10배로 부푼다. 그러면 품질 인자가 없어 크기 축소가 해상도 축소로만 이뤄지고, 루프는 5 MiB 밑에 들어오는 즉시 멈추므로 결과가 3.35~5 MiB 구간에 착지한다.

**예산이 그림을 정한다. 그림에 맞춰 예산을 늘리지 않는다.** 먼저 쓰는 레버는 품질이다. 품질은 픽셀을 버리지 않는다. 해상도는 품질이 더 내놓을 것이 없을 때만 내준다. 사진은 대개 첫 인코딩 한 번으로 1920을 유지한 채 들어오고, 품질 인자가 없는 PNG 경로만 회차를 돈다.

알파가 있으면 JPEG로 내려가지 않는다. JPEG는 투명도를 담지 못한다. 캔버스를 읽을 수 없으면(tainted 등) 알파가 있다고 보고 PNG를 유지한다.

반환값은 `{ data, mimeType, label, width, height }`이고 `label`은 원본 파일명이다.

## `imageBytesToPng(data, mimeType)`

Markdown 내보내기에서 zip에 넣을 PNG를 만든다. 이미 PNG면 복사본을 그대로 돌려주고, 아니면 디코드 후 원본 해상도 캔버스에 그려 PNG로 다시 인코딩한다. 여기서는 해상도를 줄이지 않는다.

## 그 밖

| 함수 | 동작 |
| --- | --- |
| `isSupportedImageMimeType(value)` | 타입 가드 |
| `fitImageSize(w, h, maxW, maxH)` | 비율 유지 축소. 확대하지 않는다(`scale ≤ 1`), 최소 1px |
| `imageBytesToBlob(data, mimeType)` | **바이트를 복사해서** Blob을 만든다 |

`imageBytesToBlob`이 복사하는 이유는 원본이 SQLite가 소유한 버퍼일 수 있어서다. 그대로 참조하면 DB가 닫히거나 재할당될 때 내용이 어긋날 수 있다.
