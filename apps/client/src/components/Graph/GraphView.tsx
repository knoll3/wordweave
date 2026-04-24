import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Application,
  FederatedPointerEvent,
  Rectangle,
} from "pixi.js";
import type {
  SharedBoardActivityMode,
  SharedPlayerViewportCenter,
} from "../../liveBoardTypes";
import {
  ACTION_MODIFIER_ITEM,
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM,
} from "../../types";
import type { Item, SelectionCombineLayout, WorkspaceItem } from "../../types";
import { SPECIAL_ITEMS } from "../../lib/specialItems";
import type { CatalystAction } from "./CatalystDock";
import GraphControls from "./GraphControls";
import GraphOverlays from "./GraphOverlays";
import { createItemView as createGraphItemView } from "./createItemView";
import { useGraphCamera } from "./hooks/useGraphCamera";
import { useGraphItems } from "./hooks/useGraphItems";
import { usePixiApp } from "./hooks/usePixiApp";
import {
  ARRIVAL_TINT_FADE_STEP,
  CARD_HEIGHT,
  CELEBRATION_PROGRESS_STEP,
  CELEBRATION_TINT_FADE_STEP,
  CLICK_MOVE_THRESHOLD,
  COMBINING_CONTENT_ALPHA,
  COMBINE_SCALE_STEP,
  CONTENT_ALPHA_STEP,
  DOUBLE_CLICK_MS,
  DOUBLE_TAP_DISTANCE_THRESHOLD,
  DRAWER_OPEN_DELAY_MS,
  DUPLICATE_OFFSET_X,
  DUPLICATE_OFFSET_Y,
  GRID_CELL_GAP_X,
  GRID_CELL_GAP_Y,
  INITIAL_WORLD_CENTER,
  ItemView,
  PAN_DRAG_THRESHOLD,
  PLACEHOLDER_WIDTH,
  POSITION_STEP,
  SELECTION_PADDING,
  SHRINK_SCALE,
  SPAWN_SCALE,
  drawCelebrationParticles,
  drawItemCard,
  getViewTopLeftPosition,
  moveToward,
  setViewTargetTopLeftPosition,
  setViewTopLeftPosition,
} from "./graphViewHelpers";
import { rectanglesOverlap } from "./graphGeometry";
import { buildGraphSelectionLayout } from "./graphSelectionLayout";
import {
  getLocalActivityOverlayLabels,
  getRemoteActivityOverlayLabels,
} from "./overlayLabels";
import { calculateRemoteViewportIndicators } from "./remoteViewportIndicators";

interface Props {
  items: Item[];
  workspaceItems: WorkspaceItem[];
  isRestoringWorkspace?: boolean;
  celebratedNodeId?: string | null;
  onAttachActionModifier: (sourceNodeId: string, targetNodeId: string) => void;
  onAttachCategoryModifier: (sourceNodeId: string, targetNodeId: string) => void;
  onMoveWorkspaceItems: (
    items: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) => void;
  onDeleteWorkspaceItems: (nodeIds: string[]) => void;
  onDuplicateWorkspaceItem: (nodeId: string) => void;
  onClaimWorkspaceDrag: (nodeId: string) => void;
  onDragWorkspaceItem: (nodeId: string, position: { x: number; y: number }) => void;
  onReleaseWorkspaceDrag: (nodeId: string, position: { x: number; y: number }) => void;
  onDragWorkspaceGroup?: (
    items: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) => void;
  remoteSelectedNodeIds?: string[];
  remoteSelectionLayout?: SelectionCombineLayout | null;
  remoteActivityNodeIds?: string[];
  remoteActivityLayout?: SelectionCombineLayout | null;
  remoteActivityMode?: SharedBoardActivityMode | null;
  remoteViewportCenters?: SharedPlayerViewportCenter[];
  dragAbortSignal?: { nodeId: string; nonce: number } | null;
  onSelectionStateChange?: (
    nodeIds: string[],
    layout?: SelectionCombineLayout | null
  ) => void;
  onViewportCenterChange?: (position: { x: number; y: number }) => void;
  combiningNodeIds?: string[] | null;
  ponderingNodeIds?: string[] | null;
  webSearchingNodeIds?: string[] | null;
  onClearActionModifier: (nodeId: string) => void;
  onClearCategoryModifier: (nodeId: string) => void;
  onClearWorkspace: () => void;
  onCombineWorkspaceItems: (
    sourceNodeId: string,
    targetNodeId: string,
    resultCenter?: { x: number; y: number }
  ) => void;
  onCombineWorkspaceSelection: (selectionLayout: SelectionCombineLayout) => void;
  onOpenItemDetails: (item: Item) => void;
  catalystActions?: CatalystAction[];
  closeCatalystMenuOnSelect?: boolean;
}

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

type PanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCameraX: number;
  startCameraY: number;
  moved: boolean;
};

type SelectionDragState = {
  pointerId: number | null;
  startScreenX: number;
  startScreenY: number;
};

type TouchGestureState = {
  startCenterX: number;
  startCenterY: number;
  startDistance: number;
  startZoom: number;
  startCenterWorldX: number;
  startCenterWorldY: number;
};

function GraphView({
  items,
  workspaceItems,
  isRestoringWorkspace = false,
  celebratedNodeId = null,
  onAttachCategoryModifier,
  onAttachActionModifier,
  onMoveWorkspaceItems,
  onDeleteWorkspaceItems,
  onDuplicateWorkspaceItem,
  onClaimWorkspaceDrag,
  onDragWorkspaceItem,
  onReleaseWorkspaceDrag,
  onDragWorkspaceGroup,
  remoteSelectedNodeIds = [],
  remoteSelectionLayout = null,
  remoteActivityNodeIds = [],
  remoteActivityLayout = null,
  remoteActivityMode = null,
  remoteViewportCenters = [],
  dragAbortSignal = null,
  onSelectionStateChange,
  onViewportCenterChange,
  combiningNodeIds,
  ponderingNodeIds,
  webSearchingNodeIds,
  onClearCategoryModifier,
  onClearActionModifier,
  onClearWorkspace,
  onCombineWorkspaceItems,
  onCombineWorkspaceSelection,
  onOpenItemDetails,
  catalystActions = [],
  closeCatalystMenuOnSelect = false,
}: Props) {
  const {
    hostRef,
    appRef,
    viewportRef,
    worldRef,
    gridRef,
    backgroundRef,
    resizeFrameRef,
    initializePixiApp,
    cleanupPixiApp,
  } = usePixiApp();
  const {
    cameraRef,
    viewportSnapshot,
    applyCamera,
    setCameraPosition,
    setCameraForWorldPoint,
    zoomAtScreenPoint,
    pixiPointerToWorld,
    screenPointToWorld,
    worldRectToScreenRect,
  } = useGraphCamera({
    appRef,
    viewportRef,
    gridRef,
    onViewportCenterChange,
    onCameraApplied: () => {
      refreshSelectionOverlay();
      refreshRemoteSelectionOverlay();
      refreshRemoteActivityOverlay();
      refreshActivityOverlay();
    },
  });
  const {
    itemViewsRef,
    getItemViewAtWorldPosition,
    applyViewState,
    setViewContentAlpha,
    triggerCelebration,
    triggerArrivalHighlight,
  } = useGraphItems({ worldRef });
  const dragStateRef = useRef<DragState | null>(null);
  const lastItemClickRef = useRef<{
    nodeId: string;
    time: number;
  } | null>(null);
  const pendingDrawerOpenRef = useRef<number | null>(null);
  const hoverTargetNodeIdRef = useRef<string | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const activeTouchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const touchGestureStateRef = useRef<TouchGestureState | null>(null);
  const lastBackgroundTapRef = useRef<{
    x: number;
    y: number;
    time: number;
  } | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const combiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const ponderingNodeIdsRef = useRef<string[]>(ponderingNodeIds ?? []);
  const webSearchingNodeIdsRef = useRef<string[]>(webSearchingNodeIds ?? []);
  const previousCombiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const previousWorkspaceNodeIdsRef = useRef<string[]>(workspaceItems.map((item) => item.nodeId));
  const workspaceItemsRef = useRef<WorkspaceItem[]>(workspaceItems);
  const itemByIdRef = useRef<Map<number, Item>>(new Map());
  const onMoveWorkspaceItemsRef = useRef(onMoveWorkspaceItems);
  const onDeleteWorkspaceItemsRef = useRef(onDeleteWorkspaceItems);
  const onDuplicateWorkspaceItemRef = useRef(onDuplicateWorkspaceItem);
  const onClaimWorkspaceDragRef = useRef(onClaimWorkspaceDrag);
  const onDragWorkspaceItemRef = useRef(onDragWorkspaceItem);
  const onReleaseWorkspaceDragRef = useRef(onReleaseWorkspaceDrag);
  const onDragWorkspaceGroupRef = useRef(onDragWorkspaceGroup);
  const remoteSelectedNodeIdsRef = useRef<string[]>(remoteSelectedNodeIds);
  const remoteSelectionLayoutRef = useRef<SelectionCombineLayout | null>(remoteSelectionLayout);
  const remoteActivityNodeIdsRef = useRef<string[]>(remoteActivityNodeIds);
  const remoteActivityLayoutRef = useRef<SelectionCombineLayout | null>(remoteActivityLayout);
  const remoteActivityModeRef = useRef<SharedBoardActivityMode | null>(remoteActivityMode);
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  const onAttachCategoryModifierRef = useRef(onAttachCategoryModifier);
  const onAttachActionModifierRef = useRef(onAttachActionModifier);
  const onCombineWorkspaceItemsRef = useRef(onCombineWorkspaceItems);
  const onCombineWorkspaceSelectionRef = useRef(onCombineWorkspaceSelection);
  const onClearCategoryModifierRef = useRef(onClearCategoryModifier);
  const onClearActionModifierRef = useRef(onClearActionModifier);
  const onOpenItemDetailsRef = useRef(onOpenItemDetails);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectionDragRect, setSelectionDragRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectionDragRectRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionLayout, setSelectionLayout] = useState<SelectionCombineLayout | null>(null);
  const [isCatalystDockOpen, setIsCatalystDockOpen] = useState(false);
  const [selectionOverlayRect, setSelectionOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [remoteSelectionOverlayRect, setRemoteSelectionOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [remoteActivityOverlayRect, setRemoteActivityOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [activeOverlayWorldBounds, setActiveOverlayWorldBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [activityOverlayRect, setActivityOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectionModeRef = useRef(false);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const selectionLayoutRef = useRef<SelectionCombineLayout | null>(null);
  const activeOverlayWorldBoundsRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const lastCelebratedNodeIdRef = useRef<string | null>(null);
  const ARRIVAL_HIGHLIGHT_MAX_MS = 30_000;
  const ARRIVAL_BOUNCE_MS = 500;

  const itemById = useMemo(() => {
    const next = new Map(items.map((item) => [item.id, item]));
    for (const item of SPECIAL_ITEMS) {
      next.set(item.id, item);
    }
    next.set(ACTION_MODIFIER_ITEM.id, ACTION_MODIFIER_ITEM);
    next.set(CATEGORY_MODIFIER_ITEM.id, CATEGORY_MODIFIER_ITEM);
    next.set(COMBINE_RESULT_PLACEHOLDER_ITEM.id, COMBINE_RESULT_PLACEHOLDER_ITEM);
    next.set(CREATIVE_ITEM.id, CREATIVE_ITEM);
    return next;
  }, [items]);

  itemByIdRef.current = itemById;
  workspaceItemsRef.current = workspaceItems;
  combiningNodeIdsRef.current = combiningNodeIds ?? [];
  ponderingNodeIdsRef.current = ponderingNodeIds ?? [];
  webSearchingNodeIdsRef.current = webSearchingNodeIds ?? [];
  onMoveWorkspaceItemsRef.current = onMoveWorkspaceItems;
  onDeleteWorkspaceItemsRef.current = onDeleteWorkspaceItems;
  onDuplicateWorkspaceItemRef.current = onDuplicateWorkspaceItem;
  onClaimWorkspaceDragRef.current = onClaimWorkspaceDrag;
  onDragWorkspaceItemRef.current = onDragWorkspaceItem;
  onReleaseWorkspaceDragRef.current = onReleaseWorkspaceDrag;
  onDragWorkspaceGroupRef.current = onDragWorkspaceGroup;
  remoteSelectedNodeIdsRef.current = remoteSelectedNodeIds;
  remoteSelectionLayoutRef.current = remoteSelectionLayout;
  remoteActivityNodeIdsRef.current = remoteActivityNodeIds;
  remoteActivityLayoutRef.current = remoteActivityLayout;
  remoteActivityModeRef.current = remoteActivityMode;
  onSelectionStateChangeRef.current = onSelectionStateChange;
  onAttachCategoryModifierRef.current = onAttachCategoryModifier;
  onAttachActionModifierRef.current = onAttachActionModifier;
  onCombineWorkspaceItemsRef.current = onCombineWorkspaceItems;
  onCombineWorkspaceSelectionRef.current = onCombineWorkspaceSelection;
  onClearCategoryModifierRef.current = onClearCategoryModifier;
  onClearActionModifierRef.current = onClearActionModifier;
  onOpenItemDetailsRef.current = onOpenItemDetails;
  selectionModeRef.current = isSelectionMode;
  selectedNodeIdsRef.current = selectedNodeIds;
  selectionLayoutRef.current = selectionLayout;
  activeOverlayWorldBoundsRef.current = activeOverlayWorldBounds;

  const frameWorkspaceItems = (
    app: Application,
    itemsToFrame: WorkspaceItem[]
  ) => {
    const anchorItem = itemsToFrame[itemsToFrame.length - 1];
    if (!anchorItem) {
      cameraRef.current = {
        x: app.renderer.width / 2 - INITIAL_WORLD_CENTER.x,
        y: app.renderer.height / 2 - INITIAL_WORLD_CENTER.y,
        zoom: 1,
      };
      return;
    }

    cameraRef.current = {
      x: app.renderer.width / 2 - (anchorItem.position.x + PLACEHOLDER_WIDTH / 2),
      y: app.renderer.height / 2 - (anchorItem.position.y + CARD_HEIGHT / 2),
      zoom: 1,
    };
  };

  const drawBackground = () => {
    const app = appRef.current;
    const background = backgroundRef.current;
    if (!app || !background) return;
    background.clear();
    background
      .rect(0, 0, app.renderer.width, app.renderer.height)
      .fill({ color: 0x000000, alpha: 0.001 });
    background.hitArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);
    app.stage.hitArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);
  };

  const drawGrid = () => {
    const app = appRef.current;
    const grid = gridRef.current;
    if (!app || !grid) return;
    grid.width = app.renderer.width;
    grid.height = app.renderer.height;
  };

  const resizeApp = () => {
    const app = appRef.current;
    const host = hostRef.current;
    if (!app || !host) return;
    if (host.clientWidth < 40 || host.clientHeight < 40) return;
    app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    drawBackground();
    drawGrid();
    applyCamera();
  };

  const clearHoverTarget = () => {
    const hoverTargetNodeId = hoverTargetNodeIdRef.current;
    if (!hoverTargetNodeId) return;
    const hoverView = itemViewsRef.current.get(hoverTargetNodeId);
    if (hoverView) {
      applyViewState(
        hoverView,
        selectedNodeIdsRef.current.includes(hoverTargetNodeId) ? "highlight" : "default",
        1
      );
    }
    hoverTargetNodeIdRef.current = null;
  };

  const clearSelection = () => {
    setSelectedNodeIds([]);
    setSelectionLayout(null);
    setSelectionOverlayRect(null);
  };

  const getCurrentOverlayNodeIds = () =>
    webSearchingNodeIdsRef.current.length > 0
      ? webSearchingNodeIdsRef.current
      : ponderingNodeIdsRef.current;

  const isNodeCoveredByOverlay = (nodeId: string) => getCurrentOverlayNodeIds().includes(nodeId);
  const isNodeReservedByLocalActivity = (nodeId: string) =>
    combiningNodeIdsRef.current.includes(nodeId);
  const isNodeReservedByRemoteSelection = (nodeId: string) =>
    remoteSelectedNodeIdsRef.current.includes(nodeId);
  const isNodeReservedByRemoteActivity = (nodeId: string) =>
    remoteActivityModeRef.current != null &&
    (remoteActivityNodeIdsRef.current.includes(nodeId) ||
      remoteActivityLayoutRef.current?.placeholderNodeId === nodeId);

  const cancelActiveDrag = () => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const view = itemViewsRef.current.get(dragState.nodeId);
    if (view) {
      view.container.alpha = 1;
      view.container.cursor = "grab";
      applyViewState(view, "default", 1);
    }
    dragStateRef.current = null;
    clearHoverTarget();
  };

  const beginTouchGesture = () => {
    const touchPoints = [...activeTouchPointsRef.current.values()];
    if (touchPoints.length < 2) {
      touchGestureStateRef.current = null;
      return;
    }

    const [firstPoint, secondPoint] = touchPoints;
    const centerScreenX = (firstPoint.x + secondPoint.x) / 2;
    const centerScreenY = (firstPoint.y + secondPoint.y) / 2;
    const centerWorld = screenPointToWorld(centerScreenX, centerScreenY);
    const startDistance = Math.max(
      1,
      Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
    );

    selectionDragRef.current = null;
    selectionDragRectRef.current = null;
    setSelectionDragRect(null);
    cancelActiveDrag();
    panStateRef.current = null;

    touchGestureStateRef.current = {
      startCenterX: centerScreenX,
      startCenterY: centerScreenY,
      startDistance,
      startZoom: cameraRef.current.zoom,
      startCenterWorldX: centerWorld.x,
      startCenterWorldY: centerWorld.y,
    };
  };

  const clearPendingDrawerOpen = () => {
    if (pendingDrawerOpenRef.current != null) {
      window.clearTimeout(pendingDrawerOpenRef.current);
      pendingDrawerOpenRef.current = null;
    }
  };

  const scheduleDrawerOpen = (item: Item) => {
    clearPendingDrawerOpen();
    pendingDrawerOpenRef.current = window.setTimeout(() => {
      pendingDrawerOpenRef.current = null;
      onOpenItemDetailsRef.current(item);
    }, DRAWER_OPEN_DELAY_MS);
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
        const liveView = itemViewsRef.current.get(nodeId);
        const position =
          options?.preferLayoutPositions && layoutPosition
            ? layoutPosition
            : liveView
              ? getViewTopLeftPosition(liveView)
              : layoutPosition;
        const width =
          relevantLayout?.placeholderNodeId === nodeId
            ? Math.max(
                ...relevantLayout.nodeIds.map(
                  (layoutNodeId) => itemViewsRef.current.get(layoutNodeId)?.width ?? 0
                ),
                PLACEHOLDER_WIDTH
              )
            : liveView?.width ?? 0;
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

  const refreshRemoteSelectionOverlay = () => {
    const currentRemoteSelectedNodeIds = remoteSelectedNodeIdsRef.current;
    if (currentRemoteSelectedNodeIds.length < 2) {
      setRemoteSelectionOverlayRect(null);
      return;
    }
    const worldBounds = getSelectionWorldBounds(
      currentRemoteSelectedNodeIds,
      remoteSelectionLayoutRef.current
    );
    if (!worldBounds) {
      setRemoteSelectionOverlayRect(null);
      return;
    }
    setRemoteSelectionOverlayRect(worldRectToScreenRect(worldBounds));
  };

  const refreshRemoteActivityOverlay = () => {
    if (
      remoteActivityModeRef.current == null ||
      remoteActivityNodeIdsRef.current.length === 0
    ) {
      setRemoteActivityOverlayRect(null);
      return;
    }
    const worldBounds = getSelectionWorldBounds(
      remoteActivityNodeIdsRef.current,
      remoteActivityLayoutRef.current,
      { preferLayoutPositions: true }
    );
    if (!worldBounds) {
      setRemoteActivityOverlayRect(null);
      return;
    }
    setRemoteActivityOverlayRect(worldRectToScreenRect(worldBounds));
  };

  const refreshActivityOverlay = () => {
    if (!activeOverlayWorldBoundsRef.current) {
      setActivityOverlayRect(null);
      return;
    }

    setActivityOverlayRect(worldRectToScreenRect(activeOverlayWorldBoundsRef.current));
  };

  const buildSelectionLayout = (nodeIds: string[]): SelectionCombineLayout | null => {
    const selectedWorkspaceItems = nodeIds
      .map((nodeId) => workspaceItemsRef.current.find((item) => item.nodeId === nodeId))
      .filter(Boolean) as WorkspaceItem[];

    const selectedViews = nodeIds
      .map((nodeId) => {
        const view = itemViewsRef.current.get(nodeId);
        return view
          ? {
              nodeId,
              position: getViewTopLeftPosition(view),
              width: view.width,
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

  const canAttachModifierToView = (view: ItemView) =>
    view.itemId > 0 && view.itemId !== COMBINE_RESULT_PLACEHOLDER_ITEM_ID;

  const duplicateWorkspaceItem = (nodeId: string) => {
    const sourceItem = workspaceItemsRef.current.find((item) => item.nodeId === nodeId);
    if (!sourceItem) return;
    onDuplicateWorkspaceItemRef.current(nodeId);
  };

  const clearSelectedWorkspaceItems = () => {
    const selectedIds = new Set(selectedNodeIdsRef.current);
    if (selectedIds.size === 0) {
      return;
    }

    onDeleteWorkspaceItemsRef.current([...selectedIds]);
    clearSelection();
    setIsSelectionMode(false);
  };

  const updateHoverTarget = (draggedNodeId: string) => {
    const world = worldRef.current;
    const draggedView = itemViewsRef.current.get(draggedNodeId);
    if (!world || !draggedView) return;

    const draggedBounds = {
      ...getViewTopLeftPosition(draggedView),
      width: draggedView.width,
      height: CARD_HEIGHT,
    };

    let nextHoverTargetNodeId: string | null = null;
    let nextHoverTargetZIndex = -1;

    itemViewsRef.current.forEach((view, nodeId) => {
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

    const nextHoverView = itemViewsRef.current.get(nextHoverTargetNodeId);
    if (!nextHoverView) return;
    applyViewState(nextHoverView, "highlight", 1.04);
    hoverTargetNodeIdRef.current = nextHoverTargetNodeId;
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

  const syncScene = (nextWorkspaceItems: WorkspaceItem[]) => {
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
          triggerArrivalHighlight(view, ARRIVAL_HIGHLIGHT_MAX_MS);
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
          triggerArrivalHighlight(view, ARRIVAL_HIGHLIGHT_MAX_MS);
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
      const isCombining = (combiningNodeIds ?? []).includes(workspaceItem.nodeId);
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

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    const handleWindowResize = () => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeApp();
        resizeFrameRef.current = 0;
      });
    };

    const handleStagePointerDown = (event: FederatedPointerEvent) => {
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
      if (dragStateRef.current) return;
      if (
        event.pointerType === "touch" &&
        (event.target === appRef.current?.stage || event.target === backgroundRef.current)
      ) {
        clearPendingDrawerOpen();
        lastItemClickRef.current = null;
        const now = Date.now();
        const lastBackgroundTap = lastBackgroundTapRef.current;
        if (
          lastBackgroundTap &&
          now - lastBackgroundTap.time <= DOUBLE_CLICK_MS &&
          Math.hypot(
            event.global.x - lastBackgroundTap.x,
            event.global.y - lastBackgroundTap.y
          ) <= DOUBLE_TAP_DISTANCE_THRESHOLD
        ) {
          lastBackgroundTapRef.current = null;
          beginSelectionDrag(event.pointerId, event.global.x, event.global.y);
          return;
        }
        lastBackgroundTapRef.current = {
          x: event.global.x,
          y: event.global.y,
          time: now,
        };
      }
      if (selectionModeRef.current) {
        beginSelectionDrag(event.pointerId, event.global.x, event.global.y);
        return;
      }
      if (event.target !== appRef.current?.stage && event.target !== backgroundRef.current) {
        return;
      }
      clearPendingDrawerOpen();
      lastItemClickRef.current = null;
      panStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.nativeEvent.clientX,
        startClientY: event.nativeEvent.clientY,
        startCameraX: cameraRef.current.x,
        startCameraY: cameraRef.current.y,
        moved: false,
      };
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        const rect = host.getBoundingClientRect();
        const worldPosition = screenPointToWorld(
          event.clientX - rect.left,
          event.clientY - rect.top
        );
        if (dragState.draggedNodeIds.length > 1) {
          const deltaX = worldPosition.x - dragState.pointerStartX;
          const deltaY = worldPosition.y - dragState.pointerStartY;
          const liveMoves: Array<{ nodeId: string; position: { x: number; y: number } }> = [];
          for (const startPosition of dragState.nodeStartPositions) {
            const view = itemViewsRef.current.get(startPosition.nodeId);
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
          const view = itemViewsRef.current.get(dragState.nodeId);
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
        return;
      }

      if (event.pointerType === "touch") {
        const app = appRef.current;
        const rect = app?.canvas.getBoundingClientRect();
        if (rect) {
          activeTouchPointsRef.current.set(event.pointerId, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }

        const touchGestureState = touchGestureStateRef.current;
        if (touchGestureState && activeTouchPointsRef.current.size >= 2) {
          const [firstPoint, secondPoint] = [...activeTouchPointsRef.current.values()];
          const currentCenterX = (firstPoint.x + secondPoint.x) / 2;
          const currentCenterY = (firstPoint.y + secondPoint.y) / 2;
          const currentDistance = Math.max(
            1,
            Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
          );

          setCameraForWorldPoint(
            { x: currentCenterX, y: currentCenterY },
            {
              x: touchGestureState.startCenterWorldX,
              y: touchGestureState.startCenterWorldY,
            },
            touchGestureState.startZoom * (currentDistance / touchGestureState.startDistance)
          );
          return;
        }
      }

      const selectionDrag = selectionDragRef.current;
      if (
        selectionDrag &&
        (selectionDrag.pointerId === null || selectionDrag.pointerId === event.pointerId)
      ) {
        const rect = host.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
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
        return;
      }

      const panState = panStateRef.current;
      if (!panState || panState.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - panState.startClientX;
      const deltaY = event.clientY - panState.startClientY;
      if (!panState.moved && Math.hypot(deltaX, deltaY) >= PAN_DRAG_THRESHOLD) {
        panState.moved = true;
      }
      setCameraPosition({
        x: panState.startCameraX + deltaX,
        y: panState.startCameraY + deltaY,
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointsRef.current.delete(event.pointerId);
        if (activeTouchPointsRef.current.size < 2) {
          touchGestureStateRef.current = null;
        } else if (touchGestureStateRef.current) {
          beginTouchGesture();
        }
      }

      const selectionDrag = selectionDragRef.current;
      if (
        selectionDrag &&
        (selectionDrag.pointerId === null || selectionDrag.pointerId === event.pointerId)
      ) {
        selectionDragRef.current = null;
        const finalRect = selectionDragRectRef.current;
        setSelectionDragRect(null);
        selectionDragRectRef.current = null;
        if (!finalRect || finalRect.width < 6 || finalRect.height < 6) {
          setIsSelectionMode(false);
          return;
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
            const view = itemViewsRef.current.get(item.nodeId);
            if (!view) return false;
            const position = getViewTopLeftPosition(view);
            return (
              position.x >= worldRect.left &&
              position.y >= worldRect.top &&
              position.x + view.width <= worldRect.right &&
              position.y + CARD_HEIGHT <= worldRect.bottom
            );
          })
          .map((item) => item.nodeId);

        if (selectedIds.length >= 2) {
          setSelectedNodeIds(selectedIds);
          setSelectionLayout(null);
        } else {
          clearSelection();
        }
        setIsSelectionMode(false);
        return;
      }

      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        const view = itemViewsRef.current.get(dragState.nodeId);
        const dropTargetNodeId = hoverTargetNodeIdRef.current;
        dragStateRef.current = null;
        clearHoverTarget();
        if (dragState.draggedNodeIds.length > 1) {
          const nextPositions = new Map(
            dragState.draggedNodeIds.map((nodeId) => {
              const draggedView = itemViewsRef.current.get(nodeId);
              const topLeftPosition = draggedView
                ? getViewTopLeftPosition(draggedView)
                : null;
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
          lastItemClickRef.current = null;
          return;
        }
        if (view) {
          view.container.alpha = 1;
          view.container.cursor = "grab";
          applyViewState(view, "default", 1);
          const hostRect = host.getBoundingClientRect();
          const releasedOutsideWorkspace =
            event.clientX < hostRect.left ||
            event.clientX > hostRect.right ||
            event.clientY < hostRect.top ||
            event.clientY > hostRect.bottom;
          const topLeftPosition = getViewTopLeftPosition(view);
          const nextPosition = {
            x: Math.round(topLeftPosition.x),
            y: Math.round(topLeftPosition.y),
          };
          const movedDistance = Math.hypot(
            nextPosition.x - dragState.startX,
            nextPosition.y - dragState.startY
          );
          const isClickRelease = movedDistance <= CLICK_MOVE_THRESHOLD;
          const dropTargetView = dropTargetNodeId
            ? itemViewsRef.current.get(dropTargetNodeId)
            : null;
          const resultCenter = dropTargetView
            ? {
                x: (nextPosition.x + getViewTopLeftPosition(dropTargetView).x) / 2,
                y: (nextPosition.y + getViewTopLeftPosition(dropTargetView).y) / 2,
              }
            : undefined;
          if (releasedOutsideWorkspace) {
            lastItemClickRef.current = null;
            onDeleteWorkspaceItemsRef.current([dragState.nodeId]);
            return;
          }
          onReleaseWorkspaceDragRef.current(dragState.nodeId, nextPosition);
          if (
            (view.itemId === CATEGORY_MODIFIER_ITEM_ID ||
              view.itemId === ACTION_MODIFIER_ITEM_ID) &&
            dropTargetNodeId &&
            dropTargetNodeId !== dragState.nodeId
          ) {
            const dropTargetView = itemViewsRef.current.get(dropTargetNodeId);
            if (dropTargetView && canAttachModifierToView(dropTargetView)) {
              lastItemClickRef.current = null;
              if (view.itemId === ACTION_MODIFIER_ITEM_ID) {
                onAttachActionModifierRef.current(dragState.nodeId, dropTargetNodeId);
              } else {
                onAttachCategoryModifierRef.current(dragState.nodeId, dropTargetNodeId);
              }
              return;
            }
          }
          if (dropTargetNodeId && dropTargetNodeId !== dragState.nodeId) {
            lastItemClickRef.current = null;
            onCombineWorkspaceItemsRef.current(
              dragState.nodeId,
              dropTargetNodeId,
              resultCenter
            );
          } else if (isClickRelease) {
            const now = Date.now();
            const lastClick = lastItemClickRef.current;
            if (
              lastClick &&
              lastClick.nodeId === dragState.nodeId &&
              now - lastClick.time <= DOUBLE_CLICK_MS
            ) {
              clearPendingDrawerOpen();
              duplicateWorkspaceItem(dragState.nodeId);
              lastItemClickRef.current = null;
            } else {
              const clickedItem = itemByIdRef.current.get(view.itemId);
              if (
                clickedItem &&
                clickedItem.id !== COMBINE_RESULT_PLACEHOLDER_ITEM_ID
              ) {
                scheduleDrawerOpen(clickedItem);
              }
              lastItemClickRef.current = {
                nodeId: dragState.nodeId,
                time: now,
              };
            }
          } else {
            lastItemClickRef.current = null;
          }
        }
      }

      const panState = panStateRef.current;
      if (panState && panState.pointerId === event.pointerId) {
        if (!panState.moved && selectedNodeIdsRef.current.length > 0) {
          clearSelection();
        }
        panStateRef.current = null;
      }
    };

    const handleWheel = (event: WheelEvent) => {
      const app = appRef.current;
      const element = app?.canvas as HTMLCanvasElement | undefined;
      if (!app || !element) return;
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      zoomAtScreenPoint(
        { x: screenX, y: screenY },
        event.deltaY < 0 ? "in" : "out"
      );
    };

    const handleCanvasMouseDownCapture = (event: MouseEvent) => {
      if (event.detail !== 2) return;
      if (dragStateRef.current || selectionModeRef.current) return;
      const rect = host.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldPosition = screenPointToWorld(screenX, screenY);
      if (getItemViewAtWorldPosition(worldPosition)) {
        return;
      }
      clearPendingDrawerOpen();
      lastItemClickRef.current = null;
      selectionDragRef.current = null;
      selectionDragRectRef.current = null;
      setSelectionDragRect(null);
      clearSelection();
      setIsSelectionMode(true);
      beginSelectionDrag(null, screenX, screenY);
      panStateRef.current = null;
      event.preventDefault();
      event.stopPropagation();
    };

    const init = async () => {
      const app = await initializePixiApp({
        isCancelled: () => cancelled,
        onResize: handleWindowResize,
      });
      if (!app) return;

      frameWorkspaceItems(app, workspaceItems);

      drawBackground();
      drawGrid();
      applyCamera();
      syncScene(workspaceItems);
      app.ticker.add(() => {
        let shouldRefreshSelectionOverlay = false;
        let shouldRefreshRemoteSelectionOverlay = false;
        let shouldRefreshRemoteActivityOverlay = false;
        const now = Date.now();
        itemViewsRef.current.forEach((view) => {
          const positionStepX = Math.max(
            POSITION_STEP,
            Math.abs(view.targetX - view.container.x) * 0.24
          );
          const positionStepY = Math.max(
            POSITION_STEP,
            Math.abs(view.targetY - view.container.y) * 0.24
          );
          const nextX = moveToward(view.container.x, view.targetX, positionStepX);
          const nextY = moveToward(view.container.y, view.targetY, positionStepY);
          if (
            (selectedNodeIdsRef.current.includes(view.nodeId) ||
              selectionLayoutRef.current?.placeholderNodeId === view.nodeId) &&
            (nextX !== view.container.x || nextY !== view.container.y)
          ) {
            shouldRefreshSelectionOverlay = true;
          }
          if (
            (remoteSelectedNodeIdsRef.current.includes(view.nodeId) ||
              remoteSelectionLayoutRef.current?.placeholderNodeId === view.nodeId) &&
            (nextX !== view.container.x || nextY !== view.container.y)
          ) {
            shouldRefreshRemoteSelectionOverlay = true;
          }
          if (
            remoteActivityModeRef.current &&
            (remoteActivityNodeIdsRef.current.includes(view.nodeId) ||
              remoteActivityLayoutRef.current?.placeholderNodeId === view.nodeId) &&
            (nextX !== view.container.x || nextY !== view.container.y)
          ) {
            shouldRefreshRemoteActivityOverlay = true;
          }
          view.container.x = nextX;
          view.container.y = nextY;
          if (view.loader) {
            view.loader.rotation += 0.18;
          }

          const currentScale = view.container.scale.x;
          const appliedScale = moveToward(
            currentScale,
            view.targetScale,
            view.scaleStep
          );
          view.container.scale.set(appliedScale);

          view.contentAlpha = moveToward(
            view.contentAlpha,
            view.targetContentAlpha,
            CONTENT_ALPHA_STEP
          );
          view.container.alpha = view.contentAlpha;

          const arrivalElapsedMs =
            view.arrivalHighlightStartedAt != null ? now - view.arrivalHighlightStartedAt : null;
          const isArrivalHoldActive =
            view.arrivalHighlightUntil != null && now < view.arrivalHighlightUntil;

          if (view.arrivalHighlightUntil != null && now < view.arrivalHighlightUntil) {
            view.arrivalTintProgress = 1;
          } else {
            view.arrivalHighlightUntil = null;
            view.arrivalHighlightStartedAt = null;
          }

          if (view.arrivalHighlightUntil == null && view.arrivalTintProgress > 0) {
            view.arrivalTintProgress = Math.max(
              0,
              view.arrivalTintProgress - ARRIVAL_TINT_FADE_STEP
            );
          }

          if (view.celebrationTintHoldFrames > 0) {
            view.celebrationTintHoldFrames -= 1;
          } else if (view.celebrationTintProgress > 0) {
            view.celebrationTintProgress = Math.max(
              0,
              view.celebrationTintProgress - CELEBRATION_TINT_FADE_STEP
            );
          }

          if (view.celebration && view.celebrationProgress > 0) {
            view.celebrationProgress = Math.max(
              0,
              view.celebrationProgress - CELEBRATION_PROGRESS_STEP
            );
            const completion = 1 - view.celebrationProgress;
            drawItemCard(
              view.background,
              view.width,
              view.itemId,
              "highlight",
              view.hasCategoryModifier || view.hasActionModifier,
              view.arrivalTintProgress,
              view.celebrationTintProgress
            );
            view.celebration.visible = true;
            view.celebration.alpha =
              Math.sin(completion * Math.PI) * 0.92 * view.contentAlpha;
            const scale = 0.82 + completion * 0.48;
            view.celebration.scale.set(scale);
            if (view.celebrationParticles) {
              drawCelebrationParticles(
                view.celebrationParticles,
                view.width,
                view.celebrationProgress
              );
              view.celebrationParticles.visible = true;
              view.celebrationParticles.alpha = view.contentAlpha;
            }
            const pulseBoost =
              Math.sin(completion * Math.PI * 2.6) *
              0.065 *
              Math.max(view.celebrationProgress, 0.28);
            view.container.scale.set(appliedScale + pulseBoost);
            if (view.celebrationProgress === 0) {
              view.celebration.visible = false;
              view.celebration.alpha = 0;
              if (view.celebrationParticles) {
                view.celebrationParticles.visible = false;
                view.celebrationParticles.clear();
                view.celebrationParticles.alpha = 0;
              }
              applyViewState(
                view,
                selectedNodeIdsRef.current.includes(view.nodeId) ? "highlight" : "default",
                1
              );
            }
          } else if (view.celebrationTintProgress > 0) {
            const tintPulsePhase =
              Math.sin(Date.now() * 0.006 + view.width * 0.02) * 0.5 + 0.5;
            drawItemCard(
              view.background,
              view.width,
              view.itemId,
              selectedNodeIdsRef.current.includes(view.nodeId) ? "highlight" : "default",
              view.hasCategoryModifier || view.hasActionModifier,
              view.arrivalTintProgress,
              view.celebrationTintProgress,
              tintPulsePhase
            );
            view.container.scale.set(appliedScale);
          } else if (isArrivalHoldActive) {
            const arrivalTintAmount =
              arrivalElapsedMs != null && arrivalElapsedMs >= ARRIVAL_BOUNCE_MS
                ? 0.64 + (Math.sin((arrivalElapsedMs - ARRIVAL_BOUNCE_MS) * 0.0032) * 0.5 + 0.5) * 0.42
                : 1;
            drawItemCard(
              view.background,
              view.width,
              view.itemId,
              selectedNodeIdsRef.current.includes(view.nodeId) ? "highlight" : "default",
              view.hasCategoryModifier || view.hasActionModifier,
              arrivalTintAmount
            );
            if (arrivalElapsedMs != null && arrivalElapsedMs < ARRIVAL_BOUNCE_MS) {
              const progress = arrivalElapsedMs / ARRIVAL_BOUNCE_MS;
              const arrivalBounce =
                Math.sin(progress * Math.PI * 3) *
                0.03 *
                Math.max(1 - progress, 0.25);
              view.container.scale.set(appliedScale + arrivalBounce);
            } else {
              view.container.scale.set(appliedScale);
            }
          } else if (view.arrivalTintProgress > 0) {
            drawItemCard(
              view.background,
              view.width,
              view.itemId,
              selectedNodeIdsRef.current.includes(view.nodeId) ? "highlight" : "default",
              view.hasCategoryModifier || view.hasActionModifier,
              view.arrivalTintProgress
            );
            const arrivalPulse =
              view.arrivalHighlightStartedAt != null
                ? (() => {
                    const elapsedMs = now - view.arrivalHighlightStartedAt;
                    if (elapsedMs < ARRIVAL_BOUNCE_MS) {
                      const progress = elapsedMs / ARRIVAL_BOUNCE_MS;
                      return Math.sin(progress * Math.PI * 1.15) * 0.085 * (1 - progress * 0.2);
                    }
                    const pulseElapsedMs = elapsedMs - ARRIVAL_BOUNCE_MS;
                    return (Math.sin((pulseElapsedMs / 1000) * Math.PI * 2.1) * 0.5 + 0.5) * 0.018;
                  })()
                : Math.sin((1 - view.arrivalTintProgress) * Math.PI * 3) *
                    0.03 *
                    Math.max(view.arrivalTintProgress, 0.25);
            view.container.scale.set(appliedScale + arrivalPulse);
          }

          if (
            view.destroyWhenSettled &&
            Math.abs(view.container.scale.x - view.targetScale) < 0.001 &&
            Math.abs(view.contentAlpha - view.targetContentAlpha) < 0.01
          ) {
            view.container.destroy({ children: true });
            itemViewsRef.current.delete(view.nodeId);
          }
        });
        if (shouldRefreshSelectionOverlay) {
          refreshSelectionOverlay();
        }
        if (shouldRefreshRemoteSelectionOverlay) {
          refreshRemoteSelectionOverlay();
        }
        if (shouldRefreshRemoteActivityOverlay) {
          refreshRemoteActivityOverlay();
        }
      });

      app.stage.on("pointerdown", handleStagePointerDown);
      app.canvas.addEventListener("mousedown", handleCanvasMouseDownCapture, true);
      window.addEventListener("pointermove", handleWindowPointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      app.canvas.addEventListener("wheel", handleWheel, { passive: false });
      window.addEventListener("resize", handleWindowResize);

    };

    void init();

    return () => {
      cancelled = true;
      clearPendingDrawerOpen();
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      const app = appRef.current;
      if (app) {
        app.stage.off("pointerdown", handleStagePointerDown);
        app.canvas.removeEventListener("mousedown", handleCanvasMouseDownCapture, true);
        app.canvas.removeEventListener("wheel", handleWheel);
      }
      window.removeEventListener("resize", handleWindowResize);
      itemViewsRef.current.clear();
      cleanupPixiApp();
      dragStateRef.current = null;
      hoverTargetNodeIdRef.current = null;
      panStateRef.current = null;
      lastItemClickRef.current = null;
      selectionDragRef.current = null;
      selectionDragRectRef.current = null;
      activeTouchPointsRef.current.clear();
      touchGestureStateRef.current = null;
      lastBackgroundTapRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncScene(workspaceItems);
  }, [combiningNodeIds, itemById, ponderingNodeIds, selectedNodeIds, webSearchingNodeIds, workspaceItems]);

  useEffect(() => {
    if (!celebratedNodeId) {
      lastCelebratedNodeIdRef.current = null;
      return;
    }
    if (lastCelebratedNodeIdRef.current === celebratedNodeId) {
      return;
    }
    const view = itemViewsRef.current.get(celebratedNodeId);
    if (!view) {
      return;
    }
    lastCelebratedNodeIdRef.current = celebratedNodeId;
    triggerCelebration(view);
  }, [celebratedNodeId, workspaceItems]);

  useEffect(() => {
    refreshSelectionOverlay();
  }, [selectionLayout]);

  useEffect(() => {
    refreshRemoteSelectionOverlay();
  }, [remoteSelectedNodeIds, workspaceItems]);

  useEffect(() => {
    refreshRemoteActivityOverlay();
  }, [remoteActivityNodeIds, remoteActivityLayout, remoteActivityMode, workspaceItems]);

  useEffect(() => {
    if ((combiningNodeIds ?? []).length === 0) {
      return;
    }
    const localActiveNodeIds = new Set(combiningNodeIds ?? []);
    if (
      dragStateRef.current?.draggedNodeIds.some((nodeId) =>
        localActiveNodeIds.has(nodeId)
      )
    ) {
      cancelActiveDrag();
    }
  }, [combiningNodeIds]);

  useEffect(() => {
    if (remoteActivityMode == null || remoteActivityNodeIds.length === 0) {
      return;
    }
    const remoteActiveNodeIds = new Set(remoteActivityNodeIds);
    if (
      dragStateRef.current?.draggedNodeIds.some((nodeId) =>
        remoteActiveNodeIds.has(nodeId)
      )
    ) {
      cancelActiveDrag();
    }

    const nextSelectedNodeIds = selectedNodeIds.filter(
      (nodeId) => !remoteActiveNodeIds.has(nodeId)
    );
    if (nextSelectedNodeIds.length === selectedNodeIds.length) {
      return;
    }
    if (nextSelectedNodeIds.length >= 2) {
      setSelectedNodeIds(nextSelectedNodeIds);
      setSelectionLayout(null);
      return;
    }
    clearSelection();
  }, [remoteActivityNodeIds, remoteActivityMode, selectedNodeIds]);

  useEffect(() => {
    if (!dragAbortSignal) {
      return;
    }
    const dragState = dragStateRef.current;
    if (!dragState || dragState.nodeId !== dragAbortSignal.nodeId) {
      return;
    }
    const view = itemViewsRef.current.get(dragAbortSignal.nodeId);
    const workspaceItem = workspaceItemsRef.current.find(
      (item) => item.nodeId === dragAbortSignal.nodeId
    );
    if (view && workspaceItem) {
      setViewTopLeftPosition(view, workspaceItem.position);
      setViewTargetTopLeftPosition(view, workspaceItem.position);
    }
    cancelActiveDrag();
  }, [dragAbortSignal]);

  useEffect(() => {
    const remoteReservedNodeIds = new Set(remoteSelectedNodeIds);
    if (remoteReservedNodeIds.size === 0) {
      return;
    }

    const nextSelectedNodeIds = selectedNodeIds.filter(
      (nodeId) => !remoteReservedNodeIds.has(nodeId)
    );
    if (nextSelectedNodeIds.length === selectedNodeIds.length) {
      return;
    }
    if (nextSelectedNodeIds.length >= 2) {
      setSelectedNodeIds(nextSelectedNodeIds);
      setSelectionLayout(null);
      return;
    }
    clearSelection();
  }, [remoteSelectedNodeIds, selectedNodeIds]);

  useEffect(() => {
    onSelectionStateChangeRef.current?.(selectedNodeIds, selectionLayout);
  }, [selectedNodeIds, selectionLayout]);

  useEffect(() => {
    refreshActivityOverlay();
  }, [activeOverlayWorldBounds]);

  useEffect(() => {
    const currentOverlayNodeIds = getCurrentOverlayNodeIds();
    if (currentOverlayNodeIds.length === 0) {
      setActiveOverlayWorldBounds(null);
      setActivityOverlayRect(null);
      return;
    }

    const worldBounds = getSelectionWorldBounds(
      currentOverlayNodeIds,
      selectionLayoutRef.current,
      { preferLayoutPositions: true }
    );
    if (!worldBounds) {
      return;
    }

    setActiveOverlayWorldBounds((prev) => {
      if (
        prev &&
        prev.x === worldBounds.x &&
        prev.y === worldBounds.y &&
        prev.width === worldBounds.width &&
        prev.height === worldBounds.height
      ) {
        return prev;
      }
      return worldBounds;
    });

    if (
      selectedNodeIdsRef.current.some((nodeId) => currentOverlayNodeIds.includes(nodeId)) ||
      selectionLayoutRef.current
    ) {
      clearSelection();
    }

    selectionDragRef.current = null;
    selectionDragRectRef.current = null;
    setSelectionDragRect(null);
    cancelActiveDrag();
  }, [ponderingNodeIds, webSearchingNodeIds]);

  useEffect(() => {
    if (!selectionLayout) return;
    const stillCombining = [selectionLayout.placeholderNodeId, ...selectionLayout.nodeIds].some(
      (nodeId) => (combiningNodeIds ?? []).includes(nodeId)
    );
    const placeholderItem = workspaceItems.find(
      (item) => item.nodeId === selectionLayout.placeholderNodeId
    );
    if (
      !stillCombining &&
      placeholderItem &&
      placeholderItem.itemId !== COMBINE_RESULT_PLACEHOLDER_ITEM_ID
    ) {
      clearSelection();
    }
  }, [combiningNodeIds, selectionLayout, workspaceItems]);

  useEffect(() => {
    if (selectedNodeIds.length < 2) {
      return;
    }
    const remainingSelectedCount = selectedNodeIds.filter((nodeId) =>
      workspaceItems.some((item) => item.nodeId === nodeId)
    ).length;
    if (remainingSelectedCount === 0) {
      clearSelection();
      setIsSelectionMode(false);
    }
  }, [selectedNodeIds, workspaceItems]);

  const isSelectionCombining =
    selectionLayout?.nodeIds.some((nodeId) => (combiningNodeIds ?? []).includes(nodeId)) ?? false;
  const isSelectionPondering =
    selectionLayout?.nodeIds.some((nodeId) => (ponderingNodeIds ?? []).includes(nodeId)) ?? false;
  const isSelectionWebSearching =
    selectionLayout?.nodeIds.some((nodeId) => (webSearchingNodeIds ?? []).includes(nodeId)) ?? false;
  const activeActivityOverlayRect =
    (isSelectionWebSearching || isSelectionPondering) && selectionOverlayRect
      ? selectionOverlayRect
      : activityOverlayRect;
  const localActivityLabels = getLocalActivityOverlayLabels(
    isSelectionWebSearching || (webSearchingNodeIds?.length ?? 0) > 0
  );
  const remoteActivityLabels = getRemoteActivityOverlayLabels(remoteActivityMode);
  const remoteViewportIndicators = useMemo(
    () => calculateRemoteViewportIndicators(viewportSnapshot, remoteViewportCenters),
    [remoteViewportCenters, viewportSnapshot]
  );

  return (
    <div ref={hostRef} className="graph-pixi-host">
      {isRestoringWorkspace ? (
        <div className="graph-placeholder graph-placeholder-loading">
          <div className="graph-placeholder-loading-title">Restoring workspace</div>
          <div className="graph-placeholder-loading-copy">
            Bringing your saved items back onto the board.
          </div>
        </div>
      ) : null}
      <GraphControls
        catalystActions={catalystActions}
        isCatalystDockOpen={isCatalystDockOpen}
        onToggleCatalystDock={() => setIsCatalystDockOpen((current) => !current)}
        closeCatalystMenuOnSelect={closeCatalystMenuOnSelect}
        isSelectionMode={isSelectionMode}
        hasSelection={selectedNodeIds.length > 0}
        onToggleSelectionMode={() => {
          if (isSelectionMode || selectedNodeIds.length > 0) {
            setIsSelectionMode(false);
            clearSelection();
            return;
          }
          setIsSelectionMode(true);
        }}
        onClear={selectedNodeIds.length > 0 ? clearSelectedWorkspaceItems : onClearWorkspace}
      />
      <GraphOverlays
        selectionDragRect={selectionDragRect}
        activeActivityOverlayRect={activeActivityOverlayRect}
        localActivityLabels={localActivityLabels}
        remoteActivityOverlayRect={remoteActivityOverlayRect}
        remoteActivityMode={remoteActivityMode}
        remoteActivityLabels={remoteActivityLabels}
        selectionOverlayRect={selectionOverlayRect}
        selectedNodeCount={selectedNodeIds.length}
        isSelectionCombining={isSelectionCombining}
        onCombineSelection={() => {
          const nextLayout = buildSelectionLayout(selectedNodeIdsRef.current);
          if (!nextLayout) return;
          applySelectionLayout(nextLayout);
          onCombineWorkspaceSelectionRef.current(nextLayout);
        }}
        remoteSelectionOverlayRect={remoteSelectionOverlayRect}
        remoteSelectedNodeCount={remoteSelectedNodeIds.length}
        remoteViewportIndicators={remoteViewportIndicators}
      />
    </div>
  );
}

export default GraphView;
