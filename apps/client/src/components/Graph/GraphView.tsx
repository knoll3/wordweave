import React, { useEffect, useMemo, useRef } from "react";
import {
  Application,
  Container,
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
import type { Item, WorkspaceItem } from "../../types";

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
};

type ItemView = {
  nodeId: string;
  container: Container;
  background: Graphics;
  label: Text;
  badge: Text | null;
  itemId: number;
  width: number;
  targetScale: number;
  contentAlpha: number;
  targetContentAlpha: number;
  destroyWhenSettled: boolean;
};

type ItemVisualState = "default" | "highlight";

const INITIAL_WORLD_CENTER = { x: 260, y: 180 };
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.12;
const CARD_HEIGHT = 46;
const CARD_MIN_WIDTH = 180;
const CARD_MAX_WIDTH = 320;
const CARD_HORIZONTAL_PADDING = 18;
const CARD_RADIUS = 10;
const GRID_SPACING = 28;
const GRID_RADIUS = 1.15;
const GRID_EXTENT = 4800;
const SCALE_EASING = 0.14;
const CONTENT_ALPHA_EASING = 0.18;
const COMBINING_CONTENT_ALPHA = 0.5;
const SPAWN_SCALE = 0.18;
const SHRINK_SCALE = 0.18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const resizeFrameRef = useRef<number>(0);
  const combiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const previousCombiningNodeIdsRef = useRef<string[]>(combiningNodeIds ?? []);
  const previousWorkspaceNodeIdsRef = useRef<string[]>(workspaceItems.map((item) => item.nodeId));
  const itemByIdRef = useRef<Map<number, Item>>(new Map());
  const onWorkspaceItemsChangeRef = useRef(onWorkspaceItemsChange);
  const onViewportCenterChangeRef = useRef(onViewportCenterChange);
  const onCombineWorkspaceItemsRef = useRef(onCombineWorkspaceItems);

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
  combiningNodeIdsRef.current = combiningNodeIds ?? [];
  onWorkspaceItemsChangeRef.current = onWorkspaceItemsChange;
  onViewportCenterChangeRef.current = onViewportCenterChange;
  onCombineWorkspaceItemsRef.current = onCombineWorkspaceItems;

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
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const app = appRef.current;
    const element = app?.canvas as HTMLCanvasElement | undefined;
    const camera = cameraRef.current;
    if (!app || !element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
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
  };

  const setViewContentAlpha = (view: ItemView, alpha: number) => {
    view.targetContentAlpha = alpha;
  };

  const clearHoverTarget = () => {
    const hoverTargetNodeId = hoverTargetNodeIdRef.current;
    if (!hoverTargetNodeId) return;
    const hoverView = itemViewsRef.current.get(hoverTargetNodeId);
    if (hoverView) {
      applyViewState(hoverView, "default", 1);
    }
    hoverTargetNodeIdRef.current = null;
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

    const labelValue = `${item.icon || "•"} ${item.name}`;
    const label = new Text({
      text: labelValue,
      style: {
        fill: 0xe5e7eb,
        fontFamily: "Trebuchet MS, Verdana, sans-serif",
        fontSize: 17,
        fontWeight: "600",
      },
    });
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
    const contentWidth =
      CARD_HORIZONTAL_PADDING * 2 +
      label.width +
      (badge ? badge.width + 12 : 0);
    const cardWidth = clamp(contentWidth, CARD_MIN_WIDTH, CARD_MAX_WIDTH);
    drawItemCard(background, cardWidth, item.id, "default");

    label.x = CARD_HORIZONTAL_PADDING;
    label.y = Math.round((CARD_HEIGHT - label.height) / 2) - 1;

    if (badge) {
      badge.x = cardWidth - CARD_HORIZONTAL_PADDING - badge.width;
      badge.y = Math.round((CARD_HEIGHT - badge.height) / 2) - 1;
    }

    container.addChild(background);
    container.addChild(label);
    if (badge) {
      container.addChild(badge);
    }

    container.pivot.set(cardWidth / 2, CARD_HEIGHT / 2);
    container.on("pointerdown", (event) => {
      event.stopPropagation();
      const pointerPosition = screenToWorld(
        event.nativeEvent.clientX,
        event.nativeEvent.clientY
      );
      const world = worldRef.current;
      if (world) {
        world.addChild(container);
      }
      const topLeftPosition = getViewTopLeftPosition({
        container,
        background,
        label,
        badge,
        itemId: item.id,
        width: cardWidth,
        targetScale: 1,
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
      label,
      badge,
      itemId: item.id,
      width: cardWidth,
      targetScale: 1,
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
      if (!view) {
        view = createItemView(workspaceItem, item);
        existingViews.set(workspaceItem.nodeId, view);
        world.addChild(view.container);
        if (removedCombiningNodeIds.length > 0 && addedNodeIds.includes(workspaceItem.nodeId)) {
          view.container.scale.set(SPAWN_SCALE);
          view.targetScale = 1;
          view.contentAlpha = 0;
          view.targetContentAlpha = 1;
        }
      }

      if (dragStateRef.current?.nodeId !== workspaceItem.nodeId) {
        setViewTopLeftPosition(view, workspaceItem.position);
      }
      view.destroyWhenSettled = false;
      const isCombining = (combiningNodeIds ?? []).includes(workspaceItem.nodeId);
      setViewContentAlpha(view, isCombining ? COMBINING_CONTENT_ALPHA : 1);
    });

    previousWorkspaceNodeIdsRef.current = nextWorkspaceItems.map((item) => item.nodeId);
    previousCombiningNodeIdsRef.current = [...combiningNodeIdsRef.current];
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

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        const worldPosition = screenToWorld(event.clientX, event.clientY);
        const view = itemViewsRef.current.get(dragState.nodeId);
        if (view) {
          setViewTopLeftPosition(view, {
            x: worldPosition.x - dragState.offsetX,
            y: worldPosition.y - dragState.offsetY,
          });
          updateHoverTarget(dragState.nodeId);
        }
        return;
      }

      const panState = panStateRef.current;
      if (!panState || panState.pointerId !== event.pointerId) return;
      cameraRef.current.x = panState.startCameraX + (event.clientX - panState.startClientX);
      cameraRef.current.y = panState.startCameraY + (event.clientY - panState.startClientY);
      applyCamera();
    };

    const handlePointerUp = (event: PointerEvent) => {
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

      const background = new Graphics();
      background.eventMode = "static";
      background.cursor = "grab";
      background.on("pointerdown", (event) => {
        if (dragStateRef.current) return;
        panStateRef.current = {
          pointerId: event.pointerId,
          startClientX: event.nativeEvent.clientX,
          startClientY: event.nativeEvent.clientY,
          startCameraX: cameraRef.current.x,
          startCameraY: cameraRef.current.y,
        };
      });
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

      cameraRef.current = {
        x: app.renderer.width / 2 - INITIAL_WORLD_CENTER.x,
        y: app.renderer.height / 2 - INITIAL_WORLD_CENTER.y,
        zoom: 1,
      };

      drawBackground();
      drawGrid();
      applyCamera();
      syncScene(workspaceItems);
      app.ticker.add(() => {
        itemViewsRef.current.forEach((view) => {
          const currentScale = view.container.scale.x;
          const nextScale =
            currentScale + (view.targetScale - currentScale) * SCALE_EASING;
          const settled =
            Math.abs(view.targetScale - nextScale) < 0.001;
          const appliedScale = settled ? view.targetScale : nextScale;
          view.container.scale.set(appliedScale);

          const nextContentAlpha =
            view.contentAlpha +
            (view.targetContentAlpha - view.contentAlpha) * CONTENT_ALPHA_EASING;
          const alphaSettled =
            Math.abs(view.targetContentAlpha - nextContentAlpha) < 0.01;
          view.contentAlpha = alphaSettled ? view.targetContentAlpha : nextContentAlpha;
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

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      app.canvas.addEventListener("wheel", handleWheel, { passive: false });
      window.addEventListener("resize", handleWindowResize);
    };

    void init();

    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      const app = appRef.current;
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = 0;
      }
      if (app) {
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
    };
  }, []);

  useEffect(() => {
    syncScene(workspaceItems);
  }, [combiningNodeIds, itemById, workspaceItems]);

  return (
    <div ref={hostRef} className="graph-pixi-host">
      {workspaceItems.length === 0 ? (
        <div className="graph-placeholder">
          Click items in the library to place them into the workspace.
        </div>
      ) : null}
      <div className="graph-workspace-hint" aria-hidden="true">
        Drag to move items. Drag empty space to pan. Use the mouse wheel to zoom.
      </div>
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
