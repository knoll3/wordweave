import { useCallback, useRef } from "react";
import {
  Application,
  Container,
  Graphics,
  Texture,
  TilingSprite,
} from "pixi.js";
import { GRID_RADIUS, GRID_SPACING } from "../graphViewHelpers";

type InitializePixiAppOptions = {
  isCancelled?: () => boolean;
  onResize?: () => void;
};

export function usePixiApp() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Container | null>(null);
  const worldRef = useRef<Container | null>(null);
  const gridRef = useRef<TilingSprite | null>(null);
  const gridTextureRef = useRef<Texture | null>(null);
  const backgroundRef = useRef<Graphics | null>(null);
  const resizeFrameRef = useRef<number>(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const cleanupPixiApp = useCallback(() => {
    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = 0;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    const app = appRef.current;
    if (app) {
      app.destroy(true, { children: true });
    }

    appRef.current = null;
    viewportRef.current = null;
    gridRef.current = null;
    gridTextureRef.current?.destroy(true);
    gridTextureRef.current = null;
    worldRef.current = null;
    backgroundRef.current = null;
  }, []);

  const initializePixiApp = useCallback(
    async ({ isCancelled, onResize }: InitializePixiAppOptions = {}) => {
      const host = hostRef.current;
      if (!host) return null;

      const app = new Application();
      await app.init({
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
      });

      if (isCancelled?.()) {
        app.destroy(true, { children: true });
        return null;
      }

      appRef.current = app;
      host.appendChild(app.canvas);
      app.canvas.style.touchAction = "none";
      app.stage.eventMode = "static";

      const background = new Graphics();
      background.eventMode = "static";
      background.cursor = "grab";
      backgroundRef.current = background;
      app.stage.addChild(background);

      const gridPattern = new Graphics();
      gridPattern
        .rect(0, 0, GRID_SPACING, GRID_SPACING)
        .fill({ color: 0x020617, alpha: 0.001 });
      gridPattern
        .circle(GRID_SPACING / 2, GRID_SPACING / 2, GRID_RADIUS)
        .fill({ color: 0x94a3b8, alpha: 0.14 });
      const gridTexture = app.renderer.generateTexture(gridPattern);
      gridPattern.destroy();
      gridTextureRef.current = gridTexture;

      const grid = new TilingSprite({
        texture: gridTexture,
        width: app.renderer.width,
        height: app.renderer.height,
      });
      grid.eventMode = "none";
      app.stage.addChild(grid);

      const viewport = new Container();
      const world = new Container();
      viewport.addChild(world);
      app.stage.addChild(viewport);
      viewportRef.current = viewport;
      gridRef.current = grid;
      worldRef.current = world;

      if (onResize) {
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(host);
        resizeObserverRef.current = resizeObserver;
      }

      return app;
    },
    []
  );

  return {
    hostRef,
    appRef,
    viewportRef,
    worldRef,
    gridRef,
    gridTextureRef,
    backgroundRef,
    resizeFrameRef,
    initializePixiApp,
    cleanupPixiApp,
  };
}
