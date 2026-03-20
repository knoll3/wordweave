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
import type { Item, SelectionCombineLayout, WorkspaceItem } from "../../types";

interface Props {
  items: Item[];
  workspaceItems: WorkspaceItem[];
  onWorkspaceItemsChange: (update: React.SetStateAction<WorkspaceItem[]>) => void;
  onViewportCenterChange?: (position: { x: number; y: number }) => void;
  combiningNodeIds?: string[] | null;
  onClearWorkspace: () => void;
  onRemoveWorkspaceItem: (nodeId: string) => void;
  onDuplicateWorkspaceItem: (
    nodeId: string,
    position: { x: number; y: number }
  ) => void;
  onAddItemToWorkspace: (
    itemId: number,
    position?: { x: number; y: number }
  ) => void;
  craftUnlocked: boolean;
  creativeUnlocked: boolean;
  evolveUnlocked: boolean;
  popCultureUnlocked: boolean;
  splitUnlocked: boolean;
  oppositeUnlocked: boolean;
  randomizeUnlocked: boolean;
  wordCombineUnlocked: boolean;
  onCombineWorkspaceSelection: (layout: SelectionCombineLayout) => Promise<boolean>;
  onCombineWorkspaceItems: (
    sourceNodeId: string,
    targetNodeId: string
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
  container: Container;
  background: Graphics;
  label: Text;
  badge: Text | null;
};

const INITIAL_WORLD_CENTER = { x: 260, y: 180 };
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.12;
const CARD_HEIGHT = 54;
const CARD_MIN_WIDTH = 180;
const CARD_MAX_WIDTH = 320;
const CARD_HORIZONTAL_PADDING = 18;
const CARD_RADIUS = 10;
const GRID_SPACING = 28;
const GRID_RADIUS = 1.15;
const GRID_EXTENT = 4800;

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

function GraphView({
  items,
  workspaceItems,
  onWorkspaceItemsChange,
  onViewportCenterChange,
  onClearWorkspace,
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
  const panStateRef = useRef<PanState | null>(null);
  const resizeFrameRef = useRef<number>(0);
  const itemByIdRef = useRef<Map<number, Item>>(new Map());
  const onWorkspaceItemsChangeRef = useRef(onWorkspaceItemsChange);
  const onViewportCenterChangeRef = useRef(onViewportCenterChange);

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
  onWorkspaceItemsChangeRef.current = onWorkspaceItemsChange;
  onViewportCenterChangeRef.current = onViewportCenterChange;

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
    const tint = getNodeTint(item.id);

    background
      .roundRect(0, 0, cardWidth, CARD_HEIGHT, CARD_RADIUS)
      .fill({ color: 0x0f172a, alpha: 1 })
      .stroke({ width: 1.5, color: tint, alpha: 0.42 });

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

    container.position.set(workspaceItem.position.x, workspaceItem.position.y);
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
      dragStateRef.current = {
        nodeId: workspaceItem.nodeId,
        pointerId: event.pointerId,
        offsetX: pointerPosition.x - container.x,
        offsetY: pointerPosition.y - container.y,
      };
      container.cursor = "grabbing";
      container.alpha = 1;
    });

    return { container, background, label, badge };
  };

  const syncScene = (nextWorkspaceItems: WorkspaceItem[]) => {
    const world = worldRef.current;
    if (!world) return;

    const existingViews = itemViewsRef.current;
    const nextNodeIds = new Set(nextWorkspaceItems.map((item) => item.nodeId));

    existingViews.forEach((view, nodeId) => {
      if (nextNodeIds.has(nodeId)) return;
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
      }

      if (dragStateRef.current?.nodeId !== workspaceItem.nodeId) {
        view.container.position.set(workspaceItem.position.x, workspaceItem.position.y);
      }
    });
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
          view.container.position.set(
            worldPosition.x - dragState.offsetX,
            worldPosition.y - dragState.offsetY
          );
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
        dragStateRef.current = null;
        if (view) {
          view.container.alpha = 1;
          view.container.cursor = "grab";
          const nextPosition = {
            x: Math.round(view.container.x),
            y: Math.round(view.container.y),
          };
          onWorkspaceItemsChangeRef.current((prev) =>
            prev.map((item) =>
              item.nodeId === dragState.nodeId
                ? { ...item, position: nextPosition }
                : item
            )
          );
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
      panStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncScene(workspaceItems);
  }, [itemById, workspaceItems]);

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
