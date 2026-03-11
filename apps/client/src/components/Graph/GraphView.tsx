import React, { useMemo, useRef, useState } from "react";
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
  onAddItemToWorkspace,
  onCombineWorkspaceItems,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance | null>(null);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  const nodes: Node[] = useMemo(() => {
    return workspaceItems
      .map((workspaceItem) => {
        const item = itemById.get(workspaceItem.itemId);
        if (!item) return null;
        const icon = item.icon || item.name.charAt(0).toUpperCase();
        return {
          id: workspaceItem.nodeId,
          position: workspaceItem.position,
          data: { label: `${icon} ${item.name}` },
          type: "default",
          style: {
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: 11,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid rgba(79,70,229,0.6)",
            color: "#e5e7eb",
          },
        } satisfies Node;
      })
      .filter(Boolean) as Node[];
  }, [itemById, workspaceItems]);

  const onNodeDrag: NodeDragHandler = (_event, draggedNode) => {
    onWorkspaceItemsChange(
      workspaceItems.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );
  };

  const onNodeDragStop: NodeDragHandler = (_event, draggedNode) => {
    onWorkspaceItemsChange(
      workspaceItems.map((item) =>
        item.nodeId === draggedNode.id
          ? { ...item, position: draggedNode.position }
          : item
      )
    );

    if (!reactFlow) return;

    const width = draggedNode.width;
    const height = draggedNode.height;
    const absolutePosition =
      draggedNode.positionAbsolute ?? draggedNode.position;

    // Use the drag-stop node geometry directly to avoid stale internal-store
    // lookups that can produce intermittent false-positive intersections.
    if (!width || !height) return;
    const draggedRect = {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width,
      height,
    };

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

    const overlaps = reactFlow
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
        nodesDraggable={true}
        nodesConnectable={false}
        onInit={setReactFlow}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
      >
        <Background gap={16} color="rgba(148,163,184,0.24)" />
        <Controls showInteractive={false} />
      </ReactFlow>
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
