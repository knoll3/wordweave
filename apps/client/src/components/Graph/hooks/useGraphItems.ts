import { useRef } from "react";
import type { RefObject } from "react";
import type { Container } from "pixi.js";
import {
  CARD_HEIGHT,
  getViewTopLeftPosition,
  type ItemView,
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

  return {
    itemViewsRef,
    getItemViewAtWorldPosition,
  };
}
