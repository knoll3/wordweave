import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { fetchBoardSnapshot } from "../lib/api";
import {
  subscribeToBoardActivity,
  subscribeToBoardPatch,
  subscribeToBoardSelection,
  subscribeToQuestCelebration,
  subscribeToQuestSync,
  subscribeToRoomSnapshot,
  subscribeToViewportCenter,
  subscribeToViewportCenterRemoved,
  subscribeToViewportCentersSync,
} from "../lib/liveBoardSocket";
import type {
  SharedBoardActivityMode,
  SharedBoardPatch,
  SharedPlayerViewportCenter,
  SharedRoomSnapshot,
} from "../liveBoardTypes";
import type {
  PlayerQuestStats,
  QuestSetCompletion,
  SelectionCombineLayout,
  WorkspaceItem,
} from "../types";

export function useLiveBoardSubscriptions({
  applyWorkspaceSnapshot,
  stripWorkspaceArrivalHighlights,
  applyWorkspacePatch,
  hasHydratedSharedSnapshotRef,
  setCanUndoWorkspace,
  setWorkspaceItems,
  refreshSharedItemsIfNeeded,
  setRemoteSelectedNodeIds,
  setRemoteSelectionLayout,
  setRemoteActivityNodeIds,
  setRemoteActivityLayout,
  setRemoteActivityMode,
  setQuests,
  applyQuestStats,
  setRemoteViewportCenters,
  applyNewlyCompletedQuests,
  showQuestSetCelebration,
  questStatsTotalPoints,
  enabled = true,
}: {
  applyWorkspaceSnapshot: (snapshot: SharedRoomSnapshot) => WorkspaceItem[];
  stripWorkspaceArrivalHighlights: (entries: WorkspaceItem[]) => WorkspaceItem[];
  applyWorkspacePatch: (
    current: WorkspaceItem[],
    patch: SharedBoardPatch
  ) => WorkspaceItem[];
  hasHydratedSharedSnapshotRef: MutableRefObject<boolean>;
  setCanUndoWorkspace: (value: boolean) => void;
  setWorkspaceItems: Dispatch<SetStateAction<WorkspaceItem[]>>;
  refreshSharedItemsIfNeeded: (workspaceEntries: WorkspaceItem[]) => Promise<void>;
  setRemoteSelectedNodeIds: (nodeIds: string[]) => void;
  setRemoteSelectionLayout: (layout: SelectionCombineLayout | null) => void;
  setRemoteActivityNodeIds: (nodeIds: string[]) => void;
  setRemoteActivityLayout: (layout: SelectionCombineLayout | null) => void;
  setRemoteActivityMode: (mode: SharedBoardActivityMode | null) => void;
  setQuests: Dispatch<
    SetStateAction<
      Parameters<Parameters<typeof subscribeToQuestSync>[0]>[0]["quests"]
    >
  >;
  applyQuestStats: (stats: PlayerQuestStats) => void;
  setRemoteViewportCenters: Dispatch<SetStateAction<SharedPlayerViewportCenter[]>>;
  applyNewlyCompletedQuests: (
    newlyCompletedQuestNames: string[],
    celebrationNodeId: string | null
  ) => void;
  showQuestSetCelebration: (completedSet: QuestSetCompletion, totalPoints: number) => void;
  questStatsTotalPoints: number;
  enabled?: boolean;
}) {
  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const snapshot = await fetchBoardSnapshot();
        if (!cancelled) {
          const nextWorkspace = hasHydratedSharedSnapshotRef.current
            ? applyWorkspaceSnapshot(snapshot)
            : stripWorkspaceArrivalHighlights(applyWorkspaceSnapshot(snapshot));
          hasHydratedSharedSnapshotRef.current = true;
          setCanUndoWorkspace(Boolean(snapshot.canUndo));
          setWorkspaceItems(nextWorkspace);
          void refreshSharedItemsIfNeeded(nextWorkspace);
        }
      } catch {
      }
    })();

    const unsubscribeSnapshot = subscribeToRoomSnapshot((snapshot) => {
      if (cancelled) {
        return;
      }
      const nextWorkspace = hasHydratedSharedSnapshotRef.current
        ? applyWorkspaceSnapshot(snapshot)
        : stripWorkspaceArrivalHighlights(applyWorkspaceSnapshot(snapshot));
      hasHydratedSharedSnapshotRef.current = true;
      setCanUndoWorkspace(Boolean(snapshot.canUndo));
      setWorkspaceItems(nextWorkspace);
      void refreshSharedItemsIfNeeded(nextWorkspace);
    });
    const unsubscribePatch = subscribeToBoardPatch((patch) => {
      if (cancelled) {
        return;
      }
      setWorkspaceItems((prev) => {
        const nextWorkspace = applyWorkspacePatch(prev, patch);
        if (patch.canUndo != null) {
          setCanUndoWorkspace(Boolean(patch.canUndo));
        }
        void refreshSharedItemsIfNeeded(nextWorkspace);
        return nextWorkspace;
      });
    });
    const unsubscribeSelection = subscribeToBoardSelection((payload) => {
      if (cancelled) {
        return;
      }
      setRemoteSelectedNodeIds(payload.nodeIds);
      setRemoteSelectionLayout((payload.layout as SelectionCombineLayout | null) ?? null);
    });
    const unsubscribeActivity = subscribeToBoardActivity((payload) => {
      if (cancelled) {
        return;
      }
      setRemoteActivityNodeIds(payload.nodeIds);
      setRemoteActivityLayout((payload.layout as SelectionCombineLayout | null) ?? null);
      setRemoteActivityMode(payload.mode ?? null);
    });
    const unsubscribeQuestSync = subscribeToQuestSync((payload) => {
      if (cancelled) {
        return;
      }
      setQuests(payload.quests);
      applyQuestStats(payload.stats);
    });
    const unsubscribeViewportCentersSync = subscribeToViewportCentersSync((payload) => {
      if (cancelled) {
        return;
      }
      setRemoteViewportCenters(payload.players);
    });
    const unsubscribeViewportCenter = subscribeToViewportCenter((payload) => {
      if (cancelled) {
        return;
      }
      setRemoteViewportCenters((current) => {
        const next = current.filter((entry) => entry.playerId !== payload.playerId);
        next.push(payload);
        return next;
      });
    });
    const unsubscribeViewportCenterRemoved = subscribeToViewportCenterRemoved((payload) => {
      if (cancelled) {
        return;
      }
      setRemoteViewportCenters((current) =>
        current.filter((entry) => entry.playerId !== payload.playerId)
      );
    });
    const unsubscribeQuestCelebration = subscribeToQuestCelebration((payload) => {
      if (cancelled) {
        return;
      }
      if (payload.totalPoints != null) {
        applyQuestStats({
          totalPoints: payload.totalPoints,
        });
      }
      if (payload.newlyCompletedQuestNames.length > 0) {
        applyNewlyCompletedQuests(
          payload.newlyCompletedQuestNames,
          payload.celebrationNodeId ?? null
        );
      }
      if (payload.completedQuestSets && payload.completedQuestSets.length > 0) {
        const latestCompletedSet =
          payload.completedQuestSets[payload.completedQuestSets.length - 1];
        showQuestSetCelebration(latestCompletedSet, payload.totalPoints ?? questStatsTotalPoints);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeSnapshot();
      unsubscribePatch();
      unsubscribeSelection();
      unsubscribeActivity();
      unsubscribeQuestSync();
      unsubscribeViewportCentersSync();
      unsubscribeViewportCenter();
      unsubscribeViewportCenterRemoved();
      unsubscribeQuestCelebration();
    };
  }, [
    applyNewlyCompletedQuests,
    applyQuestStats,
    applyWorkspacePatch,
    applyWorkspaceSnapshot,
    hasHydratedSharedSnapshotRef,
    questStatsTotalPoints,
    refreshSharedItemsIfNeeded,
    setCanUndoWorkspace,
    setQuests,
    setRemoteActivityLayout,
    setRemoteActivityMode,
    setRemoteActivityNodeIds,
    setRemoteSelectedNodeIds,
    setRemoteSelectionLayout,
    setRemoteViewportCenters,
    setWorkspaceItems,
    showQuestSetCelebration,
    stripWorkspaceArrivalHighlights,
    enabled,
  ]);
}
