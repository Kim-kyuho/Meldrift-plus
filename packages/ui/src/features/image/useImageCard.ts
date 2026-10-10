import {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { DraggableData, RndDragEvent, RndResizeCallback } from "react-rnd";

export interface ImageCardData {
    imageId: number;
    boardId: number;
    url: string;
    data: Uint8Array | null;
    mimeType: string | null;
    label: string | null;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
}

type UseImageCardOptions = {
    image: ImageCardData;
    isEditing: boolean;
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
};

export function useImageCard({
    image,
    isEditing,
    onEditing,
    onEditingClear,
    onUpdate,
    onDelete,
}: UseImageCardOptions) {
    const [imageState, setImageState] = useState({
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
    });
    const [syncedPosition, setSyncedPosition] = useState({ x: image.x, y: image.y });
    if (!isEditing && (syncedPosition.x !== image.x || syncedPosition.y !== image.y)) {
        setSyncedPosition({ x: image.x, y: image.y });
        setImageState((prev) => ({ ...prev, x: image.x, y: image.y }));
    }
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const lastImageTapRef = useRef(0);
    const imageStateRef = useRef(imageState);

    useEffect(() => {
        imageStateRef.current = imageState;
    }, [imageState]);
    
    const saveImageDraft = useCallback(() => {
        const latestImageState = imageStateRef.current;

        onUpdate(
            image.imageId,
            image.boardId,
            Math.round(latestImageState.x),
            Math.round(latestImageState.y),
            Math.round(latestImageState.width),
            Math.round(latestImageState.height),
        );
    }, [
        image.boardId,
        image.imageId,
        onUpdate,
    ]);

    const editImage = () => {
        onEditing();
    };

    const handleDoubleTap = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch") {
            return;
        }

        const currentTime = event.timeStamp;
        const isDoubleTap = 
            currentTime - lastImageTapRef.current > 80 && 
            currentTime - lastImageTapRef.current < 300;
        lastImageTapRef.current = currentTime;

        if (isDoubleTap) {
            editImage();
        }
    };

    useEffect(() => {
        const handlePressOutside = (event: PointerEvent) => {
            const target = event.target as Node;
            const targetElement = target instanceof Element ? target : null;

            const isPressInsideBoardToolBar = targetElement?.closest(".board-toolbar");
            const isPressInsideImage = targetElement?.closest(`.image-rnd-${image.imageId}`);
            const isPressInsideBoard = targetElement?.closest(".board-scroll-layer");
            const isPressInsideEmptyBoard = Boolean(
                isPressInsideBoard &&
                !isPressInsideImage &&
                !isPressInsideBoardToolBar
            );

            if (isEditing && isPressInsideEmptyBoard) {
                window.setTimeout(() => {
                    saveImageDraft();
                    onEditingClear();
                }, 0);
                return;
            }
        };

        document.addEventListener("pointerup", handlePressOutside);

        return () => {
            document.removeEventListener("pointerup", handlePressOutside);
        };
    }, [image.imageId, isEditing, onEditingClear, saveImageDraft]);

    const handleImagePress = (event: ReactMouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
    };

    const handleDragStop = (_event: RndDragEvent, data: DraggableData) => {
        const nextImageState = { ...imageStateRef.current, x: data.x, y: data.y };
        imageStateRef.current = nextImageState;
        setImageState(nextImageState);
    };

    const handleResizeStop: RndResizeCallback = (_event, _direction, ref, _delta, position) => {
        const nextImageState = {
            x: position.x,
            y: position.y,
            width: ref.offsetWidth,
            height: ref.offsetHeight,
        };
        imageStateRef.current = nextImageState;
        setImageState(nextImageState);
    };

    const openDeleteDialog = () => {
        setDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        onDelete(image.imageId);
        setDeleteDialogOpen(false);
        onEditingClear();
    };

    const closeDeleteDialog = () => {
        setDeleteDialogOpen(false);
    };

    return {
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
    };
}
