export type SharedRoomId = string;

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
  roomId: SharedRoomId;
  boardItems: SharedBoardItem[];
  canUndo?: boolean;
}

export interface SharedBoardPatch {
  roomId: SharedRoomId;
  upserts: SharedBoardItem[];
  deletedNodeIds: string[];
  canUndo?: boolean;
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

export interface SharedBoardMoveInput {
  nodeId: string;
  position: { x: number; y: number };
}

export interface SharedBoardCombineInput {
  consumedNodeIds: string[];
  producedItems: SharedBoardCreateItemInput[];
}

export interface SharedBoardModifierAttachmentInput {
  sourceNodeId: string;
  targetNodeId: string;
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
