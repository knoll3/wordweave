import { useRef } from "react";
import type { RefObject } from "react";
import type { Container } from "pixi.js";
import {
  CARD_HEIGHT,
  CELEBRATION_TINT_HOLD_FRAMES,
  COMBINE_SCALE_STEP,
  HOVER_SCALE_STEP,
  drawItemCard,
  getViewTopLeftPosition,
  type ItemView,
  type ItemVisualState,
} from "../graphViewHelpers";

export function useGraphItems({
  worldRef,
}: {
  worldRef: RefObject<Container | null>;
}) {
  const itemViewsRef = useRef<Map<string, ItemView>>(new Map());

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

  return {
    itemViewsRef,
    getItemViewBounds,
    getItemViewAtWorldPosition,
    applyViewState,
    setViewContentAlpha,
    triggerCelebration,
    triggerArrivalHighlight,
  };
}
