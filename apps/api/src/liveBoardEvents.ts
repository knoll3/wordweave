import type { Server as SocketIOServer } from "socket.io";
import type { SharedBoardItem, SharedBoardPatch, SharedRoomSnapshot } from "./liveBoardTypes";
import type { PlayerQuestStats, QuestRecord, CompletedQuestSet } from "./questState";

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
  canUndo?: boolean;
  excludeSocketId?: string | null;
}) {
  const patch: SharedBoardPatch = {
    roomId: params.roomId,
    upserts: params.upserts ?? [],
    deletedNodeIds: params.deletedNodeIds ?? [],
    canUndo: params.canUndo,
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

export function emitQuestSync(params: {
  roomId: string;
  quests: QuestRecord[];
  stats: PlayerQuestStats;
}) {
  io?.to(getLiveBoardRoomChannel(params.roomId)).emit("quests:sync", {
    quests: params.quests,
    stats: params.stats,
  });
}

export function emitQuestCelebration(params: {
  roomId: string;
  newlyCompletedQuestNames: string[];
  completedQuestSets?: CompletedQuestSet[];
  totalPoints?: number;
  celebrationNodeId?: string | null;
}) {
  io?.to(getLiveBoardRoomChannel(params.roomId)).emit("quests:celebration", params);
}
