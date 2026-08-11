import type {
  SharedBoardCreateItemInput,
  SharedBoardItem,
  SharedRoomSnapshot,
} from "./liveBoardTypes";
import type { Database } from "./db";

export const DEFAULT_ROOM_ID = "default-room";

type BoardItemRow = Record<string, unknown>;

function nextRevision(row: BoardItemRow) {
  return Number(row.revision ?? 0);
}

function mapBoardItemRow(row: BoardItemRow): SharedBoardItem {
  return {
    nodeId: String(row.id),
    itemId: Number(row.item_id),
    position: {
      x: Number(row.position_x),
      y: Number(row.position_y),
    },
    isNewDiscovery: Number(row.is_new_discovery ?? 0) === 1 || undefined,
    arrivalHighlightMode:
      row.arrival_highlight_mode == null
        ? undefined
        : (String(row.arrival_highlight_mode) as SharedBoardItem["arrivalHighlightMode"]),
    categoryConstraintName:
      row.category_constraint_name == null ? null : String(row.category_constraint_name),
    categoryConstraintNormalizedName:
      row.category_constraint_normalized_name == null
        ? null
        : String(row.category_constraint_normalized_name),
    actionConstraintName:
      row.action_constraint_name == null ? null : String(row.action_constraint_name),
    actionConstraintNormalizedName:
      row.action_constraint_normalized_name == null
        ? null
        : String(row.action_constraint_normalized_name),
    revision: nextRevision(row),
  };
}

export function ensureDefaultRoom(db: Database) {
  const stmt = db.prepare(
    `
    INSERT OR IGNORE INTO rooms (id, created_at, updated_at)
    VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `
  );
  stmt.run([DEFAULT_ROOM_ID]);
  stmt.free();
}

export function listBoardItems(
  db: Database,
  roomId: string = DEFAULT_ROOM_ID
): SharedBoardItem[] {
  const stmt = db.prepare(
    `
    SELECT
      id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision
    FROM room_board_items
    WHERE room_id = ?
    ORDER BY created_at ASC, id ASC
    `
  );
  stmt.bind([roomId]);
  const rows: SharedBoardItem[] = [];
  while (stmt.step()) {
    rows.push(mapBoardItemRow(stmt.getAsObject() as BoardItemRow));
  }
  stmt.free();
  return rows;
}

export function getRoomSnapshot(
  db: Database,
  roomId: string = DEFAULT_ROOM_ID
): SharedRoomSnapshot {
  return {
    roomId,
    boardItems: listBoardItems(db, roomId),
  };
}

export function getBoardItemById(db: Database, nodeId: string) {
  const stmt = db.prepare(
    `
    SELECT
      id,
      room_id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision
    FROM room_board_items
    WHERE id = ?
    `
  );
  const row = stmt.getAsObject([nodeId]);
  stmt.free();
  return row && row.id !== undefined ? (row as BoardItemRow) : null;
}

export function insertBoardItem(
  db: Database,
  params: {
    roomId?: string;
    nodeId: string;
    item: SharedBoardCreateItemInput;
  }
) {
  const stmt = db.prepare(
    `
    INSERT INTO room_board_items (
      id,
      room_id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `
  );
  stmt.run([
    params.nodeId,
    params.roomId ?? DEFAULT_ROOM_ID,
    params.item.itemId,
    params.item.position.x,
    params.item.position.y,
    params.item.isNewDiscovery ? 1 : 0,
    params.item.arrivalHighlightMode ?? null,
    params.item.categoryConstraintName ?? null,
    params.item.categoryConstraintNormalizedName ?? null,
    params.item.actionConstraintName ?? null,
    params.item.actionConstraintNormalizedName ?? null,
  ]);
  stmt.free();

  const inserted = getBoardItemById(db, params.nodeId);
  if (!inserted) {
    throw new Error("Failed to insert board item");
  }
  return mapBoardItemRow(inserted);
}

export function updateBoardItemPosition(
  db: Database,
  params: {
    nodeId: string;
    x: number;
    y: number;
  }
) {
  const stmt = db.prepare(
    `
    UPDATE room_board_items
    SET
      position_x = ?,
      position_y = ?,
      revision = revision + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  );
  stmt.run([params.x, params.y, params.nodeId]);
  stmt.free();

  const updated = getBoardItemById(db, params.nodeId);
  return updated ? mapBoardItemRow(updated) : null;
}

export function updateBoardItemMetadata(
  db: Database,
  params: {
    nodeId: string;
    itemId?: number;
    isNewDiscovery?: boolean;
    arrivalHighlightMode?: SharedBoardItem["arrivalHighlightMode"] | null;
    categoryConstraintName?: string | null;
    categoryConstraintNormalizedName?: string | null;
    actionConstraintName?: string | null;
    actionConstraintNormalizedName?: string | null;
  }
) {
  const stmt = db.prepare(
    `
    UPDATE room_board_items
    SET
      item_id = COALESCE(?, item_id),
      is_new_discovery = COALESCE(?, is_new_discovery),
      arrival_highlight_mode = ?,
      category_constraint_name = ?,
      category_constraint_normalized_name = ?,
      action_constraint_name = ?,
      action_constraint_normalized_name = ?,
      revision = revision + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  );
  stmt.run([
    params.itemId ?? null,
    params.isNewDiscovery == null ? null : params.isNewDiscovery ? 1 : 0,
    params.arrivalHighlightMode ?? null,
    params.categoryConstraintName ?? null,
    params.categoryConstraintNormalizedName ?? null,
    params.actionConstraintName ?? null,
    params.actionConstraintNormalizedName ?? null,
    params.nodeId,
  ]);
  stmt.free();

  const updated = getBoardItemById(db, params.nodeId);
  return updated ? mapBoardItemRow(updated) : null;
}

export function deleteBoardItem(db: Database, nodeId: string) {
  const stmt = db.prepare("DELETE FROM room_board_items WHERE id = ?");
  stmt.run([nodeId]);
  stmt.free();
}

export function deleteBoardItems(db: Database, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return;
  }
  const stmt = db.prepare(
    `DELETE FROM room_board_items WHERE id IN (${nodeIds.map(() => "?").join(", ")})`
  );
  stmt.run(nodeIds);
  stmt.free();
}

export function clearBoardItems(db: Database, roomId: string = DEFAULT_ROOM_ID) {
  const stmt = db.prepare("DELETE FROM room_board_items WHERE room_id = ?");
  stmt.run([roomId]);
  stmt.free();
}

export function loadBoardItemsByIds(
  db: Database,
  nodeIds: string[],
  roomId: string = DEFAULT_ROOM_ID
) {
  if (nodeIds.length === 0) {
    return [];
  }
  const stmt = db.prepare(
    `
    SELECT
      id,
      room_id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision
    FROM room_board_items
    WHERE room_id = ? AND id IN (${nodeIds.map(() => "?").join(", ")})
    `
  );
  stmt.bind([roomId, ...nodeIds]);
  const rows: SharedBoardItem[] = [];
  while (stmt.step()) {
    rows.push(mapBoardItemRow(stmt.getAsObject() as BoardItemRow));
  }
  stmt.free();
  return rows;
}
