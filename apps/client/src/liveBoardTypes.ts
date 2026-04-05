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
}

export interface SharedBoardPatch {
  roomId: string;
  upserts: SharedBoardItem[];
  deletedNodeIds: string[];
}

export interface SharedBoardCreateItemInput {
  itemId: number;
  position: { x: number; y: number };
  isNewDiscovery?: boolean;
  arrivalHighlightMode?: "library" | "combine" | null;
  categoryConstraintName?: string | null;
  categoryConstraintNormalizedName?: string | null;
  actionConstraintName?: string | null;
  actionConstraintNormalizedName?: string | null;
}

export interface SharedBoardCombineInput {
  consumedNodeIds: string[];
  producedItems: SharedBoardCreateItemInput[];
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
