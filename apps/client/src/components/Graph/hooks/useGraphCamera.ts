import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  Application,
  Container,
  FederatedPointerEvent,
  TilingSprite,
} from "pixi.js";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clamp,
} from "../graphViewHelpers";

export type CameraState = {
  x: number;
  y: number;
  zoom: number;
};

export type ViewportSnapshot = {
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  center: { x: number; y: number };
};

type UseGraphCameraOptions = {
  appRef: RefObject<Application | null>;
  viewportRef: RefObject<Container | null>;
  gridRef: RefObject<TilingSprite | null>;
  onViewportCenterChange?: (position: { x: number; y: number }) => void;
  onCameraApplied?: () => void;
};

export function useGraphCamera({
  appRef,
  viewportRef,
  gridRef,
  onViewportCenterChange,
  onCameraApplied,
}: UseGraphCameraOptions) {
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, zoom: 1 });
  const [viewportSnapshot, setViewportSnapshot] = useState<ViewportSnapshot | null>(null);
  const onViewportCenterChangeRef = useRef(onViewportCenterChange);
  const onCameraAppliedRef = useRef(onCameraApplied);

  onViewportCenterChangeRef.current = onViewportCenterChange;
  onCameraAppliedRef.current = onCameraApplied;

  const updateViewportCenter = useCallback(() => {
    const app = appRef.current;
    const handleViewportCenterChange = onViewportCenterChangeRef.current;
    if (!app) return;
    if (app.renderer.width < 40 || app.renderer.height < 40) return;
    const camera = cameraRef.current;
    const nextCenter = {
      x: (app.renderer.width / 2 - camera.x) / camera.zoom,
      y: (app.renderer.height / 2 - camera.y) / camera.zoom,
    };
    handleViewportCenterChange?.(nextCenter);
    setViewportSnapshot((current) => {
      const nextSnapshot = {
        width: app.renderer.width,
        height: app.renderer.height,
        cameraX: camera.x,
        cameraY: camera.y,
        zoom: camera.zoom,
        center: nextCenter,
      };
      if (
        current &&
        current.width === nextSnapshot.width &&
        current.height === nextSnapshot.height &&
        Math.abs(current.cameraX - nextSnapshot.cameraX) < 0.5 &&
        Math.abs(current.cameraY - nextSnapshot.cameraY) < 0.5 &&
        Math.abs(current.zoom - nextSnapshot.zoom) < 0.001
      ) {
        return current;
      }
      return nextSnapshot;
    });
  }, [appRef]);

  const applyCamera = useCallback(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport) return;
    const camera = cameraRef.current;
    viewport.position.set(camera.x, camera.y);
    viewport.scale.set(camera.zoom);
    if (grid) {
      grid.tilePosition.set(camera.x, camera.y);
      grid.tileScale.set(camera.zoom);
    }
    updateViewportCenter();
    onCameraAppliedRef.current?.();
  }, [gridRef, updateViewportCenter, viewportRef]);

  const setCameraPosition = useCallback(
    (position: { x: number; y: number }) => {
      cameraRef.current.x = position.x;
      cameraRef.current.y = position.y;
      applyCamera();
    },
    [applyCamera]
  );

  const setCameraForWorldPoint = useCallback(
    (screenPoint: { x: number; y: number }, worldPoint: { x: number; y: number }, zoom: number) => {
      const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      cameraRef.current.zoom = nextZoom;
      cameraRef.current.x = screenPoint.x - worldPoint.x * nextZoom;
      cameraRef.current.y = screenPoint.y - worldPoint.y * nextZoom;
      applyCamera();
    },
    [applyCamera]
  );

  const zoomAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }, direction: "in" | "out") => {
      const camera = cameraRef.current;
      const previousZoom = camera.zoom;
      const zoomDelta = direction === "in" ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      const nextZoom = clamp(previousZoom * zoomDelta, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === previousZoom) return;

      const worldPoint = {
        x: (screenPoint.x - camera.x) / previousZoom,
        y: (screenPoint.y - camera.y) / previousZoom,
      };
      setCameraForWorldPoint(screenPoint, worldPoint, nextZoom);
    },
    [setCameraForWorldPoint]
  );

  const pixiPointerToWorld = useCallback((event: FederatedPointerEvent) => {
    const camera = cameraRef.current;
    return {
      x: (event.global.x - camera.x) / camera.zoom,
      y: (event.global.y - camera.y) / camera.zoom,
    };
  }, []);

  const screenPointToWorld = useCallback((screenX: number, screenY: number) => {
    const camera = cameraRef.current;
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  }, []);

  const worldRectToScreenRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const camera = cameraRef.current;
      return {
        left: rect.x * camera.zoom + camera.x,
        top: rect.y * camera.zoom + camera.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
      };
    },
    []
  );

  return {
    cameraRef,
    viewportSnapshot,
    updateViewportCenter,
    applyCamera,
    setCameraPosition,
    setCameraForWorldPoint,
    zoomAtScreenPoint,
    pixiPointerToWorld,
    screenPointToWorld,
    worldRectToScreenRect,
  };
}
