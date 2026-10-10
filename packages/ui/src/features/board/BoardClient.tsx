"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import ImageCard from "@meldrift/ui/ImageCard";
import MemoCard from "@meldrift/ui/MemoCard";
import BoardToolBar from "@meldrift/ui/BoardToolBar";
import BoardMessage from "@meldrift/ui/BoardMessage";
import BoardSearchPanel from "@meldrift/ui/BoardSearchPanel";
import BoardNavigator from "@meldrift/ui/BoardNavigator";
import BoardMarkdownView from "@meldrift/ui/BoardMarkdownView";
import MemoReorderPanel from "@meldrift/ui/MemoReorderPanel";
import AboutModal from "@meldrift/ui/AboutModal";
import AiAssistantButton from "@meldrift/ui/AiAssistantButton";
import AiChatPanel from "@meldrift/ui/AiChatPanel";
import AiUnlockPanel from "@meldrift/ui/AiUnlockPanel";
import MermaidCard from "@meldrift/ui/MermaidCard";
import TableCard from "@meldrift/ui/TableCard";
import DrawingLayer from "@meldrift/ui/DrawingLayer";
import DrawingToolBar from "@meldrift/ui/DrawingToolBar";
import SelectionLayer from "@meldrift/ui/SelectionLayer";
import SelectionToolBar from "@meldrift/ui/SelectionToolBar";
import { useSelectionPointer } from "@meldrift/ui/useSelectionPointer";
import BoardImageDropOverlay from "@meldrift/ui/BoardImageDropOverlay";
import { useBoardImageDrop } from "@meldrift/ui/useBoardImageDrop";
import { useBoardDrawing } from "@meldrift/ui/useBoardDrawing";
import { useCardLayer } from "@meldrift/ui/useCardLayer";
import { useBoardSelection } from "@meldrift/ui/useBoardSelection";
import { useBoardImages } from "@meldrift/ui/useBoardImages";
import { imageInputAccept } from "@meldrift/board-data/image-file";
import type { BoardSnapshot } from "@meldrift/board-data/board-state";
import type { CardType } from "@meldrift/core/cards";
import { useBoardMermaids } from "@meldrift/ui/useBoardMermaids";
import { useBoardTables } from "@meldrift/ui/useBoardTables";
import { useBoardMemoFocus } from "@meldrift/ui/useBoardMemoFocus";
import { useBoardMemos } from "@meldrift/ui/useBoardMemos";
import { useBoardScroll } from "@meldrift/ui/useBoardScroll";
import { useBoardSearch } from "@meldrift/ui/useBoardSearch";
import { useBoardZoom } from "@meldrift/ui/useBoardZoom";
import { useBoardPinchZoom } from "@meldrift/ui/useBoardPinchZoom";
import { useAiAssistant } from "@meldrift/ui/useAiAssistant";
import { useMemoReorder } from "@meldrift/ui/useMemoReorder";

export type BoardControls = {
    snapshot: BoardSnapshot;
    savePaused: boolean;
    setMessage: (message: string) => void;
    menuOpen: boolean;
    setMenuOpen: Dispatch<SetStateAction<boolean>>;
    reorderOpen: boolean;
    onReorder: () => void;
    onCompileMarkdown: () => void;
    onAbout: () => void;
    closeOverlays: () => void;
    replaceSnapshot: (snapshot: BoardSnapshot) => void;
};

type BoardClientProps = {
    initialSnapshot: BoardSnapshot;
    canEdit?: boolean;
    permissionMessage?: string;
    viewportRef?: RefObject<HTMLDivElement | null>;
    renderControls: (controls: BoardControls) => ReactNode;
};

export default function BoardClient({
    initialSnapshot,
    canEdit: canEditCard = true,
    permissionMessage = "Please sign in before editing cards.",
    viewportRef,
    renderControls,
}: BoardClientProps) {
    const { board: currentBoard, images: mappedImages, memos: mappedMemos, mermaids: mappedMermaids, tables: mappedTables, strokes: mappedStrokes } = initialSnapshot;
    const boardWidth = currentBoard.width;
    const boardHeight = currentBoard.height;
    const localViewportRef = useRef<HTMLDivElement | null>(null);
    const cardLocationRef = viewportRef ?? localViewportRef;
    const [menuOpen, setMenuOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [markdownViewOpen, setMarkdownViewOpen] = useState(false);
    const [boardNavigatorOpen, setBoardNavigatorOpen] = useState(false);
    const [boardMessage, setBoardMessage] = useState("");
    const [contentVersion, setContentVersion] = useState(0);
    const showPermissionMessage = () => {
        setBoardMessage(permissionMessage);
    };

    const closeOverlays = useCallback(() => {
        setMenuOpen(false);
        setAboutOpen(false);
        setMarkdownViewOpen(false);
    }, []);

    const {
        boardZoom,
        setBoardZoom,
    } = useBoardZoom();

    const imagesRef = useRef<BoardSnapshot["images"]>(mappedImages);
    const memosRef = useRef<BoardSnapshot["memos"]>(mappedMemos);
    const mermaidsRef = useRef<BoardSnapshot["mermaids"]>(mappedMermaids);
    const tablesRef = useRef<BoardSnapshot["tables"]>(mappedTables);

    const getTopmostZ = useCallback(() => {
        const allZ = [
            ...memosRef.current.map((m) => m.z),
            ...imagesRef.current.map((i) => i.z),
            ...mermaidsRef.current.map((m) => m.z),
            ...tablesRef.current.map((t) => t.z),
        ];
        return allZ.length > 0 ? Math.max(...allZ) + 1 : 1;
    }, []);

    const {
        imageInputRef,
        images,
        setImages,
        editingImageId,
        setEditingImageId,
        handleImageUploadClick,
        handleUploadImage,
        handleDropImageFiles,
        handleUpdateImage,
        handleDeleteImage,
    } = useBoardImages({
        initialImages: mappedImages,
        boardId: currentBoard.boardId,
        boardZoom,
        cardLocationRef,
        getTopmostZ,
        setMessage: setBoardMessage,
    });

    const {
        memos,
        setMemos,
        editingMemoId,
        setEditingMemoId,
        handleCreateTempMemo,
        handleInsertMemo,
        handleUpdateMemo,
        handleDeleteMemo,
    } = useBoardMemos({
        initialMemos: mappedMemos,
        boardId: currentBoard.boardId,
        boardZoom,
        cardLocationRef,
        getTopmostZ,
    });

    const {
        memoMessage,
        setMemoMessage,
        focusedMemoId,
        setFocusedMemoId,
        focusMemoById,
        focusMemoByOrder,
        focusedMemoOrder,
        memoCount,
        handleFocusPrevMemo,
        handleFocusNextMemo,
    } = useBoardMemoFocus(memos);

    const {
        reorderOpen,
        reorderListRef,
        reorderMemoList,
        draggingMemoId,
        dragOffsetY,
        handleToggleReorderPanel,
        handleCloseReorderPanel,
        handleReorderStart,
        handleRowClick,
    } = useMemoReorder({
        memos,
        setMemos,
        onFocusMemo: focusMemoById,
    });

    const {
        searchBarOpen,
        setSearchBarOpen,
        searchText,
        searchIndex,
        searchResults,
        handleSearchTextChange,
        handleSearchPrev,
        handleSearchNext,
    } = useBoardSearch({
        memos,
        focusMemoById,
        setMemoMessage,
    });

    const {
        mermaids,
        setMermaids,
        editingMermaidId,
        setEditingMermaidId,
        handleCreateTempMermaid,
        handleInsertMermaid,
        handleUpdateMermaid,
        handleDeleteMermaid,
    } = useBoardMermaids({
        initialMermaids: mappedMermaids,
        boardId: currentBoard.boardId,
        boardZoom,
        cardLocationRef,
        getTopmostZ,
    });

    const {
        tables,
        setTables,
        editingTableId,
        setEditingTableId,
        handleCreateTempTable,
        handleInsertTable,
        handleUpdateTable,
        handleDeleteTable,
    } = useBoardTables({
        initialTables: mappedTables,
        boardId: currentBoard.boardId,
        boardZoom,
        cardLocationRef,
        getTopmostZ,
    });

    useEffect(() => {
        imagesRef.current = images;
        memosRef.current = memos;
        mermaidsRef.current = mermaids;
        tablesRef.current = tables;
    }, [images, memos, mermaids, tables]);

    const {
        aiPanelOpen,
        unlocked: aiUnlocked,
        unlocking: aiUnlocking,
        unlockError: aiUnlockError,
        messages: aiMessages,
        sending: aiSending,
        saving: aiSaving,
        hasPendingCards: hasPendingAiCards,
        handleToggleAiPanel,
        handleUnlock: handleAiUnlock,
        handleLock: handleAiLock,
        handleSendMessage,
        handleSavePendingCards,
        discardPendingCards,
    } = useAiAssistant({
        boardId: currentBoard.boardId,
        boardWidth,
        boardHeight,
        boardZoom,
        cardLocationRef,
        canEdit: canEditCard,
        onPermissionDenied: showPermissionMessage,
        setMessage: setBoardMessage,
        memos,
        mermaids,
        tables,
        setMemos,
        setMermaids,
        setTables,
        onInsertMemo: handleInsertMemo,
        onInsertMermaid: handleInsertMermaid,
        onInsertTable: handleInsertTable,
        onUpdateMemo: handleUpdateMemo,
        onUpdateMermaid: handleUpdateMermaid,
        onUpdateTable: handleUpdateTable,
        images,
        setImages,
        onDeleteMemo: handleDeleteMemo,
        onDeleteMermaid: handleDeleteMermaid,
        onDeleteTable: handleDeleteTable,
        onDeleteImage: handleDeleteImage,
    });

    const {
        strokes,
        setStrokes,
        drawingMode,
        drawingTool,
        penColor,
        setPenColor,
        penWidth,
        setPenWidth,
        handleToggleDrawingMode,
        handleToggleEraseTool,
        handleStrokeEnd,
        handleErase,
        handleUndoStroke,
    } = useBoardDrawing({
        initialStrokes: mappedStrokes,
    });

    const isEditing =
        editingMemoId !== null ||
        editingImageId !== null ||
        editingMermaidId !== null ||
        editingTableId !== null;

    const {
        boardPanning,
        handleBoardPanStart,
        handleBoardPanMove,
        handleBoardPanEnd,
    } = useBoardScroll({
        cardEditing: isEditing,
        boardScrollRef: cardLocationRef,
    });

    const {
        isDraggingOverBoard,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    } = useBoardImageDrop({
        boardScrollRef: cardLocationRef,
        boardZoom,
        onDropImages: async (files, coords) => {
            if (!canEditCard) {
                showPermissionMessage();
                return;
            }
            await handleDropImageFiles(files, coords);
        },
    });
    
    useBoardPinchZoom({
        boardScrollRef: cardLocationRef,
        boardZoom,
        setBoardZoom,
    });

    const { handleCardLayer } = useCardLayer({
        memos, images, mermaids, tables,
        setMemos,
        setImages,
        setMermaids,
        setTables,
    });

    const {
        selectionMode,
        selectedCards,
        selectionBounds,
        clampSelectionOffset,
        handleToggleSelectionMode,
        handleSelectCards,
        handleClearSelection,
        handleMoveSelection,
        handleDeleteSelection,
    } = useBoardSelection({
        boardWidth,
        boardHeight,
        memos, images, mermaids, tables,
        setMemos,
        setImages,
        setMermaids,
        setTables,
        onDeleteMemo: handleDeleteMemo,
        onDeleteImage: handleDeleteImage,
        onDeleteMermaid: handleDeleteMermaid,
        onDeleteTable: handleDeleteTable,
    });

    const {
        marqueeRect,
        selectionOffset,
        handleSelectionPointerDown,
        handleSelectionPointerMove,
        handleSelectionPointerUp,
        handleSelectionPointerCancel,
    } = useSelectionPointer({
        zoom: boardZoom,
        selectionBounds,
        onSelectCards: handleSelectCards,
        onMoveSelection: handleMoveSelection,
        onClearSelection: handleClearSelection,
    });

    const selectionActive = selectionMode && !isEditing && !hasPendingAiCards;
    const cardsSelected = selectionActive && selectedCards.length > 0;
    const groupOffset = selectionOffset ? clampSelectionOffset(selectionOffset) : null;
    const selectedCardKeys = new Set(selectedCards.map((card) => `${card.type}:${card.id}`));
    const groupOffsetOf = (type: CardType, id: number) =>
        groupOffset && selectedCardKeys.has(`${type}:${id}`) ? groupOffset : undefined;

    const snapshot = useMemo<BoardSnapshot>(() => ({ board: currentBoard, memos, images, mermaids, tables, strokes }), [currentBoard, memos, images, mermaids, tables, strokes]);
    const savePaused = isEditing || drawingMode || hasPendingAiCards;
    const withPermission = (action: () => void) => () => {
        if (!canEditCard) {
            showPermissionMessage();
            return;
        }
        action();
    };

  return (
    <>
        <input
            ref={imageInputRef}
            type="file"
            accept={imageInputAccept}
            aria-label="Upload image"
            className="hidden"
            onChange={handleUploadImage}
        />
        {renderControls({
            snapshot,
            savePaused,
            setMessage: setBoardMessage,
            menuOpen,
            setMenuOpen,
            reorderOpen,
            onReorder: handleToggleReorderPanel,
            onCompileMarkdown: () => setMarkdownViewOpen(true),
            onAbout: () => setAboutOpen(true),
            closeOverlays,
            replaceSnapshot: (next) => {
                if (!canEditCard) {
                    showPermissionMessage();
                    return;
                }
                if (next.board.boardId !== currentBoard.boardId) {
                    return;
                }
                setMemos(next.memos);
                setImages(next.images);
                setMermaids(next.mermaids);
                setTables(next.tables);
                setStrokes(next.strokes);
                setContentVersion((version) => version + 1);
                setEditingMemoId(null);
                setEditingImageId(null);
                setEditingMermaidId(null);
                setEditingTableId(null);
                setFocusedMemoId(null);
                handleClearSelection();
            },
        })}
        <BoardToolBar
            cardEditing={isEditing || drawingMode || cardsSelected}
            drawingMode={drawingMode}
            selectionMode={selectionMode}
            searchBarOpen={searchBarOpen}
            boardNavigatorOpen={boardNavigatorOpen}
            boardZoom={boardZoom}
            setBoardZoom={setBoardZoom}
            setMenuOpen={setMenuOpen}
            setSearchBarOpen={setSearchBarOpen}
            setBoardNavigatorOpen={setBoardNavigatorOpen}
            onMemoCreateClick={withPermission(handleCreateTempMemo)}
            onImageUploadClick={withPermission(handleImageUploadClick)}
            onMermaidCreateClick={withPermission(handleCreateTempMermaid)}
            onTableCreateClick={withPermission(handleCreateTempTable)}
            onDrawingToggleClick={withPermission(() => {
                if (selectionMode) {
                    handleToggleSelectionMode();
                }
                handleToggleDrawingMode();
            })}
            onSelectionToggleClick={withPermission(() => {
                if (!selectionMode && hasPendingAiCards) {
                    setBoardMessage("Save or discard the assistant's changes first.");
                    return;
                }
                handleToggleSelectionMode();
            })}
        />
        {cardsSelected && (
            <SelectionToolBar
                selectedCount={selectedCards.length}
                onDelete={handleDeleteSelection}
            />
        )}
        {drawingMode && (
            <DrawingToolBar
                drawingTool={drawingTool}
                penColor={penColor}
                penWidth={penWidth}
                onChangeColor={setPenColor}
                onChangeWidth={setPenWidth}
                onToggleErase={handleToggleEraseTool}
                onUndo={handleUndoStroke}
            />
        )}
        {searchBarOpen && (
            <BoardSearchPanel
                searchText={searchText}
                currentIndex={searchResults.length > 0 ? searchIndex + 1 : 0}
                searchCount={searchResults.length}
                onTextChange={handleSearchTextChange}
                onPrev={handleSearchPrev}
                onNext={handleSearchNext}
            />
        )}
        {boardNavigatorOpen && (
            <BoardNavigator
                currentMemoNumber={focusedMemoOrder}
                memoCount={memoCount}
                onPrev={handleFocusPrevMemo}
                onNext={handleFocusNextMemo}
                onMemoNumberChange={focusMemoByOrder}
            />
        )}
        {reorderOpen && (
            <MemoReorderPanel
                memos={reorderMemoList}
                listRef={reorderListRef}
                draggingMemoId={draggingMemoId}
                dragOffsetY={dragOffsetY}
                onDragStart={(event, memoId) => {
                    if (!canEditCard) {
                        showPermissionMessage();
                        return;
                    }
                    handleReorderStart(event, memoId);
                }}
                onRowClick={handleRowClick}
                onClose={handleCloseReorderPanel}
            />
        )}
        {markdownViewOpen && (
            <BoardMarkdownView
                snapshot={snapshot}
                onClose={() => setMarkdownViewOpen(false)}
            />
        )}
        {aboutOpen && (
            <AboutModal onClose={() => setAboutOpen(false)} />
        )}
        <AiAssistantButton
            aiPanelOpen={aiPanelOpen}
            onToggle={handleToggleAiPanel}
        />
        {aiPanelOpen && (aiUnlocked ? (
            <AiChatPanel
                messages={aiMessages}
                sending={aiSending}
                saving={aiSaving}
                hasPendingCards={hasPendingAiCards}
                onSend={handleSendMessage}
                onSave={handleSavePendingCards}
                onDiscard={discardPendingCards}
                onLock={handleAiLock}
                onClose={handleToggleAiPanel}
            />
        ) : (
            <AiUnlockPanel
                unlocking={aiUnlocking}
                errorMessage={aiUnlockError}
                onUnlock={handleAiUnlock}
                onClose={handleToggleAiPanel}
            />
        ))}
        <BoardMessage
            variant="toast"
            message={boardMessage}
            onDismiss={() => setBoardMessage("")}
        />
        <BoardMessage
            variant="toast"
            message={memoMessage}
            onDismiss={() => setMemoMessage("")}
        />
    
         <main
            className="h-screen w-screen select-none bg-neutral-200 relative"
            onClick={()=>{
                setBoardMessage("");
                setMemoMessage("");
            }}
        >
            <BoardImageDropOverlay isDragging={isDraggingOverBoard} />
            <div
                ref={cardLocationRef}
                className="board-scroll-layer h-full w-full overflow-auto"
                style={selectionActive ? { touchAction: "none" } : undefined}
                onPointerDown={selectionActive ? handleSelectionPointerDown : handleBoardPanStart}
                onPointerMove={selectionActive ? handleSelectionPointerMove : handleBoardPanMove}
                onPointerUp={selectionActive ? handleSelectionPointerUp : handleBoardPanEnd}
                onPointerCancel={selectionActive ? handleSelectionPointerCancel : undefined}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
            <div
                className="board-size-layer"
                style={{
                    width: `${boardWidth * boardZoom}px`,
                    height: `${boardHeight * boardZoom}px`,
                }}
            >
                <div
                    className="meldrift-board relative bg-white"
                    style={{
                            width: `${boardWidth}px`,
                            height: `${boardHeight}px`,
                            transform: `scale(${boardZoom})`,
                            transformOrigin: "top left",
                            backgroundImage: "radial-gradient(#d4d4d8 1px, transparent 1px)",
                            backgroundSize: "24px 24px",
                            WebkitUserSelect: "none",
                            userSelect: "none",
                            WebkitTouchCallout: "none",
                            cursor: selectionActive ? "default" : boardPanning ? "grabbing" : "grab",
                        }}
                >
                    {images.map((image) => (
                        <ImageCard
                            key={`${contentVersion}:${image.imageId}`}
                            image={image}
                            zoom={boardZoom}
                            isEditing={editingImageId === image.imageId}
                            groupOffset={groupOffsetOf("image", image.imageId)}
                            onEditing={() => {
                                if (!canEditCard) {
                                    showPermissionMessage();
                                    return;
                                }
                                setEditingImageId(image.imageId);
                                handleClearSelection();
                                setEditingMemoId(null);
                                setEditingMermaidId(null);
                                setEditingTableId(null);
                                setFocusedMemoId(null);
                            }}
                            onEditingClear={() => setEditingImageId(null)}
                            onUpdate={handleUpdateImage}
                            onDelete={handleDeleteImage}
                            onBringToFront={() => handleCardLayer("image", image.imageId, "front")}
                            onSendToBack={() => handleCardLayer("image", image.imageId, "back")}
                        />
                    ))}
                    {memos.map((memo) => (
                        <MemoCard
                            key={`${contentVersion}:${memo.id}`}
                            memo={memo}
                            zoom={boardZoom}
                            canEdit={canEditCard}
                            isEditing={editingMemoId === memo.id}
                            isFocused={focusedMemoId === memo.id}
                            groupOffset={groupOffsetOf("memo", memo.id)}
                            onFocus={() => setFocusedMemoId(memo.id)}
                            onFocusClear={() => setFocusedMemoId(null)}
                            onEditing={() => {
                                if (!canEditCard) {
                                    showPermissionMessage();
                                    return;
                                }
                                setEditingMemoId(memo.id);
                                handleClearSelection();
                                setEditingImageId(null);
                                setEditingMermaidId(null);
                                setEditingTableId(null);
                            }}
                            onEditingClear={() => setEditingMemoId(null)}
                            onPermissionDenied={showPermissionMessage}
                            onInsert={handleInsertMemo}
                            onUpdate={handleUpdateMemo}
                            onDelete={handleDeleteMemo}
                            onBringToFront={() => handleCardLayer("memo", memo.id, "front")}
                            onSendToBack={() => handleCardLayer("memo", memo.id, "back")}
                        />
                    ))}
                    {mermaids.map((mermaid) => (
                        <MermaidCard
                            key={`${contentVersion}:${mermaid.id}`}
                            mermaid={mermaid}
                            zoom={boardZoom}
                            canEdit={canEditCard}
                            isEditing={editingMermaidId === mermaid.id}
                            groupOffset={groupOffsetOf("mermaid", mermaid.id)}
                            onEditing={() => {
                                if (!canEditCard) {
                                    showPermissionMessage();
                                    return;
                                }
                                setEditingMermaidId(mermaid.id);
                                handleClearSelection();
                                setEditingMemoId(null);
                                setEditingImageId(null);
                                setEditingTableId(null);
                                setFocusedMemoId(null);
                            }}
                            onEditingClear={() => setEditingMermaidId(null)}
                            onPermissionDenied={showPermissionMessage}
                            onInsert={handleInsertMermaid}
                            onUpdate={handleUpdateMermaid}
                            onDelete={handleDeleteMermaid}
                            onBringToFront={() => handleCardLayer("mermaid", mermaid.id, "front")}
                            onSendToBack={() => handleCardLayer("mermaid", mermaid.id, "back")}
                        />
                    ))}
                    {tables.map((table) => (
                        <TableCard
                            key={`${contentVersion}:${table.id}`}
                            table={table}
                            zoom={boardZoom}
                            canEdit={canEditCard}
                            isEditing={editingTableId === table.id}
                            groupOffset={groupOffsetOf("table", table.id)}
                            onEditing={() => {
                                if (!canEditCard) {
                                    showPermissionMessage();
                                    return;
                                }
                                setEditingTableId(table.id);
                                handleClearSelection();
                                setEditingMemoId(null);
                                setEditingImageId(null);
                                setEditingMermaidId(null);
                                setFocusedMemoId(null);
                            }}
                            onEditingClear={() => setEditingTableId(null)}
                            onPermissionDenied={showPermissionMessage}
                            onInsert={handleInsertTable}
                            onUpdate={handleUpdateTable}
                            onDelete={handleDeleteTable}
                            onBringToFront={() => handleCardLayer("table", table.id, "front")}
                            onSendToBack={() => handleCardLayer("table", table.id, "back")}
                        />
                    ))}
                    <DrawingLayer
                        key={`${contentVersion}:${drawingMode ? "drawing-active" : "drawing-inactive"}`}
                        strokes={strokes}
                        drawingMode={drawingMode}
                        drawingTool={drawingTool}
                        penColor={penColor}
                        penWidth={penWidth}
                        zoom={boardZoom}
                        onStrokeEnd={handleStrokeEnd}
                        onErase={handleErase}
                    />
                    {selectionActive && (
                        <SelectionLayer
                            marqueeRect={marqueeRect}
                            selectionBounds={selectionBounds}
                            selectionOffset={groupOffset ?? { x: 0, y: 0 }}
                        />
                    )}
                </div>
            </div>
            </div>
        </main>
    </>
  );
}
