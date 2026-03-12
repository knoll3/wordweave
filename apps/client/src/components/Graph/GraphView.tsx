import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  NodeDragHandler,
  ReactFlowInstance,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import type { Item, WorkspaceItem } from "../../types";

interface Props {
  items: Item[];
  workspaceItems: WorkspaceItem[];
  onWorkspaceItemsChange: (items: WorkspaceItem[]) => void;
  onViewportCenterChange?: (position: { x: number; y: number }) => void;
  combiningNodeIds?: string[] | null;
  convergingNodeIds?: string[] | null;
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
  onCombineWorkspaceSelection: (nodeIds: string[]) => void;
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

const LONG_PRESS_MS = 550;
const MOVE_THRESHOLD_PX = 10;
const NODE_DRAG_THRESHOLD_PX = 12;

function FlowCanvas({
  items,
  workspaceItems,
  onWorkspaceItemsChange,
  onViewportCenterChange,
  combiningNodeIds,
  convergingNodeIds,
  onClearWorkspace,
  onRemoveWorkspaceItem,
  onDuplicateWorkspaceItem,
  onAddItemToWorkspace,
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

  const pressStateRef = useRef<PressState | null>(null);
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
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver(() => {
      publishViewportCenter();
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [publishViewportCenter]);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  useEffect(() => {
    const workspaceNodeIds = new Set(workspaceItems.map((item) => item.nodeId));
    setSelectedNodeIds((prev) => prev.filter((id) => workspaceNodeIds.has(id)));
  }, [workspaceItems]);

  const selectionMode = selectedNodeIds.length > 0;

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
          const workspaceNode = workspaceItems.find((item) => item.nodeId === nodeId);
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
    [itemById, reactFlow, workspaceItems]
  );

  const selectionCenterVisual = useMemo(() => {
    if (!wrapperRef.current || selectedNodeIds.length < 2) {
      return null;
    }

    const bounds = wrapperRef.current.getBoundingClientRect();
    const nodeVisuals = getNodeVisualsLocal(selectedNodeIds);
    if (nodeVisuals.length < 2) return null;

    const centerSum = nodeVisuals.reduce(
      (acc, node) => ({
        x: acc.x + node.x,
        y: acc.y + node.y,
      }),
      { x: 0, y: 0 }
    );
    const localCenter = {
      x: centerSum.x / nodeVisuals.length,
      y: centerSum.y / nodeVisuals.length,
    };

    const clampedCenter = {
      x: Math.max(44, Math.min(bounds.width - 44, localCenter.x)),
      y: Math.max(44, Math.min(bounds.height - 44, localCenter.y)),
    };

    return {
      center: clampedCenter,
      lines: nodeVisuals.map((node) => ({ x: node.x, y: node.y })),
    };
  }, [getNodeVisualsLocal, selectedNodeIds, viewportVersion, workspaceItems]);

  const combineConvergeVisual = useMemo(() => {
    if (!wrapperRef.current || !convergingNodeIds || convergingNodeIds.length < 2) {
      return null;
    }

    const bounds = wrapperRef.current.getBoundingClientRect();
    const nodeVisuals = getNodeVisualsLocal(convergingNodeIds);
    if (nodeVisuals.length < 2) return null;

    const centerSum = nodeVisuals.reduce(
      (acc, node) => ({
        x: acc.x + node.x,
        y: acc.y + node.y,
      }),
      { x: 0, y: 0 }
    );
    const localCenter = {
      x: centerSum.x / nodeVisuals.length,
      y: centerSum.y / nodeVisuals.length,
    };
    const clampedCenter = {
      x: Math.max(44, Math.min(bounds.width - 44, localCenter.x)),
      y: Math.max(44, Math.min(bounds.height - 44, localCenter.y)),
    };

    return {
      center: clampedCenter,
      nodes: nodeVisuals.map((node) => ({
        ...node,
        dx: clampedCenter.x - node.x,
        dy: clampedCenter.y - node.y,
      })),
    };
  }, [convergingNodeIds, getNodeVisualsLocal, viewportVersion, workspaceItems]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) =>
      prev.includes(nodeId)
        ? prev.filter((id) => id !== nodeId)
        : [...prev, nodeId]
    );
  }, []);

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

  const getOverlapsForDraggedNode = useCallback(
    (draggedNode: Node) => {
      if (!reactFlow) return [];
      const width = draggedNode.width;
      const height = draggedNode.height;
      const absolutePosition =
        draggedNode.positionAbsolute ?? draggedNode.position;
      if (!width || !height) return [];

      const draggedRect = {
        x: absolutePosition.x,
        y: absolutePosition.y,
        width,
        height,
      };

      return reactFlow
        .getIntersectingNodes(draggedRect)
        .filter((node) => node.id !== draggedNode.id)
        .map((node) => ({
          node,
          area: overlapArea(draggedRect, {
            x: node.positionAbsolute?.x ?? node.position.x,
            y: node.positionAbsolute?.y ?? node.position.y,
            width: node.width ?? 0,
            height: node.height ?? 0,
          }),
        }))
        .filter((entry) => entry.area > 0)
        .sort((a, b) => b.area - a.area);
    },
    [reactFlow]
  );

  const nodes: Node[] = useMemo(() => {
    return workspaceItems
      .map((workspaceItem) => {
        const item = itemById.get(workspaceItem.itemId);
        if (!item) return null;

        const isDragging = workspaceItem.nodeId === draggingNodeId;
        const isDragOverlapPair =
          !!draggingNodeId &&
          !!hoverTargetNodeId &&
          (workspaceItem.nodeId === draggingNodeId ||
            workspaceItem.nodeId === hoverTargetNodeId);
        const isCombiningNode = !!combiningNodeIds?.includes(workspaceItem.nodeId);
        const isConvergingNode = !!convergingNodeIds?.includes(workspaceItem.nodeId);
        const shouldPulseCombineNode = isCombiningNode && !isConvergingNode;
        const isSelected = selectedNodeIds.includes(workspaceItem.nodeId);

        const icon = item.icon || item.name.charAt(0).toUpperCase();

        return {
          id: workspaceItem.nodeId,
          position: workspaceItem.position,
          data: { label: `${icon} ${item.name}` },
          type: "default",
          className: shouldPulseCombineNode ? "node-combining" : undefined,
          zIndex: isDragging ? 1000 : isSelected ? 20 : 1,
          style: {
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: 11,
            background: isSelected
              ? "rgba(99,102,241,0.38)"
              : "rgba(15,23,42,0.98)",
            border: isSelected
              ? "1px solid rgba(99,102,241,0.95)"
              : "1px solid rgba(79,70,229,0.6)",
            boxShadow: isSelected
              ? "0 0 0 2px rgba(99,102,241,0.25)"
              : "none",
            color: "#e5e7eb",
            opacity: isConvergingNode ? 0 : isCombiningNode ? 1 : isDragOverlapPair ? 0.5 : 1,
          },
        } satisfies Node;
      })
      .filter(Boolean) as Node[];
  }, [
    combiningNodeIds,
    convergingNodeIds,
    draggingNodeId,
    hoverTargetNodeId,
    itemById,
    selectedNodeIds,
    workspaceItems,
  ]);

  const onNodeDrag: NodeDragHandler = (_event, draggedNode) => {
    setDraggingNodeId(draggedNode.id);
    onWorkspaceItemsChange(
      workspaceItems.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );

    const overlaps = getOverlapsForDraggedNode(draggedNode);
    setHoverTargetNodeId(overlaps[0]?.node.id ?? null);
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

    onWorkspaceItemsChange(
      workspaceItems.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );

    const overlaps = getOverlapsForDraggedNode(draggedNode);

    setDraggingNodeId(null);
    setHoverTargetNodeId(null);

    if (!overlaps.length) return;
    onCombineWorkspaceItems(draggedNode.id, overlaps[0].node.id);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (combiningNodeIds?.length) return;

    const target = event.target as HTMLElement | null;
    const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
    const nodeId = nodeEl?.getAttribute("data-id") ?? null;

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
    const current = pressStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    pressStateRef.current = null;
  };

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
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
        zoomOnScroll={true}
        panOnScroll={false}
        panOnDrag={true}
        autoPanOnNodeDrag={false}
        nodeDragThreshold={NODE_DRAG_THRESHOLD_PX}
        nodesDraggable={true}
        nodesConnectable={false}
        onInit={setReactFlow}
        onMove={() => {
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
            x: node.position.x + 28,
            y: node.position.y + 28,
          });
        }}
      >
        <Background gap={16} color="rgba(148,163,184,0.24)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {combineConvergeVisual ? (
        <div className="combine-converge-layer" aria-hidden="true">
          {combineConvergeVisual.nodes.map((node) => (
            <div
              key={`combine-converge-${node.nodeId}`}
              className="combine-converge-node"
              style={
                {
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.width}px`,
                  height: `${node.height}px`,
                  "--converge-x": `${node.dx}px`,
                  "--converge-y": `${node.dy}px`,
                } as React.CSSProperties
              }
            >
              <span className="combine-converge-icon">{node.icon}</span>
              <span className="combine-converge-name">{node.name}</span>
            </div>
          ))}
        </div>
      ) : null}
      {selectionCenterVisual ? (
        <svg className="selection-center-lines" aria-hidden="true">
          {selectionCenterVisual.lines.map((line, idx) => (
            <line
              key={`selection-line-${idx}`}
              x1={line.x}
              y1={line.y}
              x2={selectionCenterVisual.center.x}
              y2={selectionCenterVisual.center.y}
            />
          ))}
        </svg>
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
      {selectedNodeIds.length >= 2 && selectionCenterVisual ? (
        <button
          type="button"
          className="button primary graph-combine-selected-button"
          aria-label="Combine selected items"
          style={{
            left: `${selectionCenterVisual.center.x}px`,
            top: `${selectionCenterVisual.center.y}px`,
          }}
          onClick={() => {
            onCombineWorkspaceSelection(selectedNodeIds);
            setSelectedNodeIds([]);
          }}
        >
          ⚗
          <span className="graph-combine-count">{selectedNodeIds.length}</span>
        </button>
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
