"use client";

import { useEffect, useRef } from "react";
import ImageCardView from "./ImageCardView";
import { ImageCardData, useImageCard } from "./useImageCard";
import { imageBytesToBlob } from "@meldrift/board-data/image-file";
import type { SelectionOffset } from "@meldrift/core/cards";

type ImageCardProps = {
    image: ImageCardData;
    zoom: number;
    isEditing: boolean;
    groupOffset?: SelectionOffset;
    onEditing: () => void;
    onEditingClear: () => void;
    onUpdate: (
        imageId: number,
        boardId: number,
        x: number,
        y: number,
        width: number,
        height: number,
    ) => void;
    onDelete: (imageId: number) => void;
    onBringToFront: () => void;
    onSendToBack: () => void;
};

export default function ImageCard({
    image,
    zoom,
    isEditing,
    groupOffset,
    onEditing,
    onEditingClear,
    onUpdate,
    onDelete,
    onBringToFront,
    onSendToBack,
}: ImageCardProps) {
    const {
        imageState,
        deleteDialogOpen,
        editImage,
        handleDoubleTap,
        handleImagePress,
        handleDragStop,
        handleResizeStop,
        openDeleteDialog,
        confirmDelete,
        closeDeleteDialog,
    } = useImageCard({
        image,
        isEditing,
        onEditing,
        onEditingClear,
        onUpdate,
        onDelete,
    });
    const imageElementRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        const imageElement = imageElementRef.current;
        if (!imageElement || !image.data || !image.mimeType) {
            return;
        }

        const objectUrl = URL.createObjectURL(imageBytesToBlob(image.data, image.mimeType));
        imageElement.src = objectUrl;
        return () => URL.revokeObjectURL(objectUrl);
    }, [image.data, image.mimeType]);

    return (
        <ImageCardView
            imageId={image.imageId}
            z={image.z}
            zoom={zoom}
            isEditing={isEditing}
            groupOffset={groupOffset}
            imageState={imageState}
            deleteDialogOpen={deleteDialogOpen}
            onPress={handleImagePress}
            onEdit={editImage}
            onDoubleTap={handleDoubleTap}
            onDragStop={handleDragStop}
            onResizeStop={handleResizeStop}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onOpenDeleteDialog={openDeleteDialog}
            onConfirmDelete={confirmDelete}
            onCloseDeleteDialog={closeDeleteDialog}
        >
            {(image.data || image.url) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    ref={imageElementRef}
                    src={image.data ? undefined : image.url}
                    alt={image.label ?? "Board image"}
                    draggable={false}
                    className="h-full w-full object-contain"
                />
            )}
        </ImageCardView>
    );
}
