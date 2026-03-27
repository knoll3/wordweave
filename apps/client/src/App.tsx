import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
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
  ChallengeTarget,
  FeatureUnlockStatus,
  Item,
  SelectionCombineLayout,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import JournalDock from "./components/Journal/JournalDock";
import {
  combineElements,
  generateChallengeTargets,
  fetchQuestTargetReference,
  fetchUnlockStatuses,
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
const CHALLENGE_TARGETS_STORAGE_KEY = "wordweave.challenge-targets";
const TRACKED_QUEST_NAMES_STORAGE_KEY = "wordweave.tracked-quests";
const ABANDONED_QUEST_NAMES_STORAGE_KEY = "wordweave.abandoned-quests";
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

const loadStoredChallengeTargets = (): ChallengeTarget[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = window.localStorage.getItem(CHALLENGE_TARGETS_STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is ChallengeTarget =>
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

function normalizeQuestText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-–—]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactQuestText(value: string) {
  return normalizeQuestText(value).replace(/\s+/g, "");
}

function questsCloselyMatch(left: string, right: string) {
  const normalizedLeft = normalizeQuestText(left);
  const normalizedRight = normalizeQuestText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return compactQuestText(normalizedLeft) === compactQuestText(normalizedRight);
}

function isContainedQuestPhrase(itemName: string, questName: string) {
  const itemTokens = itemName.split(/\s+/).filter(Boolean);
  const questTokens = questName.split(/\s+/).filter(Boolean);
  if (questTokens.length < 2 || itemTokens.length <= questTokens.length) {
    return false;
  }

  for (let start = 0; start <= itemTokens.length - questTokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < questTokens.length; offset += 1) {
      if (itemTokens[start + offset] !== questTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>(
    loadStoredWorkspaceItems
  );
  const [combiningNodeIds, setCombiningNodeIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewportCenter, setViewportCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState<AiModel>("gpt-4.1");
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [forceUnlocks, setForceUnlocks] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [questReferences, setQuestReferences] = useState<
    Record<string, ItemReference | null | undefined>
  >({});
  const [challengeTargets, setChallengeTargets] = useState<ChallengeTarget[]>(
    loadStoredChallengeTargets
  );
  const [trackedQuestNames, setTrackedQuestNames] = useState<Set<string>>(
    () => loadStoredNameSet(TRACKED_QUEST_NAMES_STORAGE_KEY)
  );
  const [abandonedQuestNames, setAbandonedQuestNames] = useState<Set<string>>(
    () => loadStoredNameSet(ABANDONED_QUEST_NAMES_STORAGE_KEY)
  );
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
  const initialQuestSnapshotRef = useRef<Set<string> | null>(null);
  const previousQuestItemIdsRef = useRef<Set<number> | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const journalDockRef = useRef<HTMLElement | null>(null);
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
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
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement != null);
    };

    handleFullscreenChange();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      FORCE_UNLOCKS_STORAGE_KEY,
      forceUnlocks ? "true" : "false"
    );
  }, [forceUnlocks]);

  useEffect(() => {
    window.localStorage.setItem(
      TRACKED_QUEST_NAMES_STORAGE_KEY,
      JSON.stringify([...trackedQuestNames])
    );
  }, [trackedQuestNames]);

  useEffect(() => {
    window.localStorage.setItem(
      ABANDONED_QUEST_NAMES_STORAGE_KEY,
      JSON.stringify([...abandonedQuestNames])
    );
  }, [abandonedQuestNames]);

  useEffect(() => {
    if (!isAndroidDevice) {
      setAndroidViewportHeight(null);
      document.documentElement.style.removeProperty("--android-viewport-height");
      return;
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

    scheduleRefresh();
    window.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("scroll", scheduleRefresh);

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
      scheduleRefresh();
    };

    document.addEventListener("pointerdown", handlePointerDownCapture, true);

    return () => {
      window.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("scroll", scheduleRefresh);
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
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
    window.localStorage.setItem(
      CHALLENGE_TARGETS_STORAGE_KEY,
      JSON.stringify(challengeTargets)
    );
  }, [challengeTargets]);

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

  const visibleChallengeTargets = useMemo(
    () =>
      challengeTargets.filter((quest) => !abandonedQuestNames.has(quest.name)),
    [abandonedQuestNames, challengeTargets]
  );

  useEffect(() => {
    const visibleQuestNames = new Set(visibleChallengeTargets.map((quest) => quest.name));
    setTrackedQuestNames((prev) => {
      const next = new Set([...prev].filter((name) => visibleQuestNames.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleChallengeTargets]);

  const completedQuestNames = useMemo(() => {
    const normalizedItems = items.map((item) =>
      normalizeQuestText(item.normalizedName || item.name)
    );
    const completed = new Set<string>();

    for (const quest of visibleChallengeTargets) {
      const normalizedQuest = normalizeQuestText(quest.name);
      if (!normalizedQuest) continue;
      if (
        normalizedItems.some(
          (itemName) =>
            itemName === normalizedQuest ||
            compactQuestText(itemName) === compactQuestText(normalizedQuest) ||
            isContainedQuestPhrase(itemName, normalizedQuest)
        )
      ) {
        completed.add(quest.name);
      }
    }

    return completed;
  }, [items, visibleChallengeTargets]);

  useEffect(() => {
    const previousCompleted = initialQuestSnapshotRef.current;
    const previousItemIds = previousQuestItemIdsRef.current;

    if (previousCompleted == null || previousItemIds == null) {
      initialQuestSnapshotRef.current = new Set(completedQuestNames);
      previousQuestItemIdsRef.current = new Set(items.map((item) => item.id));
      return;
    }

    const newlyCompleted = visibleChallengeTargets.filter(
      (quest) =>
        trackedQuestNames.has(quest.name) &&
        completedQuestNames.has(quest.name) && !previousCompleted.has(quest.name)
    );

    const newlyDiscoveredItems = items.filter((item) => !previousItemIds.has(item.id));
    const newestDiscoveredItem = newlyDiscoveredItems[newlyDiscoveredItems.length - 1] ?? null;
    const celebrationNodeId =
      newestDiscoveredItem != null
        ? [...workspaceItems]
            .reverse()
            .find((workspaceItem) => workspaceItem.itemId === newestDiscoveredItem.id)?.nodeId ??
          null
        : null;

    if (newlyCompleted.length > 0) {
      showProgressCelebration(
        "Quest Complete",
        newlyCompleted.length === 1
          ? newlyCompleted[0].name
          : `${newlyCompleted.length} quests completed`,
        newlyCompleted.length === 1
          ? "You discovered one of your active quests."
          : "You completed multiple active quests.",
        celebrationNodeId
      );
    }

    initialQuestSnapshotRef.current = new Set(completedQuestNames);
    previousQuestItemIdsRef.current = new Set(items.map((item) => item.id));
  }, [completedQuestNames, items, trackedQuestNames, visibleChallengeTargets, workspaceItems]);

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
      const response = await generateChallengeTargets({
        count: 10,
        difficulty,
        discoveredNames: items.map((item) => item.name),
        recentTargets: visibleChallengeTargets.map((target) => target.name),
        model: selectedModel,
      });
      setChallengeTargets((prev) => {
        const seen = new Set(prev.map((target) => target.name.trim().toLowerCase()));
        const next = [...prev];
        for (const target of response.targets) {
          const normalized = target.name.trim().toLowerCase();
          if (!normalized || seen.has(normalized)) {
            continue;
          }
          seen.add(normalized);
          next.push(target);
        }
        return next;
      });
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

  function openQuestDetails(quest: ChallengeTarget) {
    setSelectedQuestName(quest.name);
    setRightPanelMode("quest");
    setIsJournalOpen(true);
  }

  function trackQuest(questName: string) {
    setTrackedQuestNames((prev) => new Set(prev).add(questName));
  }

  function untrackQuest(questName: string) {
    setTrackedQuestNames((prev) => {
      const next = new Set(prev);
      next.delete(questName);
      return next;
    });
  }

  function abandonQuest(questName: string) {
    setTrackedQuestNames((prev) => {
      const next = new Set(prev);
      next.delete(questName);
      return next;
    });
    setAbandonedQuestNames((prev) => new Set(prev).add(questName));
    if (selectedQuestName === questName) {
      setSelectedQuestName(null);
      setRightPanelMode("journal");
    }
    setPendingAbandonedQuestName(null);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
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
  const selectedQuestItem =
    selectedQuest == null
      ? null
      : items.find(
          (entry) => questsCloselyMatch(entry.normalizedName || entry.name, selectedQuest.name)
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
      icon: React.ReactNode;
      tint: string;
      iconTint: string;
      onClick: () => void;
    }> = [];

    actions.push({
      key: "creative",
      title: "Creative",
      icon: "✨",
      tint: "rgba(167, 139, 250, 0.22)",
      iconTint: "#ddd6fe",
      onClick: () => addItemToWorkspace(CREATIVE_ITEM_ID),
    });

    actions.push({
      key: "category",
      title: "Category",
      icon: <Tags size={16} strokeWidth={2} />,
      tint: "rgba(20, 184, 166, 0.22)",
      iconTint: "#99f6e4",
      onClick: () => addItemToWorkspace(CATEGORY_MODIFIER_ITEM_ID),
    });

    actions.push({
      key: "action",
      title: "Action",
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

    setWorkspaceItems((prev) => [
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

    setWorkspaceItems((prev) => [
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
    setWorkspaceItems((prev) => {
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
    setWorkspaceItems((prev) => {
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
    setWorkspaceItems((prev) =>
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
    setWorkspaceItems((prev) =>
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
    setWorkspaceItems([]);
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

      if (selectionLayout) {
        setWorkspaceItems((prev) => {
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
        });
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
      if (autoUnlockedActionWords.length > 0) {
        setActionUnlockModal({
          unlockedWords: autoUnlockedActionWords,
        });
      }

      if (selectionLayout) {
        setWorkspaceItems((prev) => {
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
        });
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

        setWorkspaceItems((prev) => {
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
        });
      }
      if (hasNewDiscovery) {
        void loadFeatureUnlocks();
      }
      return true;
    } catch (err) {
      if (options?.selectionLayout) {
        setWorkspaceItems((prev) =>
          prev.filter((node) => node.nodeId !== options.selectionLayout!.placeholderNodeId)
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
          />
        </aside>

        <main className="main-area">
          <section className="workspace-layout">
            <div className="graph-wrapper">
              {isPortraitTabletLayout ? null : (
                <div className="graph-header">
                  <h2 className="section-title">Crafting workspace</h2>
                  <div className="graph-header-actions">
                    <button
                      type="button"
                      className="graph-fullscreen-button"
                      onClick={() => {
                        void toggleFullscreen();
                      }}
                      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    >
                      {isFullscreen ? (
                        <Minimize2 size={15} strokeWidth={2} />
                      ) : (
                        <Maximize2 size={15} strokeWidth={2} />
                      )}
                    </button>
                  </div>
                </div>
              )}
              <div className="graph-canvas">
                {isPortraitTabletLayout ? (
                  <button
                    type="button"
                    className="graph-fullscreen-button graph-quests-button-overlay"
                    onClick={() => openJournal()}
                    aria-label="Open quests"
                    title="Open quests"
                  >
                    <ScrollText size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
                {isPortraitTabletLayout ? (
                  <button
                    type="button"
                    className="graph-fullscreen-button graph-fullscreen-button-overlay"
                    onClick={() => {
                      void toggleFullscreen();
                    }}
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  >
                    {isFullscreen ? (
                      <Minimize2 size={15} strokeWidth={2} />
                    ) : (
                      <Maximize2 size={15} strokeWidth={2} />
                    )}
                  </button>
                ) : null}
                <GraphView
                  items={items}
                  workspaceItems={workspaceItems}
                  celebratedNodeId={celebratedQuestNodeId}
                  onAttachActionModifier={attachActionModifier}
                  onAttachCategoryModifier={attachCategoryModifier}
                  onWorkspaceItemsChange={setWorkspaceItems}
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
