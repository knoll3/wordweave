import { DEFAULT_ROOM_ID, clearBoardItems, getRoomSnapshot, insertBoardItem } from "./boardState";
import type { Database } from "./db";
import type { SharedBoardItem, SharedRoomSnapshot } from "./liveBoardTypes";

type HistoryBoardItem = Omit<SharedBoardItem, "revision">;

const MAX_HISTORY_ENTRIES = 40;
const roomHistory = new Map<string, HistoryBoardItem[][]>();

function cloneHistoryBoardItem(item: HistoryBoardItem | SharedBoardItem): HistoryBoardItem {
  return {
    nodeId: item.nodeId,
    itemId: item.itemId,
    position: {
      x: item.position.x,
      y: item.position.y,
    },
    isNewDiscovery: item.isNewDiscovery ?? false,
    arrivalHighlightMode: item.arrivalHighlightMode,
    categoryConstraintName: item.categoryConstraintName ?? null,
    categoryConstraintNormalizedName: item.categoryConstraintNormalizedName ?? null,
    actionConstraintName: item.actionConstraintName ?? null,
    actionConstraintNormalizedName: item.actionConstraintNormalizedName ?? null,
  };
}

function cloneHistorySnapshot(items: Array<HistoryBoardItem | SharedBoardItem>) {
  return items.map((item) => cloneHistoryBoardItem(item));
}

function historyItemsEqual(left: HistoryBoardItem[], right: HistoryBoardItem[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftItem, index) => {
    const rightItem = right[index];
    return (
      leftItem.nodeId === rightItem.nodeId &&
      leftItem.itemId === rightItem.itemId &&
      leftItem.position.x === rightItem.position.x &&
      leftItem.position.y === rightItem.position.y &&
      (leftItem.isNewDiscovery ?? false) === (rightItem.isNewDiscovery ?? false) &&
      (leftItem.arrivalHighlightMode ?? null) === (rightItem.arrivalHighlightMode ?? null) &&
      (leftItem.categoryConstraintName ?? null) ===
        (rightItem.categoryConstraintName ?? null) &&
      (leftItem.categoryConstraintNormalizedName ?? null) ===
        (rightItem.categoryConstraintNormalizedName ?? null) &&
      (leftItem.actionConstraintName ?? null) ===
        (rightItem.actionConstraintName ?? null) &&
      (leftItem.actionConstraintNormalizedName ?? null) ===
        (rightItem.actionConstraintNormalizedName ?? null)
    );
  });
}

function setRoomHistory(roomId: string, snapshots: HistoryBoardItem[][]) {
  if (snapshots.length === 0) {
    roomHistory.delete(roomId);
    return;
  }
  roomHistory.set(roomId, snapshots);
}

export function canUndoBoard(roomId: string = DEFAULT_ROOM_ID) {
  return (roomHistory.get(roomId)?.length ?? 0) > 0;
}

export function recordBoardHistorySnapshot(
  items: Array<HistoryBoardItem | SharedBoardItem>,
  roomId: string = DEFAULT_ROOM_ID
) {
  const nextSnapshot = cloneHistorySnapshot(items);
  const currentHistory = roomHistory.get(roomId) ?? [];
  const lastSnapshot = currentHistory[currentHistory.length - 1];
  if (lastSnapshot && historyItemsEqual(lastSnapshot, nextSnapshot)) {
    return false;
  }

  const nextHistory = [...currentHistory, nextSnapshot];
  setRoomHistory(
    roomId,
    nextHistory.length > MAX_HISTORY_ENTRIES
      ? nextHistory.slice(nextHistory.length - MAX_HISTORY_ENTRIES)
      : nextHistory
  );
  return true;
}

export function recordBoardHistory(db: Database, roomId: string = DEFAULT_ROOM_ID) {
  return recordBoardHistorySnapshot(getRoomSnapshot(db, roomId).boardItems, roomId);
}

export function buildRoomSnapshotWithUndo(
  db: Database,
  roomId: string = DEFAULT_ROOM_ID
): SharedRoomSnapshot {
  return {
    ...getRoomSnapshot(db, roomId),
    canUndo: canUndoBoard(roomId),
  };
}

export function undoBoardHistory(
  db: Database,
  roomId: string = DEFAULT_ROOM_ID
): SharedRoomSnapshot | null {
  const currentHistory = roomHistory.get(roomId) ?? [];
  const previousSnapshot = currentHistory[currentHistory.length - 1];
  if (!previousSnapshot) {
    return null;
  }

  setRoomHistory(roomId, currentHistory.slice(0, -1));
  clearBoardItems(db, roomId);
  for (const item of previousSnapshot) {
    insertBoardItem(db, {
      roomId,
      nodeId: item.nodeId,
      item: {
        itemId: item.itemId,
        position: item.position,
        isNewDiscovery: item.isNewDiscovery ?? false,
        arrivalHighlightMode: item.arrivalHighlightMode ?? undefined,
        categoryConstraintName: item.categoryConstraintName ?? null,
        categoryConstraintNormalizedName: item.categoryConstraintNormalizedName ?? null,
        actionConstraintName: item.actionConstraintName ?? null,
        actionConstraintNormalizedName: item.actionConstraintNormalizedName ?? null,
      },
    });
  }

  return buildRoomSnapshotWithUndo(db, roomId);
}
