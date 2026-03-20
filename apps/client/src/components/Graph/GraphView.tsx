import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Node,
  NodeProps,
  NodeDragHandler,
  ReactFlowInstance,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CRAFT_ITEM,
  CRAFT_ITEM_ID,
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
  EVOLVE_ITEM,
  EVOLVE_ITEM_ID,
  POP_CULTURE_ITEM,
  POP_CULTURE_ITEM_ID,
  OPPOSITE_ITEM,
  OPPOSITE_ITEM_ID,
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

interface PressState {
  pointerId: number;
  nodeId: string | null;
  startX: number;
  startY: number;
  moved: boolean;
  longPressTriggered: boolean;
}

interface CreativeDragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  dispose: (() => void) | null;
}

interface MarqueeSelection {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface WorkspaceNodeData {
  icon: string;
  name: string;
  isNewDiscovery: boolean;
  isResultPlaceholder: boolean;
}

const LONG_PRESS_MS = 550;
const MOVE_THRESHOLD_PX = 10;
const NODE_DRAG_THRESHOLD_PX = 12;
const DOUBLE_CLICK_DUPLICATE_OFFSET_PX = 10;
const COMBINE_TARGET_SLOP_PX = 16;
const GRAPH_DEBUG = true;

function debugGraph(message: string, payload?: Record<string, unknown>) {
  if (!GRAPH_DEBUG) return;
  try {
    console.log(`[graph-debug][view] ${message} ${JSON.stringify(payload ?? {})}`);
  } catch {
    console.log(`[graph-debug][view] ${message}`, payload ?? {});
  }
}

const WorkspaceNode: React.FC<NodeProps<WorkspaceNodeData>> = ({ data }) => {
  if (data.isResultPlaceholder) {
    return (
      <span className="graph-result-placeholder-label" aria-hidden="true">
        <span className="graph-result-placeholder-spinner" />
      </span>
    );
  }

  return (
    <span className="graph-node-label">
      <span className="graph-node-label-text">{`${data.icon} ${data.name}`}</span>
      {data.isNewDiscovery ? (
        <span
          className="graph-node-new-discovery-badge"
          aria-label="New discovery"
          title="New discovery"
        >
          ✦
        </span>
      ) : null}
    </span>
  );
};

const nodeTypes = {
  workspace: WorkspaceNode,
};

function FlowCanvas({
  items,
  workspaceItems,
  onWorkspaceItemsChange,
  onViewportCenterChange,
  combiningNodeIds,
  onClearWorkspace,
  onRemoveWorkspaceItem,
  onDuplicateWorkspaceItem,
  onAddItemToWorkspace,
  craftUnlocked,
  creativeUnlocked,
  evolveUnlocked,
  popCultureUnlocked,
  splitUnlocked,
  oppositeUnlocked,
  randomizeUnlocked,
  wordCombineUnlocked,
  onCombineWorkspaceSelection,
  onCombineWorkspaceItems,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [hoverTargetNodeId, setHoverTargetNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [creativeDragPreview, setCreativeDragPreview] = useState<{
    x: number;
    y: number;
    itemId: number;
  } | null>(null);
  const [isMarqueeMode, setIsMarqueeMode] = useState(false);
  const [marqueeSelection, setMarqueeSelection] =
    useState<MarqueeSelection | null>(null);
  const [selectionCombineAwaitingStart, setSelectionCombineAwaitingStart] =
    useState(false);
  const [selectionCombineActive, setSelectionCombineActive] = useState(false);
  const [selectionCombinePlaceholderId, setSelectionCombinePlaceholderId] = useState<
    string | null
  >(null);
  const workspaceItemsRef = useRef(workspaceItems);
  const selectionMoveDragRef = useRef<{
    pointerId: number;
    startFlowPoint: { x: number; y: number };
    initialPositions: Array<{ nodeId: string; position: { x: number; y: number } }>;
  } | null>(null);

  const pressStateRef = useRef<PressState | null>(null);
  const creativeDragRef = useRef<CreativeDragState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextPaneClickRef = useRef(false);

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const publishViewportCenter = useCallback(() => {
    if (!reactFlow || !wrapperRef.current || !onViewportCenterChange) return;
    const bounds = wrapperRef.current.getBoundingClientRect();
    const center = reactFlow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    onViewportCenterChange(center);
  }, [onViewportCenterChange, reactFlow]);

  useEffect(() => {
    publishViewportCenter();
  }, [publishViewportCenter]);

  useEffect(() => {
    let frameId = 0;
    const handleResize = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        publishViewportCenter();
        frameId = 0;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [publishViewportCenter]);

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

  useEffect(() => {
    workspaceItemsRef.current = workspaceItems;
  }, [workspaceItems]);

  useEffect(() => {
    const workspaceNodeIds = new Set(workspaceItems.map((item) => item.nodeId));
    setSelectedNodeIds((prev) => prev.filter((id) => workspaceNodeIds.has(id)));
    setSelectionCombinePlaceholderId((prev) =>
      prev && !workspaceNodeIds.has(prev) ? null : prev
    );
  }, [workspaceItems]);

  useEffect(() => {
    if (
      selectionCombineAwaitingStart &&
      selectionCombinePlaceholderId &&
      workspaceItems.some((item) => item.nodeId === selectionCombinePlaceholderId)
    ) {
      setSelectionCombineAwaitingStart(false);
      setSelectionCombineActive(true);
    }
  }, [selectionCombineAwaitingStart, selectionCombinePlaceholderId, workspaceItems]);

  useEffect(() => {
    if (
      selectionCombineActive &&
      selectionCombinePlaceholderId &&
      !workspaceItems.some((item) => item.nodeId === selectionCombinePlaceholderId)
    ) {
      setSelectionCombineActive(false);
      setSelectionCombineAwaitingStart(false);
      setSelectionCombinePlaceholderId(null);
      setSelectedNodeIds([]);
    }
  }, [selectionCombineActive, selectionCombinePlaceholderId, workspaceItems]);

  const selectionMode = selectedNodeIds.length > 0;
  const hasMultiSelection = selectedNodeIds.length >= 2;
  const selectionBoundsNodeIds = useMemo(
    () =>
      selectionCombineActive && selectionCombinePlaceholderId
        ? [...selectedNodeIds, selectionCombinePlaceholderId]
        : selectedNodeIds,
    [selectedNodeIds, selectionCombineActive, selectionCombinePlaceholderId]
  );

  const marqueeSelectionRect = useMemo(() => {
    if (!marqueeSelection) return null;

    return {
      left: Math.min(marqueeSelection.startX, marqueeSelection.currentX),
      top: Math.min(marqueeSelection.startY, marqueeSelection.currentY),
      width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
      height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY),
    };
  }, [marqueeSelection]);

  const getNodeVisualsLocal = useCallback(
    (nodeIds: string[]) => {
      if (!reactFlow || !wrapperRef.current) {
        return [] as Array<{
          nodeId: string;
          x: number;
          y: number;
          width: number;
          height: number;
          icon: string;
          name: string;
        }>;
      }

      const bounds = wrapperRef.current.getBoundingClientRect();

      return nodeIds
        .map((nodeId) => {
          const workspaceNode = workspaceItemsRef.current.find(
            (item) => item.nodeId === nodeId
          );
          const item = workspaceNode ? itemById.get(workspaceNode.itemId) : null;
          const icon = item?.icon || item?.name.charAt(0).toUpperCase() || "•";
          const name = item?.name ?? "";

          const nodeEl = wrapperRef.current?.querySelector(
            `.react-flow__node[data-id=\"${nodeId}\"]`
          ) as HTMLElement | null;

          if (nodeEl) {
            const rect = nodeEl.getBoundingClientRect();
            return {
              nodeId,
              x: rect.left - bounds.left + rect.width / 2,
              y: rect.top - bounds.top + rect.height / 2,
              width: rect.width,
              height: rect.height,
              icon,
              name,
            };
          }

          const node = reactFlow.getNode(nodeId);
          if (!node) return null;
          const width = node.width ?? 96;
          const height = node.height ?? 34;
          const centerFlow = {
            x: node.position.x + width / 2,
            y: node.position.y + height / 2,
          };
          const centerScreen = reactFlow.flowToScreenPosition(centerFlow);
          return {
            nodeId,
            x: centerScreen.x - bounds.left,
            y: centerScreen.y - bounds.top,
            width,
            height,
            icon,
            name,
          };
        })
        .filter(
          (
            node
          ): node is {
            nodeId: string;
            x: number;
            y: number;
            width: number;
            height: number;
            icon: string;
            name: string;
          } => !!node
        );
    },
    [itemById, reactFlow]
  );

  const selectionBoundsVisual = useMemo(() => {
    if (!wrapperRef.current || selectionBoundsNodeIds.length === 0) {
      return null;
    }

    const nodeVisuals = getNodeVisualsLocal(selectionBoundsNodeIds);
    if (!nodeVisuals.length) return null;

    const nodeBounds = nodeVisuals.reduce(
      (acc, node) => ({
        left: Math.min(acc.left, node.x - node.width / 2),
        top: Math.min(acc.top, node.y - node.height / 2),
        right: Math.max(acc.right, node.x + node.width / 2),
        bottom: Math.max(acc.bottom, node.y + node.height / 2),
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      }
    );

    const paddingX = 28;
    const paddingTop = 24;
    const paddingBottom = hasMultiSelection ? 32 : 24;

    return {
      left: nodeBounds.left - paddingX,
      top: nodeBounds.top - paddingTop,
      width: nodeBounds.right - nodeBounds.left + paddingX * 2,
      height:
        nodeBounds.bottom - nodeBounds.top + paddingTop + paddingBottom,
    };
  }, [getNodeVisualsLocal, hasMultiSelection, selectionBoundsNodeIds, viewportVersion]);

  const buildSelectionCombineLayout = useCallback((): SelectionCombineLayout | null => {
    if (!reactFlow || selectedNodeIds.length < 2) return null;

    const paddingX = 16;
    const paddingY = 16;
    const gapX = 10;
    const gapY = 10;
    const placeholderWidth = 132;
    const placeholderHeight = 34;
    const flowNodes = selectedNodeIds
      .map((nodeId) => {
        const node = reactFlow.getNode(nodeId);
        if (!node) return null;
        const width = node.width ?? 110;
        const height = node.height ?? 34;
        return {
          nodeId,
          width,
          height,
          left: node.position.x,
          top: node.position.y,
          right: node.position.x + width,
          bottom: node.position.y + height,
        };
      })
      .filter(
        (
          node
        ): node is {
          nodeId: string;
          width: number;
          height: number;
          left: number;
          top: number;
          right: number;
          bottom: number;
        } => !!node
      );

    if (flowNodes.length < 2) return null;

    flowNodes.sort((a, b) => {
      const yDelta = a.top - b.top;
      if (Math.abs(yDelta) > 18) return yDelta;
      return a.left - b.left;
    });

    const bounds = flowNodes.reduce(
      (acc, node) => ({
        left: Math.min(acc.left, node.left),
        top: Math.min(acc.top, node.top),
        right: Math.max(acc.right, node.right),
        bottom: Math.max(acc.bottom, node.bottom),
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      }
    );

    const containerWidth = Math.max(
      220,
      Math.min(420, bounds.right - bounds.left + paddingX * 2)
    );
    const rowLimit = containerWidth - paddingX * 2;

    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;

    const placeBox = (width: number, height: number) => {
      if (cursorX > 0 && cursorX + width > rowLimit) {
        cursorX = 0;
        cursorY += rowHeight + gapY;
        rowHeight = 0;
      }

      const position = {
        x: bounds.left + paddingX + cursorX,
        y: bounds.top + paddingY + cursorY,
      };

      cursorX += width + gapX;
      rowHeight = Math.max(rowHeight, height);

      return position;
    };

    const nodePositions = flowNodes.map((node) => ({
      nodeId: node.nodeId,
      position: placeBox(node.width, node.height),
    }));

    const placeholderPosition = placeBox(placeholderWidth, placeholderHeight);

    return {
      nodeIds: [...selectedNodeIds],
      nodePositions,
      placeholderNodeId: `workspace-${Date.now()}-result-placeholder`,
      placeholderPosition,
    };
  }, [reactFlow, selectedNodeIds]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) =>
      prev.includes(nodeId)
        ? prev.filter((id) => id !== nodeId)
        : [...prev, nodeId]
    );
  }, []);

  const duplicateSelection = useCallback(() => {
    if (!selectionBoundsVisual) return;

    const offset = {
      x: Math.max(72, selectionBoundsVisual.width + 28),
      y: 24,
    };

    selectedNodeIds.forEach((nodeId) => {
      const workspaceNode = workspaceItems.find((item) => item.nodeId === nodeId);
      if (!workspaceNode) return;

      onDuplicateWorkspaceItem(nodeId, {
        x: workspaceNode.position.x + offset.x,
        y: workspaceNode.position.y + offset.y,
      });
    });
  }, [
    onDuplicateWorkspaceItem,
    selectedNodeIds,
    selectionBoundsVisual,
    workspaceItems,
  ]);

  const applyMarqueeSelection = useCallback(() => {
    if (!wrapperRef.current || !marqueeSelectionRect) {
      setMarqueeSelection(null);
      setIsMarqueeMode(false);
      return;
    }

    const selectedIds = getNodeVisualsLocal(
      workspaceItems.map((item) => item.nodeId)
    )
      .map((node) => {
        const localRect = {
          left: node.x - node.width / 2,
          top: node.y - node.height / 2,
          right: node.x + node.width / 2,
          bottom: node.y + node.height / 2,
        };
        const intersects =
          localRect.right >= marqueeSelectionRect.left &&
          localRect.left <= marqueeSelectionRect.left + marqueeSelectionRect.width &&
          localRect.bottom >= marqueeSelectionRect.top &&
          localRect.top <= marqueeSelectionRect.top + marqueeSelectionRect.height;

        return intersects ? node.nodeId : null;
      })
      .filter((nodeId): nodeId is string => !!nodeId);

    suppressNextPaneClickRef.current = true;
    setSelectedNodeIds(selectedIds);
    setMarqueeSelection(null);
    setIsMarqueeMode(false);
  }, [getNodeVisualsLocal, marqueeSelectionRect, workspaceItems]);

  const clearCreativeDrag = useCallback(() => {
    const current = creativeDragRef.current;
    current?.dispose?.();
    creativeDragRef.current = null;
    setCreativeDragPreview(null);
  }, []);

  useEffect(() => clearCreativeDrag, [clearCreativeDrag]);

  const handleCatalystSpawnPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      catalystItemId: number
    ) => {
      event.preventDefault();
      event.stopPropagation();

      clearCreativeDrag();

      const updatePreview = (clientX: number, clientY: number) => {
        if (!wrapperRef.current) return;
        const bounds = wrapperRef.current.getBoundingClientRect();
        setCreativeDragPreview({
          x: clientX - bounds.left,
          y: clientY - bounds.top,
          itemId: catalystItemId,
        });
      };

      updatePreview(event.clientX, event.clientY);

      const pointerId = event.pointerId;
      const handlePointerMove = (moveEvent: PointerEvent) => {
        const current = creativeDragRef.current;
        if (!current || current.pointerId !== moveEvent.pointerId) return;

        const dx = moveEvent.clientX - current.startX;
        const dy = moveEvent.clientY - current.startY;
        if (Math.hypot(dx, dy) >= MOVE_THRESHOLD_PX) {
          current.moved = true;
        }
        updatePreview(moveEvent.clientX, moveEvent.clientY);
      };

      const finishPointerDrag = (endEvent: PointerEvent) => {
        const current = creativeDragRef.current;
        if (!current || current.pointerId !== endEvent.pointerId) return;

        const didMove = current.moved;
        clearCreativeDrag();

        if (!didMove || !wrapperRef.current) return;

        const bounds = wrapperRef.current.getBoundingClientRect();
        const droppedInside =
          endEvent.clientX >= bounds.left &&
          endEvent.clientX <= bounds.right &&
          endEvent.clientY >= bounds.top &&
          endEvent.clientY <= bounds.bottom;
        if (!droppedInside) return;

        if (!reactFlow) {
          onAddItemToWorkspace(catalystItemId);
          return;
        }

        const position = reactFlow.screenToFlowPosition({
          x: endEvent.clientX,
          y: endEvent.clientY,
        });
        onAddItemToWorkspace(catalystItemId, position);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishPointerDrag(upEvent);
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishPointerDrag(cancelEvent);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);

      creativeDragRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        dispose: () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerCancel);
        },
      };
    },
    [clearCreativeDrag, onAddItemToWorkspace, reactFlow]
  );

  const handleCraftSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!craftUnlocked) return;
    onAddItemToWorkspace(CRAFT_ITEM_ID);
  }, [craftUnlocked, onAddItemToWorkspace]);

  const handleCreativeSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!creativeUnlocked) return;
    onAddItemToWorkspace(CREATIVE_ITEM_ID);
  }, [creativeUnlocked, onAddItemToWorkspace]);

  const handleEvolveSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!evolveUnlocked) return;
    onAddItemToWorkspace(EVOLVE_ITEM_ID);
  }, [evolveUnlocked, onAddItemToWorkspace]);

  const handleSplitSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!splitUnlocked) return;
    onAddItemToWorkspace(SPLIT_ITEM_ID);
  }, [onAddItemToWorkspace, splitUnlocked]);

  const handleOppositeSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!oppositeUnlocked) return;
    onAddItemToWorkspace(OPPOSITE_ITEM_ID);
  }, [onAddItemToWorkspace, oppositeUnlocked]);

  const handlePopCultureSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!popCultureUnlocked) return;
    onAddItemToWorkspace(POP_CULTURE_ITEM_ID);
  }, [onAddItemToWorkspace, popCultureUnlocked]);

  const handleRandomizeSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!randomizeUnlocked) return;
    onAddItemToWorkspace(RANDOMIZE_ITEM_ID);
  }, [onAddItemToWorkspace, randomizeUnlocked]);

  const handleWordCombineSpawnClick = useCallback(() => {
    if (creativeDragRef.current?.moved) return;
    if (!wordCombineUnlocked) return;
    onAddItemToWorkspace(WORD_COMBINE_ITEM_ID);
  }, [onAddItemToWorkspace, wordCombineUnlocked]);

  const handleSelectionMovePointerMove = useCallback((event: PointerEvent) => {
    const dragState = selectionMoveDragRef.current;
    if (!dragState || !reactFlow) return;
    const currentFlowPoint = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const delta = {
      x: currentFlowPoint.x - dragState.startFlowPoint.x,
      y: currentFlowPoint.y - dragState.startFlowPoint.y,
    };
    onWorkspaceItemsChange((prev) =>
      prev.map((item) => {
        const initial = dragState.initialPositions.find(
          (entry) => entry.nodeId === item.nodeId
        );
        return initial
          ? {
              ...item,
              position: {
                x: initial.position.x + delta.x,
                y: initial.position.y + delta.y,
              },
            }
          : item;
      })
    );
  }, [onWorkspaceItemsChange, reactFlow]);

  const handleSelectionMovePointerUp = useCallback((event: PointerEvent) => {
    if (
      !selectionMoveDragRef.current ||
      selectionMoveDragRef.current.pointerId !== event.pointerId
    ) {
      return;
    }
    selectionMoveDragRef.current = null;
    window.removeEventListener("pointermove", handleSelectionMovePointerMove);
    window.removeEventListener("pointerup", handleSelectionMovePointerUp);
    window.removeEventListener("pointercancel", handleSelectionMovePointerUp);
  }, [handleSelectionMovePointerMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handleSelectionMovePointerMove);
      window.removeEventListener("pointerup", handleSelectionMovePointerUp);
      window.removeEventListener("pointercancel", handleSelectionMovePointerUp);
    };
  }, [handleSelectionMovePointerMove, handleSelectionMovePointerUp]);

  const handleSelectionMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!reactFlow || selectedNodeIds.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);

      const startFlowPoint = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const initialPositions = selectedNodeIds
        .map((nodeId) => {
          const workspaceNode = workspaceItemsRef.current.find(
            (item) => item.nodeId === nodeId
          );
          return workspaceNode
            ? { nodeId, position: workspaceNode.position }
            : null;
        })
        .filter(
          (
            value
          ): value is { nodeId: string; position: { x: number; y: number } } => !!value
        );

      selectionMoveDragRef.current = {
        pointerId: event.pointerId,
        startFlowPoint,
        initialPositions,
      };

      window.addEventListener("pointermove", handleSelectionMovePointerMove);
      window.addEventListener("pointerup", handleSelectionMovePointerUp);
      window.addEventListener("pointercancel", handleSelectionMovePointerUp);
    },
    [handleSelectionMovePointerMove, handleSelectionMovePointerUp, reactFlow, selectedNodeIds]
  );

  const startMarqueeSelectionAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      setMarqueeSelection({
        startX: clientX - bounds.left,
        startY: clientY - bounds.top,
        currentX: clientX - bounds.left,
        currentY: clientY - bounds.top,
      });
      pressStateRef.current = null;
      clearLongPressTimer();
    },
    []
  );

  const overlapArea = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) => {
    const overlapWidth =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapHeight =
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
    return overlapWidth * overlapHeight;
  };

  const getDropTargetNodeId = useCallback(
    (draggedNodeId: string, pointer?: { x: number; y: number }) => {
      if (!wrapperRef.current) return null;

      const draggedEl = wrapperRef.current.querySelector(
        `.react-flow__node[data-id=\"${draggedNodeId}\"]`
      ) as HTMLElement | null;
      if (!draggedEl) return null;

      const draggedRect = draggedEl.getBoundingClientRect();
      const draggedBox = {
        x: draggedRect.left,
        y: draggedRect.top,
        width: draggedRect.width,
        height: draggedRect.height,
      };

      const candidateEls = Array.from(
        wrapperRef.current.querySelectorAll(".react-flow__node[data-id]")
      ) as HTMLElement[];

      const candidates = candidateEls
        .map((nodeEl) => {
          const nodeId = nodeEl.getAttribute("data-id");
          if (!nodeId || nodeId === draggedNodeId) return null;

          const rect = nodeEl.getBoundingClientRect();
          const expandedBox = {
            x: rect.left - COMBINE_TARGET_SLOP_PX,
            y: rect.top - COMBINE_TARGET_SLOP_PX,
            width: rect.width + COMBINE_TARGET_SLOP_PX * 2,
            height: rect.height + COMBINE_TARGET_SLOP_PX * 2,
          };
          const area = overlapArea(draggedBox, expandedBox);
          const pointerInside = pointer
            ? pointer.x >= expandedBox.x &&
              pointer.x <= expandedBox.x + expandedBox.width &&
              pointer.y >= expandedBox.y &&
              pointer.y <= expandedBox.y + expandedBox.height
            : false;

          if (!pointerInside && area <= 0) return null;

          return { nodeId, area, pointerInside };
        })
        .filter(
          (
            entry
          ): entry is { nodeId: string; area: number; pointerInside: boolean } => !!entry
        )
        .sort((a, b) => {
          if (a.pointerInside !== b.pointerInside) {
            return a.pointerInside ? -1 : 1;
          }
          return b.area - a.area;
        });

      return candidates[0]?.nodeId ?? null;
    },
    []
  );

  const nodes: Node<WorkspaceNodeData>[] = useMemo(() => {
    const missingItemWorkspaceNodes: Array<{ nodeId: string; itemId: number }> = [];

    const nextNodes = workspaceItems
      .map((workspaceItem) => {
        const item = itemById.get(workspaceItem.itemId);
        if (!item) {
          missingItemWorkspaceNodes.push({
            nodeId: workspaceItem.nodeId,
            itemId: workspaceItem.itemId,
          });
          return null;
        }
        const isCraftItem = workspaceItem.itemId === CRAFT_ITEM_ID;
        const isCreativeItem = workspaceItem.itemId === CREATIVE_ITEM_ID;
        const isEvolveItem = workspaceItem.itemId === EVOLVE_ITEM_ID;
        const isPopCultureItem = workspaceItem.itemId === POP_CULTURE_ITEM_ID;
        const isSplitItem = workspaceItem.itemId === SPLIT_ITEM_ID;
        const isOppositeItem = workspaceItem.itemId === OPPOSITE_ITEM_ID;
        const isRandomizeItem = workspaceItem.itemId === RANDOMIZE_ITEM_ID;
        const isWordCombineItem = workspaceItem.itemId === WORD_COMBINE_ITEM_ID;
        const isResultPlaceholder =
          workspaceItem.itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID;

        const isDragging = workspaceItem.nodeId === draggingNodeId;
        const isDragOverlapPair =
          !!draggingNodeId &&
          !!hoverTargetNodeId &&
          (workspaceItem.nodeId === draggingNodeId ||
            workspaceItem.nodeId === hoverTargetNodeId);
        const isCombiningNode = !!combiningNodeIds?.includes(workspaceItem.nodeId);
        const shouldPulseCombineNode = isCombiningNode;
        const isSelected = selectedNodeIds.includes(workspaceItem.nodeId);
        const isNewDiscovery = workspaceItem.isNewDiscovery === true;
        const isSelectionCombineNode =
          selectionCombineActive ||
          (selectionCombineAwaitingStart &&
            (selectedNodeIds.includes(workspaceItem.nodeId) ||
              workspaceItem.nodeId === selectionCombinePlaceholderId));

        const icon = item.icon || item.name.charAt(0).toUpperCase();

        return {
          id: workspaceItem.nodeId,
          position: workspaceItem.position,
          data: {
            icon,
            name: item.name,
            isNewDiscovery,
            isResultPlaceholder,
          },
          type: "workspace",
          draggable: !isCombiningNode && !isResultPlaceholder,
          className: `${shouldPulseCombineNode ? "node-combining" : ""}${
            isResultPlaceholder ? " graph-result-placeholder-node" : ""
          }`.trim(),
          zIndex: isDragging ? 1000 : isSelected ? 20 : 1,
          style: {
            borderRadius: 4,
            padding: "6px 12px",
            fontSize: 11,
            minWidth: isResultPlaceholder ? 132 : undefined,
            minHeight: isResultPlaceholder ? 34 : undefined,
            overflow: "visible",
            background: isSelected
              ? isCreativeItem
                ? "rgba(168,85,247,0.42)"
                : isEvolveItem
                  ? "rgba(244,114,182,0.28)"
                : isCraftItem
                  ? "rgba(245, 158, 11, 0.28)"
                : isPopCultureItem
                  ? "rgba(250,204,21,0.28)"
                : isSplitItem
                  ? "rgba(251,146,60,0.34)"
                : isOppositeItem
                  ? "rgba(96,165,250,0.3)"
                : isRandomizeItem
                  ? "rgba(52,211,153,0.28)"
                : isWordCombineItem
                  ? "rgba(192,132,252,0.28)"
                : "rgba(99,102,241,0.38)"
              : isCreativeItem
                ? "linear-gradient(135deg, rgba(88,28,135,0.96), rgba(76,29,149,0.92))"
                : isEvolveItem
                  ? "rgba(190,24,93,0.96)"
                : isCraftItem
                  ? "rgba(180, 83, 9, 0.96)"
                : isPopCultureItem
                  ? "rgba(202,138,4,0.96)"
                : isSplitItem
                  ? "rgba(249,115,22,0.96)"
                : isOppositeItem
                  ? "rgba(37,99,235,0.96)"
                : isRandomizeItem
                  ? "rgba(5,150,105,0.96)"
                : isWordCombineItem
                  ? "rgba(126,34,206,0.96)"
                : isResultPlaceholder
                  ? "rgba(15,23,42,0.58)"
                : "rgba(15,23,42,0.98)",
            border: isSelected
              ? isCreativeItem
                ? "1px solid rgba(216,180,254,0.96)"
                : isEvolveItem
                  ? "1px solid rgba(251,207,232,0.92)"
                : isCraftItem
                  ? "1px solid rgba(253, 230, 138, 0.92)"
                : isPopCultureItem
                  ? "1px solid rgba(254,240,138,0.92)"
                : isSplitItem
                  ? "1px solid rgba(254,215,170,0.94)"
                : isOppositeItem
                  ? "1px solid rgba(147,197,253,0.92)"
                : isRandomizeItem
                  ? "1px solid rgba(167,243,208,0.92)"
                : isWordCombineItem
                  ? "1px solid rgba(233,213,255,0.92)"
                : "1px solid rgba(99,102,241,0.95)"
              : isCreativeItem
                ? "1px solid rgba(196,181,253,0.8)"
                : isEvolveItem
                  ? "1px solid rgba(251,207,232,0.76)"
                : isCraftItem
                  ? "1px solid rgba(253, 230, 138, 0.76)"
                : isPopCultureItem
                  ? "1px solid rgba(254,240,138,0.76)"
                : isSplitItem
                  ? "1px solid rgba(254,215,170,0.76)"
                : isOppositeItem
                  ? "1px solid rgba(147,197,253,0.76)"
                : isRandomizeItem
                  ? "1px solid rgba(167,243,208,0.76)"
                : isWordCombineItem
                  ? "1px solid rgba(233,213,255,0.76)"
                : isResultPlaceholder
                  ? "1px dashed rgba(148,163,184,0.58)"
                : "1px solid rgba(79,70,229,0.6)",
            boxShadow: isSelected
              ? isCreativeItem
                ? "0 0 0 2px rgba(168,85,247,0.28), 0 8px 24px rgba(88,28,135,0.3)"
                : isEvolveItem
                  ? "0 0 0 2px rgba(244,114,182,0.18), 0 8px 24px rgba(157,23,77,0.22)"
                : isCraftItem
                  ? "0 0 0 2px rgba(245, 158, 11, 0.18), 0 8px 24px rgba(146, 64, 14, 0.22)"
                : isPopCultureItem
                  ? "0 0 0 2px rgba(250,204,21,0.18), 0 8px 24px rgba(161,98,7,0.22)"
                : isSplitItem
                  ? "0 0 0 2px rgba(251,146,60,0.2), 0 8px 24px rgba(194,65,12,0.24)"
                : isOppositeItem
                  ? "0 0 0 2px rgba(96,165,250,0.2), 0 8px 24px rgba(29,78,216,0.24)"
                : isRandomizeItem
                  ? "0 0 0 2px rgba(52,211,153,0.18), 0 8px 24px rgba(4,120,87,0.22)"
                : isWordCombineItem
                  ? "0 0 0 2px rgba(192,132,252,0.18), 0 8px 24px rgba(107,33,168,0.22)"
                : "0 0 0 2px rgba(99,102,241,0.25)"
              : isCreativeItem
                ? "0 8px 24px rgba(88,28,135,0.18)"
                : isEvolveItem
                  ? "0 8px 24px rgba(157,23,77,0.18)"
                : isCraftItem
                  ? "0 8px 24px rgba(146, 64, 14, 0.18)"
                : isPopCultureItem
                  ? "0 8px 24px rgba(161,98,7,0.18)"
                : isSplitItem
                  ? "0 8px 24px rgba(194,65,12,0.18)"
                : isOppositeItem
                  ? "0 8px 24px rgba(29,78,216,0.18)"
                : isRandomizeItem
                  ? "0 8px 24px rgba(4,120,87,0.18)"
                : isWordCombineItem
                  ? "0 8px 24px rgba(107,33,168,0.18)"
                : isResultPlaceholder
                  ? "inset 0 0 0 1px rgba(148,163,184,0.08)"
                : "none",
            color: "#e5e7eb",
            opacity: isCombiningNode ? 1 : isDragOverlapPair ? 0.5 : 1,
            transition: isSelectionCombineNode
              ? "transform 220ms ease, opacity 180ms ease, box-shadow 180ms ease, background 180ms ease, border-color 180ms ease"
              : "opacity 180ms ease, box-shadow 180ms ease, background 180ms ease, border-color 180ms ease",
          },
        } satisfies Node<WorkspaceNodeData>;
      })
      .filter(Boolean) as Node<WorkspaceNodeData>[];

    debugGraph("nodes-derived", {
      workspaceCount: workspaceItems.length,
      renderedNodeCount: nextNodes.length,
      missingItemWorkspaceNodes,
      combiningCount: combiningNodeIds?.length ?? 0,
      selectedCount: selectedNodeIds.length,
      selectionCombineActive,
      selectionCombineAwaitingStart,
      selectionCombinePlaceholderId,
    });

    return nextNodes;
  }, [
    combiningNodeIds,
    draggingNodeId,
    hoverTargetNodeId,
    itemById,
    selectedNodeIds,
    selectionCombineActive,
    selectionCombineAwaitingStart,
    selectionCombinePlaceholderId,
    workspaceItems,
  ]);

  useEffect(() => {
    if (!wrapperRef.current) return;

    const logDomState = (reason: string) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const wrapperStyle = window.getComputedStyle(wrapper);
      const reactFlowRoot = wrapper.querySelector(".react-flow") as HTMLElement | null;
      const viewportEl = wrapper.querySelector(".react-flow__viewport") as HTMLElement | null;
      const rendererEl = wrapper.querySelector(".react-flow__renderer") as HTMLElement | null;
      const nodesEl = wrapper.querySelector(".react-flow__nodes") as HTMLElement | null;
      const nodeEls = Array.from(
        wrapper.querySelectorAll(".react-flow__node[data-id]")
      ) as HTMLElement[];
      const sampleNode = nodeEls[0] ?? null;
      const resultNode =
        nodeEls.find((nodeEl) => !workspaceItemsRef.current.some((item) => item.nodeId === nodeEl.dataset.id)) ??
        nodeEls[nodeEls.length - 1] ??
        null;
      const sampleNodeStyle = sampleNode ? window.getComputedStyle(sampleNode) : null;
      const resultNodeStyle = resultNode ? window.getComputedStyle(resultNode) : null;
      const viewportStyle = viewportEl ? window.getComputedStyle(viewportEl) : null;
      const rendererStyle = rendererEl ? window.getComputedStyle(rendererEl) : null;
      const nodesStyle = nodesEl ? window.getComputedStyle(nodesEl) : null;
      const wrapperRect = wrapper.getBoundingClientRect();
      const visibleNodeCount = nodeEls.filter((nodeEl) => {
        const rect = nodeEl.getBoundingClientRect();
        return (
          rect.right >= wrapperRect.left &&
          rect.left <= wrapperRect.right &&
          rect.bottom >= wrapperRect.top &&
          rect.top <= wrapperRect.bottom
        );
      }).length;
      const offscreenNodeIds = nodeEls
        .filter((nodeEl) => {
          const rect = nodeEl.getBoundingClientRect();
          return (
            rect.right < wrapperRect.left ||
            rect.left > wrapperRect.right ||
            rect.bottom < wrapperRect.top ||
            rect.top > wrapperRect.bottom
          );
        })
        .map((nodeEl) => nodeEl.dataset.id ?? "");
      const hiddenOpacityNodeIds = nodeEls
        .filter((nodeEl) => Number(window.getComputedStyle(nodeEl).opacity) < 0.05)
        .map((nodeEl) => nodeEl.dataset.id ?? "");
      const viewport = reactFlow?.getViewport?.() ?? null;
      const workspaceNodePositions = workspaceItemsRef.current.map((item) => ({
        nodeId: item.nodeId,
        x: Number(item.position.x.toFixed(1)),
        y: Number(item.position.y.toFixed(1)),
      }));
      const sampleNodeRect = sampleNode?.getBoundingClientRect() ?? null;
      const resultNodeRect = resultNode?.getBoundingClientRect() ?? null;
      const sampleNodeCenter =
        sampleNodeRect && sampleNodeRect.width > 0 && sampleNodeRect.height > 0
          ? {
              x: sampleNodeRect.left + sampleNodeRect.width / 2,
              y: sampleNodeRect.top + sampleNodeRect.height / 2,
            }
          : null;
      const resultNodeCenter =
        resultNodeRect && resultNodeRect.width > 0 && resultNodeRect.height > 0
          ? {
              x: resultNodeRect.left + resultNodeRect.width / 2,
              y: resultNodeRect.top + resultNodeRect.height / 2,
            }
          : null;
      const sampleCoverEl = sampleNodeCenter
        ? document.elementFromPoint(sampleNodeCenter.x, sampleNodeCenter.y)
        : null;
      const resultCoverEl = resultNodeCenter
        ? document.elementFromPoint(resultNodeCenter.x, resultNodeCenter.y)
        : null;
      const describeElement = (element: Element | null) => {
        if (!element) return null;
        const htmlEl = element as HTMLElement;
        return {
          tag: element.tagName,
          className: htmlEl.className || null,
          dataId: htmlEl.dataset?.id ?? null,
        };
      };

      debugGraph("dom-state", {
        reason,
        workspaceCount: workspaceItemsRef.current.length,
        domNodeCount: nodeEls.length,
        visibleNodeCount,
        offscreenNodeIds,
        hiddenOpacityNodeIds,
        viewportX: viewport?.x ?? null,
        viewportY: viewport?.y ?? null,
        viewportZoom: viewport?.zoom ?? null,
        wrapperOpacity: wrapperStyle.opacity,
        wrapperVisibility: wrapperStyle.visibility,
        wrapperLeft: Number(wrapperRect.left.toFixed(1)),
        wrapperTop: Number(wrapperRect.top.toFixed(1)),
        wrapperWidth: Number(wrapperRect.width.toFixed(1)),
        wrapperHeight: Number(wrapperRect.height.toFixed(1)),
        reactFlowExists: !!reactFlowRoot,
        viewportExists: !!viewportEl,
        rendererExists: !!rendererEl,
        nodesLayerExists: !!nodesEl,
        viewportTransform: viewportEl?.style.transform ?? null,
        viewportOpacity: viewportStyle?.opacity ?? null,
        viewportVisibility: viewportStyle?.visibility ?? null,
        rendererOpacity: rendererStyle?.opacity ?? null,
        rendererVisibility: rendererStyle?.visibility ?? null,
        nodesOpacity: nodesStyle?.opacity ?? null,
        nodesVisibility: nodesStyle?.visibility ?? null,
        sampleNodeId: sampleNode?.dataset.id ?? null,
        sampleNodeOpacity: sampleNodeStyle?.opacity ?? null,
        sampleNodeVisibility: sampleNodeStyle?.visibility ?? null,
        sampleNodeDisplay: sampleNodeStyle?.display ?? null,
        sampleNodeTransform: sampleNode?.style.transform ?? null,
        sampleNodeBackground: sampleNodeStyle?.background ?? null,
        sampleNodeBorder: sampleNodeStyle?.border ?? null,
        sampleNodeColor: sampleNodeStyle?.color ?? null,
        sampleNodeLeft: sampleNodeRect ? Number(sampleNodeRect.left.toFixed(1)) : null,
        sampleNodeTop: sampleNodeRect ? Number(sampleNodeRect.top.toFixed(1)) : null,
        sampleNodeWidth: sampleNodeRect ? Number(sampleNodeRect.width.toFixed(1)) : null,
        sampleNodeHeight: sampleNodeRect ? Number(sampleNodeRect.height.toFixed(1)) : null,
        sampleNodeCenterX: sampleNodeCenter ? Number(sampleNodeCenter.x.toFixed(1)) : null,
        sampleNodeCenterY: sampleNodeCenter ? Number(sampleNodeCenter.y.toFixed(1)) : null,
        sampleNodeCover: describeElement(sampleCoverEl),
        resultNodeId: resultNode?.dataset.id ?? null,
        resultNodeOpacity: resultNodeStyle?.opacity ?? null,
        resultNodeVisibility: resultNodeStyle?.visibility ?? null,
        resultNodeDisplay: resultNodeStyle?.display ?? null,
        resultNodeTransform: resultNode?.style.transform ?? null,
        resultNodeBackground: resultNodeStyle?.background ?? null,
        resultNodeBorder: resultNodeStyle?.border ?? null,
        resultNodeColor: resultNodeStyle?.color ?? null,
        resultNodeLeft: resultNodeRect ? Number(resultNodeRect.left.toFixed(1)) : null,
        resultNodeTop: resultNodeRect ? Number(resultNodeRect.top.toFixed(1)) : null,
        resultNodeWidth: resultNodeRect ? Number(resultNodeRect.width.toFixed(1)) : null,
        resultNodeHeight: resultNodeRect ? Number(resultNodeRect.height.toFixed(1)) : null,
        resultNodeCenterX: resultNodeCenter ? Number(resultNodeCenter.x.toFixed(1)) : null,
        resultNodeCenterY: resultNodeCenter ? Number(resultNodeCenter.y.toFixed(1)) : null,
        resultNodeCover: describeElement(resultCoverEl),
        workspaceNodePositions,
      });
    };

    logDomState("effect-start");
    const timeoutId = window.setTimeout(() => logDomState("effect-timeout"), 0);
    const rafId = window.requestAnimationFrame(() => logDomState("effect-raf"));

    const observer = new MutationObserver(() => {
      logDomState("mutation");
    });

    observer.observe(wrapperRef.current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [nodes, viewportVersion]);

  const onNodeDrag: NodeDragHandler = (_event, draggedNode) => {
    setDraggingNodeId(draggedNode.id);
    onWorkspaceItemsChange((prev) =>
      prev.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );

    // Use live DOM overlap for hover state. It is more reliable mid-drag than
    // React Flow's internal node geometry, which can lag during movement.
    requestAnimationFrame(() => {
      setHoverTargetNodeId(getDropTargetNodeId(draggedNode.id));
    });
  };

  const onNodeDragStop: NodeDragHandler = (event, draggedNode) => {
    if (wrapperRef.current && "clientX" in event && "clientY" in event) {
      const bounds = wrapperRef.current.getBoundingClientRect();
      const outsideBounds =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;

      if (outsideBounds) {
        onRemoveWorkspaceItem(draggedNode.id);
        setDraggingNodeId(null);
        setHoverTargetNodeId(null);
        return;
      }
    }

    onWorkspaceItemsChange((prev) =>
      prev.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );

    const dropTargetNodeId =
      "clientX" in event && "clientY" in event
        ? getDropTargetNodeId(draggedNode.id, {
            x: event.clientX,
            y: event.clientY,
          })
        : getDropTargetNodeId(draggedNode.id);

    setDraggingNodeId(null);
    setHoverTargetNodeId(null);

    if (!dropTargetNodeId) return;
    setSelectedNodeIds([]);
    onCombineWorkspaceItems(draggedNode.id, dropTargetNodeId);
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;

    if ((isMarqueeMode || event.detail === 2) && !nodeEl) {
      startMarqueeSelectionAtPoint(event.clientX, event.clientY);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
    const nodeId = nodeEl?.getAttribute("data-id") ?? null;

    if (isMarqueeMode && !nodeId) {
      startMarqueeSelectionAtPoint(event.clientX, event.clientY);
      return;
    }

    pressStateRef.current = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      longPressTriggered: false,
    };

    clearLongPressTimer();

    if (nodeId) {
      longPressTimerRef.current = setTimeout(() => {
        const current = pressStateRef.current;
        if (!current || current.nodeId !== nodeId || current.moved) return;
        current.longPressTriggered = true;
        suppressNextPaneClickRef.current = true;
        toggleNodeSelection(nodeId);
      }, LONG_PRESS_MS);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeSelection && wrapperRef.current) {
      const bounds = wrapperRef.current.getBoundingClientRect();
      setMarqueeSelection((prev) =>
        prev
          ? {
              ...prev,
              currentX: event.clientX - bounds.left,
              currentY: event.clientY - bounds.top,
            }
          : prev
      );
      return;
    }

    const current = pressStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    if (current.moved) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.hypot(dx, dy) >= MOVE_THRESHOLD_PX) {
      current.moved = true;
      clearLongPressTimer();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeSelection) {
      applyMarqueeSelection();
      return;
    }

    const current = pressStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    clearLongPressTimer();

    const wasDrag = current.moved || draggingNodeId === current.nodeId;

    if (!wasDrag && !current.longPressTriggered) {
      if (current.nodeId && selectionMode) {
        toggleNodeSelection(current.nodeId);
      } else if (!current.nodeId && selectionMode) {
        setSelectedNodeIds([]);
      }
    }

    pressStateRef.current = null;
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeSelection) {
      setMarqueeSelection(null);
      setIsMarqueeMode(false);
      return;
    }

    const current = pressStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    pressStateRef.current = null;
  };

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      onMouseDownCapture={handleMouseDown}
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={handlePointerUp}
      onPointerCancelCapture={handlePointerCancel}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const rawId = event.dataTransfer.getData(
          "application/wordweave-item-id"
        );
        const itemId = Number(rawId);
        if (!Number.isInteger(itemId) || itemId <= 0) return;
        if (!reactFlow || !wrapperRef.current) {
          onAddItemToWorkspace(itemId);
          return;
        }

        const position = reactFlow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        onAddItemToWorkspace(itemId, position);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        zoomOnScroll={true}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag={!isMarqueeMode && !marqueeSelection}
        autoPanOnNodeDrag={false}
        nodeDragThreshold={NODE_DRAG_THRESHOLD_PX}
        nodesDraggable={!isMarqueeMode && !marqueeSelection}
        nodesConnectable={false}
        onInit={setReactFlow}
        onMove={() => {
          const viewport = reactFlow?.getViewport?.() ?? null;
          debugGraph("onMove", {
            viewport,
          });
          publishViewportCenter();
          setViewportVersion((prev) => prev + 1);
        }}
        onNodeDragStart={(_event, node) => {
          setDraggingNodeId(node.id);
          clearLongPressTimer();
        }}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => {
          if (isMarqueeMode) {
            setIsMarqueeMode(false);
            setMarqueeSelection(null);
            return;
          }
          if (suppressNextPaneClickRef.current) {
            suppressNextPaneClickRef.current = false;
            return;
          }
          if (selectionMode) {
            setSelectedNodeIds([]);
          }
        }}
        onNodeDoubleClick={(_event, node) => {
          onDuplicateWorkspaceItem(node.id, {
            x: node.position.x + DOUBLE_CLICK_DUPLICATE_OFFSET_PX,
            y: node.position.y + DOUBLE_CLICK_DUPLICATE_OFFSET_PX,
          });
        }}
      >
        <Background gap={16} color="rgba(148,163,184,0.24)" />
      </ReactFlow>
      {creativeDragPreview ? (
        <div
          className="creative-drag-preview"
          aria-hidden="true"
          style={{
            left: `${creativeDragPreview.x}px`,
            top: `${creativeDragPreview.y}px`,
          }}
        >
          <span className="creative-drag-preview-icon">
            {itemById.get(creativeDragPreview.itemId)?.icon ?? "•"}
          </span>
          <span className="creative-drag-preview-name">
            {itemById.get(creativeDragPreview.itemId)?.name ?? ""}
          </span>
        </div>
      ) : null}
      {selectionBoundsVisual ? (
        <div
          className="graph-selection-bounds"
          aria-hidden="true"
          style={{
            left: `${selectionBoundsVisual.left}px`,
            top: `${selectionBoundsVisual.top}px`,
            width: `${selectionBoundsVisual.width}px`,
            height: `${selectionBoundsVisual.height}px`,
          }}
        />
      ) : null}
      {marqueeSelectionRect ? (
        <div
          className="graph-marquee-selection"
          aria-hidden="true"
          style={{
            left: `${marqueeSelectionRect.left}px`,
            top: `${marqueeSelectionRect.top}px`,
            width: `${marqueeSelectionRect.width}px`,
            height: `${marqueeSelectionRect.height}px`,
          }}
        />
      ) : null}
      <button
        type="button"
        className={`graph-select-button${isMarqueeMode ? " is-active" : ""}`}
        aria-label="Drag a selection box"
        title="Drag a selection box"
        onClick={() => {
          setIsMarqueeMode((prev) => !prev);
          setMarqueeSelection(null);
        }}
      >
        ⬚
      </button>
      {evolveUnlocked ? (
        <button
          type="button"
          className="graph-evolve-button"
          aria-label="Drag Evolve into the workspace"
          title="Drag Evolve into the workspace to advance a concept into its next stronger form"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, EVOLVE_ITEM_ID)
          }
          onClick={handleEvolveSpawnClick}
        >
          {EVOLVE_ITEM.icon}
        </button>
      ) : null}
      {wordCombineUnlocked ? (
        <button
          type="button"
          className="graph-word-combine-button"
          aria-label="Drag Compound into the workspace"
          title="Drag Compound into the workspace to join inputs into a real established compound word or phrase"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, WORD_COMBINE_ITEM_ID)
          }
          onClick={handleWordCombineSpawnClick}
        >
          {WORD_COMBINE_ITEM.icon}
        </button>
      ) : null}
      {popCultureUnlocked ? (
        <button
          type="button"
          className="graph-pop-culture-button"
          aria-label="Drag Pop Culture into the workspace"
          title="Drag Pop Culture into the workspace to resolve a combination as a specific pop culture reference"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, POP_CULTURE_ITEM_ID)
          }
          onClick={handlePopCultureSpawnClick}
        >
          {POP_CULTURE_ITEM.icon}
        </button>
      ) : null}
      {craftUnlocked ? (
        <button
          type="button"
          className="graph-craft-button"
          aria-label="Drag Craft into the workspace"
          title="Drag Craft into the workspace to resolve a combination as a physical crafted result"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, CRAFT_ITEM_ID)
          }
          onClick={handleCraftSpawnClick}
        >
          {CRAFT_ITEM.icon}
        </button>
      ) : null}
      {randomizeUnlocked ? (
        <button
          type="button"
          className="graph-randomize-button"
          aria-label="Drag Randomize into the workspace"
          title="Drag Randomize into the workspace to transform an item into another nearby variation"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, RANDOMIZE_ITEM_ID)
          }
          onClick={handleRandomizeSpawnClick}
        >
          {RANDOMIZE_ITEM.icon}
        </button>
      ) : null}
      {oppositeUnlocked ? (
        <button
          type="button"
          className="graph-opposite-button"
          aria-label="Drag Opposite into the workspace"
          title="Drag Opposite into the workspace to find the direct opposite of an input"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, OPPOSITE_ITEM_ID)
          }
          onClick={handleOppositeSpawnClick}
        >
          {OPPOSITE_ITEM.icon}
        </button>
      ) : null}
      {splitUnlocked ? (
        <button
          type="button"
          className="graph-subtraction-button"
          aria-label="Drag Split into the workspace"
          title="Drag Split into the workspace to remove one concept from another"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, SPLIT_ITEM_ID)
          }
          onClick={handleSplitSpawnClick}
        >
          {SPLIT_ITEM.icon}
        </button>
      ) : null}
      {creativeUnlocked ? (
        <button
          type="button"
          className="graph-creative-button"
          aria-label="Drag Creative Spark into the workspace"
          title="Drag Creative Spark into the workspace to make a combination more creative"
          onPointerDown={(event) =>
            handleCatalystSpawnPointerDown(event, CREATIVE_ITEM_ID)
          }
          onClick={handleCreativeSpawnClick}
        >
          {CREATIVE_ITEM.icon}
        </button>
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
      {hasMultiSelection && selectionBoundsVisual ? (
        <button
          type="button"
          className="graph-selection-move-handle"
          aria-label="Move selected items"
          title="Move selected items"
          style={{
            left: `${selectionBoundsVisual.left + selectionBoundsVisual.width}px`,
            top: `${selectionBoundsVisual.top}px`,
          }}
          onPointerDown={handleSelectionMovePointerDown}
        >
          ✥
        </button>
      ) : null}
      {hasMultiSelection && selectionBoundsVisual ? (
        <div
          className="graph-selection-actions"
          style={{
            left: `${selectionBoundsVisual.left + selectionBoundsVisual.width}px`,
            top: `${selectionBoundsVisual.top + selectionBoundsVisual.height}px`,
          }}
        >
          <button
            type="button"
            className="button secondary graph-copy-selected-button"
            aria-label="Copy selected items"
            title="Copy selected items"
            onClick={duplicateSelection}
          >
            ⧉
          </button>
          <button
            type="button"
            className="button primary graph-combine-selected-button"
            aria-label="Combine selected items"
            onClick={async () => {
              const layout = buildSelectionCombineLayout();
              if (!layout) return;
              setSelectionCombinePlaceholderId(layout.placeholderNodeId);
              setSelectionCombineAwaitingStart(true);
              const started = await onCombineWorkspaceSelection(layout);
              if (started) {
                setSelectionCombineAwaitingStart(false);
                setSelectionCombineActive(false);
                setSelectionCombinePlaceholderId(null);
                setSelectedNodeIds([]);
              } else {
                setSelectionCombineAwaitingStart(false);
                setSelectionCombinePlaceholderId(null);
                setSelectedNodeIds(layout.nodeIds);
              }
            }}
          >
            Combine
          </button>
        </div>
      ) : null}
      {workspaceItems.length === 0 ? (
        <div className="graph-placeholder">
          Add items from the left, then drag one onto another to combine.
        </div>
      ) : null}
    </div>
  );
}

const GraphView: React.FC<Props> = (props) => {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
};

export default GraphView;
