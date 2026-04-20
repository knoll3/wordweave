export interface SharedBoardItem {
  nodeId: string;
  itemId: number;
  position: { x: number; y: number };
  isNewDiscovery?: boolean;
  arrivalHighlightMode?: "library" | "combine";
  categoryConstraintName?: string | null;
  categoryConstraintNormalizedName?: string | null;
  actionConstraintName?: string | null;
  actionConstraintNormalizedName?: string | null;
  revision: number;
}

export interface SharedRoomSnapshot {
  roomId: string;
  boardItems: SharedBoardItem[];
  canUndo?: boolean;
}

export interface SharedBoardPatch {
  roomId: string;
  upserts: SharedBoardItem[];
  deletedNodeIds: string[];
  canUndo?: boolean;
}

export type SharedBoardActivityMode = "combining" | "pondering" | "searching";

export interface SharedBoardActivity {
  nodeIds: string[];
  layout?: {
    nodeIds: string[];
    nodePositions: Array<{
      nodeId: string;
      position: { x: number; y: number };
    }>;
    placeholderNodeId: string;
    placeholderPosition: { x: number; y: number };
  } | null;
  mode?: SharedBoardActivityMode | null;
}

export interface SharedPlayerViewportCenter {
  playerId: string;
  center: { x: number; y: number };
}

export interface SharedBoardCreateItemInput {
  itemId: number;
  position: { x: number; y: number };
  isNewDiscovery?: boolean;
  arrivalHighlightMode?: "library" | "combine";
  categoryConstraintName?: string | null;
  categoryConstraintNormalizedName?: string | null;
  actionConstraintName?: string | null;
  actionConstraintNormalizedName?: string | null;
}

export interface SharedBoardDragClaim {
  nodeId: string;
}

export interface SharedBoardDragMove {
  nodeId: string;
  position: { x: number; y: number };
  sequence: number;
}

export interface SharedBoardDragResult {
  ok: boolean;
  nodeId: string;
  position?: { x: number; y: number } | null;
}
