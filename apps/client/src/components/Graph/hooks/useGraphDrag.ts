import { useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Container } from "pixi.js";
import { rectanglesOverlap } from "../graphGeometry";
import { CARD_HEIGHT, getViewTopLeftPosition, type ItemView } from "../graphViewHelpers";

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

  return {
    dragStateRef,
    hoverTargetNodeIdRef,
    clearHoverTarget,
    cancelActiveDrag,
    updateHoverTarget,
  };
}
