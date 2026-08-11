import { io, type Socket } from "socket.io-client";
import type {
  SharedBoardActivity,
  SharedBoardDragClaim,
  SharedBoardDragMove,
  SharedBoardDragResult,
  SharedBoardPatch,
  SharedPlayerViewportCenter,
  SharedRoomSnapshot,
} from "../liveBoardTypes";
import type { PlayerQuestStats, QuestRecord, QuestSetCompletion } from "../types";
import { getCurrentSessionId } from "./session";

let socket: Socket | null = null;
let socketSessionId: string | null = null;

function getSocketBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base || base.startsWith("/")) {
    return window.location.origin;
  }

  try {
    return new URL(base).origin;
  } catch {
    return window.location.origin;
  }
}

export function getLiveBoardSocket() {
  const sessionId = getCurrentSessionId();
  if (socket && socketSessionId !== sessionId) {
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    socketSessionId = sessionId;
    socket = io(getSocketBaseUrl(), {
      transports: ["websocket", "polling"],
      auth: {
        sessionId,
      },
    });
  }
  return socket;
}

export function subscribeToRoomSnapshot(
  listener: (snapshot: SharedRoomSnapshot) => void
) {
  const current = getLiveBoardSocket();
  current.on("room:snapshot", listener);
  return () => {
    current.off("room:snapshot", listener);
  };
}

export function subscribeToBoardPatch(
  listener: (patch: SharedBoardPatch) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:patch", listener);
  return () => {
    current.off("board:patch", listener);
  };
}

export function claimBoardDrag(payload: SharedBoardDragClaim) {
  return new Promise<SharedBoardDragResult>((resolve) => {
    getLiveBoardSocket().emit("board:drag-claim", payload, resolve);
  });
}

export function sendBoardDragMove(payload: SharedBoardDragMove) {
  getLiveBoardSocket().emit("board:drag-move", payload);
}

export function endBoardDrag(payload: SharedBoardDragMove) {
  return new Promise<SharedBoardDragResult>((resolve) => {
    getLiveBoardSocket().emit("board:drag-end", payload, resolve);
  });
}

export function sendBoardGroupMove(
  items: Array<{ nodeId: string; position: { x: number; y: number } }>
) {
  getLiveBoardSocket().emit("board:group-move", { items });
}

export function publishBoardSelection(nodeIds: string[]) {
  getLiveBoardSocket().emit("board:selection", { nodeIds });
}

export function subscribeToBoardSelection(
  listener: (payload: { nodeIds: string[]; layout?: unknown | null }) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:selection", listener);
  return () => {
    current.off("board:selection", listener);
  };
}

export function publishBoardSelectionState(payload: {
  nodeIds: string[];
  layout?: unknown | null;
}) {
  getLiveBoardSocket().emit("board:selection", payload);
}

export function subscribeToBoardActivity(
  listener: (payload: SharedBoardActivity) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:activity", listener);
  return () => {
    current.off("board:activity", listener);
  };
}

export function publishBoardActivityState(payload: SharedBoardActivity) {
  getLiveBoardSocket().emit("board:activity", payload);
}

export function subscribeToViewportCentersSync(
  listener: (payload: { players: SharedPlayerViewportCenter[] }) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:viewport-centers", listener);
  return () => {
    current.off("board:viewport-centers", listener);
  };
}

export function subscribeToViewportCenter(
  listener: (payload: SharedPlayerViewportCenter) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:viewport-center", listener);
  return () => {
    current.off("board:viewport-center", listener);
  };
}

export function subscribeToViewportCenterRemoved(
  listener: (payload: { playerId: string }) => void
) {
  const current = getLiveBoardSocket();
  current.on("board:viewport-center-remove", listener);
  return () => {
    current.off("board:viewport-center-remove", listener);
  };
}

export function publishViewportCenter(center: { x: number; y: number }) {
  getLiveBoardSocket().emit("board:viewport-center", { center });
}

export function subscribeToQuestSync(
  listener: (payload: { quests: QuestRecord[]; stats: PlayerQuestStats }) => void
) {
  const current = getLiveBoardSocket();
  current.on("quests:sync", listener);
  return () => {
    current.off("quests:sync", listener);
  };
}

export function subscribeToQuestCelebration(
  listener: (payload: {
    newlyCompletedQuestNames: string[];
    completedQuestSets?: QuestSetCompletion[];
    totalPoints?: number;
    celebrationNodeId?: string | null;
  }) => void
) {
  const current = getLiveBoardSocket();
  current.on("quests:celebration", listener);
  return () => {
    current.off("quests:celebration", listener);
  };
}
