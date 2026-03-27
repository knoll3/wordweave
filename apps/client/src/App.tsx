import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollText,
  Tags,
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
  QuestRecord,
  SelectionCombineLayout,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import JournalDock from "./components/Journal/JournalDock";
import {
  combineElements,
  fetchQuests,
  generateChallengeTargets,
  fetchQuestTargetReference,
  fetchUnlockStatuses,
  importLegacyQuestState,
  updateQuestStatus,
  type ItemReference,
} from "./lib/api";
import {
  ACTION_PROMPT_FAMILY_REFERENCES,
  normalizeActionTrigger,
} from "./lib/actionPromptFamilies";
import {
  ACTION_CATALYSTS,
  ACTION_CATALYST_BY_ID,
  NON_INGREDIENT_ITEM_IDS,
  SPECIAL_ITEM_BY_ID,
  SPECIAL_ITEMS,
} from "./lib/specialItems";

const AI_MODELS: AiModel[] = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const WORKSPACE_STORAGE_KEY = "wordweave.workspace-items";
const LEGACY_CHALLENGE_TARGETS_STORAGE_KEY = "wordweave.challenge-targets";
const LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY = "wordweave.tracked-quests";
const LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY = "wordweave.abandoned-quests";
const TOAST_DURATION_MS = 3500;
const QUEST_CELEBRATION_DURATION_MS = 2600;
const ACHIEVEMENT_REFERENCE_PREVIEW_LIMIT = 180;
const PORTRAIT_TABLET_LAYOUT_QUERY = "(orientation: portrait)";

type QuestCelebrationState = {
  kicker: string;
  title: string;
  copy: string;
};

type ActionUnlockModalState = {
  unlockedWords: AutoUnlockedActionWord[];
};

type LegacyChallengeTarget = {
  name: string;
  icon: string;
};

type VirtualKeyboardApi = {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
  addEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject
  ) => void;
};

const loadStoredWorkspaceItems = (): WorkspaceItem[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const storedWorkspace = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!storedWorkspace) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedWorkspace);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is WorkspaceItem =>
        !!item &&
        typeof item.nodeId === "string" &&
        typeof item.itemId === "number" &&
        (item.itemId > 0 || SPECIAL_ITEM_BY_ID.has(item.itemId)) &&
        item.itemId !== COMBINE_RESULT_PLACEHOLDER_ITEM_ID &&
        !!item.position &&
        typeof item.position.x === "number" &&
        typeof item.position.y === "number"
    );
  } catch {
    return [];
  }
};

const loadLegacyStoredChallengeTargets = (): LegacyChallengeTarget[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = window.localStorage.getItem(LEGACY_CHALLENGE_TARGETS_STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is LegacyChallengeTarget =>
        !!entry &&
        typeof entry.name === "string" &&
        entry.name.trim().length > 0 &&
        typeof entry.icon === "string" &&
        entry.icon.trim().length > 0
    );
  } catch {
    return [];
  }
};

const loadStoredNameSet = (storageKey: string): Set<string> => {
  if (typeof window === "undefined") {
    return new Set();
  }

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
};

function truncateAchievementReference(value: string, limit: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function clearLegacyQuestStorage() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LEGACY_CHALLENGE_TARGETS_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY);
}

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>(
    loadStoredWorkspaceItems
  );
  const [workspaceUndoStack, setWorkspaceUndoStack] = useState<WorkspaceItem[][]>([]);
  const [combiningNodeIds, setCombiningNodeIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewportCenter, setViewportCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState<AiModel>("gpt-4.1");
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [forceUnlocks, setForceUnlocks] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [questReferences, setQuestReferences] = useState<
    Record<string, ItemReference | null | undefined>
  >({});
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [isGeneratingChallengeTargets, setIsGeneratingChallengeTargets] = useState(false);
  const [questCelebration, setQuestCelebration] = useState<QuestCelebrationState | null>(
    null
  );
  const [isQuestCelebrating, setIsQuestCelebrating] = useState(false);
  const [celebratedQuestNodeId, setCelebratedQuestNodeId] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<"journal" | "item" | "quest">(
    "journal"
  );
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [selectedQuestName, setSelectedQuestName] = useState<string | null>(null);
  const [pendingAbandonedQuestName, setPendingAbandonedQuestName] = useState<string | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<number[]>([]);
  const [actionUnlockModal, setActionUnlockModal] = useState<ActionUnlockModalState | null>(
    null
  );
  const [isPortraitTabletLayout, setIsPortraitTabletLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(PORTRAIT_TABLET_LAYOUT_QUERY).matches;
  });
  const [androidViewportHeight, setAndroidViewportHeight] = useState<number | null>(null);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const journalDockRef = useRef<HTMLElement | null>(null);
  const isRestoringWorkspaceRef = useRef(false);
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  function cloneWorkspaceSnapshot(entries: WorkspaceItem[]) {
    return entries.map((item) => ({
      ...item,
      position: { ...item.position },
    }));
  }

  function workspaceItemsEqual(left: WorkspaceItem[], right: WorkspaceItem[]) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    return left.every((leftItem, index) => {
      const rightItem = right[index];
      return (
        leftItem.nodeId === rightItem.nodeId &&
        leftItem.itemId === rightItem.itemId &&
        leftItem.position.x === rightItem.position.x &&
        leftItem.position.y === rightItem.position.y &&
        (leftItem.isNewDiscovery ?? false) === (rightItem.isNewDiscovery ?? false) &&
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

  function pushWorkspaceUndoSnapshot(snapshot: WorkspaceItem[]) {
    setWorkspaceUndoStack((prev) => {
      const nextSnapshot = cloneWorkspaceSnapshot(snapshot);
      const lastSnapshot = prev[prev.length - 1];
      if (lastSnapshot && workspaceItemsEqual(lastSnapshot, nextSnapshot)) {
        return prev;
      }
      const next = [...prev, nextSnapshot];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }

  function updateWorkspaceItems(
    update: React.SetStateAction<WorkspaceItem[]>,
    options?: { recordHistory?: boolean }
  ) {
    const shouldRecordHistory =
      options?.recordHistory ?? !isRestoringWorkspaceRef.current;
    setWorkspaceItems((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (workspaceItemsEqual(prev, next)) {
        return prev;
      }
      if (shouldRecordHistory) {
        pushWorkspaceUndoSnapshot(prev);
      }
      return next;
    });
  }

  function undoWorkspaceBoardAction() {
    if (combiningNodeIds.length > 0) {
      return;
    }
    setWorkspaceUndoStack((prev) => {
      const snapshot = prev[prev.length - 1];
      if (!snapshot) {
        return prev;
      }
      isRestoringWorkspaceRef.current = true;
      setWorkspaceItems(cloneWorkspaceSnapshot(snapshot));
      window.requestAnimationFrame(() => {
        isRestoringWorkspaceRef.current = false;
      });
      return prev.slice(0, -1);
    });
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
    const mediaQuery = window.matchMedia(PORTRAIT_TABLET_LAYOUT_QUERY);
    const handleChange = () => {
      setIsPortraitTabletLayout(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

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
    if (!isAndroidDevice) {
      setAndroidViewportHeight(null);
      setAndroidKeyboardHeight(0);
      document.documentElement.style.removeProperty("--android-viewport-height");
      document.documentElement.style.removeProperty("--android-keyboard-height");
      return;
    }

    const virtualKeyboard = (
      navigator as Navigator & { virtualKeyboard?: VirtualKeyboardApi }
    ).virtualKeyboard;

    if (virtualKeyboard) {
      virtualKeyboard.overlaysContent = true;
    }

    const applyViewportHeight = () => {
      const nextHeight = Math.round(
        window.visualViewport?.height ?? window.innerHeight
      );
      setAndroidViewportHeight(nextHeight);
      document.documentElement.style.setProperty(
        "--android-viewport-height",
        `${nextHeight}px`
      );
      window.scrollTo(0, 0);
    };

    const scheduleRefresh = () => {
      applyViewportHeight();
      window.requestAnimationFrame(applyViewportHeight);
      window.setTimeout(applyViewportHeight, 120);
      window.setTimeout(applyViewportHeight, 280);
    };

    const applyKeyboardGeometry = () => {
      const nextKeyboardHeight = Math.max(
        0,
        Math.round(virtualKeyboard?.boundingRect.height ?? 0)
      );
      setAndroidKeyboardHeight(nextKeyboardHeight);
      document.documentElement.style.setProperty(
        "--android-keyboard-height",
        `${nextKeyboardHeight}px`
      );
      scheduleRefresh();
    };

    scheduleRefresh();
    applyKeyboardGeometry();
    window.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("scroll", scheduleRefresh);
    virtualKeyboard?.addEventListener("geometrychange", applyKeyboardGeometry);

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      const activeElement = document.activeElement;
      if (
        !(target instanceof Element) ||
        !(activeElement instanceof HTMLElement) ||
        !["INPUT", "TEXTAREA"].includes(activeElement.tagName)
      ) {
        return;
      }
      if (activeElement.contains(target) || target.closest("input, textarea")) {
        return;
      }
      activeElement.blur();
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        applyKeyboardGeometry();
      });
    };

    document.addEventListener("pointerdown", handlePointerDownCapture, true);

    return () => {
      window.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("scroll", scheduleRefresh);
      virtualKeyboard?.removeEventListener("geometrychange", applyKeyboardGeometry);
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
      document.documentElement.style.removeProperty("--android-keyboard-height");
    };
  }, [isAndroidDevice]);

  useEffect(() => {
    if (combiningNodeIds.length > 0) return;
    if (workspaceItems.some((item) => item.itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID)) {
      return;
    }

    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify(workspaceItems)
    );
  }, [combiningNodeIds, workspaceItems]);

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
        let nextQuests = await fetchQuests();
        if (!cancelled && nextQuests.length === 0) {
          const legacyQuests = loadLegacyStoredChallengeTargets();
          if (legacyQuests.length > 0) {
            nextQuests = await importLegacyQuestState({
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
          setQuests(nextQuests);
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleChallengeTargets = useMemo(
    () => quests.filter((quest) => quest.status !== "abandoned"),
    [quests]
  );
  const trackedQuestNames = useMemo(
    () =>
      new Set(
        visibleChallengeTargets
          .filter((quest) => quest.status === "tracked")
          .map((quest) => quest.name)
      ),
    [visibleChallengeTargets]
  );
  const completedQuestNames = useMemo(
    () =>
      new Set(
        visibleChallengeTargets
          .filter((quest) => quest.status === "completed")
          .map((quest) => quest.name)
      ),
    [visibleChallengeTargets]
  );

  useEffect(() => {
    if (!isJournalOpen || visibleChallengeTargets.length === 0) {
      return;
    }

    const missing = visibleChallengeTargets.filter(
      (quest) => questReferences[quest.name] === undefined
    );

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      missing.map(async (quest) => {
        try {
          const reference = await fetchQuestTargetReference(quest.name);
          return [quest.name, reference] as const;
        } catch {
          return [quest.name, null] as const;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setQuestReferences((prev) => {
        const next = { ...prev };
        for (const [questName, reference] of results) {
          next[questName] = reference;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isJournalOpen, questReferences, visibleChallengeTargets]);

  function showError(message: string, err: unknown) {
    void err;
    setErrorMessage(message);
  }

  async function loadFeatureUnlocks() {
    try {
      const statuses = await fetchUnlockStatuses();
      setFeatureUnlocks(statuses);
    } catch {
    }
  }

  function isFeatureUnlocked(key: UnlockKey) {
    if (forceUnlocks) return true;
    return featureUnlocks.some((unlock) => unlock.key === key && unlock.unlocked);
  }

  async function generateQuests(difficulty: "easy" | "hard") {
    setIsGeneratingChallengeTargets(true);
    try {
      const nextQuests = await generateChallengeTargets({
        count: 10,
        difficulty,
        model: selectedModel,
      });
      setQuests(nextQuests);
      setRightPanelMode("journal");
      setIsJournalOpen(true);
    } catch (err) {
      showError("Failed to generate challenge targets.", err);
    } finally {
      setIsGeneratingChallengeTargets(false);
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
    try {
      setQuests(await updateQuestStatus({ name: questName, status: "tracked" }));
    } catch (err) {
      showError("Failed to update quest.", err);
    }
  }

  async function untrackQuest(questName: string) {
    try {
      setQuests(await updateQuestStatus({ name: questName, status: "available" }));
    } catch (err) {
      showError("Failed to update quest.", err);
    }
  }

  async function abandonQuest(questName: string) {
    try {
      const nextQuests = await updateQuestStatus({ name: questName, status: "abandoned" });
      setQuests(nextQuests);
      if (selectedQuestName === questName) {
        setSelectedQuestName(null);
        setRightPanelMode("journal");
      }
      setPendingAbandonedQuestName(null);
    } catch (err) {
      showError("Failed to update quest.", err);
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
  const drawerItem = drawerItemId == null ? null : itemById.get(drawerItemId) ?? null;
  const selectedQuest =
    selectedQuestName == null
      ? null
      : visibleChallengeTargets.find((entry) => entry.name === selectedQuestName) ?? null;
  const primaryTrackedQuest =
    visibleChallengeTargets.find(
      (quest) => trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
    ) ?? null;
  const selectedQuestItem =
    selectedQuest == null
      ? null
      : selectedQuest.matchedItemName == null
        ? null
        : items.find(
            (entry) =>
              normalizeName(entry.normalizedName || entry.name) ===
              normalizeName(selectedQuest.matchedItemName || "")
          ) ?? null;
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
    const actions: Array<{
      key: string;
      title: string;
      badgeLabel?: string;
      icon: React.ReactNode;
      tint: string;
      iconTint: string;
      onClick: () => void;
    }> = [];

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
  }, [items, unlockedCatalystFamilyKeys, viewportCenter]);

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    return SPECIAL_ITEM_BY_ID.get(itemId) ?? items.find((item) => item.id === itemId);
  }

  function addItemToWorkspace(
    itemId: number,
    position?: { x: number; y: number },
    options?: { isNewDiscovery?: boolean }
  ) {
    const item = findItemById(itemId);
    if (!item) return;
    const anchorPosition =
      position ??
      viewportCenter ??
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

    updateWorkspaceItems((prev) => [
      ...prev,
      {
        nodeId: makeWorkspaceNodeId(),
        itemId,
        position: { x: nextPosition.x, y: nextPosition.y },
        isNewDiscovery: options?.isNewDiscovery ?? false,
      },
    ]);
  }

  function addLibraryItemToWorkspace(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );
    addItemToWorkspace(item.id);
  }

  function addLibraryItemToWorkspaceAsActionAnchor(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );

    const anchorPosition =
      viewportCenter ??
      ({
        x: 260,
        y: 180,
      } as const);

    updateWorkspaceItems((prev) => [
      ...prev,
      {
        nodeId: makeWorkspaceNodeId(),
        itemId: item.id,
        position: {
          x: anchorPosition.x + (Math.random() - 0.5) * 160,
          y: anchorPosition.y + (Math.random() - 0.5) * 120,
        },
        actionConstraintName: item.name,
        actionConstraintNormalizedName: item.normalizedName,
      },
    ]);
  }

  function attachCategoryModifier(sourceNodeId: string, targetNodeId: string) {
    updateWorkspaceItems((prev) => {
      const targetNode = prev.find((item) => item.nodeId === targetNodeId);
      const targetItem = targetNode ? findItemById(targetNode.itemId) : null;
      if (!targetNode || !targetItem || targetItem.id < 0) {
        return prev;
      }
      return prev
        .filter((item) => item.nodeId !== sourceNodeId)
        .map((item) =>
          item.nodeId === targetNodeId
            ? {
                ...item,
                categoryConstraintName: targetItem.name,
                categoryConstraintNormalizedName: targetItem.normalizedName,
              }
            : item
        );
    });
  }

  function attachActionModifier(sourceNodeId: string, targetNodeId: string) {
    updateWorkspaceItems((prev) => {
      const targetNode = prev.find((item) => item.nodeId === targetNodeId);
      const targetItem = targetNode ? findItemById(targetNode.itemId) : null;
      if (!targetNode || !targetItem || targetItem.id < 0) {
        return prev;
      }
      return prev
        .filter((item) => item.nodeId !== sourceNodeId)
        .map((item) =>
          item.nodeId === targetNodeId
            ? {
                ...item,
                actionConstraintName: targetItem.name,
                actionConstraintNormalizedName: targetItem.normalizedName,
              }
            : item
        );
    });
  }

  function clearCategoryModifier(nodeId: string) {
    updateWorkspaceItems((prev) =>
      prev.map((item) =>
        item.nodeId === nodeId
          ? {
              ...item,
              categoryConstraintName: null,
              categoryConstraintNormalizedName: null,
            }
          : item
      )
    );
  }

  function clearActionModifier(nodeId: string) {
    updateWorkspaceItems((prev) =>
      prev.map((item) =>
        item.nodeId === nodeId
          ? {
              ...item,
              actionConstraintName: null,
              actionConstraintNormalizedName: null,
            }
          : item
      )
    );
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
    updateWorkspaceItems([]);
  }

  async function combineWorkspaceNodeIds(
    nodeIds: string[],
    options?: {
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
    const actualInputItems = selectedItems.filter(
      (item) => !NON_INGREDIENT_ITEM_IDS.has(item.id)
    );
    const effectiveInputItems = selectedNodes
      .filter(
        (node) =>
          node.nodeId !== categoryAnchor?.nodeId && node.nodeId !== actionAnchor?.nodeId
      )
      .map((node) => findItemById(node.itemId))
      .filter(
        (item): item is Item => !!item && !NON_INGREDIENT_ITEM_IDS.has(item.id)
      );
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

    try {
      const selectionLayout = options?.selectionLayout ?? null;
      const placeholderNodeId = selectionLayout?.placeholderNodeId ?? null;
      operationCombiningIds = placeholderNodeId
        ? [...uniqueNodeIds, placeholderNodeId]
        : uniqueNodeIds;

      pushWorkspaceUndoSnapshot(workspaceItems);

      if (selectionLayout) {
        updateWorkspaceItems((prev) => {
          const next = prev.map((node) => {
            const layoutNode = selectionLayout.nodePositions.find(
              (entry) => entry.nodeId === node.nodeId
            );
            return layoutNode ? { ...node, position: layoutNode.position } : node;
          });
          return [
            ...next,
            {
              nodeId: selectionLayout.placeholderNodeId,
              itemId: COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
              position: selectionLayout.placeholderPosition,
            },
          ];
        }, { recordHistory: false });
      }

      setCombiningNodeIds((prev) =>
        Array.from(new Set([...prev, ...operationCombiningIds]))
      );
      const recipe = await combineElements(inputNames, {
        creative: Boolean(creativeCatalyst),
        categoryConstraint: categoryAnchor?.categoryConstraintName ?? undefined,
        actionConstraint:
          actionAnchor?.actionConstraintName ??
          actionCatalyst?.actionConstraint ??
          undefined,
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

      if (selectionLayout) {
        updateWorkspaceItems((prev) => {
          const updated = prev.map((node) =>
            node.nodeId === selectionLayout.placeholderNodeId
              ? {
                  ...node,
                  itemId: producedItemsWithDiscovery[0].item.id,
                  isNewDiscovery: producedItemsWithDiscovery[0].isNewDiscovery,
                }
              : node
          );
          if (producedItemsWithDiscovery.length === 1) {
            return updated;
          }

          const placeholderNode = updated.find(
            (node) => node.nodeId === selectionLayout.placeholderNodeId
          );
          if (!placeholderNode) {
            return updated;
          }

          const extras = producedItemsWithDiscovery.slice(1).map((produced, index) => ({
            nodeId: makeWorkspaceNodeId(),
            itemId: produced.item.id,
            position: {
              x: placeholderNode.position.x + 124 + index * 110,
              y: placeholderNode.position.y,
            },
            isNewDiscovery: produced.isNewDiscovery,
          }));

          return [...updated, ...extras];
        }, { recordHistory: false });
      } else {
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

        updateWorkspaceItems((prev) => {
          const withoutInputs = prev.filter((node) => !uniqueNodeIds.includes(node.nodeId));
          const spawnOffset = producedItemsWithDiscovery.length > 1 ? 56 : 0;
          const spawned = producedItemsWithDiscovery.map((produced, index) => ({
            nodeId: makeWorkspaceNodeId(),
            itemId: produced.item.id,
            position: {
              x: center.x + index * 112 - spawnOffset,
              y: center.y,
            },
            isNewDiscovery: produced.isNewDiscovery,
          }));
          return [...withoutInputs, ...spawned];
        }, { recordHistory: false });
      }
      const celebrationNodeId =
        newestDiscoveredItem != null
          ? [...workspaceItems]
              .reverse()
              .find((workspaceItem) => workspaceItem.itemId === newestDiscoveredItem.id)?.nodeId ??
            null
          : null;
      applyNewlyCompletedQuests(newlyCompletedQuestNames, celebrationNodeId);
      if (newlyCompletedQuestNames.length > 0) {
        try {
          setQuests(await fetchQuests());
        } catch {
        }
      }
      if (hasNewDiscovery) {
        void loadFeatureUnlocks();
      }
      return true;
    } catch (err) {
      if (options?.selectionLayout) {
        updateWorkspaceItems(
          (prev) =>
            prev.filter((node) => node.nodeId !== options.selectionLayout!.placeholderNodeId),
          { recordHistory: false }
        );
      }
      showError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to combine items. Please try again.",
        err
      );
      return false;
    } finally {
      setCombiningNodeIds((prev) =>
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
      resultCenter: resultCenter ?? null,
    });
  }

  async function combineWorkspaceSelection(selectionLayout: SelectionCombineLayout) {
    await combineWorkspaceNodeIds(selectionLayout.nodeIds, {
      selectionLayout,
    });
  }

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
                onClick={() => setPendingAbandonedQuestName(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => abandonQuest(pendingAbandonedQuestName)}
              >
                Abandon Quest
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className="app-root"
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
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onItemsLoaded={setItems}
            randomUnlocked={isFeatureUnlocked("random_tools")}
            canUndoWorkspace={workspaceUndoStack.length > 0 && combiningNodeIds.length === 0}
            onUndoWorkspace={undoWorkspaceBoardAction}
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
                {isPortraitTabletLayout ? (
                  <div className="graph-quests-button-overlay">
                    <button
                      type="button"
                      className="graph-fullscreen-button graph-quests-button-trigger"
                      onClick={() => openJournal()}
                      aria-label="Open quests"
                      title="Open quests"
                    >
                      <ScrollText size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    {primaryTrackedQuest ? (
                      <button
                        type="button"
                        className="graph-quest-target-chip"
                        onClick={() => openJournal()}
                        title={primaryTrackedQuest.name}
                      >
                        <span className="graph-quest-target-chip-marker" aria-hidden="true">
                          ◎
                        </span>
                        <span className="graph-quest-target-chip-label">
                          {primaryTrackedQuest.name}
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <GraphView
                  items={items}
                  workspaceItems={workspaceItems}
                  celebratedNodeId={celebratedQuestNodeId}
                  onAttachActionModifier={attachActionModifier}
                  onAttachCategoryModifier={attachCategoryModifier}
                  onWorkspaceItemsChange={updateWorkspaceItems}
                  onViewportCenterChange={setViewportCenter}
                  combiningNodeIds={combiningNodeIds}
                  onClearActionModifier={clearActionModifier}
                  onClearCategoryModifier={clearCategoryModifier}
                  onClearWorkspace={clearWorkspaceItems}
                  onCombineWorkspaceItems={combineWorkspaceItems}
                  onCombineWorkspaceSelection={combineWorkspaceSelection}
                  onOpenItemDetails={openItemDetails}
                  catalystActions={catalystActions}
                />
              </div>
            </div>
              <JournalDock
                dockRef={journalDockRef}
                isOpen={isJournalOpen}
                isTransient={isPortraitTabletLayout}
                mode={rightPanelMode}
                questReferences={questReferences}
                referencePreviewLimit={ACHIEVEMENT_REFERENCE_PREVIEW_LIMIT}
                challengeTargets={visibleChallengeTargets}
                trackedQuestNames={trackedQuestNames}
                completedQuestNames={completedQuestNames}
                isGeneratingChallengeTargets={isGeneratingChallengeTargets}
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
                onGenerateEasyQuests={() => {
                  void generateQuests("easy");
                }}
                onGenerateHardQuests={() => {
                  void generateQuests("hard");
                }}
                onSelectQuest={openQuestDetails}
                onTrackQuest={trackQuest}
                onUntrackQuest={untrackQuest}
                onRequestAbandonQuest={setPendingAbandonedQuestName}
                truncateReference={truncateAchievementReference}
              />
          </section>
        </main>
      </div>
    </>
  );
};

export default App;
