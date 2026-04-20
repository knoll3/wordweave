import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { buildRoomSnapshotWithUndo, canUndoBoard, recordBoardHistory } from "./boardHistory";
import type {
  SharedBoardActivity,
  SharedBoardDragClaim,
  SharedBoardDragMove,
  SharedBoardDragResult,
  SharedBoardItem,
} from "./liveBoardTypes";
import { DEFAULT_ROOM_ID, getBoardItemById, updateBoardItemPosition } from "./boardState";
import { getDb, persistDatabase } from "./db";
import { emitBoardPatch, getLiveBoardRoomChannel, setLiveBoardIo } from "./liveBoardEvents";

const DRAG_LEASE_MS = 6_000;

type DragLease = {
  socketId: string;
  expiresAt: number;
  lastSequence: number;
};

const dragLeases = new Map<string, DragLease>();

function canUseLease(nodeId: string, socketId: string) {
  const lease = dragLeases.get(nodeId);
  if (!lease) {
    return false;
  }
  if (lease.expiresAt <= Date.now()) {
    dragLeases.delete(nodeId);
    return false;
  }
  return lease.socketId === socketId;
}

export function createLiveBoardSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  setLiveBoardIo(io);

  io.on("connection", (socket) => {
    const roomId = DEFAULT_ROOM_ID;
    socket.join(getLiveBoardRoomChannel(roomId));

    void (async () => {
      const db = await getDb();
      socket.emit("room:snapshot", buildRoomSnapshotWithUndo(db, roomId));
    })();

    socket.on("board:drag-claim", async (payload: SharedBoardDragClaim, callback?: (result: SharedBoardDragResult) => void) => {
      const nodeId = String(payload?.nodeId ?? "");
      if (!nodeId) {
        callback?.({ ok: false, nodeId });
        return;
      }

      const currentLease = dragLeases.get(nodeId);
      if (currentLease && currentLease.expiresAt > Date.now() && currentLease.socketId !== socket.id) {
        const db = await getDb();
        const item = getBoardItemById(db, nodeId);
        callback?.({
          ok: false,
          nodeId,
          position:
            item == null
              ? null
              : {
                  x: Number(item.position_x),
                  y: Number(item.position_y),
                },
        });
        return;
      }

      dragLeases.set(nodeId, {
        socketId: socket.id,
        expiresAt: Date.now() + DRAG_LEASE_MS,
        lastSequence: -1,
      });
      callback?.({ ok: true, nodeId });
    });

    socket.on("board:drag-move", async (payload: SharedBoardDragMove) => {
      const nodeId = String(payload?.nodeId ?? "");
      if (!nodeId || !canUseLease(nodeId, socket.id)) {
        return;
      }

      const lease = dragLeases.get(nodeId);
      if (!lease || payload.sequence <= lease.lastSequence) {
        return;
      }

      lease.lastSequence = payload.sequence;
      lease.expiresAt = Date.now() + DRAG_LEASE_MS;
      dragLeases.set(nodeId, lease);

      const db = await getDb();
      const item = getBoardItemById(db, nodeId);
      if (!item) {
        return;
      }
      emitBoardPatch({
        roomId,
        upserts: [
          {
            nodeId,
            itemId: Number(item.item_id),
            position: {
              x: payload.position.x,
              y: payload.position.y,
            },
            isNewDiscovery: Number(item.is_new_discovery ?? 0) === 1 || undefined,
            arrivalHighlightMode:
              item.arrival_highlight_mode == null
                ? undefined
                : (String(item.arrival_highlight_mode) as SharedBoardItem["arrivalHighlightMode"]),
            categoryConstraintName:
              item.category_constraint_name == null
                ? null
                : String(item.category_constraint_name),
            categoryConstraintNormalizedName:
              item.category_constraint_normalized_name == null
                ? null
                : String(item.category_constraint_normalized_name),
            actionConstraintName:
              item.action_constraint_name == null
                ? null
                : String(item.action_constraint_name),
            actionConstraintNormalizedName:
              item.action_constraint_normalized_name == null
                ? null
                : String(item.action_constraint_normalized_name),
            revision: Number(item.revision ?? 0),
          },
        ],
        canUndo: canUndoBoard(roomId),
        excludeSocketId: socket.id,
      });
    });

    socket.on("board:drag-end", async (payload: SharedBoardDragMove, callback?: (result: SharedBoardDragResult) => void) => {
      const nodeId = String(payload?.nodeId ?? "");
      if (!nodeId || !canUseLease(nodeId, socket.id)) {
        callback?.({ ok: false, nodeId });
        return;
      }

      dragLeases.delete(nodeId);
      const db = await getDb();
      recordBoardHistory(db, roomId);
      const updated = updateBoardItemPosition(db, {
        nodeId,
        x: payload.position.x,
        y: payload.position.y,
      });
      persistDatabase(db);

      if (!updated) {
        callback?.({ ok: false, nodeId });
        return;
      }

      emitBoardPatch({
        roomId,
        upserts: [updated],
        canUndo: canUndoBoard(roomId),
      });
      callback?.({
        ok: true,
        nodeId,
        position: updated.position,
      });
    });

    socket.on("board:selection", (payload: { nodeIds: string[]; layout?: unknown | null }) => {
      io.to(getLiveBoardRoomChannel(roomId))
        .except(socket.id)
        .emit("board:selection", {
          nodeIds: Array.isArray(payload?.nodeIds)
            ? payload.nodeIds.filter((nodeId) => typeof nodeId === "string" && nodeId.trim())
            : [],
          layout: payload?.layout ?? null,
        });
    });

    socket.on("board:activity", (payload: SharedBoardActivity) => {
      io.to(getLiveBoardRoomChannel(roomId))
        .except(socket.id)
        .emit("board:activity", {
          nodeIds: Array.isArray(payload?.nodeIds)
            ? payload.nodeIds.filter((nodeId) => typeof nodeId === "string" && nodeId.trim())
            : [],
          layout: payload?.layout ?? null,
          mode:
            payload?.mode === "combining" ||
            payload?.mode === "pondering" ||
            payload?.mode === "searching"
              ? payload.mode
              : null,
        } satisfies SharedBoardActivity);
    });

    socket.on(
      "board:group-move",
      async (payload: { items: Array<{ nodeId: string; position: { x: number; y: number } }> }) => {
        const moves = Array.isArray(payload?.items) ? payload.items : [];
        if (moves.length === 0) {
          return;
        }

        const db = await getDb();
        const updated = moves
          .map((item) => {
            const current = getBoardItemById(db, String(item.nodeId));
            if (!current) {
              return null;
            }
            const previewItem: SharedBoardItem = {
              nodeId: String(item.nodeId),
              itemId: Number(current.item_id),
              position: {
                x: Number(item.position.x),
                y: Number(item.position.y),
              },
              isNewDiscovery: Number(current.is_new_discovery ?? 0) === 1 ? true : undefined,
              arrivalHighlightMode:
                current.arrival_highlight_mode == null
                  ? undefined
                  : (String(current.arrival_highlight_mode) as SharedBoardItem["arrivalHighlightMode"]),
              categoryConstraintName:
                current.category_constraint_name == null
                  ? null
                  : String(current.category_constraint_name),
              categoryConstraintNormalizedName:
                current.category_constraint_normalized_name == null
                  ? null
                  : String(current.category_constraint_normalized_name),
              actionConstraintName:
                current.action_constraint_name == null
                  ? null
                  : String(current.action_constraint_name),
              actionConstraintNormalizedName:
                current.action_constraint_normalized_name == null
                  ? null
                  : String(current.action_constraint_normalized_name),
              revision: Number(current.revision ?? 0),
            };
            return previewItem;
          })
          .filter((item): item is SharedBoardItem => item != null);
        if (updated.length === 0) {
          return;
        }
        emitBoardPatch({
          roomId,
          upserts: updated,
          canUndo: canUndoBoard(roomId),
          excludeSocketId: socket.id,
        });
      }
    );

    socket.on("disconnect", () => {
      for (const [nodeId, lease] of dragLeases.entries()) {
        if (lease.socketId === socket.id) {
          dragLeases.delete(nodeId);
        }
      }
      io.to(getLiveBoardRoomChannel(roomId))
        .except(socket.id)
        .emit("board:selection", { nodeIds: [], layout: null });
      io.to(getLiveBoardRoomChannel(roomId))
        .except(socket.id)
        .emit("board:activity", { nodeIds: [], layout: null, mode: null } satisfies SharedBoardActivity);
    });
  });

  return io;
}
