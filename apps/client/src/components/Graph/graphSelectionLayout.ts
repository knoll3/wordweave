import type { SelectionCombineLayout, WorkspaceItem } from "../../types";
import { resolveActionPromptFamilyKey } from "../../lib/actionPromptFamilies";
import { ACTION_CATALYST_BY_ID } from "../../lib/specialItems";
import {
  CARD_HEIGHT,
  GRID_CELL_GAP_X,
  GRID_CELL_GAP_Y,
  PLACEHOLDER_WIDTH,
} from "./graphViewHelpers";

type SelectionLayoutWorkspaceItem = Pick<
  WorkspaceItem,
  "nodeId" | "itemId" | "actionConstraintName" | "actionConstraintNormalizedName"
>;

type SelectionLayoutView = {
  nodeId: string;
  position: { x: number; y: number };
  width: number;
};

type BuildSelectionLayoutInput = {
  nodeIds: string[];
  selectedWorkspaceItems: SelectionLayoutWorkspaceItem[];
  selectedViews: SelectionLayoutView[];
  placeholderNodeId: string;
};

type ActionCatalyst = NonNullable<
  typeof ACTION_CATALYST_BY_ID extends Map<number, infer Value> ? Value : never
>;

export function buildGraphSelectionLayout({
  nodeIds,
  selectedWorkspaceItems,
  selectedViews,
  placeholderNodeId,
}: BuildSelectionLayoutInput): SelectionCombineLayout | null {
  if (nodeIds.length < 2 || selectedViews.length < 2) return null;

  const actionAnchor = selectedWorkspaceItems.find(
    (item) => item.actionConstraintName && item.actionConstraintNormalizedName
  );
  const actionCatalyst =
    selectedWorkspaceItems
      .map((item) => ACTION_CATALYST_BY_ID.get(item.itemId) ?? null)
      .find((entry): entry is ActionCatalyst => entry != null) ?? null;
  const effectiveActionConstraint =
    actionAnchor?.actionConstraintName ?? actionCatalyst?.actionConstraint ?? null;
  const isCompoundSelection =
    resolveActionPromptFamilyKey(effectiveActionConstraint) === "compound";

  const bounds = selectedViews.reduce(
    (acc, entry) => ({
      left: Math.min(acc.left, entry.position.x),
      top: Math.min(acc.top, entry.position.y),
      right: Math.max(acc.right, entry.position.x + entry.width),
      bottom: Math.max(acc.bottom, entry.position.y + CARD_HEIGHT),
      totalWidth: acc.totalWidth + entry.width,
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
      totalWidth: 0,
    }
  );

  const orderedNodeIds = [...selectedViews]
    .sort((a, b) => {
      if (isCompoundSelection) {
        if (a.position.x !== b.position.x) return a.position.x - b.position.x;
        return a.position.y - b.position.y;
      }
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    })
    .map((entry) => entry.nodeId);

  const viewWidthByNodeId = new Map(
    selectedViews.map((entry) => [entry.nodeId, entry.width])
  );
  const placeholderWidth = Math.max(
    PLACEHOLDER_WIDTH,
    Math.round(bounds.totalWidth / selectedViews.length)
  );
  const itemsForLayout = [
    ...orderedNodeIds.map((nodeId) => ({
      nodeId,
      width: viewWidthByNodeId.get(nodeId) ?? 0,
      isPlaceholder: false,
    })),
    {
      nodeId: placeholderNodeId,
      width: placeholderWidth,
      isPlaceholder: true,
    },
  ];

  const selectionWidth = bounds.right - bounds.left;
  const averageWidth = bounds.totalWidth / selectedViews.length;
  const targetRowWidth = Math.max(
    selectionWidth,
    Math.round(Math.sqrt(itemsForLayout.length) * averageWidth)
  );

  const rows: Array<Array<(typeof itemsForLayout)[number]>> = [];
  let currentRow: Array<(typeof itemsForLayout)[number]> = [];
  let currentRowWidth = 0;

  itemsForLayout.forEach((entry) => {
    const nextWidth =
      currentRow.length === 0 ? entry.width : currentRowWidth + GRID_CELL_GAP_X + entry.width;
    if (currentRow.length > 0 && nextWidth > targetRowWidth) {
      rows.push(currentRow);
      currentRow = [entry];
      currentRowWidth = entry.width;
      return;
    }
    currentRow.push(entry);
    currentRowWidth = nextWidth;
  });
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  const gridHeight = rows.length * CARD_HEIGHT + (rows.length - 1) * GRID_CELL_GAP_Y;
  const currentCenterY = (bounds.top + bounds.bottom) / 2;
  const startX = Math.round(bounds.left);
  const startY = Math.round(currentCenterY - gridHeight / 2);
  const nodePositions: SelectionCombineLayout["nodePositions"] = [];
  let placeholderPosition = { x: startX, y: startY };

  rows.forEach((row, rowIndex) => {
    let rowX = startX;
    const rowY = startY + rowIndex * (CARD_HEIGHT + GRID_CELL_GAP_Y);
    row.forEach((entry) => {
      if (entry.isPlaceholder) {
        placeholderPosition = { x: Math.round(rowX), y: Math.round(rowY) };
      } else {
        nodePositions.push({
          nodeId: entry.nodeId,
          position: {
            x: Math.round(rowX),
            y: Math.round(rowY),
          },
        });
      }
      rowX += entry.width + GRID_CELL_GAP_X;
    });
  });

  return {
    nodeIds: orderedNodeIds,
    nodePositions,
    placeholderNodeId,
    placeholderPosition,
  };
}
