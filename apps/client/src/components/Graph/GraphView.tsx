import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
} from "pixi.js";
import {
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CRAFT_ITEM,
  CRAFT_ITEM_ID,
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
  EVOLVE_ITEM,
  EVOLVE_ITEM_ID,
  OPPOSITE_ITEM,
  OPPOSITE_ITEM_ID,
  POP_CULTURE_ITEM,
  POP_CULTURE_ITEM_ID,
  RANDOMIZE_ITEM,
  RANDOMIZE_ITEM_ID,
  SPLIT_ITEM,
  SPLIT_ITEM_ID,
  WORD_COMBINE_ITEM,
  WORD_COMBINE_ITEM_ID,
} from "../../types";
import type { Item, SelectionCombineLayout, WorkspaceItem } from "../../types";

interface Props {
  items: Item[];
  workspaceItems: WorkspaceItem[];
  onWorkspaceItemsChange: (update: React.SetStateAction<WorkspaceItem[]>) => void;
  onViewportCenterChange?: (position: { x: number; y: number }) => void;
  combiningNodeIds?: string[] | null;
  onClearWorkspace: () => void;
  onCombineWorkspaceItems: (
    sourceNodeId: string,
    targetNodeId: string,
    resultCenter?: { x: number; y: number }
  ) => void;
  onCombineWorkspaceSelection: (selectionLayout: SelectionCombineLayout) => void;
}

type CameraState = {
  x: number;
  y: number;
  zoom: number;
};

type DragState = {
  nodeId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
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

type ItemView = {
  nodeId: string;
  container: Container;
  background: Graphics;
  loader: Graphics | null;
  icon: Text;
  label: Text;
  badge: Text | null;
  itemId: number;
  width: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  scaleStep: number;
  contentAlpha: number;
  targetContentAlpha: number;
  destroyWhenSettled: boolean;
};

type ItemVisualState = "default" | "highlight";

const INITIAL_WORLD_CENTER = { x: 260, y: 180 };
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.12;
const CARD_HEIGHT = 42;
const CARD_HORIZONTAL_PADDING = 18;
const CARD_RADIUS = 10;
const GRID_SPACING = 28;
const GRID_RADIUS = 1.15;
const GRID_EXTENT = 4800;
const HOVER_SCALE_STEP = 0.012;
const COMBINE_SCALE_STEP = 0.075;
const POSITION_STEP = 26;
const CONTENT_ALPHA_STEP = 0.11;
const COMBINING_CONTENT_ALPHA = 0.5;
const SPAWN_SCALE = 0.18;
const SHRINK_SCALE = 0.18;
const GRID_CELL_GAP_X = 18;
const GRID_CELL_GAP_Y = 16;
const SELECTION_PADDING = 14;
const PLACEHOLDER_WIDTH = 120;
const PAN_DRAG_THRESHOLD = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function moveToward(current: number, target: number, step: number) {
  if (Math.abs(target - current) <= step) {
    return target;
  }
  return current + Math.sign(target - current) * step;
}

function getNodeTint(itemId: number) {
  if (itemId === CREATIVE_ITEM_ID) return 0xa78bfa;
  if (itemId === EVOLVE_ITEM_ID) return 0xf472b6;
  if (itemId === CRAFT_ITEM_ID) return 0xf59e0b;
  if (itemId === POP_CULTURE_ITEM_ID) return 0xfacc15;
  if (itemId === SPLIT_ITEM_ID) return 0xfb923c;
  if (itemId === OPPOSITE_ITEM_ID) return 0x93c5fd;
  if (itemId === RANDOMIZE_ITEM_ID) return 0x6ee7b7;
  if (itemId === WORD_COMBINE_ITEM_ID) return 0xd8b4fe;
  if (itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID) return 0x64748b;
  return 0x94a3b8;
}

function drawItemCard(
  background: Graphics,
  width: number,
  itemId: number,
  state: ItemVisualState
) {
  const isHighlighted = state === "highlight";
  background.clear();
  background
    .roundRect(0, 0, width, CARD_HEIGHT, CARD_RADIUS)
    .fill({ color: isHighlighted ? 0x132033 : 0x0f172a, alpha: 1 })
    .stroke({
      width: 1.5,
      color: getNodeTint(itemId),
      alpha: isHighlighted ? 0.5 : 0.42,
    });
}

function setViewTopLeftPosition(view: ItemView, position: { x: number; y: number }) {
  view.container.position.set(position.x + view.width / 2, position.y + CARD_HEIGHT / 2);
  view.targetX = view.container.x;
  view.targetY = view.container.y;
}

function setViewTargetTopLeftPosition(view: ItemView, position: { x: number; y: number }) {
  view.targetX = position.x + view.width / 2;
  view.targetY = position.y + CARD_HEIGHT / 2;
}

function getViewTopLeftPosition(view: ItemView) {
  return {
    x: view.container.x - view.width / 2,
    y: view.container.y - CARD_HEIGHT / 2,
  };
}

function GraphView({
  items,
  workspaceItems,
  onWorkspaceItemsChange,
  onViewportCenterChange,
  combiningNodeIds,
  onClearWorkspace,
  onCombineWorkspaceItems,
  onCombineWorkspaceSelection,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Container | null>(null);
  const worldRef = useRef<Container | null>(null);
  const gridRef = useRef<Graphics | null>(null);
  const backgroundRef = useRef<Graphics | null>(null);
  const itemViewsRef = useRef<Map<string, ItemView>>(new Map());
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, zoom: 1 });
  const dragStateRef = useRef<DragState | null>(null);
  const hoverTargetNodeIdRef = useRef<string | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const resizeFrameRef = useRef<number>(0);
  const combiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const previousCombiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const previousWorkspaceNodeIdsRef = useRef<string[]>(workspaceItems.map((item) => item.nodeId));
  const workspaceItemsRef = useRef<WorkspaceItem[]>(workspaceItems);
  const itemByIdRef = useRef<Map<number, Item>>(new Map());
  const onWorkspaceItemsChangeRef = useRef(onWorkspaceItemsChange);
  const onViewportCenterChangeRef = useRef(onViewportCenterChange);
  const onCombineWorkspaceItemsRef = useRef(onCombineWorkspaceItems);
  const onCombineWorkspaceSelectionRef = useRef(onCombineWorkspaceSelection);
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
  const [selectionOverlayRect, setSelectionOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectionModeRef = useRef(false);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const selectionLayoutRef = useRef<SelectionCombineLayout | null>(null);

  const itemById = useMemo(() => {
    const next = new Map(items.map((item) => [item.id, item]));
    next.set(CRAFT_ITEM.id, CRAFT_ITEM);
    next.set(COMBINE_RESULT_PLACEHOLDER_ITEM.id, COMBINE_RESULT_PLACEHOLDER_ITEM);
    next.set(CREATIVE_ITEM.id, CREATIVE_ITEM);
    next.set(EVOLVE_ITEM.id, EVOLVE_ITEM);
    next.set(POP_CULTURE_ITEM.id, POP_CULTURE_ITEM);
    next.set(SPLIT_ITEM.id, SPLIT_ITEM);
    next.set(OPPOSITE_ITEM.id, OPPOSITE_ITEM);
    next.set(RANDOMIZE_ITEM.id, RANDOMIZE_ITEM);
    next.set(WORD_COMBINE_ITEM.id, WORD_COMBINE_ITEM);
    return next;
  }, [items]);

  itemByIdRef.current = itemById;
  workspaceItemsRef.current = workspaceItems;
  combiningNodeIdsRef.current = combiningNodeIds ?? [];
  onWorkspaceItemsChangeRef.current = onWorkspaceItemsChange;
  onViewportCenterChangeRef.current = onViewportCenterChange;
  onCombineWorkspaceItemsRef.current = onCombineWorkspaceItems;
  onCombineWorkspaceSelectionRef.current = onCombineWorkspaceSelection;
  selectionModeRef.current = isSelectionMode;
  selectedNodeIdsRef.current = selectedNodeIds;
  selectionLayoutRef.current = selectionLayout;

  const updateViewportCenter = () => {
    const app = appRef.current;
    const handleViewportCenterChange = onViewportCenterChangeRef.current;
    if (!app || !handleViewportCenterChange) return;
    const camera = cameraRef.current;
    handleViewportCenterChange({
      x: (app.renderer.width / 2 - camera.x) / camera.zoom,
      y: (app.renderer.height / 2 - camera.y) / camera.zoom,
    });
  };

  const applyCamera = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const camera = cameraRef.current;
    viewport.position.set(camera.x, camera.y);
    viewport.scale.set(camera.zoom);
    updateViewportCenter();
    refreshSelectionOverlay();
  };

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

  const pixiPointerToWorld = (event: FederatedPointerEvent) => {
    const camera = cameraRef.current;
    return {
      x: (event.global.x - camera.x) / camera.zoom,
      y: (event.global.y - camera.y) / camera.zoom,
    };
  };

  const screenPointToWorld = (screenX: number, screenY: number) => {
    const camera = cameraRef.current;
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  };

  const worldRectToScreenRect = (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const camera = cameraRef.current;
    return {
      left: rect.x * camera.zoom + camera.x,
      top: rect.y * camera.zoom + camera.y,
      width: rect.width * camera.zoom,
      height: rect.height * camera.zoom,
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
    const grid = gridRef.current;
    if (!grid) return;

    grid.clear();
    grid
      .rect(-GRID_EXTENT, -GRID_EXTENT, GRID_EXTENT * 2, GRID_EXTENT * 2)
      .fill({ color: 0x020617, alpha: 0.001 });

    for (let x = -GRID_EXTENT; x <= GRID_EXTENT; x += GRID_SPACING) {
      for (let y = -GRID_EXTENT; y <= GRID_EXTENT; y += GRID_SPACING) {
        grid.circle(x, y, GRID_RADIUS).fill({ color: 0x94a3b8, alpha: 0.14 });
      }
    }
  };

  const resizeApp = () => {
    const app = appRef.current;
    const host = hostRef.current;
    if (!app || !host) return;
    app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    drawBackground();
    applyCamera();
  };

  const applyViewState = (view: ItemView, state: ItemVisualState, scale = 1) => {
    drawItemCard(view.background, view.width, view.itemId, state);
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
    layout?: SelectionCombineLayout | null
  ) => {
    const involvedNodeIds = new Set(nodeIds);
    if (layout) {
      involvedNodeIds.add(layout.placeholderNodeId);
    }
    const entries = Array.from(involvedNodeIds)
      .map((nodeId) => {
        const layoutPosition =
          layout?.placeholderNodeId === nodeId
            ? layout.placeholderPosition
            : layout?.nodePositions.find((entry) => entry.nodeId === nodeId)?.position;
        const liveView = itemViewsRef.current.get(nodeId);
        const position = layoutPosition ?? (liveView ? getViewTopLeftPosition(liveView) : null);
        const width =
          layout?.placeholderNodeId === nodeId
            ? Math.max(
                ...nodeIds.map(
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

  const buildSelectionLayout = (nodeIds: string[]): SelectionCombineLayout | null => {
    if (nodeIds.length < 2) return null;

    const selectedViews = nodeIds
      .map((nodeId) => {
        const view = itemViewsRef.current.get(nodeId);
        return view ? { nodeId, view } : null;
      })
      .filter(Boolean) as Array<{ nodeId: string; view: ItemView }>;

    if (selectedViews.length < 2) return null;

    const bounds = selectedViews.reduce(
      (acc, entry) => {
        const position = getViewTopLeftPosition(entry.view);
        return {
          left: Math.min(acc.left, position.x),
          top: Math.min(acc.top, position.y),
          right: Math.max(acc.right, position.x + entry.view.width),
          bottom: Math.max(acc.bottom, position.y + CARD_HEIGHT),
          totalWidth: acc.totalWidth + entry.view.width,
        };
      },
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
        totalWidth: 0,
      }
    );

    const orderedNodeIds = [...selectedViews]
      .sort((a, b) => {
        const aPosition = getViewTopLeftPosition(a.view);
        const bPosition = getViewTopLeftPosition(b.view);
        if (aPosition.y !== bPosition.y) return aPosition.y - bPosition.y;
        return aPosition.x - bPosition.x;
      })
      .map((entry) => entry.nodeId);

    const placeholderWidth = Math.max(
      PLACEHOLDER_WIDTH,
      Math.round(bounds.totalWidth / selectedViews.length)
    );
    const itemsForLayout = [
      ...orderedNodeIds.map((nodeId) => ({
        nodeId,
        width: itemViewsRef.current.get(nodeId)?.width ?? 0,
        isPlaceholder: false,
      })),
      {
        nodeId: `workspace-selection-placeholder-${Date.now()}`,
        width: placeholderWidth,
        isPlaceholder: true,
      },
    ];

    const selectionWidth = bounds.right - bounds.left;
    const averageWidth = bounds.totalWidth / selectedViews.length;
    const targetRowWidth = Math.max(
      selectionWidth,
      Math.round(Math.sqrt(itemsForLayout.length) * averageWidth)
    );

    const rows: Array<Array<(typeof itemsForLayout)[number]>> = [];
    let currentRow: Array<(typeof itemsForLayout)[number]> = [];
    let currentRowWidth = 0;

    itemsForLayout.forEach((entry) => {
      const nextWidth = currentRow.length === 0 ? entry.width : currentRowWidth + GRID_CELL_GAP_X + entry.width;
      if (currentRow.length > 0 && nextWidth > targetRowWidth) {
        rows.push(currentRow);
        currentRow = [entry];
        currentRowWidth = entry.width;
        return;
      }
      currentRow.push(entry);
      currentRowWidth = nextWidth;
    });
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    const gridHeight = rows.length * CARD_HEIGHT + (rows.length - 1) * GRID_CELL_GAP_Y;
    const currentCenterY = (bounds.top + bounds.bottom) / 2;
    const startX = Math.round(bounds.left);
    const startY = Math.round(currentCenterY - gridHeight / 2);
    const nodePositions: SelectionCombineLayout["nodePositions"] = [];
    let placeholderPosition = { x: startX, y: startY };

    rows.forEach((row, rowIndex) => {
      let rowX = startX;
      const rowY = startY + rowIndex * (CARD_HEIGHT + GRID_CELL_GAP_Y);
      row.forEach((entry) => {
        if (entry.isPlaceholder) {
          placeholderPosition = { x: Math.round(rowX), y: Math.round(rowY) };
        } else {
          nodePositions.push({
            nodeId: entry.nodeId,
            position: {
              x: Math.round(rowX),
              y: Math.round(rowY),
            },
          });
        }
        rowX += entry.width + GRID_CELL_GAP_X;
      });
    });

    const placeholderNodeId = itemsForLayout[itemsForLayout.length - 1].nodeId;

    return {
      nodeIds: orderedNodeIds,
      nodePositions,
      placeholderNodeId,
      placeholderPosition,
    };
  };

  const applySelectionLayout = (nextLayout: SelectionCombineLayout | null) => {
    if (!nextLayout) {
      clearSelection();
      return;
    }

    onWorkspaceItemsChangeRef.current((prev) =>
      prev.map((item) => {
        const nextPosition = nextLayout.nodePositions.find(
          (entry) => entry.nodeId === item.nodeId
        )?.position;
        return nextPosition ? { ...item, position: nextPosition } : item;
      })
    );
    setSelectedNodeIds(nextLayout.nodeIds);
    setSelectionLayout(nextLayout);
  };

  const rectanglesOverlap = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  const updateHoverTarget = (draggedNodeId: string) => {
    const world = worldRef.current;
    const draggedView = itemViewsRef.current.get(draggedNodeId);
    if (!world || !draggedView) return;

    const draggedBounds = {
      ...getViewTopLeftPosition(draggedView),
      width: draggedView.width,
      height: CARD_HEIGHT,
    };

    const hoveredCandidates = Array.from(itemViewsRef.current.entries())
      .filter(([nodeId]) => nodeId !== draggedNodeId)
      .map(([nodeId, view]) => ({
        nodeId,
        view,
        zIndex: world.getChildIndex(view.container),
      }))
      .filter(({ view }) =>
        rectanglesOverlap(draggedBounds, {
          ...getViewTopLeftPosition(view),
          width: view.width,
          height: CARD_HEIGHT,
        })
      )
      .sort((a, b) => b.zIndex - a.zIndex);

    const nextHoverTargetNodeId = hoveredCandidates[0]?.nodeId ?? null;
    if (nextHoverTargetNodeId === hoverTargetNodeIdRef.current) return;

    clearHoverTarget();

    if (!nextHoverTargetNodeId) return;

    const nextHoverView = itemViewsRef.current.get(nextHoverTargetNodeId);
    if (!nextHoverView) return;
    applyViewState(nextHoverView, "highlight", 1.04);
    hoverTargetNodeIdRef.current = nextHoverTargetNodeId;
  };

  const createItemView = (workspaceItem: WorkspaceItem, item: Item): ItemView => {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "grab";
    const isPlaceholder = item.id === COMBINE_RESULT_PLACEHOLDER_ITEM_ID;

    const icon = new Text({
      text: isPlaceholder ? "" : item.icon || "•",
      style: {
        fill: 0xe5e7eb,
        fontFamily: "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif",
        fontSize: 20,
        fontWeight: "600",
        wordWrap: false,
        breakWords: false,
      },
    });
    const labelValue = isPlaceholder ? "" : item.name;
    const label = new Text({
      text: labelValue,
      style: {
        fill: 0xe5e7eb,
        fontFamily: "Trebuchet MS, Verdana, sans-serif",
        fontSize: 17,
        fontWeight: "600",
        wordWrap: false,
        breakWords: false,
      },
    });
    const loader = isPlaceholder ? new Graphics() : null;
    const badge = workspaceItem.isNewDiscovery
      ? new Text({
          text: "✦",
          style: {
            fill: 0xfacc15,
            fontFamily: "Trebuchet MS, Verdana, sans-serif",
            fontSize: 15,
            fontWeight: "700",
          },
        })
      : null;

    const background = new Graphics();
    if (loader) {
      loader
        .arc(0, 0, 7, 0.2 * Math.PI, 1.7 * Math.PI)
        .stroke({ width: 3, color: 0xe5e7eb, alpha: 0.95 });
    }
    const contentWidth = isPlaceholder
      ? PLACEHOLDER_WIDTH
      : CARD_HORIZONTAL_PADDING * 2 +
        icon.width +
        10 +
        label.width +
        (badge ? badge.width + 12 : 0);
    const cardWidth = contentWidth;
    drawItemCard(background, cardWidth, item.id, "default");

    icon.x = CARD_HORIZONTAL_PADDING;
    icon.y = Math.round((CARD_HEIGHT - icon.height) / 2) - 1;

    label.x = icon.x + icon.width + 10;
    label.y = Math.round((CARD_HEIGHT - label.height) / 2) - 1;

    if (loader) {
      loader.x = Math.round(cardWidth / 2);
      loader.y = Math.round(CARD_HEIGHT / 2);
    }

    if (badge) {
      badge.x = cardWidth - CARD_HORIZONTAL_PADDING - badge.width;
      badge.y = Math.round((CARD_HEIGHT - badge.height) / 2) - 1;
    }

    container.addChild(background);
    if (loader) {
      container.addChild(loader);
    } else {
      container.addChild(icon);
      container.addChild(label);
    }
    if (badge) {
      container.addChild(badge);
    }

    container.pivot.set(cardWidth / 2, CARD_HEIGHT / 2);
    container.on("pointerdown", (event) => {
      if (selectionModeRef.current) {
        return;
      }
      event.stopPropagation();
      if (selectedNodeIdsRef.current.length > 0) {
        clearSelection();
      }
      const pointerPosition = pixiPointerToWorld(event);
      const world = worldRef.current;
      if (world) {
        world.addChild(container);
      }
      const topLeftPosition = getViewTopLeftPosition({
        container,
        background,
        loader,
        icon,
        label,
        badge,
        itemId: item.id,
        width: cardWidth,
        targetX: container.x,
        targetY: container.y,
        targetScale: 1,
        scaleStep: HOVER_SCALE_STEP,
        contentAlpha: 1,
        targetContentAlpha: 1,
        destroyWhenSettled: false,
        nodeId: workspaceItem.nodeId,
      });
      dragStateRef.current = {
        nodeId: workspaceItem.nodeId,
        pointerId: event.pointerId,
        offsetX: pointerPosition.x - topLeftPosition.x,
        offsetY: pointerPosition.y - topLeftPosition.y,
      };
      container.cursor = "grabbing";
      container.alpha = 1;
      drawItemCard(background, cardWidth, item.id, "highlight");
    });

    const view = {
      nodeId: workspaceItem.nodeId,
      container,
      background,
      loader,
      icon,
      label,
      badge,
      itemId: item.id,
      width: cardWidth,
      targetX: 0,
      targetY: 0,
      targetScale: 1,
      scaleStep: HOVER_SCALE_STEP,
      contentAlpha: 1,
      targetContentAlpha: 1,
      destroyWhenSettled: false,
    };
    setViewTopLeftPosition(view, workspaceItem.position);
    return view;
  };

  const syncScene = (nextWorkspaceItems: WorkspaceItem[]) => {
    const world = worldRef.current;
    if (!world) return;

    const existingViews = itemViewsRef.current;
    const previousNodeIds = previousWorkspaceNodeIdsRef.current;
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
        (view.itemId !== item.id || Boolean(view.badge) !== Boolean(workspaceItem.isNewDiscovery))
      ) {
        const currentPosition = getViewTopLeftPosition(view);
        const currentScale = view.container.scale.x;
        const currentAlpha = view.contentAlpha;
        view.container.destroy({ children: true });
        existingViews.delete(workspaceItem.nodeId);
        view = createItemView(workspaceItem, item);
        setViewTopLeftPosition(view, currentPosition);
        view.container.scale.set(currentScale);
        view.targetScale = currentScale;
        view.contentAlpha = currentAlpha;
        view.targetContentAlpha = currentAlpha;
        view.container.alpha = currentAlpha;
        existingViews.set(workspaceItem.nodeId, view);
        world.addChild(view.container);
      }
      if (!view) {
        view = createItemView(workspaceItem, item);
        existingViews.set(workspaceItem.nodeId, view);
        world.addChild(view.container);
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

    const handleStagePointerMove = (event: FederatedPointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        const worldPosition = pixiPointerToWorld(event);
        const view = itemViewsRef.current.get(dragState.nodeId);
        if (view) {
          setViewTopLeftPosition(view, {
            x: worldPosition.x - dragState.offsetX,
            y: worldPosition.y - dragState.offsetY,
          });
          updateHoverTarget(dragState.nodeId);
        }
      }
    };

    const handleStagePointerDown = (event: FederatedPointerEvent) => {
      if (dragStateRef.current) return;
      if (selectionModeRef.current) {
        beginSelectionDrag(event.pointerId, event.global.x, event.global.y);
        return;
      }
      if (event.target !== appRef.current?.stage && event.target !== backgroundRef.current) {
        return;
      }
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
      cameraRef.current.x = panState.startCameraX + deltaX;
      cameraRef.current.y = panState.startCameraY + deltaY;
      applyCamera();
    };

    const handlePointerUp = (event: PointerEvent) => {
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
            onWorkspaceItemsChangeRef.current((prev) =>
              prev.filter((item) => item.nodeId !== dragState.nodeId)
            );
            return;
          }
          onWorkspaceItemsChangeRef.current((prev) =>
            prev.map((item) =>
              item.nodeId === dragState.nodeId
                ? { ...item, position: nextPosition }
                : item
            )
          );
          if (dropTargetNodeId && dropTargetNodeId !== dragState.nodeId) {
            onCombineWorkspaceItemsRef.current(
              dragState.nodeId,
              dropTargetNodeId,
              resultCenter
            );
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
      const camera = cameraRef.current;
      const previousZoom = camera.zoom;
      const zoomDelta = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      const nextZoom = clamp(previousZoom * zoomDelta, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === previousZoom) return;

      const worldX = (screenX - camera.x) / previousZoom;
      const worldY = (screenY - camera.y) / previousZoom;
      camera.zoom = nextZoom;
      camera.x = screenX - worldX * nextZoom;
      camera.y = screenY - worldY * nextZoom;
      applyCamera();
    };

    const handleCanvasMouseDownCapture = (event: MouseEvent) => {
      if (event.detail !== 2) return;
      if (dragStateRef.current || selectionModeRef.current) return;
      const rect = host.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
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
      const app = new Application();
      await app.init({
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
      });
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      appRef.current = app;
      host.appendChild(app.canvas);
      app.stage.eventMode = "static";

      const background = new Graphics();
      background.eventMode = "static";
      background.cursor = "grab";
      backgroundRef.current = background;
      app.stage.addChild(background);

      const viewport = new Container();
      const grid = new Graphics();
      const world = new Container();
      viewport.addChild(grid);
      viewport.addChild(world);
      app.stage.addChild(viewport);
      viewportRef.current = viewport;
      gridRef.current = grid;
      worldRef.current = world;

      frameWorkspaceItems(app, workspaceItems);

      drawBackground();
      drawGrid();
      applyCamera();
      syncScene(workspaceItems);
      app.ticker.add(() => {
        itemViewsRef.current.forEach((view) => {
          view.container.x = moveToward(view.container.x, view.targetX, POSITION_STEP);
          view.container.y = moveToward(view.container.y, view.targetY, POSITION_STEP);
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

          if (
            view.destroyWhenSettled &&
            Math.abs(view.container.scale.x - view.targetScale) < 0.001 &&
            Math.abs(view.contentAlpha - view.targetContentAlpha) < 0.01
          ) {
            view.container.destroy({ children: true });
            itemViewsRef.current.delete(view.nodeId);
          }
        });
      });

      app.stage.on("pointerdown", handleStagePointerDown);
      app.stage.on("globalpointermove", handleStagePointerMove);
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
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      const app = appRef.current;
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = 0;
      }
      if (app) {
        app.stage.off("pointerdown", handleStagePointerDown);
        app.stage.off("globalpointermove", handleStagePointerMove);
        app.canvas.removeEventListener("mousedown", handleCanvasMouseDownCapture, true);
        app.canvas.removeEventListener("wheel", handleWheel);
        app.destroy(true, { children: true });
      }
      window.removeEventListener("resize", handleWindowResize);
      itemViewsRef.current.clear();
      appRef.current = null;
      viewportRef.current = null;
      gridRef.current = null;
      worldRef.current = null;
      backgroundRef.current = null;
      dragStateRef.current = null;
      hoverTargetNodeIdRef.current = null;
      panStateRef.current = null;
      selectionDragRef.current = null;
      selectionDragRectRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncScene(workspaceItems);
  }, [combiningNodeIds, itemById, selectedNodeIds, workspaceItems]);

  useEffect(() => {
    refreshSelectionOverlay();
  }, [selectionLayout]);

  useEffect(() => {
    if (!selectionLayout) return;
    const stillCombining = [selectionLayout.placeholderNodeId, ...selectionLayout.nodeIds].some(
      (nodeId) => (combiningNodeIds ?? []).includes(nodeId)
    );
    if (!stillCombining && workspaceItems.some((item) => item.nodeId === selectionLayout.placeholderNodeId)) {
      clearSelection();
    }
  }, [combiningNodeIds, selectionLayout, workspaceItems]);

  const isSelectionCombining =
    selectionLayout?.nodeIds.some((nodeId) => (combiningNodeIds ?? []).includes(nodeId)) ?? false;

  return (
    <div ref={hostRef} className="graph-pixi-host">
      {workspaceItems.length === 0 ? (
        <div className="graph-placeholder">
          Click items in the library to place them into the workspace.
        </div>
      ) : null}
      <button
        type="button"
        className={`button ${isSelectionMode || selectedNodeIds.length > 0 ? "primary" : "secondary"} graph-selection-button`}
        aria-label={
          isSelectionMode
            ? "Cancel selection mode"
            : selectedNodeIds.length > 0
              ? "Clear selection"
              : "Enter selection mode"
        }
        onClick={() => {
          if (isSelectionMode || selectedNodeIds.length > 0) {
            setIsSelectionMode(false);
            clearSelection();
            return;
          }
          setIsSelectionMode(true);
        }}
      >
        <span aria-hidden="true">{isSelectionMode ? "×" : "⬚"}</span>
      </button>
      {selectionDragRect ? (
        <div
          className="graph-selection-drag-box"
          style={{
            left: selectionDragRect.left,
            top: selectionDragRect.top,
            width: selectionDragRect.width,
            height: selectionDragRect.height,
          }}
        />
      ) : null}
      {selectionOverlayRect && selectedNodeIds.length >= 2 ? (
        <div
          className="graph-selection-overlay"
          style={{
            left: selectionOverlayRect.left,
            top: selectionOverlayRect.top,
            width: selectionOverlayRect.width,
            height: selectionOverlayRect.height,
          }}
        >
          <button
            type="button"
            className="button primary graph-selection-combine-button"
            onClick={() => {
              const nextLayout = buildSelectionLayout(selectedNodeIdsRef.current);
              if (!nextLayout) return;
              applySelectionLayout(nextLayout);
              onCombineWorkspaceSelectionRef.current(nextLayout);
            }}
            disabled={isSelectionCombining}
          >
            {isSelectionCombining ? "Combining..." : "Combine"}
          </button>
        </div>
      ) : null}
      {workspaceItems.length > 0 ? (
        <button
          type="button"
          className="button secondary graph-clear-button"
          onClick={onClearWorkspace}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

export default GraphView;
