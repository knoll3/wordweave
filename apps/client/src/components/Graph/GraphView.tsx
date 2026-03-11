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
  combiningNodeIds?: {
    sourceNodeId: string;
    targetNodeId: string;
  } | null;
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
  onCombineWorkspaceItems: (
    sourceNodeId: string,
    targetNodeId: string
  ) => void;
}

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
  onCombineWorkspaceItems,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [hoverTargetNodeId, setHoverTargetNodeId] = useState<string | null>(null);

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
        const isCombiningPair =
          !!combiningNodeIds &&
          (workspaceItem.nodeId === combiningNodeIds.sourceNodeId ||
            workspaceItem.nodeId === combiningNodeIds.targetNodeId);
        const icon = item.icon || item.name.charAt(0).toUpperCase();
        return {
          id: workspaceItem.nodeId,
          position: workspaceItem.position,
          data: { label: `${icon} ${item.name}` },
          type: "default",
          className: isCombiningPair ? "node-combining" : undefined,
          zIndex: isDragging ? 1000 : 1,
          style: {
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: 11,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid rgba(79,70,229,0.6)",
            color: "#e5e7eb",
            opacity: isCombiningPair ? 1 : isDragOverlapPair ? 0.5 : 1,
          },
        } satisfies Node;
      })
      .filter(Boolean) as Node[];
  }, [
    combiningNodeIds,
    draggingNodeId,
    hoverTargetNodeId,
    itemById,
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

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
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
        nodesDraggable={true}
        nodesConnectable={false}
        onInit={setReactFlow}
        onMove={publishViewportCenter}
        onNodeDragStart={(_event, node) => {
          setDraggingNodeId(node.id);
        }}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
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
      {workspaceItems.length > 0 ? (
        <button
          type="button"
          className="button secondary graph-clear-button"
          onClick={onClearWorkspace}
        >
          Clear
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
