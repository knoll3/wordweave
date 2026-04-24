import { useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Container } from "pixi.js";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
} from "../../../types";
import { rectanglesOverlap } from "../graphGeometry";
import {
  CARD_HEIGHT,
  getViewTopLeftPosition,
  setViewTopLeftPosition,
  type ItemView,
} from "../graphViewHelpers";

export type GraphDragState = {
  nodeId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  pointerStartX: number;
  pointerStartY: number;
  startX: number;
  startY: number;
  draggedNodeIds: string[];
  nodeStartPositions: Array<{
    nodeId: string;
    x: number;
    y: number;
  }>;
};

export function useGraphDrag({
  worldRef,
  getItemViews,
  selectedNodeIdsRef,
  getItemViewBounds,
  getApplyViewState,
  hostRef,
  screenPointToWorld,
  onDragWorkspaceItemRef,
  onDragWorkspaceGroupRef,
  onMoveWorkspaceItemsRef,
  onDeleteWorkspaceItemsRef,
  onReleaseWorkspaceDragRef,
  onAttachActionModifierRef,
  onAttachCategoryModifierRef,
  onCombineWorkspaceItemsRef,
  refreshSelectionOverlay,
  getCanAttachModifierToView,
  isNodeCoveredByOverlay,
  isNodeReservedByLocalActivity,
  isNodeReservedByRemoteSelection,
  isNodeReservedByRemoteActivity,
}: {
  worldRef: RefObject<Container | null>;
  getItemViews: () => Map<string, ItemView>;
  selectedNodeIdsRef: MutableRefObject<string[]>;
  getItemViewBounds: (
    nodeId: string
  ) => { x: number; y: number; width: number; height: number } | null;
  getApplyViewState: () => (
    view: ItemView,
    state: "default" | "highlight",
    scale?: number
  ) => void;
  hostRef: RefObject<HTMLElement | null>;
  screenPointToWorld: (x: number, y: number) => { x: number; y: number };
  onDragWorkspaceItemRef: MutableRefObject<
    (nodeId: string, position: { x: number; y: number }) => void
  >;
  onDragWorkspaceGroupRef: MutableRefObject<
    | ((
        items: Array<{ nodeId: string; position: { x: number; y: number } }>
      ) => void)
    | undefined
  >;
  onMoveWorkspaceItemsRef: MutableRefObject<
    (items: Array<{ nodeId: string; position: { x: number; y: number } }>) => void
  >;
  onDeleteWorkspaceItemsRef: MutableRefObject<(nodeIds: string[]) => void>;
  onReleaseWorkspaceDragRef: MutableRefObject<
    (nodeId: string, position: { x: number; y: number }) => void
  >;
  onAttachActionModifierRef: MutableRefObject<
    (sourceNodeId: string, targetNodeId: string) => void
  >;
  onAttachCategoryModifierRef: MutableRefObject<
    (sourceNodeId: string, targetNodeId: string) => void
  >;
  onCombineWorkspaceItemsRef: MutableRefObject<
    (
      sourceNodeId: string,
      targetNodeId: string,
      resultCenter?: { x: number; y: number }
    ) => void
  >;
  refreshSelectionOverlay: () => void;
  getCanAttachModifierToView: () => (view: ItemView) => boolean;
  isNodeCoveredByOverlay: (nodeId: string) => boolean;
  isNodeReservedByLocalActivity: (nodeId: string) => boolean;
  isNodeReservedByRemoteSelection: (nodeId: string) => boolean;
  isNodeReservedByRemoteActivity: (nodeId: string) => boolean;
}) {
  const dragStateRef = useRef<GraphDragState | null>(null);
  const hoverTargetNodeIdRef = useRef<string | null>(null);

  const clearHoverTarget = () => {
    const hoverTargetNodeId = hoverTargetNodeIdRef.current;
    if (!hoverTargetNodeId) return;
    const hoverView = getItemViews().get(hoverTargetNodeId);
    if (hoverView) {
      getApplyViewState()(
        hoverView,
        selectedNodeIdsRef.current.includes(hoverTargetNodeId) ? "highlight" : "default",
        1
      );
    }
    hoverTargetNodeIdRef.current = null;
  };

  const cancelActiveDrag = () => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const view = getItemViews().get(dragState.nodeId);
    if (view) {
      view.container.alpha = 1;
      view.container.cursor = "grab";
      getApplyViewState()(view, "default", 1);
    }
    dragStateRef.current = null;
    clearHoverTarget();
  };

  const updateHoverTarget = (draggedNodeId: string) => {
    const world = worldRef.current;
    const draggedBounds = getItemViewBounds(draggedNodeId);
    if (!world || !draggedBounds) return;

    let nextHoverTargetNodeId: string | null = null;
    let nextHoverTargetZIndex = -1;

    getItemViews().forEach((view, nodeId) => {
      if (nodeId === draggedNodeId) {
        return;
      }
      if (
        isNodeCoveredByOverlay(nodeId) ||
        isNodeReservedByLocalActivity(nodeId) ||
        isNodeReservedByRemoteSelection(nodeId) ||
        isNodeReservedByRemoteActivity(nodeId)
      ) {
        return;
      }
      const overlaps = rectanglesOverlap(draggedBounds, {
        ...getViewTopLeftPosition(view),
        width: view.width,
        height: CARD_HEIGHT,
      });
      if (!overlaps) {
        return;
      }
      const zIndex = world.getChildIndex(view.container);
      if (zIndex > nextHoverTargetZIndex) {
        nextHoverTargetNodeId = nodeId;
        nextHoverTargetZIndex = zIndex;
      }
    });

    if (nextHoverTargetNodeId === hoverTargetNodeIdRef.current) return;

    clearHoverTarget();

    if (!nextHoverTargetNodeId) return;

    const nextHoverView = getItemViews().get(nextHoverTargetNodeId);
    if (!nextHoverView) return;
    getApplyViewState()(nextHoverView, "highlight", 1.04);
    hoverTargetNodeIdRef.current = nextHoverTargetNodeId;
  };

  const handleDragPointerMove = (pointerId: number, clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    const host = hostRef.current;
    if (!dragState || dragState.pointerId !== pointerId || !host) {
      return false;
    }

    const rect = host.getBoundingClientRect();
    const worldPosition = screenPointToWorld(clientX - rect.left, clientY - rect.top);
    if (dragState.draggedNodeIds.length > 1) {
      const deltaX = worldPosition.x - dragState.pointerStartX;
      const deltaY = worldPosition.y - dragState.pointerStartY;
      const liveMoves: Array<{ nodeId: string; position: { x: number; y: number } }> = [];
      for (const startPosition of dragState.nodeStartPositions) {
        const view = getItemViews().get(startPosition.nodeId);
        if (!view) continue;
        const nextPosition = {
          x: startPosition.x + deltaX,
          y: startPosition.y + deltaY,
        };
        setViewTopLeftPosition(view, nextPosition);
        liveMoves.push({
          nodeId: startPosition.nodeId,
          position: {
            x: nextPosition.x,
            y: nextPosition.y,
          },
        });
      }
      onDragWorkspaceGroupRef.current?.(liveMoves);
      refreshSelectionOverlay();
    } else {
      const view = getItemViews().get(dragState.nodeId);
      if (view) {
        const nextPosition = {
          x: worldPosition.x - dragState.offsetX,
          y: worldPosition.y - dragState.offsetY,
        };
        setViewTopLeftPosition(view, nextPosition);
        onDragWorkspaceItemRef.current(dragState.nodeId, {
          x: Math.round(nextPosition.x),
          y: Math.round(nextPosition.y),
        });
        updateHoverTarget(dragState.nodeId);
      }
    }

    return true;
  };

  const handleDragPointerUp = (pointerId: number, clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    const host = hostRef.current;
    if (!dragState || dragState.pointerId !== pointerId || !host) {
      return null;
    }

    const view = getItemViews().get(dragState.nodeId);
    const dropTargetNodeId = hoverTargetNodeIdRef.current;
    dragStateRef.current = null;
    clearHoverTarget();

    if (dragState.draggedNodeIds.length > 1) {
      const nextPositions = new Map(
        dragState.draggedNodeIds.map((nodeId) => {
          const draggedView = getItemViews().get(nodeId);
          const topLeftPosition = draggedView ? getViewTopLeftPosition(draggedView) : null;
          return [
            nodeId,
            topLeftPosition
              ? {
                  x: Math.round(topLeftPosition.x),
                  y: Math.round(topLeftPosition.y),
                }
              : null,
          ] as const;
        })
      );

      onMoveWorkspaceItemsRef.current(
        [...nextPositions.entries()]
          .filter((entry): entry is [string, { x: number; y: number }] => entry[1] != null)
          .map(([nodeId, position]) => ({ nodeId, position }))
      );
      return { kind: "group" as const };
    }

    if (!view) {
      return { kind: "missing-view" as const };
    }

    view.container.alpha = 1;
    view.container.cursor = "grab";
    getApplyViewState()(view, "default", 1);

    const hostRect = host.getBoundingClientRect();
    const releasedOutsideWorkspace =
      clientX < hostRect.left ||
      clientX > hostRect.right ||
      clientY < hostRect.top ||
      clientY > hostRect.bottom;
    const topLeftPosition = getViewTopLeftPosition(view);
    const nextPosition = {
      x: Math.round(topLeftPosition.x),
      y: Math.round(topLeftPosition.y),
    };
    const movedDistance = Math.hypot(
      nextPosition.x - dragState.startX,
      nextPosition.y - dragState.startY
    );
    const dropTargetView = dropTargetNodeId ? getItemViews().get(dropTargetNodeId) : null;
    const resultCenter = dropTargetView
      ? {
          x: (nextPosition.x + getViewTopLeftPosition(dropTargetView).x) / 2,
          y: (nextPosition.y + getViewTopLeftPosition(dropTargetView).y) / 2,
        }
      : undefined;

    if (releasedOutsideWorkspace) {
      onDeleteWorkspaceItemsRef.current([dragState.nodeId]);
      return { kind: "deleted" as const };
    }

    onReleaseWorkspaceDragRef.current(dragState.nodeId, nextPosition);

    if (
      (view.itemId === CATEGORY_MODIFIER_ITEM_ID || view.itemId === ACTION_MODIFIER_ITEM_ID) &&
      dropTargetNodeId &&
      dropTargetNodeId !== dragState.nodeId
    ) {
      const hoveredView = getItemViews().get(dropTargetNodeId);
      if (hoveredView && getCanAttachModifierToView()(hoveredView)) {
        if (view.itemId === ACTION_MODIFIER_ITEM_ID) {
          onAttachActionModifierRef.current(dragState.nodeId, dropTargetNodeId);
        } else {
          onAttachCategoryModifierRef.current(dragState.nodeId, dropTargetNodeId);
        }
        return { kind: "modifier-attached" as const };
      }
    }

    if (dropTargetNodeId && dropTargetNodeId !== dragState.nodeId) {
      onCombineWorkspaceItemsRef.current(dragState.nodeId, dropTargetNodeId, resultCenter);
      return { kind: "combined" as const };
    }

    return {
      kind: "released" as const,
      nodeId: dragState.nodeId,
      itemId: view.itemId,
      nextPosition,
      movedDistance,
    };
  };

  return {
    dragStateRef,
    hoverTargetNodeIdRef,
    clearHoverTarget,
    cancelActiveDrag,
    updateHoverTarget,
    handleDragPointerMove,
    handleDragPointerUp,
  };
}
