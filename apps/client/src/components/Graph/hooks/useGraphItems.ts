import { useRef } from "react";
import type { RefObject } from "react";
import type { Container } from "pixi.js";
import {
  CARD_HEIGHT,
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

  return {
    itemViewsRef,
    getItemViewAtWorldPosition,
    applyViewState,
    setViewContentAlpha,
  };
}
