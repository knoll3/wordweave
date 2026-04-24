import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  SharedBoardActivityMode,
  SharedBoardPatch,
  SharedPlayerViewportCenter,
  SharedRoomSnapshot,
} from "./liveBoardTypes";
import {
  ScrollText,
  Tags,
  Undo2,
  Zap,
} from "lucide-react";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM_ID,
} from "./types";
import type {
  AutoUnlockedActionWord,
  AiModel,
  FeatureUnlockStatus,
  Item,
  PlayerQuestStats,
  QuestGenerationDraft,
  QuestRecord,
  QuestSetCompletion,
  SelectionCombineLayout,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import type { CatalystAction } from "./components/Graph/CatalystDock";
import JournalDock from "./components/Journal/JournalDock";
import QuestGenerationModal from "./components/Journal/QuestGenerationModal";
import { useMobileKeyboardWorkarounds } from "./hooks/useMobileKeyboardWorkarounds";
import { useQuestReferences } from "./hooks/useQuestReferences";
import { useResponsiveLayout } from "./hooks/useResponsiveLayout";
import {
  attachBoardActionModifier,
  attachBoardCategoryModifier,
  clearBoardItems as clearSharedBoardItems,
  combineBoardItems,
  acceptGeneratedQuestSet,
  combineElements,
  createBoardItem,
  deleteBoardItems,
    duplicateBoardItem,
    fetchBoardSnapshot,
    fetchItems,
    fetchQuests,
  fetchUnlockStatuses,
  generateQuestDraft,
  importLegacyQuestState,
  moveBoardItems,
  undoBoard,
  updateBoardItem,
  updateQuestStatus,
} from "./lib/api";
import {
  claimBoardDrag,
  endBoardDrag,
  publishBoardActivityState,
  publishBoardSelectionState,
  publishViewportCenter,
  sendBoardGroupMove,
  sendBoardDragMove,
  subscribeToBoardActivity,
  subscribeToBoardPatch,
  subscribeToBoardSelection,
  subscribeToQuestCelebration,
  subscribeToQuestSync,
  subscribeToRoomSnapshot,
  subscribeToViewportCenter,
  subscribeToViewportCenterRemoved,
  subscribeToViewportCentersSync,
} from "./lib/liveBoardSocket";
import {
  ACTION_PROMPT_FAMILY_REFERENCES,
  normalizeActionTrigger,
  resolveActionPromptFamilyKey,
} from "./lib/actionPromptFamilies";
import {
  clearLegacyQuestStorage,
  LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY,
  LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY,
  loadLegacyStoredQuests,
  loadStoredNameSet,
} from "./lib/legacyQuestStorage";
import {
  ACTION_CATALYSTS,
  ACTION_CATALYST_BY_ID,
  NON_INGREDIENT_ITEM_IDS,
  SPECIAL_ITEM_BY_ID,
  SPECIAL_ITEMS,
} from "./lib/specialItems";

const AI_MODELS: AiModel[] = [
  "gpt-5.4",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const TOAST_DURATION_MS = 3500;
const QUEST_CELEBRATION_DURATION_MS = 2600;
const QUEST_REFERENCE_PREVIEW_LIMIT = 180;
const PORTRAIT_TABLET_LAYOUT_QUERY = "(orientation: portrait)";
const MOBILE_LAYOUT_QUERY = "(max-width: 600px)";
const VIEWPORT_CENTER_PUBLISH_INTERVAL_MS = 120;
const VIEWPORT_CENTER_MIN_DELTA = 12;

type QuestCelebrationState = {
  kicker: string;
  title: string;
  copy: string;
};

type QuestSetCelebrationState = QuestSetCompletion & {
  totalPoints: number;
};

type ActionUnlockModalState = {
  unlockedWords: AutoUnlockedActionWord[];
};

type DragAbortSignal = {
  nodeId: string;
  nonce: number;
};

function truncateReferencePreview(value: string, limit: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase();
}

function applyWorkspaceSnapshot(snapshot: SharedRoomSnapshot) {
  return snapshot.boardItems as WorkspaceItem[];
}

function stripWorkspaceArrivalHighlights(entries: WorkspaceItem[]) {
  return entries.map((item) => ({
    ...item,
    arrivalHighlightMode: undefined,
  }));
}

function applyWorkspacePatch(
  current: WorkspaceItem[],
  patch: SharedBoardPatch
): WorkspaceItem[] {
  const deletedIds = new Set(patch.deletedNodeIds);
  const byId = new Map(
    current
      .filter((item) => !deletedIds.has(item.nodeId))
      .map((item) => [item.nodeId, item])
  );

  for (const item of patch.upserts) {
    byId.set(item.nodeId, item as WorkspaceItem);
  }

  return [...byId.values()];
}

function upsertWorkspaceItems(
  current: WorkspaceItem[],
  upserts: WorkspaceItem[]
): WorkspaceItem[] {
  const byId = new Map(current.map((item) => [item.nodeId, item]));
  for (const item of upserts) {
    byId.set(item.nodeId, item);
  }
  return [...byId.values()];
}

function collectMissingWorkspaceItemIds(
  workspaceEntries: WorkspaceItem[],
  knownItems: Item[]
) {
  const knownIds = new Set(knownItems.map((item) => item.id));
  return workspaceEntries
    .map((item) => item.itemId)
    .filter((itemId) => itemId > 0 && !knownIds.has(itemId));
}

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [hasLoadedInitialLibrary, setHasLoadedInitialLibrary] = useState(false);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [canUndoWorkspace, setCanUndoWorkspace] = useState(false);
  const [isUndoingWorkspace, setIsUndoingWorkspace] = useState(false);
  const [combiningNodeIds, setCombiningNodeIds] = useState<string[]>([]);
  const [webSearchingNodeIds, setWebSearchingNodeIds] = useState<string[]>([]);
  const [remoteSelectedNodeIds, setRemoteSelectedNodeIds] = useState<string[]>([]);
  const [remoteSelectionLayout, setRemoteSelectionLayout] = useState<SelectionCombineLayout | null>(
    null
  );
  const [remoteActivityNodeIds, setRemoteActivityNodeIds] = useState<string[]>([]);
  const [remoteActivityLayout, setRemoteActivityLayout] = useState<SelectionCombineLayout | null>(
    null
  );
  const [remoteActivityMode, setRemoteActivityMode] = useState<SharedBoardActivityMode | null>(
    null
  );
  const [remoteViewportCenters, setRemoteViewportCenters] = useState<SharedPlayerViewportCenter[]>(
    []
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<AiModel>("gpt-5-mini");
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [forceUnlocks, setForceUnlocks] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [questStats, setQuestStats] = useState<PlayerQuestStats>({ totalPoints: 0 });
  const [questPointsHighlightKey, setQuestPointsHighlightKey] = useState(0);
  const [isQuestModalOpen, setIsQuestModalOpen] = useState(false);
  const [questTopicInput, setQuestTopicInput] = useState("");
  const [questDraft, setQuestDraft] = useState<QuestGenerationDraft | null>(null);
  const [questDraftSeenTargets, setQuestDraftSeenTargets] = useState<string[]>([]);
  const [selectedQuestDraftTargets, setSelectedQuestDraftTargets] = useState<string[]>([]);
  const [isGeneratingQuests, setIsGeneratingQuests] = useState(false);
  const [questCelebration, setQuestCelebration] = useState<QuestCelebrationState | null>(
    null
  );
  const [questSetCelebration, setQuestSetCelebration] =
    useState<QuestSetCelebrationState | null>(null);
  const [isQuestCelebrating, setIsQuestCelebrating] = useState(false);
  const [celebratedQuestNodeId, setCelebratedQuestNodeId] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<"journal" | "item" | "quest">(
    "journal"
  );
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [selectedQuestName, setSelectedQuestName] = useState<string | null>(null);
  const [pendingAbandonedQuestName, setPendingAbandonedQuestName] = useState<string | null>(null);
  const [pendingQuestAction, setPendingQuestAction] = useState<{
    name: string;
    kind: "track" | "untrack" | "abandon";
  } | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<number[]>([]);
  const [actionUnlockModal, setActionUnlockModal] = useState<ActionUnlockModalState | null>(
    null
  );
  const [librarySearchQuery, setLibrarySearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { isPortraitTabletLayout, isMobileLayout } = useResponsiveLayout({
    portraitTabletLayoutQuery: PORTRAIT_TABLET_LAYOUT_QUERY,
    mobileLayoutQuery: MOBILE_LAYOUT_QUERY,
  });
  const celebrationTimeoutRef = useRef<number | null>(null);
  const journalDockRef = useRef<HTMLElement | null>(null);
  const hasHydratedSharedSnapshotRef = useRef(false);
  const itemsRef = useRef<Item[]>([]);
  const viewportCenterRef = useRef<{
    x: number;
    y: number;
  } | null>(null);
  const lastPublishedViewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastPublishedViewportAtRef = useRef(0);
  const viewportCenterPublishTimeoutRef = useRef<number | null>(null);
  const activeDragNodeIdRef = useRef<string | null>(null);
  const dragSequenceRef = useRef(0);
  const lastDragSentAtRef = useRef(0);
  const dragAbortNonceRef = useRef(0);
  const [dragAbortSignal, setDragAbortSignal] = useState<DragAbortSignal | null>(null);
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const isRestoringWorkspace = false;
  const {
    androidViewportHeight,
    androidKeyboardHeight,
    clearMobileSearchFocus,
  } = useMobileKeyboardWorkarounds({
    isMobileLayout,
    isSearchFocused,
    setIsSearchFocused,
    isAndroidDevice,
  });
  itemsRef.current = items;

  async function undoWorkspaceBoardAction() {
    if (combiningNodeIds.length > 0 || isUndoingWorkspace) {
      return;
    }
    setIsUndoingWorkspace(true);
    try {
      const snapshot = await undoBoard();
      setCanUndoWorkspace(Boolean(snapshot.canUndo));
      setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
      void refreshSharedItemsIfNeeded(applyWorkspaceSnapshot(snapshot));
    } catch (err) {
      if (err instanceof Error && err.message === "Nothing to undo") {
        setCanUndoWorkspace(false);
      } else {
        showError(
          err instanceof Error ? err.message : "Failed to undo the last board action.",
          err
        );
      }
    } finally {
      setIsUndoingWorkspace(false);
    }
  }

  function publishSharedViewportCenter(center: { x: number; y: number }) {
    const now = Date.now();
    const lastCenter = lastPublishedViewportCenterRef.current;
    const distanceFromLast =
      lastCenter == null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(center.x - lastCenter.x, center.y - lastCenter.y);

    const flushPublish = (nextCenter: { x: number; y: number }) => {
      lastPublishedViewportCenterRef.current = nextCenter;
      lastPublishedViewportAtRef.current = Date.now();
      publishViewportCenter(nextCenter);
    };

    if (
      lastCenter == null ||
      distanceFromLast >= VIEWPORT_CENTER_MIN_DELTA ||
      now - lastPublishedViewportAtRef.current >= VIEWPORT_CENTER_PUBLISH_INTERVAL_MS
    ) {
      if (viewportCenterPublishTimeoutRef.current != null) {
        window.clearTimeout(viewportCenterPublishTimeoutRef.current);
        viewportCenterPublishTimeoutRef.current = null;
      }
      flushPublish(center);
      return;
    }

    if (viewportCenterPublishTimeoutRef.current != null) {
      window.clearTimeout(viewportCenterPublishTimeoutRef.current);
    }
    viewportCenterPublishTimeoutRef.current = window.setTimeout(() => {
      viewportCenterPublishTimeoutRef.current = null;
      flushPublish(center);
    }, VIEWPORT_CENTER_PUBLISH_INTERVAL_MS);
  }

  useEffect(() => {
    const storedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (storedModel && AI_MODELS.includes(storedModel as AiModel)) {
      setSelectedModel(storedModel as AiModel);
    }
    setForceUnlocks(window.localStorage.getItem(FORCE_UNLOCKS_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (!isPortraitTabletLayout || !isJournalOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const dock = journalDockRef.current;
      if (!(target instanceof Node) || !dock) {
        return;
      }
      if (dock.contains(target)) {
        return;
      }
      setIsJournalOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isJournalOpen, isPortraitTabletLayout]);

  useEffect(() => {
    window.localStorage.setItem(
      FORCE_UNLOCKS_STORAGE_KEY,
      forceUnlocks ? "true" : "false"
    );
  }, [forceUnlocks]);

  useEffect(() => {
    if (!errorMessage) return;
    const timeoutId = window.setTimeout(() => {
      setErrorMessage(null);
    }, TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [errorMessage]);

  useEffect(() => {
    void loadFeatureUnlocks();
  }, []);

  useEffect(() => {
    let cancelled = false;

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
        showQuestSetCelebration(latestCompletedSet, payload.totalPoints ?? questStats.totalPoints);
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
  }, []);

  useEffect(
    () => () => {
      if (viewportCenterPublishTimeoutRef.current != null) {
        window.clearTimeout(viewportCenterPublishTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let nextQuestData = await fetchQuests();
        if (!cancelled && nextQuestData.quests.length === 0) {
          const legacyQuests = loadLegacyStoredQuests();
          if (legacyQuests.length > 0) {
            nextQuestData = await importLegacyQuestState({
              quests: legacyQuests.map((quest) => ({
                name: quest.name,
                icon: quest.icon,
              })),
              trackedNames: [...loadStoredNameSet(LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY)],
              abandonedNames: [...loadStoredNameSet(LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY)],
            });
            clearLegacyQuestStorage();
          }
        }
        if (!cancelled) {
          setQuests(nextQuestData.quests);
          applyQuestStats(nextQuestData.stats);
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleQuests = useMemo(
    () => quests.filter((quest) => quest.status !== "abandoned"),
    [quests]
  );
  const questReferences = useQuestReferences(visibleQuests, isJournalOpen);
  const trackedQuestNames = useMemo(
    () =>
      new Set(
        visibleQuests
          .filter((quest) => quest.status === "tracked")
          .map((quest) => quest.name)
      ),
    [visibleQuests]
  );
  const completedQuestNames = useMemo(
    () =>
      new Set(
        visibleQuests
          .filter((quest) => quest.status === "completed")
          .map((quest) => quest.name)
      ),
    [visibleQuests]
  );

  function showError(message: string, err: unknown) {
    void err;
    setErrorMessage(message);
  }

  function applyQuestStats(nextStats: PlayerQuestStats) {
    setQuestStats((prev) => {
      const nextTotalPoints = Math.max(prev.totalPoints, nextStats.totalPoints);
      if (nextTotalPoints > prev.totalPoints) {
        setQuestPointsHighlightKey((current) => current + 1);
      }
      if (nextTotalPoints === prev.totalPoints) {
        return prev;
      }
      return { totalPoints: nextTotalPoints };
    });
  }

  async function loadFeatureUnlocks() {
    try {
      const statuses = await fetchUnlockStatuses();
      setFeatureUnlocks(statuses);
    } catch {
    }
  }

  async function refreshSharedItemsIfNeeded(workspaceEntries: WorkspaceItem[]) {
    if (collectMissingWorkspaceItemIds(workspaceEntries, itemsRef.current).length === 0) {
      return;
    }
    try {
      const nextItems = await fetchItems();
      setItems(nextItems);
      setHasLoadedInitialLibrary(true);
    } catch {
    }
  }

  function isFeatureUnlocked(key: UnlockKey) {
    if (forceUnlocks) return true;
    return featureUnlocks.some((unlock) => unlock.key === key && unlock.unlocked);
  }

  function openQuestGenerationModal() {
    setIsQuestModalOpen(true);
    setRightPanelMode("journal");
    setIsJournalOpen(true);
  }

  function updateQuestTopicInput(value: string) {
    setQuestTopicInput(value);
    setQuestDraft(null);
    setQuestDraftSeenTargets([]);
    setSelectedQuestDraftTargets([]);
  }

  function closeQuestGenerationModal() {
    if (isGeneratingQuests) {
      return;
    }
    setIsQuestModalOpen(false);
    setQuestTopicInput("");
    setQuestDraft(null);
    setQuestDraftSeenTargets([]);
    setSelectedQuestDraftTargets([]);
  }

  async function submitQuestGenerationTopic() {
    const topic = questTopicInput.trim();
    if (!topic) {
      return;
    }
    setIsGeneratingQuests(true);
    try {
      const nextDraft = await generateQuestDraft({
        topic,
        excludeTargets: questDraftSeenTargets,
      });
      setQuestDraft(nextDraft);
      setQuestDraftSeenTargets((prev) => {
        const seen = new Set(prev);
        nextDraft.targets.forEach((target) => seen.add(target.name));
        return [...seen];
      });
      setSelectedQuestDraftTargets(
        nextDraft.targets
          .slice(0, nextDraft.recommendedCount)
          .map((target) => target.name)
      );
    } catch (err) {
      showError("Failed to generate quest set.", err);
    } finally {
      setIsGeneratingQuests(false);
    }
  }

  function toggleQuestDraftTarget(targetName: string) {
    if (!questDraft || isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets((current) =>
      current.includes(targetName)
        ? current.filter((name) => name !== targetName)
        : [...current, targetName]
    );
  }

  function clearQuestDraftSelection() {
    if (isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets([]);
  }

  function selectAllQuestDraftTargets() {
    if (!questDraft || isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets(questDraft.targets.map((target) => target.name));
  }

  async function acceptQuestGenerationDraft() {
    if (!questDraft) {
      return;
    }
    const selectedTargets = questDraft.targets.filter((target) =>
      selectedQuestDraftTargets.includes(target.name)
    );
    if (selectedTargets.length === 0) {
      return;
    }
    setIsGeneratingQuests(true);
    try {
      const nextQuests = await acceptGeneratedQuestSet({
        topic: questDraft.topic,
        targets: selectedTargets,
      });
      setQuests(nextQuests.quests);
      applyQuestStats(nextQuests.stats);
      setIsQuestModalOpen(false);
      setQuestTopicInput("");
      setQuestDraft(null);
      setQuestDraftSeenTargets([]);
      setSelectedQuestDraftTargets([]);
      setRightPanelMode("journal");
      setIsJournalOpen(true);
    } catch (err) {
      showError("Failed to accept quest set.", err);
    } finally {
      setIsGeneratingQuests(false);
    }
  }

  function openJournal() {
    setSelectedQuestName(null);
    setRightPanelMode("journal");
    setIsJournalOpen(true);
  }

  function openQuestDetails(quest: QuestRecord) {
    setSelectedQuestName(quest.name);
    setRightPanelMode("quest");
    setIsJournalOpen(true);
  }

  async function trackQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }

    setPendingQuestAction({ name: questName, kind: "track" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "tracked" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
    } catch (err) {
      showError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "track" ? null : current
      );
    }
  }

  async function untrackQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }

    setPendingQuestAction({ name: questName, kind: "untrack" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "available" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
    } catch (err) {
      showError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "untrack" ? null : current
      );
    }
  }

  async function abandonQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }

    setPendingQuestAction({ name: questName, kind: "abandon" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "abandoned" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
      if (selectedQuestName === questName) {
        setSelectedQuestName(null);
        setRightPanelMode("journal");
      }
      setPendingAbandonedQuestName(null);
    } catch (err) {
      showError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "abandon" ? null : current
      );
    }
  }

  function showProgressCelebration(
    kicker: string,
    title: string,
    copy: string,
    nodeId: string | null
  ) {
    if (celebrationTimeoutRef.current != null) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    setQuestCelebration({ kicker, title, copy });
    setIsQuestCelebrating(true);
    setCelebratedQuestNodeId(nodeId);
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setIsQuestCelebrating(false);
      setQuestCelebration(null);
      setCelebratedQuestNodeId(null);
      celebrationTimeoutRef.current = null;
    }, QUEST_CELEBRATION_DURATION_MS);
  }

  function applyNewlyCompletedQuests(
    newlyCompletedQuestNames: string[],
    celebrationNodeId: string | null
  ) {
    if (newlyCompletedQuestNames.length === 0) {
      return;
    }

    const completedNameSet = new Set(newlyCompletedQuestNames);
    const newlyCompletedTrackedCount = quests.filter(
      (quest) => completedNameSet.has(quest.name) && quest.status === "tracked"
    ).length;

    setQuests((prev) =>
      prev.map((quest) =>
        completedNameSet.has(quest.name)
          ? {
              ...quest,
              status: "completed",
            }
          : quest
      )
    );

    showProgressCelebration(
      "Quest Complete",
      newlyCompletedQuestNames.length === 1
        ? newlyCompletedQuestNames[0]
        : `${newlyCompletedQuestNames.length} quests completed`,
      newlyCompletedQuestNames.length === 1
        ? newlyCompletedTrackedCount === 1
          ? "You discovered one of your active quests."
          : "You discovered one of your available quests."
        : newlyCompletedTrackedCount === newlyCompletedQuestNames.length
          ? "You completed multiple active quests."
          : newlyCompletedTrackedCount === 0
            ? "You completed multiple available quests."
            : "You completed multiple quests.",
      celebrationNodeId
    );
  }

  function showQuestSetCelebration(completedSet: QuestSetCompletion, totalPoints: number) {
    setQuestSetCelebration({
      ...completedSet,
      totalPoints,
    });
  }

  useEffect(
    () => () => {
      if (celebrationTimeoutRef.current != null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
    },
    []
  );
  const itemById = useMemo(() => {
    const next = new Map(items.map((item) => [item.id, item]));
    for (const item of SPECIAL_ITEMS) {
      next.set(item.id, item);
    }
    return next;
  }, [items]);
  const itemByNormalizedName = useMemo(
    () =>
      new Map(
        items.map((item) => [
          normalizeItemName(item.normalizedName || item.name),
          item,
        ] as const)
      ),
    [items]
  );
  const drawerItem = drawerItemId == null ? null : itemById.get(drawerItemId) ?? null;
  const selectedQuest =
    selectedQuestName == null
      ? null
      : visibleQuests.find((entry) => entry.name === selectedQuestName) ?? null;
  const activeTrackedQuests = visibleQuests.filter(
    (quest) => trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const visibleTrackedQuests = activeTrackedQuests.slice(0, 5);
  const selectedQuestItem =
    selectedQuest == null
      ? null
      : selectedQuest.matchedItemName == null
        ? null
        : itemByNormalizedName.get(normalizeItemName(selectedQuest.matchedItemName)) ?? null;
  const unlockedCatalystFamilyKeys = useMemo(() => {
    const discoveredTriggerNames = new Set(
      items.map((item) => normalizeActionTrigger(item.normalizedName || item.name))
    );
    return new Set(
      ACTION_PROMPT_FAMILY_REFERENCES.filter((family) =>
        family.triggerWords.some((word) =>
          discoveredTriggerNames.has(normalizeActionTrigger(word))
        )
      ).map((family) => family.key)
    );
  }, [items]);
  const catalystActions = useMemo(() => {
    const actions: CatalystAction[] = [];

    actions.push({
      key: "category",
      title: "Category",
      badgeLabel: "mod",
      icon: <Tags size={16} strokeWidth={2} />,
      tint: "rgba(20, 184, 166, 0.22)",
      iconTint: "#99f6e4",
      onClick: () => addItemToWorkspace(CATEGORY_MODIFIER_ITEM_ID),
    });

    actions.push({
      key: "action",
      title: "Action",
      badgeLabel: "mod",
      icon: <Zap size={16} strokeWidth={2} />,
      tint: "rgba(251, 191, 36, 0.22)",
      iconTint: "#fde68a",
      onClick: () => addItemToWorkspace(ACTION_MODIFIER_ITEM_ID),
    });

    for (const catalyst of ACTION_CATALYSTS) {
      if (!unlockedCatalystFamilyKeys.has(catalyst.familyKey)) {
        continue;
      }
      actions.push({
        key: catalyst.familyKey,
        title: catalyst.actionConstraint,
        icon: catalyst.item.icon ?? catalyst.actionConstraint.charAt(0),
        tint: catalyst.tint,
        iconTint: catalyst.iconTint,
        onClick: () => addItemToWorkspace(catalyst.item.id),
      });
    }

    return actions;
  }, [items, unlockedCatalystFamilyKeys]);

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    return SPECIAL_ITEM_BY_ID.get(itemId) ?? items.find((item) => item.id === itemId);
  }

  function addItemToWorkspace(
    itemId: number,
    position?: { x: number; y: number },
    options?: { isNewDiscovery?: boolean; arrivalHighlightMode?: "library" | "combine" }
  ) {
    const item = findItemById(itemId);
    if (!item) return;
    const anchorPosition =
      position ??
      viewportCenterRef.current ??
      ({
        x: 260,
        y: 180,
      } as const);
    const nextPosition = position
      ? anchorPosition
      : {
          x: anchorPosition.x + (Math.random() - 0.5) * 160,
          y: anchorPosition.y + (Math.random() - 0.5) * 120,
        };
    const nodeId = makeWorkspaceNodeId();
    const optimisticItem: WorkspaceItem = {
      nodeId,
      itemId,
      position: { x: nextPosition.x, y: nextPosition.y },
      isNewDiscovery: options?.isNewDiscovery ?? false,
      arrivalHighlightMode: options?.arrivalHighlightMode,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));
    void createBoardItem({
      nodeId,
      itemId,
      position: { x: nextPosition.x, y: nextPosition.y },
      isNewDiscovery: options?.isNewDiscovery ?? false,
      arrivalHighlightMode: options?.arrivalHighlightMode ?? null,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((item) => item.nodeId !== nodeId));
        showError(
          err instanceof Error ? err.message : "Failed to add item to the shared board.",
          err
        );
      });
  }

  function addLibraryItemToWorkspace(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );

    if (isMobileLayout && isSearchFocused) {
      clearMobileSearchFocus();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          addItemToWorkspace(item.id, viewportCenterRef.current ?? undefined, {
            arrivalHighlightMode: "library",
          });
        });
      });
      return;
    }

    addItemToWorkspace(item.id, undefined, { arrivalHighlightMode: "library" });
  }

  function addLibraryItemToWorkspaceAsActionAnchor(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );

    const anchorPosition =
      viewportCenterRef.current ??
      ({
        x: 260,
        y: 180,
      } as const);
    const nodeId = makeWorkspaceNodeId();
    const nextPosition = {
      x: anchorPosition.x + (Math.random() - 0.5) * 160,
      y: anchorPosition.y + (Math.random() - 0.5) * 120,
    };
    const optimisticItem: WorkspaceItem = {
      nodeId,
      itemId: item.id,
      position: nextPosition,
      arrivalHighlightMode: "library",
      actionConstraintName: item.name,
      actionConstraintNormalizedName: item.normalizedName,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));

    void createBoardItem({
      nodeId,
      itemId: item.id,
      position: nextPosition,
      arrivalHighlightMode: "library",
      actionConstraintName: item.name,
      actionConstraintNormalizedName: item.normalizedName,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((workspaceItem) => workspaceItem.nodeId !== nodeId));
        showError(
          err instanceof Error ? err.message : "Failed to add item to the shared board.",
          err
        );
      });
  }

  function attachCategoryModifier(sourceNodeId: string, targetNodeId: string) {
    void attachBoardCategoryModifier({ sourceNodeId, targetNodeId }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to attach the category modifier.",
        err
      );
    });
  }

  function attachActionModifier(sourceNodeId: string, targetNodeId: string) {
    void attachBoardActionModifier({ sourceNodeId, targetNodeId }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to attach the action modifier.",
        err
      );
    });
  }

  function clearCategoryModifier(nodeId: string) {
    void updateBoardItem(nodeId, {
      categoryConstraintName: null,
      categoryConstraintNormalizedName: null,
    }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to clear the category modifier.",
        err
      );
    });
  }

  function clearActionModifier(nodeId: string) {
    void updateBoardItem(nodeId, {
      actionConstraintName: null,
      actionConstraintNormalizedName: null,
    }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to clear the action modifier.",
        err
      );
    });
  }

  function openItemDetails(item: Item) {
    setDrawerItemId((current) => {
      if (current === item.id) {
        setRightPanelMode("item");
        setIsJournalOpen(true);
        return current;
      }
      setDrawerHistory((history) =>
        current == null ? [] : [...history, current]
      );
      setRightPanelMode("item");
      setIsJournalOpen(true);
      return item.id;
    });
  }

  function closeItemDetails() {
    setDrawerItemId(null);
    setDrawerHistory([]);
    setIsJournalOpen(false);
  }

  function goBackInItemDetails() {
    setDrawerHistory((history) => {
      const previousItemId = history[history.length - 1] ?? null;
      setDrawerItemId(previousItemId);
      setRightPanelMode(previousItemId == null ? "journal" : "item");
      return history.slice(0, -1);
    });
  }

  function clearWorkspaceItems() {
    void clearSharedBoardItems()
      .then(() => {
        setWorkspaceItems([]);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to clear the shared board.", err);
      });
  }

  function handleViewportCenterChange(position: { x: number; y: number }) {
    viewportCenterRef.current = position;
    publishSharedViewportCenter(position);
  }

  function moveSharedWorkspaceItems(
    nextItems: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) {
    if (nextItems.length === 0) {
      return;
    }
    setWorkspaceItems((prev) =>
      prev.map((item) => {
        const moved = nextItems.find((entry) => entry.nodeId === item.nodeId);
        return moved ? { ...item, position: moved.position } : item;
      })
    );
    void moveBoardItems(nextItems).catch((err) => {
      showError(err instanceof Error ? err.message : "Failed to move board items.", err);
      void fetchBoardSnapshot().then((snapshot) => {
        setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
      });
    });
  }

  function dragSharedWorkspaceGroup(
    nextItems: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) {
    if (nextItems.length === 0) {
      return;
    }
    const now = Date.now();
    if (now - lastDragSentAtRef.current < 45) {
      return;
    }
    lastDragSentAtRef.current = now;
    sendBoardGroupMove(nextItems);
  }

  function deleteSharedWorkspaceItems(nodeIds: string[]) {
    if (nodeIds.length === 0) {
      return;
    }
    const removedItems = workspaceItems.filter((item) => nodeIds.includes(item.nodeId));
    setWorkspaceItems((prev) => prev.filter((item) => !nodeIds.includes(item.nodeId)));
    void deleteBoardItems(nodeIds)
      .catch((err) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, removedItems));
        showError(err instanceof Error ? err.message : "Failed to delete board items.", err);
      });
  }

  function duplicateSharedWorkspaceItem(nodeId: string) {
    const sourceItem = workspaceItems.find((item) => item.nodeId === nodeId);
    if (!sourceItem) {
      return;
    }
    const optimisticNodeId = makeWorkspaceNodeId();
    const optimisticItem: WorkspaceItem = {
      nodeId: optimisticNodeId,
      itemId: sourceItem.itemId,
      position: {
        x: sourceItem.position.x + 12,
        y: sourceItem.position.y + 12,
      },
      isNewDiscovery: false,
      categoryConstraintName: sourceItem.categoryConstraintName ?? null,
      categoryConstraintNormalizedName:
        sourceItem.categoryConstraintNormalizedName ?? null,
      actionConstraintName: sourceItem.actionConstraintName ?? null,
      actionConstraintNormalizedName:
        sourceItem.actionConstraintNormalizedName ?? null,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));
    void duplicateBoardItem(nodeId, {
      nodeId: optimisticNodeId,
      position: optimisticItem.position,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((item) => item.nodeId !== optimisticNodeId));
        showError(err instanceof Error ? err.message : "Failed to duplicate board item.", err);
      });
  }

  function claimSharedWorkspaceDrag(nodeId: string) {
    activeDragNodeIdRef.current = nodeId;
    dragSequenceRef.current = 0;
    lastDragSentAtRef.current = 0;
    void claimBoardDrag({ nodeId }).then((result) => {
      if (result.ok || activeDragNodeIdRef.current !== nodeId) {
        return;
      }
      activeDragNodeIdRef.current = null;
      dragAbortNonceRef.current += 1;
      setDragAbortSignal({
        nodeId,
        nonce: dragAbortNonceRef.current,
      });
      if (result.position) {
        setWorkspaceItems((prev) =>
          prev.map((item) =>
            item.nodeId === nodeId ? { ...item, position: result.position! } : item
          )
        );
      } else {
        void fetchBoardSnapshot().then((snapshot) => {
          setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
        });
      }
    });
  }

  function dragSharedWorkspaceItem(nodeId: string, position: { x: number; y: number }) {
    if (activeDragNodeIdRef.current !== nodeId) {
      return;
    }
    const now = Date.now();
    if (now - lastDragSentAtRef.current < 45) {
      return;
    }
    lastDragSentAtRef.current = now;
    dragSequenceRef.current += 1;
    sendBoardDragMove({
      nodeId,
      position,
      sequence: dragSequenceRef.current,
    });
  }

  function releaseSharedWorkspaceDrag(nodeId: string, position: { x: number; y: number }) {
    activeDragNodeIdRef.current = null;
    dragSequenceRef.current += 1;
    setWorkspaceItems((prev) =>
      prev.map((item) =>
        item.nodeId === nodeId ? { ...item, position } : item
      )
    );
    void endBoardDrag({
      nodeId,
      position,
      sequence: dragSequenceRef.current,
    }).then((result) => {
      if (!result.ok && result.position) {
        setWorkspaceItems((prev) =>
          prev.map((item) =>
            item.nodeId === nodeId ? { ...item, position: result.position! } : item
          )
        );
      }
    });
  }

  function publishSharedSelection(
    nodeIds: string[],
    layout?: SelectionCombineLayout | null
  ) {
    publishBoardSelectionState({
      nodeIds,
      layout: layout ?? null,
    });
  }

  function publishSharedActivity(
    nodeIds: string[],
    mode: SharedBoardActivityMode | null,
    layout?: SelectionCombineLayout | null
  ) {
    publishBoardActivityState({
      nodeIds,
      layout: layout ?? null,
      mode,
    });
  }

  async function combineWorkspaceNodeIds(
    nodeIds: string[],
    options?: {
      mode?: "selection" | "direct";
      selectionLayout?: SelectionCombineLayout | null;
      resultCenter?: { x: number; y: number } | null;
    }
  ): Promise<boolean> {
    const uniqueNodeIds = Array.from(new Set(nodeIds));
    if (uniqueNodeIds.length < 2) return false;
    if (uniqueNodeIds.some((nodeId) => combiningNodeIds.includes(nodeId))) {
      showError("One or more selected items are already combining.", null);
      return false;
    }
    let operationCombiningIds: string[] = uniqueNodeIds;

    const selectedNodes = uniqueNodeIds
      .map((nodeId) => workspaceItems.find((n) => n.nodeId === nodeId))
      .filter(Boolean) as WorkspaceItem[];
    if (selectedNodes.length < 2) return false;

    const selectedItems = selectedNodes
      .map((node) => findItemById(node.itemId))
      .filter(Boolean) as Item[];
    if (selectedItems.length < 2) return false;

    const creativeCatalyst = selectedItems.find((item) => item.id === CREATIVE_ITEM_ID) ?? null;
    const actionCatalysts = selectedItems
      .map((item) => ACTION_CATALYST_BY_ID.get(item.id) ?? null)
      .filter((entry): entry is NonNullable<(typeof ACTION_CATALYSTS)[number]> => entry != null);
    const categoryAnchors = selectedNodes.filter(
      (node) => node.categoryConstraintName && node.categoryConstraintNormalizedName
    );
    const actionAnchors = selectedNodes.filter(
      (node) => node.actionConstraintName && node.actionConstraintNormalizedName
    );
    const activeCatalystCount =
      [creativeCatalyst, actionCatalysts[0] ?? null].filter(Boolean).length;
    if (activeCatalystCount > 1) {
      showError("Use only one catalyst at a time.", null);
      return false;
    }
    if (actionCatalysts.length > 1) {
      showError("Use only one catalyst at a time.", null);
      return false;
    }
    if (categoryAnchors.length > 1) {
      showError("Use only one Category modifier at a time.", null);
      return false;
    }
    if (actionAnchors.length > 1) {
      showError("Use only one Action modifier at a time.", null);
      return false;
    }
    const categoryAnchor = categoryAnchors[0] ?? null;
    const actionAnchor = actionAnchors[0] ?? null;
    const actionCatalyst = actionCatalysts[0] ?? null;
    const effectiveActionConstraint =
      actionAnchor?.actionConstraintName ?? actionCatalyst?.actionConstraint ?? null;
    const resolvedActionFamilyKey = resolveActionPromptFamilyKey(effectiveActionConstraint);
    const isCompoundCombine = resolvedActionFamilyKey === "compound";
    const usesWebSearch = resolvedActionFamilyKey === "pop_culture";
    const actualInputItems = selectedItems.filter(
      (item) => !NON_INGREDIENT_ITEM_IDS.has(item.id)
    );
    const effectiveInputNodes = selectedNodes
      .filter(
        (node) =>
          node.nodeId !== categoryAnchor?.nodeId && node.nodeId !== actionAnchor?.nodeId
      )
      .filter((node) => {
        const item = findItemById(node.itemId);
        return !!item && !NON_INGREDIENT_ITEM_IDS.has(item.id);
      });
    if (isCompoundCombine) {
      effectiveInputNodes.sort((left, right) => {
        if (left.position.x !== right.position.x) {
          return left.position.x - right.position.x;
        }
        return left.position.y - right.position.y;
      });
    }
    const effectiveInputItems = effectiveInputNodes
      .map((node) => findItemById(node.itemId))
      .filter((item): item is Item => !!item);
    const catalystLabel = creativeCatalyst
      ? "Creative Spark"
      : actionCatalyst
        ? actionCatalyst.actionConstraint
      : categoryAnchor && actionAnchor
        ? "Category + Action"
      : categoryAnchor
        ? "Category"
      : actionAnchor
        ? "Action"
        : null;
    if (effectiveInputItems.length === 0) {
      showError(
        catalystLabel
          ? `${catalystLabel} needs at least one regular item to combine.`
          : "No regular items selected.",
        null
      );
      return false;
    }
    if (
      !creativeCatalyst &&
      !actionCatalyst &&
      !categoryAnchor &&
      !actionAnchor &&
      actualInputItems.length < 2
    ) {
      return false;
    }

    const inputNames = effectiveInputItems.map((item) => item.name);
    const combineMode = options?.mode ?? "direct";
    const usesPendingPlaceholder = combineMode === "selection";
    let pendingPlaceholderNodeId: string | null = null;
    let publishedActivityNodeIds = uniqueNodeIds;
    const activityMode: SharedBoardActivityMode =
      usesWebSearch ? "searching" : "combining";

    try {
      const selectionLayout = options?.selectionLayout ?? null;
      const center =
        options?.resultCenter ??
        (() => {
          const centerSum = selectedNodes.reduce(
            (acc, node) => ({
              x: acc.x + node.position.x,
              y: acc.y + node.position.y,
            }),
            { x: 0, y: 0 }
          );
          return {
            x: centerSum.x / selectedNodes.length,
            y: centerSum.y / selectedNodes.length,
          };
        })();
      const placeholderPosition = selectionLayout?.placeholderPosition ?? center;
      if (usesPendingPlaceholder) {
        const pendingPlaceholder = await createBoardItem({
          nodeId: selectionLayout?.placeholderNodeId,
          itemId: COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
          position: placeholderPosition,
        });
        pendingPlaceholderNodeId = pendingPlaceholder.nodeId;
        operationCombiningIds = [...uniqueNodeIds, pendingPlaceholder.nodeId];
      }
      publishedActivityNodeIds = operationCombiningIds;

      setCombiningNodeIds((prev) =>
        Array.from(new Set([...prev, ...operationCombiningIds]))
      );
      if (usesWebSearch) {
        setWebSearchingNodeIds((prev) =>
          Array.from(new Set([...prev, ...operationCombiningIds]))
        );
      }
      publishSharedActivity(
        publishedActivityNodeIds,
        activityMode,
        usesPendingPlaceholder ? selectionLayout : null
      );
      const recipe = await combineElements(inputNames, {
        creative: Boolean(creativeCatalyst),
        ponderificate: false,
        categoryConstraint: categoryAnchor?.categoryConstraintName ?? undefined,
        actionConstraint: effectiveActionConstraint ?? undefined,
        model: selectedModel,
      });

      const producedItems =
        recipe.resultElements && recipe.resultElements.length > 0
          ? recipe.resultElements
          : recipe.resultElement
            ? [recipe.resultElement]
            : [];
      const autoUnlockedActionWords = recipe.autoUnlockedActionWords ?? [];
      const newlyCompletedQuestNames = recipe.newlyCompletedQuestNames ?? [];
      const completedQuestMatches = recipe.completedQuestMatches ?? [];

      if (producedItems.length === 0) {
        showError("Combine returned no result item.", null);
        return false;
      }

      setItems((prev) => {
        const next = [...prev];
        for (const producedItem of [
          ...producedItems,
          ...autoUnlockedActionWords.map((entry) => entry.element),
        ]) {
          if (!next.some((el) => el.id === producedItem.id)) {
            next.push(producedItem);
          }
        }
        return next;
      });
      const producedItemsWithDiscovery = producedItems.map((producedItem) => ({
        item: producedItem,
        isNewDiscovery: !items.some((el) => el.id === producedItem.id),
      }));
      const hasNewDiscovery = producedItemsWithDiscovery.some(
        (produced) => produced.isNewDiscovery
      );
      const newlyDiscoveredProducedItems = producedItemsWithDiscovery.filter(
        (produced) => produced.isNewDiscovery
      );
      const newestDiscoveredItem =
        newlyDiscoveredProducedItems.length > 0
          ? newlyDiscoveredProducedItems[newlyDiscoveredProducedItems.length - 1].item
          : null;
      if (autoUnlockedActionWords.length > 0) {
        setActionUnlockModal({
          unlockedWords: autoUnlockedActionWords,
        });
      }

      const spawnOffset = producedItemsWithDiscovery.length > 1 ? 56 : 0;
      const producedBoardItems = producedItemsWithDiscovery.map((produced, index) => ({
        itemId: produced.item.id,
        position: {
          x: placeholderPosition.x + index * 112 - spawnOffset,
          y: placeholderPosition.y,
        },
        isNewDiscovery: produced.isNewDiscovery,
        arrivalHighlightMode: "combine" as const,
      }));
      const celebrationMatchedItemName =
        completedQuestMatches.find((match) =>
          producedItemsWithDiscovery.some(
            (produced) =>
              normalizeItemName(produced.item.normalizedName || produced.item.name) ===
              normalizeItemName(match.matchedItemName)
          )
        )?.matchedItemName ?? null;
      const celebrationItemIndex =
        celebrationMatchedItemName != null
          ? producedItemsWithDiscovery.findIndex(
              (produced) =>
                normalizeItemName(produced.item.normalizedName || produced.item.name) ===
                normalizeItemName(celebrationMatchedItemName)
            )
          : newestDiscoveredItem != null
            ? producedItemsWithDiscovery.findIndex(
                (produced) => produced.item.id === newestDiscoveredItem.id
              )
            : -1;
      await combineBoardItems({
        consumedNodeIds: uniqueNodeIds,
        placeholderNodeId: pendingPlaceholderNodeId ?? undefined,
        producedItems: producedBoardItems,
        questSync:
          newlyCompletedQuestNames.length > 0 ||
          (recipe.completedQuestSets && recipe.completedQuestSets.length > 0) ||
          recipe.totalPoints != null
            ? {
                newlyCompletedQuestNames,
                completedQuestSets: recipe.completedQuestSets,
                totalPoints: recipe.totalPoints,
                celebrationProducedItemIndex:
                  celebrationItemIndex >= 0 ? celebrationItemIndex : null,
              }
            : undefined,
      });
      if (
        newlyCompletedQuestNames.length > 0 ||
        (recipe.completedQuestSets && recipe.completedQuestSets.length > 0)
      ) {
        try {
          const result = await fetchQuests();
          const hasTrackedQuest = result.quests.some((quest) => quest.status === "tracked");
          const nextAvailableQuest = result.quests.find((quest) => quest.status === "available");

          if (!hasTrackedQuest && nextAvailableQuest) {
            const trackedResult = await updateQuestStatus({
              name: nextAvailableQuest.name,
              status: "tracked",
            });
            setQuests(trackedResult.quests);
            applyQuestStats(trackedResult.stats);
          } else {
            setQuests(result.quests);
            applyQuestStats(result.stats);
          }
        } catch {
        }
      }
      if (hasNewDiscovery) {
        void loadFeatureUnlocks();
      }
      return true;
    } catch (err) {
      if (pendingPlaceholderNodeId) {
        void deleteBoardItems([pendingPlaceholderNodeId]).catch(() => {});
      }
      showError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to combine items. Please try again.",
        err
      );
      return false;
    } finally {
      publishSharedActivity([], null, null);
      setCombiningNodeIds((prev) =>
        prev.filter((nodeId) => !operationCombiningIds.includes(nodeId))
      );
      setWebSearchingNodeIds((prev) =>
        prev.filter((nodeId) => !operationCombiningIds.includes(nodeId))
      );
    }
  }

  async function combineWorkspaceItems(
    sourceNodeId: string,
    targetNodeId: string,
    resultCenter?: { x: number; y: number }
  ) {
    if (sourceNodeId === targetNodeId) return;
    await combineWorkspaceNodeIds([sourceNodeId, targetNodeId], {
      mode: "direct",
      resultCenter: resultCenter ?? null,
    });
  }

  async function combineWorkspaceSelection(selectionLayout: SelectionCombineLayout) {
    await combineWorkspaceNodeIds(selectionLayout.nodeIds, {
      mode: "selection",
      selectionLayout,
    });
  }

  const visibleCombiningNodeIds = useMemo(
    () => Array.from(new Set([...combiningNodeIds, ...remoteActivityNodeIds])),
    [combiningNodeIds, remoteActivityNodeIds]
  );

  return (
    <>
      {errorMessage && (
        <div className="toast">
          <span className="toast-text">{errorMessage}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {questCelebration ? (
        <div className="quest-complete-toast" aria-live="assertive" role="status">
          <div className="quest-complete-toast-kicker">{questCelebration.kicker}</div>
          <div className="quest-complete-toast-title">{questCelebration.title}</div>
          <div className="quest-complete-toast-copy">{questCelebration.copy}</div>
        </div>
      ) : null}
      {questSetCelebration ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setQuestSetCelebration(null)}
          />
          <div className="quest-set-complete-panel" role="dialog" aria-modal="true">
            <div className="quest-set-complete-kicker">Quest Set Complete</div>
            <div className="quest-set-complete-title">{questSetCelebration.title}</div>
            <div className="quest-set-complete-copy">
              You finished all {questSetCelebration.questCount} quests in this set and earned{" "}
              {questSetCelebration.earnedPoints} bonus points.
            </div>
            <div className="quest-set-complete-graph" aria-hidden="true">
              <div className="quest-set-complete-bar quest-set-complete-bar-progress">
                <span>Set finished</span>
                <strong>{questSetCelebration.questCount}/{questSetCelebration.questCount}</strong>
              </div>
              <div className="quest-set-complete-bar quest-set-complete-bar-points">
                <span>Bonus points</span>
                <strong>+{questSetCelebration.earnedPoints}</strong>
              </div>
              <div className="quest-set-complete-bar quest-set-complete-bar-total">
                <span>Total score</span>
                <strong>{questSetCelebration.totalPoints}</strong>
              </div>
            </div>
            <div className="quest-set-complete-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => setQuestSetCelebration(null)}
              >
                Nice
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {actionUnlockModal ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setActionUnlockModal(null)}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">
              {actionUnlockModal.unlockedWords.length === 1
                ? `${actionUnlockModal.unlockedWords[0].familyTitle} unlocked`
                : "New action words unlocked"}
            </h3>
            <p className="confirm-text">
              {actionUnlockModal.unlockedWords.length === 1
                ? `${actionUnlockModal.unlockedWords[0].triggerWord} belongs to the ${actionUnlockModal.unlockedWords[0].familyTitle} action family, so ${actionUnlockModal.unlockedWords[0].element.name} was added to your library automatically.`
                : "You discovered words that belong to special action families, so their main action words were added to your library automatically."}
            </p>
            <div className="item-drawer-chip-row">
              {actionUnlockModal.unlockedWords.map((entry) => (
                <button
                  key={`${entry.familyKey}-${entry.element.id}`}
                  type="button"
                  className="item-drawer-chip"
                  onClick={() => {
                    addLibraryItemToWorkspace(entry.element);
                    setActionUnlockModal(null);
                  }}
                >
                  {entry.element.name}
                </button>
              ))}
            </div>
            <p className="confirm-text">
              Add one of these words to the workspace, attach the <strong>Action</strong>{" "}
              modifier to it, then combine it with other clues to use that specialized
              action behavior.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setActionUnlockModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingAbandonedQuestName ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setPendingAbandonedQuestName(null)}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">Abandon Quest?</h3>
            <p className="confirm-text">
              <strong>{pendingAbandonedQuestName}</strong> will be removed from the quest list.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                disabled={
                  pendingQuestAction?.name === pendingAbandonedQuestName &&
                  pendingQuestAction.kind === "abandon"
                }
                onClick={() => setPendingAbandonedQuestName(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={
                  pendingQuestAction?.name === pendingAbandonedQuestName &&
                  pendingQuestAction.kind === "abandon"
                }
                onClick={() => abandonQuest(pendingAbandonedQuestName)}
              >
                {pendingQuestAction?.name === pendingAbandonedQuestName &&
                pendingQuestAction.kind === "abandon"
                  ? "Abandoning…"
                  : "Abandon Quest"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`app-root${isMobileLayout ? " is-mobile" : ""}${
          isMobileLayout && isSearchFocused ? " is-search-focused" : ""
        }${
          isMobileLayout && !isSearchFocused && !librarySearchQuery.trim()
            ? " is-mobile-library-collapsed"
            : ""
        }`}
        style={
          isAndroidDevice && isPortraitTabletLayout && androidViewportHeight != null
            ? ({
                ["--app-viewport-height" as string]: `${androidViewportHeight}px`,
                ["--android-keyboard-height" as string]: `${androidKeyboardHeight}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <aside className="sidebar">
          <ElementSidebar
            items={items}
            isMobileLayout={isMobileLayout}
            totalQuestPoints={questStats.totalPoints}
            questPointsHighlightKey={questPointsHighlightKey}
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onItemsLoaded={(nextItems) => {
              setItems(nextItems);
              setHasLoadedInitialLibrary(true);
            }}
            randomUnlocked={isFeatureUnlocked("random_tools")}
            canUndoWorkspace={canUndoWorkspace && !isUndoingWorkspace && combiningNodeIds.length === 0}
            onUndoWorkspace={undoWorkspaceBoardAction}
            onSearchFocusChange={setIsSearchFocused}
            onSearchQueryChange={setLibrarySearchQuery}
          />
        </aside>

        <main className="main-area">
          <section className="workspace-layout">
            <div className="graph-wrapper">
              {isPortraitTabletLayout ? null : (
                <div className="graph-header">
                  <h2 className="section-title">Crafting workspace</h2>
                </div>
              )}
              <div className="graph-canvas">
                {isMobileLayout ? (
                  <div className="graph-undo-button-overlay">
                    <button
                      type="button"
                      className="graph-overlay-icon-button graph-undo-button-trigger"
                      onClick={() => void undoWorkspaceBoardAction()}
                      disabled={
                        !canUndoWorkspace ||
                        isUndoingWorkspace ||
                        combiningNodeIds.length > 0
                      }
                      aria-label="Undo last board action"
                      title="Undo last board action"
                    >
                      <Undo2 size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {isPortraitTabletLayout ? (
                  <div className="graph-quests-button-overlay">
                    <button
                      type="button"
                      className="graph-overlay-icon-button graph-quests-button-trigger"
                      onClick={() => openJournal()}
                      aria-label="Open quests"
                      title="Open quests"
                    >
                      <ScrollText size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    {visibleTrackedQuests.length > 0 ? (
                      <div className="graph-quest-target-chip-list">
                        {visibleTrackedQuests.map((quest) => (
                          <button
                            key={quest.name}
                            type="button"
                            className="graph-quest-target-chip"
                            onClick={() => openJournal()}
                            title={quest.name}
                          >
                            <span className="graph-quest-target-chip-marker" aria-hidden="true">
                              ◎
                            </span>
                            <span className="graph-quest-target-chip-label">{quest.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <GraphView
                  items={items}
                  workspaceItems={workspaceItems}
                  isRestoringWorkspace={isRestoringWorkspace}
                  celebratedNodeId={celebratedQuestNodeId}
                  onAttachActionModifier={attachActionModifier}
                  onAttachCategoryModifier={attachCategoryModifier}
                  onMoveWorkspaceItems={moveSharedWorkspaceItems}
                  onDeleteWorkspaceItems={deleteSharedWorkspaceItems}
                  onDuplicateWorkspaceItem={duplicateSharedWorkspaceItem}
                  onClaimWorkspaceDrag={claimSharedWorkspaceDrag}
                  onDragWorkspaceItem={dragSharedWorkspaceItem}
                  onReleaseWorkspaceDrag={releaseSharedWorkspaceDrag}
                  onDragWorkspaceGroup={dragSharedWorkspaceGroup}
                  remoteSelectedNodeIds={remoteSelectedNodeIds}
                  remoteSelectionLayout={remoteSelectionLayout}
                  remoteActivityNodeIds={remoteActivityNodeIds}
                  remoteActivityLayout={remoteActivityLayout}
                  remoteActivityMode={remoteActivityMode}
                  remoteViewportCenters={remoteViewportCenters}
                  dragAbortSignal={dragAbortSignal}
                  onSelectionStateChange={publishSharedSelection}
                  onViewportCenterChange={handleViewportCenterChange}
                  combiningNodeIds={visibleCombiningNodeIds}
                  webSearchingNodeIds={webSearchingNodeIds}
                  onClearActionModifier={clearActionModifier}
                  onClearCategoryModifier={clearCategoryModifier}
                  onClearWorkspace={clearWorkspaceItems}
                  onCombineWorkspaceItems={combineWorkspaceItems}
                  onCombineWorkspaceSelection={combineWorkspaceSelection}
                  onOpenItemDetails={openItemDetails}
                  catalystActions={catalystActions}
                  closeCatalystMenuOnSelect={isMobileLayout}
                />
              </div>
            </div>
              <JournalDock
                dockRef={journalDockRef}
                isOpen={isJournalOpen}
                isTransient={isPortraitTabletLayout}
                mode={rightPanelMode}
                questReferences={questReferences}
                referencePreviewLimit={QUEST_REFERENCE_PREVIEW_LIMIT}
                quests={visibleQuests}
                trackedQuestNames={trackedQuestNames}
                completedQuestNames={completedQuestNames}
                isGeneratingQuests={isGeneratingQuests}
                selectedQuest={selectedQuest}
                selectedQuestItem={selectedQuestItem}
                item={drawerItem}
                items={items}
                itemsById={itemById}
                canGoBack={drawerHistory.length > 0}
                onBack={goBackInItemDetails}
                onAddItemToWorkspace={addLibraryItemToWorkspace}
                onAddItemToWorkspaceAsActionAnchor={addLibraryItemToWorkspaceAsActionAnchor}
                onCloseItem={closeItemDetails}
                onCloseQuest={() => {
                  setRightPanelMode("journal");
                  setSelectedQuestName(null);
                }}
                onBackToJournal={openJournal}
                onSelectItem={openItemDetails}
                onCollapse={() => setIsJournalOpen(false)}
                onStartQuestDraftSession={openQuestGenerationModal}
                onSelectQuest={openQuestDetails}
                onTrackQuest={trackQuest}
                onUntrackQuest={untrackQuest}
                onRequestAbandonQuest={setPendingAbandonedQuestName}
                pendingQuestAction={pendingQuestAction}
                truncateReference={truncateReferencePreview}
              />
              <QuestGenerationModal
                isOpen={isQuestModalOpen}
                isLoading={isGeneratingQuests}
                topic={questTopicInput}
                draft={questDraft}
                selectedTargetNames={selectedQuestDraftTargets}
                onTopicChange={updateQuestTopicInput}
                onClose={closeQuestGenerationModal}
                onSubmit={() => {
                  void submitQuestGenerationTopic();
                }}
                onToggleTarget={toggleQuestDraftTarget}
                onSelectAll={selectAllQuestDraftTargets}
                onDeselectAll={clearQuestDraftSelection}
                onAccept={() => {
                  void acceptQuestGenerationDraft();
                }}
              />
          </section>
        </main>
      </div>
    </>
  );
};

export default App;
