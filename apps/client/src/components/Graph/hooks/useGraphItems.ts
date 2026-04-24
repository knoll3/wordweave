import { useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Item, WorkspaceItem } from "../../../types";
import { createItemView as createGraphItemView } from "../createItemView";
import {
  COMBINING_CONTENT_ALPHA,
  CARD_HEIGHT,
  CELEBRATION_TINT_HOLD_FRAMES,
  COMBINE_SCALE_STEP,
  HOVER_SCALE_STEP,
  SHRINK_SCALE,
  SPAWN_SCALE,
  drawItemCard,
  getViewTopLeftPosition,
  setViewTargetTopLeftPosition,
  setViewTopLeftPosition,
  type ItemView,
  type ItemVisualState,
} from "../graphViewHelpers";

type DragState = {
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

export function useGraphItems({
  worldRef,
  itemByIdRef,
  combiningNodeIdsRef,
  selectedNodeIdsRef,
  selectionModeRef,
  dragStateRef,
  hoverTargetNodeIdRef,
  activeTouchPointsRef,
  onClaimWorkspaceDragRef,
  onClearActionModifierRef,
  onClearCategoryModifierRef,
  beginTouchGesture,
  clearSelection,
  pixiPointerToWorld,
  isNodeCoveredByOverlay,
  isNodeReservedByLocalActivity,
  isNodeReservedByRemoteSelection,
  isNodeReservedByRemoteActivity,
  refreshSelectionOverlay,
  refreshRemoteSelectionOverlay,
  refreshActivityOverlay,
  initialWorkspaceNodeIds,
  initialCombiningNodeIds,
}: {
  worldRef: RefObject<Container | null>;
  itemByIdRef: MutableRefObject<Map<number, Item>>;
  combiningNodeIdsRef: MutableRefObject<string[]>;
  selectedNodeIdsRef: MutableRefObject<string[]>;
  selectionModeRef: MutableRefObject<boolean>;
  dragStateRef: MutableRefObject<DragState | null>;
  hoverTargetNodeIdRef: MutableRefObject<string | null>;
  activeTouchPointsRef: MutableRefObject<Map<number, { x: number; y: number }>>;
  onClaimWorkspaceDragRef: MutableRefObject<(nodeId: string) => void>;
  onClearActionModifierRef: MutableRefObject<(nodeId: string) => void>;
  onClearCategoryModifierRef: MutableRefObject<(nodeId: string) => void>;
  beginTouchGesture: () => void;
  clearSelection: () => void;
  pixiPointerToWorld: (event: FederatedPointerEvent) => { x: number; y: number };
  isNodeCoveredByOverlay: (nodeId: string) => boolean;
  isNodeReservedByLocalActivity: (nodeId: string) => boolean;
  isNodeReservedByRemoteSelection: (nodeId: string) => boolean;
  isNodeReservedByRemoteActivity: (nodeId: string) => boolean;
  refreshSelectionOverlay: () => void;
  refreshRemoteSelectionOverlay: () => void;
  refreshActivityOverlay: () => void;
  initialWorkspaceNodeIds: string[];
  initialCombiningNodeIds: string[];
}) {
  const itemViewsRef = useRef<Map<string, ItemView>>(new Map());
  const previousWorkspaceNodeIdsRef = useRef<string[]>(initialWorkspaceNodeIds);
  const previousCombiningNodeIdsRef = useRef<string[]>(initialCombiningNodeIds);

  const getItemViewBounds = (nodeId: string) => {
    const view = itemViewsRef.current.get(nodeId);
    if (!view) return null;
    const position = getViewTopLeftPosition(view);
    return {
      view,
      x: position.x,
      y: position.y,
      width: view.width,
      height: CARD_HEIGHT,
    };
  };

  const getItemViewAtWorldPosition = (position: { x: number; y: number }) => {
    const world = worldRef.current;
    if (!world) return null;

    const candidates = Array.from(itemViewsRef.current.values())
      .map((view) => ({
        view,
        zIndex: world.getChildIndex(view.container),
      }))
      .sort((left, right) => right.zIndex - left.zIndex);

    return (
      candidates.find(({ view }) => {
        const topLeft = getViewTopLeftPosition(view);
        return (
          position.x >= topLeft.x &&
          position.x <= topLeft.x + view.width &&
          position.y >= topLeft.y &&
          position.y <= topLeft.y + CARD_HEIGHT
        );
      })?.view ?? null
    );
  };

  const applyViewState = (view: ItemView, state: ItemVisualState, scale = 1) => {
    drawItemCard(
      view.background,
      view.width,
      view.itemId,
      state,
      view.hasCategoryModifier || view.hasActionModifier,
      view.arrivalTintProgress,
      view.celebrationTintProgress
    );
    view.targetScale = scale;
    const isHoverScale = scale === 1 || scale === 1.04;
    const isSettledNearFullSize =
      view.container.scale.x >= 0.98 && view.targetScale >= 0.98;
    view.scaleStep =
      isHoverScale && isSettledNearFullSize
        ? HOVER_SCALE_STEP
        : COMBINE_SCALE_STEP;
  };

  const setViewContentAlpha = (view: ItemView, alpha: number) => {
    view.targetContentAlpha = alpha;
  };

  const triggerCelebration = (view: ItemView) => {
    if (!view.celebration) {
      return;
    }
    view.celebrationProgress = 1;
    view.celebrationTintProgress = 1;
    view.celebrationTintHoldFrames = CELEBRATION_TINT_HOLD_FRAMES;
    view.celebration.visible = true;
    view.celebration.alpha = 1;
    view.celebration.scale.set(0.82);
    if (view.celebrationParticles) {
      view.celebrationParticles.visible = true;
      view.celebrationParticles.alpha = 1;
    }
    applyViewState(view, "highlight", 1.13);
  };

  const triggerArrivalHighlight = (view: ItemView, maxDurationMs: number) => {
    const now = Date.now();
    view.arrivalTintProgress = 1;
    view.arrivalHighlightStartedAt = now;
    view.arrivalHighlightUntil = now + maxDurationMs;
  };

  const createItemView = (workspaceItem: WorkspaceItem, item: Item): ItemView => {
    return createGraphItemView(workspaceItem, item, {
      onActionBadgePointerDown: (event, badgeWorkspaceItem) => {
        event.stopPropagation();
        if (
          isNodeCoveredByOverlay(badgeWorkspaceItem.nodeId) ||
          isNodeReservedByLocalActivity(badgeWorkspaceItem.nodeId) ||
          isNodeReservedByRemoteActivity(badgeWorkspaceItem.nodeId)
        ) {
          return;
        }
        onClearActionModifierRef.current(badgeWorkspaceItem.nodeId);
      },
      onCategoryBadgePointerDown: (event, badgeWorkspaceItem) => {
        event.stopPropagation();
        if (
          isNodeCoveredByOverlay(badgeWorkspaceItem.nodeId) ||
          isNodeReservedByLocalActivity(badgeWorkspaceItem.nodeId) ||
          isNodeReservedByRemoteActivity(badgeWorkspaceItem.nodeId)
        ) {
          return;
        }
        onClearCategoryModifierRef.current(badgeWorkspaceItem.nodeId);
      },
      onContainerPointerDown: (event, view, pointerWorkspaceItem, pointerItem) => {
        if (event.pointerType === "touch") {
          activeTouchPointsRef.current.set(event.pointerId, {
            x: event.global.x,
            y: event.global.y,
          });
          if (activeTouchPointsRef.current.size >= 2) {
            beginTouchGesture();
            return;
          }
        }
        if (isNodeCoveredByOverlay(pointerWorkspaceItem.nodeId)) {
          return;
        }
        if (isNodeReservedByLocalActivity(pointerWorkspaceItem.nodeId)) {
          return;
        }
        if (isNodeReservedByRemoteSelection(pointerWorkspaceItem.nodeId)) {
          return;
        }
        if (isNodeReservedByRemoteActivity(pointerWorkspaceItem.nodeId)) {
          return;
        }
        if (selectionModeRef.current) {
          return;
        }
        event.stopPropagation();
        const currentSelectedNodeIds = selectedNodeIdsRef.current;
        const isDraggingSelectedGroup =
          currentSelectedNodeIds.length > 1 &&
          currentSelectedNodeIds.includes(pointerWorkspaceItem.nodeId);
        if (currentSelectedNodeIds.length > 0 && !isDraggingSelectedGroup) {
          clearSelection();
        }
        const pointerPosition = pixiPointerToWorld(event);
        const world = worldRef.current;
        if (world) {
          world.addChild(view.container);
        }
        const topLeftPosition = getViewTopLeftPosition(view);
        dragStateRef.current = {
          nodeId: pointerWorkspaceItem.nodeId,
          pointerId: event.pointerId,
          offsetX: pointerPosition.x - topLeftPosition.x,
          offsetY: pointerPosition.y - topLeftPosition.y,
          pointerStartX: pointerPosition.x,
          pointerStartY: pointerPosition.y,
          startX: topLeftPosition.x,
          startY: topLeftPosition.y,
          draggedNodeIds: isDraggingSelectedGroup
            ? [...currentSelectedNodeIds]
            : [pointerWorkspaceItem.nodeId],
          nodeStartPositions: (isDraggingSelectedGroup
            ? currentSelectedNodeIds
            : [pointerWorkspaceItem.nodeId]
          )
            .map((nodeId) => {
              const draggedView = itemViewsRef.current.get(nodeId);
              if (!draggedView) return null;
              const position = getViewTopLeftPosition(draggedView);
              return {
                nodeId,
                x: position.x,
                y: position.y,
              };
            })
            .filter(
              (
                entry
              ): entry is {
                nodeId: string;
                x: number;
                y: number;
              } => entry != null
            ),
        };
        if (!isDraggingSelectedGroup) {
          onClaimWorkspaceDragRef.current(pointerWorkspaceItem.nodeId);
        }
        const touchedView = itemViewsRef.current.get(pointerWorkspaceItem.nodeId);
        if (touchedView) {
          touchedView.arrivalHighlightUntil = null;
          touchedView.arrivalHighlightStartedAt = null;
        }
        view.container.cursor = "grabbing";
        view.container.alpha = 1;
        drawItemCard(
          view.background,
          view.width,
          pointerItem.id,
          "highlight",
          view.hasCategoryModifier || view.hasActionModifier
        );
      },
    });
  };

  const syncScene = (
    nextWorkspaceItems: WorkspaceItem[],
    {
      arrivalHighlightMaxMs,
    }: {
      arrivalHighlightMaxMs: number;
    }
  ) => {
    const world = worldRef.current;
    if (!world) return;

    const existingViews = itemViewsRef.current;
    const previousNodeIds = previousWorkspaceNodeIdsRef.current;
    const isInitialSceneHydration = previousNodeIds.length === 0;
    const previousCombiningNodeIds = previousCombiningNodeIdsRef.current;
    const nextNodeIds = new Set(nextWorkspaceItems.map((item) => item.nodeId));
    const addedNodeIds = nextWorkspaceItems
      .map((item) => item.nodeId)
      .filter((nodeId) => !previousNodeIds.includes(nodeId));
    const removedNodeIds = previousNodeIds.filter((nodeId) => !nextNodeIds.has(nodeId));
    const removedCombiningNodeIds = removedNodeIds.filter((nodeId) =>
      previousCombiningNodeIds.includes(nodeId)
    );

    existingViews.forEach((view, nodeId) => {
      if (nextNodeIds.has(nodeId)) return;
      if (removedCombiningNodeIds.includes(nodeId)) {
        applyViewState(view, "default", SHRINK_SCALE);
        setViewContentAlpha(view, 0);
        view.destroyWhenSettled = true;
        return;
      }
      view.container.destroy({ children: true });
      existingViews.delete(nodeId);
    });

    nextWorkspaceItems.forEach((workspaceItem) => {
      const item = itemByIdRef.current.get(workspaceItem.itemId);
      if (!item) return;

      let view = existingViews.get(workspaceItem.nodeId);
      if (
        view &&
        (
          view.itemId !== item.id ||
          Boolean(view.badge) !== Boolean(workspaceItem.isNewDiscovery) ||
          view.hasActionModifier !==
            Boolean(
              workspaceItem.actionConstraintName &&
                workspaceItem.actionConstraintNormalizedName
            ) ||
          view.hasCategoryModifier !==
            Boolean(
              workspaceItem.categoryConstraintName &&
                workspaceItem.categoryConstraintNormalizedName
            )
        )
      ) {
        const currentPosition = getViewTopLeftPosition(view);
        const currentScale = view.container.scale.x;
        const currentAlpha = view.contentAlpha;
        const currentArrivalTintProgress = view.arrivalTintProgress;
        const currentArrivalHighlightUntil = view.arrivalHighlightUntil;
        const currentArrivalHighlightStartedAt = view.arrivalHighlightStartedAt;
        view.container.destroy({ children: true });
        existingViews.delete(workspaceItem.nodeId);
        view = createItemView(workspaceItem, item);
        setViewTopLeftPosition(view, currentPosition);
        view.container.scale.set(currentScale);
        view.targetScale = currentScale;
        view.contentAlpha = currentAlpha;
        view.targetContentAlpha = currentAlpha;
        view.container.alpha = currentAlpha;
        if (workspaceItem.arrivalHighlightMode && !isInitialSceneHydration) {
          triggerArrivalHighlight(view, arrivalHighlightMaxMs);
        } else {
          view.arrivalTintProgress = currentArrivalTintProgress;
          view.arrivalHighlightUntil = currentArrivalHighlightUntil;
          view.arrivalHighlightStartedAt = currentArrivalHighlightStartedAt;
        }
        existingViews.set(workspaceItem.nodeId, view);
        world.addChild(view.container);
      }
      if (!view) {
        view = createItemView(workspaceItem, item);
        existingViews.set(workspaceItem.nodeId, view);
        world.addChild(view.container);
        if (workspaceItem.arrivalHighlightMode && !isInitialSceneHydration) {
          triggerArrivalHighlight(view, arrivalHighlightMaxMs);
        }
        if (removedCombiningNodeIds.length > 0 && addedNodeIds.includes(workspaceItem.nodeId)) {
          view.container.scale.set(SPAWN_SCALE);
          view.targetScale = 1;
          view.scaleStep = COMBINE_SCALE_STEP;
          view.contentAlpha = 0;
          view.targetContentAlpha = 1;
        }
      }

      if (dragStateRef.current?.nodeId !== workspaceItem.nodeId) {
        setViewTargetTopLeftPosition(view, workspaceItem.position);
      }
      view.destroyWhenSettled = false;
      const isCombining = combiningNodeIdsRef.current.includes(workspaceItem.nodeId);
      setViewContentAlpha(view, isCombining ? COMBINING_CONTENT_ALPHA : 1);
      if (hoverTargetNodeIdRef.current !== workspaceItem.nodeId) {
        applyViewState(
          view,
          selectedNodeIdsRef.current.includes(workspaceItem.nodeId) ? "highlight" : "default",
          view.targetScale === 1.04 ? 1.04 : 1
        );
      }
    });

    previousWorkspaceNodeIdsRef.current = nextWorkspaceItems.map((item) => item.nodeId);
    previousCombiningNodeIdsRef.current = [...combiningNodeIdsRef.current];
    refreshSelectionOverlay();
    refreshRemoteSelectionOverlay();
    refreshActivityOverlay();
  };

  return {
    itemViewsRef,
    getItemViewBounds,
    getItemViewAtWorldPosition,
    applyViewState,
    setViewContentAlpha,
    triggerCelebration,
    triggerArrivalHighlight,
    syncScene,
  };
}
