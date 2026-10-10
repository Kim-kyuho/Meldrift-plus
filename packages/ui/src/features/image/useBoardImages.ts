import { ChangeEvent, RefObject, useRef, useState } from "react";
import { createAssetId, createSyncId, nextPositiveId, type BoardImage } from "@meldrift/board-data/board-state";
import { prepareImageFile } from "@meldrift/board-data/image-file";

export type { BoardImage } from "@meldrift/board-data/board-state";

type UseBoardImagesOptions = {
    initialImages: BoardImage[];
    boardId: number;
    boardZoom: number;
    cardLocationRef: RefObject<HTMLDivElement | null>;
    setMessage: (message: string) => void;
    getTopmostZ?: () => number;
};

export function useBoardImages({
    initialImages,
    boardId,
    boardZoom,
    cardLocationRef,
    setMessage,
    getTopmostZ,
}: UseBoardImagesOptions) {
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const [images, setImages] = useState(initialImages);
    const nextImageIdRef = useRef(nextPositiveId(initialImages.map((image) => image.imageId)));
    const [editingImageId, setEditingImageId] = useState<number | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);

    const handleImageUploadClick = () => {
        if (!uploadingImage) {
            imageInputRef.current?.click();
        }
    };

    const handleUploadImageFile = async (file: File, targetCoords?: { x: number; y: number }, offsetIndex = 0) => {
        if (uploadingImage) {
            return;
        }

        setUploadingImage(true);
        setMessage("");
        try {
            const prepared = await prepareImageFile(file);
            const locationElement = cardLocationRef.current;
            const autoX = locationElement
                ? Math.max(
                    0,
                    (locationElement.scrollLeft + locationElement.clientWidth / 2) / boardZoom - prepared.width / 2,
                )
                : 0;
            const autoY = locationElement
                ? Math.max(
                    0,
                    (locationElement.scrollTop + locationElement.clientHeight / 2) / boardZoom - prepared.height / 2,
                )
                : 0;
            const x = targetCoords ? Math.max(0, targetCoords.x - prepared.width / 2 + offsetIndex * 24) : autoX;
            const y = targetCoords ? Math.max(0, targetCoords.y - prepared.height / 2 + offsetIndex * 24) : autoY;

            const baseZ = getTopmostZ ? getTopmostZ() : 1;
            const imageId = Math.max(nextImageIdRef.current, nextPositiveId(images.map((image) => image.imageId)));
            nextImageIdRef.current = imageId + 1;
            const image: BoardImage = {
                imageId,
                syncId: createSyncId(),
                assetId: createAssetId(),
                boardId,
                url: "",
                data: prepared.data,
                mimeType: prepared.mimeType,
                label: prepared.label,
                x: Math.round(x),
                y: Math.round(y),
                z: baseZ + offsetIndex,
                width: prepared.width,
                height: prepared.height,
            };

            setImages((previous) => [...previous, image]);
            setEditingImageId(imageId);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "The image could not be added.");
        } finally {
            setUploadingImage(false);
        }
    };

    const handleUploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || uploadingImage) {
            return;
        }
        await handleUploadImageFile(file);
    };

    const handleDropImageFiles = async (files: File[], targetCoords?: { x: number; y: number }) => {
        for (let i = 0; i < files.length; i++) {
            await handleUploadImageFile(files[i], targetCoords, i);
        }
    };

    const handleUpdateImage = async (
        imageId: number,
        boardId: number,
        x: number,
        y: number,
        width: number,
        height: number,
    ) => {
        setImages((previous) => previous.map((image) => image.imageId === imageId
            ? { ...image, boardId, x, y, width, height }
            : image));
    };

    const handleDeleteImage = async (imageId: number) => {
        setImages((previous) => previous.filter((image) => image.imageId !== imageId));
        setEditingImageId(null);
    };

    return {
        imageInputRef,
        images,
        setImages,
        editingImageId,
        setEditingImageId,
        uploadingImage,
        handleImageUploadClick,
        handleUploadImage,
        handleUploadImageFile,
        handleDropImageFiles,
        handleUpdateImage,
        handleDeleteImage,
    };
}
