import type { Server as SocketIOServer } from "socket.io";
import type { SharedBoardItem, SharedBoardPatch, SharedRoomSnapshot } from "./liveBoardTypes";

let io: SocketIOServer | null = null;

export function setLiveBoardIo(nextIo: SocketIOServer) {
  io = nextIo;
}

export function getLiveBoardRoomChannel(roomId: string) {
  return `room:${roomId}`;
}

export function emitRoomSnapshot(snapshot: SharedRoomSnapshot) {
  io?.to(getLiveBoardRoomChannel(snapshot.roomId)).emit("room:snapshot", snapshot);
}

export function emitBoardPatch(params: {
  roomId: string;
  upserts?: SharedBoardItem[];
  deletedNodeIds?: string[];
  excludeSocketId?: string | null;
}) {
  const patch: SharedBoardPatch = {
    roomId: params.roomId,
    upserts: params.upserts ?? [],
    deletedNodeIds: params.deletedNodeIds ?? [],
  };

  if (!io) {
    return;
  }

  const channel = io.to(getLiveBoardRoomChannel(params.roomId));
  if (params.excludeSocketId) {
    channel.except(params.excludeSocketId).emit("board:patch", patch);
    return;
  }
  channel.emit("board:patch", patch);
}
