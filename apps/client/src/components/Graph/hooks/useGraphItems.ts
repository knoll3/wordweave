import { useRef } from "react";
import type { ItemView } from "../graphViewHelpers";

export function useGraphItems() {
  const itemViewsRef = useRef<Map<string, ItemView>>(new Map());

  return {
    itemViewsRef,
  };
}
