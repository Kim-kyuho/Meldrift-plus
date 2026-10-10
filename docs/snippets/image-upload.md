# 이미지 업로드

## input ref

숨겨진 파일 input을 ref로 클릭한다.

```tsx
const imageInputRef = useRef<HTMLInputElement | null>(null);

const handleImageUploadClick = () => {
  imageInputRef.current?.click();
};
```

```tsx
<input
  ref={imageInputRef}
  type="file"
  accept="image/*"
  className="hidden"
  onChange={handleUploadImage}
/>
```

## 현재 화면 중앙에 생성 위치 계산

```tsx
const cardLocationRef = useRef<HTMLElement | null>(null);

const getImageUploadPoint = () => {
  const scrollElement = cardLocationRef.current;
  if (!scrollElement) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.max(0, (scrollElement.scrollLeft + scrollElement.clientWidth / 2) / boardZoom - 200),
    y: Math.max(0, (scrollElement.scrollTop + scrollElement.clientHeight / 2) / boardZoom - 150),
  };
};
```

## FormData 전송

```tsx
const formData = new FormData();
formData.append("file", file);
formData.append("boardId", String(boardId));
formData.append("x", String(x));
formData.append("y", String(y));
formData.append("width", String(width));
formData.append("height", String(height));

const response = await fetch("/api/images", {
  method: "POST",
  body: formData,
});
```

## 브라우저에서 압축해 바이트로 담는다

업로드 대상이 없다. 고른 파일을 그 자리에서 줄여 스냅샷에 넣는다.

```ts
const prepared = await prepareImageFile(file);
// { data: Uint8Array, mimeType, label, width, height }

setImages((prev) => [...prev, {
  imageId: nextPositiveId(prev.map((image) => image.imageId)),
  boardId, url: "", data: prepared.data, mimeType: prepared.mimeType,
  label: prepared.label, x, y, z: 1, width: prepared.width, height: prepared.height,
}]);
```

압축 루프는 결과가 `maxStoredImageBytes`(5 MiB) 이하가 될 때까지 해상도와 품질을 함께 낮춘다. 자세한 규칙은 [로컬 이미지 처리](../shared/image-file.md)에 있다.

Plus는 이 바이트가 스냅샷에 실려 서버로 올라가므로, 보드 전체가 4 MiB를 넘지 않아야 한다는 제약이 한 겹 더 붙는다.

## 화면에 그릴 때

```tsx
useEffect(() => {
  if (!image.data || !image.mimeType) return;
  const url = URL.createObjectURL(imageBytesToBlob(image.data, image.mimeType));
  element.src = url;
  return () => URL.revokeObjectURL(url);
}, [image.data, image.mimeType]);
```

`imageBytesToBlob`은 바이트를 **복사해서** Blob을 만든다. 원본이 SQLite가 소유한 버퍼일 수 있어, 그대로 참조하면 DB가 닫히거나 재할당될 때 내용이 어긋난다.

`next/image`를 쓰지 않는다. blob URL은 최적화 대상이 아니다.

Meldrift 적용 위치:

- `packages/ui/src/features/image/useBoardImages.ts`
- `packages/board-data/src/image-file.ts`
- `packages/ui/src/features/image/ImageCard.tsx`
