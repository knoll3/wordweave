import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { SelectionCombineLayout, WorkspaceItem } from "../../../types";
import { buildGraphSelectionLayout } from "../graphSelectionLayout";
import { CARD_HEIGHT, PLACEHOLDER_WIDTH, SELECTION_PADDING } from "../graphViewHelpers";

type SelectionDragState = {
  pointerId: number | null;
  startScreenX: number;
  startScreenY: number;
};

type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function useGraphSelection({
  workspaceItemsRef,
  onMoveWorkspaceItemsRef,
  onSelectionStateChange,
  getItemViewBounds,
  worldRectToScreenRect,
  screenPointToWorld,
  isNodeCoveredByOverlay,
  isNodeReservedByLocalActivity,
  isNodeReservedByRemoteSelection,
  isNodeReservedByRemoteActivity,
}: {
  workspaceItemsRef: MutableRefObject<WorkspaceItem[]>;
  onMoveWorkspaceItemsRef: MutableRefObject<
    (items: Array<{ nodeId: string; position: { x: number; y: number } }>) => void
  >;
  onSelectionStateChange?: (
    nodeIds: string[],
    layout?: SelectionCombineLayout | null
  ) => void;
  getItemViewBounds: (
    nodeId: string
  ) => { x: number; y: number; width: number; height: number } | null;
  worldRectToScreenRect: (worldRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => SelectionRect;
  screenPointToWorld: (x: number, y: number) => { x: number; y: number };
  isNodeCoveredByOverlay: (nodeId: string) => boolean;
  isNodeReservedByLocalActivity: (nodeId: string) => boolean;
  isNodeReservedByRemoteSelection: (nodeId: string) => boolean;
  isNodeReservedByRemoteActivity: (nodeId: string) => boolean;
}) {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectionDragRect, setSelectionDragRect] = useState<SelectionRect | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionLayout, setSelectionLayout] = useState<SelectionCombineLayout | null>(null);
  const [selectionOverlayRect, setSelectionOverlayRect] = useState<SelectionRect | null>(null);

  const selectionModeRef = useRef(false);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const selectionDragRectRef = useRef<SelectionRect | null>(null);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const selectionLayoutRef = useRef<SelectionCombineLayout | null>(null);

  selectionModeRef.current = isSelectionMode;
  selectedNodeIdsRef.current = selectedNodeIds;
  selectionLayoutRef.current = selectionLayout;

  const clearSelection = () => {
    setSelectedNodeIds([]);
    setSelectionLayout(null);
    setSelectionOverlayRect(null);
  };

  const cancelSelectionDrag = () => {
    selectionDragRef.current = null;
    selectionDragRectRef.current = null;
    setSelectionDragRect(null);
  };

  const beginSelectionDrag = (
    pointerId: number | null,
    screenX: number,
    screenY: number
  ) => {
    selectionDragRef.current = {
      pointerId,
      startScreenX: screenX,
      startScreenY: screenY,
    };
    const nextRect = {
      left: screenX,
      top: screenY,
      width: 0,
      height: 0,
    };
    setSelectionDragRect(nextRect);
    selectionDragRectRef.current = nextRect;
    setSelectedNodeIds([]);
    setSelectionLayout(null);
    setSelectionOverlayRect(null);
  };

  const updateSelectionDrag = (screenX: number, screenY: number) => {
    const selectionDrag = selectionDragRef.current;
    if (!selectionDrag) {
      return false;
    }
    const left = Math.min(selectionDrag.startScreenX, screenX);
    const top = Math.min(selectionDrag.startScreenY, screenY);
    const nextRect = {
      left,
      top,
      width: Math.abs(screenX - selectionDrag.startScreenX),
      height: Math.abs(screenY - selectionDrag.startScreenY),
    };
    setSelectionDragRect(nextRect);
    selectionDragRectRef.current = nextRect;
    return true;
  };

  const getSelectionWorldBounds = (
    nodeIds: string[],
    layout?: SelectionCombineLayout | null,
    options?: { preferLayoutPositions?: boolean }
  ) => {
    const requestedNodeIds = new Set(nodeIds);
    const layoutNodeIds = new Set(layout?.nodeIds ?? []);
    const relevantLayout =
      layout &&
      layout.nodeIds.every((nodeId) => requestedNodeIds.has(nodeId)) &&
      nodeIds.every(
        (nodeId) => layoutNodeIds.has(nodeId) || nodeId === layout.placeholderNodeId
      )
        ? layout
        : null;
    const involvedNodeIds = new Set(relevantLayout ? relevantLayout.nodeIds : nodeIds);
    if (relevantLayout) {
      involvedNodeIds.add(relevantLayout.placeholderNodeId);
    }
    const entries = Array.from(involvedNodeIds)
      .map((nodeId) => {
        const layoutPosition =
          relevantLayout?.placeholderNodeId === nodeId
            ? relevantLayout.placeholderPosition
            : relevantLayout?.nodePositions.find((entry) => entry.nodeId === nodeId)?.position;
        const liveBounds = getItemViewBounds(nodeId);
        const position =
          options?.preferLayoutPositions && layoutPosition
            ? layoutPosition
            : liveBounds
              ? { x: liveBounds.x, y: liveBounds.y }
              : layoutPosition;
        const width =
          relevantLayout?.placeholderNodeId === nodeId
            ? Math.max(
                ...relevantLayout.nodeIds.map(
                  (layoutNodeId) => getItemViewBounds(layoutNodeId)?.width ?? 0
                ),
                PLACEHOLDER_WIDTH
              )
            : liveBounds?.width ?? 0;
        return position ? { ...position, width } : null;
      })
      .filter(Boolean) as Array<{ x: number; y: number; width: number }>;

    if (entries.length === 0) return null;

    const left = Math.min(...entries.map((entry) => entry.x)) - SELECTION_PADDING;
    const top = Math.min(...entries.map((entry) => entry.y)) - SELECTION_PADDING;
    const right =
      Math.max(...entries.map((entry) => entry.x + entry.width)) + SELECTION_PADDING;
    const bottom =
      Math.max(...entries.map((entry) => entry.y + CARD_HEIGHT)) + SELECTION_PADDING;

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  };

  const refreshSelectionOverlay = () => {
    const currentSelectedNodeIds = selectedNodeIdsRef.current;
    const currentSelectionLayout = selectionLayoutRef.current;
    if (currentSelectedNodeIds.length === 0) {
      setSelectionOverlayRect(null);
      return;
    }

    const worldBounds = getSelectionWorldBounds(
      currentSelectedNodeIds,
      currentSelectionLayout
    );
    if (!worldBounds) {
      setSelectionOverlayRect(null);
      return;
    }

    setSelectionOverlayRect(worldRectToScreenRect(worldBounds));
  };

  const buildSelectionLayout = (nodeIds: string[]): SelectionCombineLayout | null => {
    const selectedWorkspaceItems = nodeIds
      .map((nodeId) => workspaceItemsRef.current.find((item) => item.nodeId === nodeId))
      .filter(Boolean) as WorkspaceItem[];

    const selectedViews = nodeIds
      .map((nodeId) => {
        const bounds = getItemViewBounds(nodeId);
        return bounds
          ? {
              nodeId,
              position: { x: bounds.x, y: bounds.y },
              width: bounds.width,
            }
          : null;
      })
      .filter(
        (
          entry
        ): entry is { nodeId: string; position: { x: number; y: number }; width: number } =>
          entry != null
      );

    return buildGraphSelectionLayout({
      nodeIds,
      selectedWorkspaceItems,
      selectedViews,
      placeholderNodeId: `workspace-selection-placeholder-${Date.now()}`,
    });
  };

  const applySelectionLayout = (nextLayout: SelectionCombineLayout | null) => {
    if (!nextLayout) {
      clearSelection();
      return;
    }

    onMoveWorkspaceItemsRef.current(
      nextLayout.nodePositions.map((entry) => ({
        nodeId: entry.nodeId,
        position: entry.position,
      }))
    );
    setSelectedNodeIds(nextLayout.nodeIds);
    setSelectionLayout(nextLayout);
  };

  const finalizeSelectionDrag = (
    pointerId: number | null,
    onComplete?: (selectedIds: string[]) => void
  ) => {
    const selectionDrag = selectionDragRef.current;
    if (
      !selectionDrag ||
      (selectionDrag.pointerId !== null && selectionDrag.pointerId !== pointerId)
    ) {
      return false;
    }

    selectionDragRef.current = null;
    const finalRect = selectionDragRectRef.current;
    setSelectionDragRect(null);
    selectionDragRectRef.current = null;
    if (!finalRect || finalRect.width < 6 || finalRect.height < 6) {
      setIsSelectionMode(false);
      return true;
    }

    const topLeft = screenPointToWorld(finalRect.left, finalRect.top);
    const bottomRight = screenPointToWorld(
      finalRect.left + finalRect.width,
      finalRect.top + finalRect.height
    );
    const worldRect = {
      left: Math.min(topLeft.x, bottomRight.x),
      top: Math.min(topLeft.y, bottomRight.y),
      right: Math.max(topLeft.x, bottomRight.x),
      bottom: Math.max(topLeft.y, bottomRight.y),
    };

    const selectedIds = workspaceItemsRef.current
      .filter((item) => {
        if (isNodeCoveredByOverlay(item.nodeId)) {
          return false;
        }
        if (isNodeReservedByLocalActivity(item.nodeId)) {
          return false;
        }
        if (isNodeReservedByRemoteSelection(item.nodeId)) {
          return false;
        }
        if (isNodeReservedByRemoteActivity(item.nodeId)) {
          return false;
        }
        const bounds = getItemViewBounds(item.nodeId);
        if (!bounds) return false;
        return (
          bounds.x >= worldRect.left &&
          bounds.y >= worldRect.top &&
          bounds.x + bounds.width <= worldRect.right &&
          bounds.y + bounds.height <= worldRect.bottom
        );
      })
      .map((item) => item.nodeId);

    if (selectedIds.length >= 2) {
      setSelectedNodeIds(selectedIds);
      setSelectionLayout(null);
      onComplete?.(selectedIds);
    } else {
      clearSelection();
    }
    setIsSelectionMode(false);
    return true;
  };

  useEffect(() => {
    onSelectionStateChange?.(selectedNodeIds, selectionLayout);
  }, [onSelectionStateChange, selectedNodeIds, selectionLayout]);

  return {
    isSelectionMode,
    setIsSelectionMode,
    selectionDragRect,
    selectionDragRef,
    selectionDragRectRef,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedNodeIdsRef,
    selectionLayout,
    setSelectionLayout,
    selectionLayoutRef,
    selectionModeRef,
    selectionOverlayRect,
    setSelectionOverlayRect,
    clearSelection,
    cancelSelectionDrag,
    beginSelectionDrag,
    updateSelectionDrag,
    finalizeSelectionDrag,
    getSelectionWorldBounds,
    refreshSelectionOverlay,
    buildSelectionLayout,
    applySelectionLayout,
  };
}
