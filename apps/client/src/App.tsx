import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Tags,
  Hammer,
  Sparkles,
  TrendingUp,
  Theater,
  Link2,
  Split,
  ArrowLeftRight,
  PanelRightClose,
} from "lucide-react";
import {
  CATEGORY_MODIFIER_ITEM,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CRAFT_ITEM,
  CRAFT_ITEM_ID,
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
  EVOLVE_ITEM,
  EVOLVE_ITEM_ID,
  POP_CULTURE_ITEM,
  POP_CULTURE_ITEM_ID,
  OPPOSITE_ITEM,
  OPPOSITE_ITEM_ID,
  SPLIT_ITEM,
  SPLIT_ITEM_ID,
  WORD_COMBINE_ITEM,
  WORD_COMBINE_ITEM_ID,
} from "./types";
import type {
  AchievementSummary,
  AiModel,
  FeatureUnlockStatus,
  Item,
  SelectionCombineLayout,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import ItemDetailsDrawer from "./components/Graph/ItemDetailsDrawer";
import { evaluateAchievements } from "./lib/achievements";
import {
  combineElements,
  fetchQuestTargetReference,
  fetchUnlockStatuses,
  markUnlockIntroSeen,
  type ItemReference,
} from "./lib/api";

const AI_MODELS: AiModel[] = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const WORKSPACE_STORAGE_KEY = "wordweave.workspace-items";
const TOAST_DURATION_MS = 3500;
const QUEST_CELEBRATION_DURATION_MS = 2600;
const ACHIEVEMENT_REFERENCE_PREVIEW_LIMIT = 180;

type QuestCelebrationState = {
  kicker: string;
  title: string;
  copy: string;
};

const UNLOCK_DISPLAY: Record<
  UnlockKey,
  {
    name: string;
    icon: string;
    accentClass: string;
    shortCopy: string;
  }
> = {
  creative: {
    name: "Creative Spark",
    icon: "✨",
    accentClass: "is-creative",
    shortCopy: "Pushes results toward imaginative, memorable concepts.",
  },
  split: {
    name: "Split",
    icon: "✂️",
    accentClass: "is-split",
    shortCopy: "Subtracts one concept from another to reveal what remains.",
  },
  opposite: {
    name: "Opposite",
    icon: "↔️",
    accentClass: "is-opposite",
    shortCopy: "Finds the clearest opposite of the selected idea.",
  },
  random_tools: {
    name: "Category",
    icon: "🔀",
    accentClass: "is-category",
    shortCopy: "Adds a modifier token that constrains another item by category.",
  },
  craft: {
    name: "Craft",
    icon: "🔨",
    accentClass: "is-craft",
    shortCopy: "Resolves inputs as a physical outcome, object, or material.",
  },
  evolve: {
    name: "Evolve",
    icon: "🧬",
    accentClass: "is-evolve",
    shortCopy: "Pushes an item toward its next stronger or more advanced form.",
  },
  pop_culture: {
    name: "Pop Culture",
    icon: "🎬",
    accentClass: "is-pop-culture",
    shortCopy: "Turns clues into a specific entertainment reference.",
  },
  word_combine: {
    name: "Compound",
    icon: "🔗",
    accentClass: "is-compound",
    shortCopy: "Builds a real established compound word or phrase.",
  },
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
        item.itemId !== COMBINE_RESULT_PLACEHOLDER_ITEM_ID &&
        !!item.position &&
        typeof item.position.x === "number" &&
        typeof item.position.y === "number"
    );
  } catch {
    return [];
  }
};

function truncateAchievementReference(value: string, limit: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
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
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<"achievements" | "quests">(
    "achievements"
  );
  const [achievementReferences, setAchievementReferences] = useState<
    Record<string, ItemReference | null | undefined>
  >({});
  const [questCelebration, setQuestCelebration] = useState<QuestCelebrationState | null>(
    null
  );
  const [isQuestCelebrating, setIsQuestCelebrating] = useState(false);
  const [celebratedQuestNodeId, setCelebratedQuestNodeId] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<"journal" | "item">("journal");
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<number[]>([]);
  const initialAchievementSnapshotRef = useRef<Set<string> | null>(null);
  const previousItemIdsRef = useRef<Set<number> | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);
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
    window.localStorage.setItem(
      FORCE_UNLOCKS_STORAGE_KEY,
      forceUnlocks ? "true" : "false"
    );
  }, [forceUnlocks]);

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
    const pendingUnlock = featureUnlocks.find((unlock) => unlock.introPending);
    if (!pendingUnlock) {
      return;
    }

    const sourceNormalized = pendingUnlock.sourceItemName?.trim().toLowerCase() ?? null;
    const sourceItemId =
      sourceNormalized == null
        ? null
        : items.find((item) => item.normalizedName === sourceNormalized)?.id ?? null;
    const sourceNodeId =
      sourceItemId == null
        ? null
        : [...workspaceItems]
            .reverse()
            .find((workspaceItem) => workspaceItem.itemId === sourceItemId)?.nodeId ?? null;
    const catalystName = UNLOCK_DISPLAY[pendingUnlock.key].name;

    showProgressCelebration(
      "Quest Complete",
      `${catalystName} unlocked`,
      pendingUnlock.summary,
      sourceNodeId
    );

    void markUnlockIntroSeen(pendingUnlock.key)
      .then(() => {
        setFeatureUnlocks((prev) =>
          prev.map((unlock) =>
            unlock.key === pendingUnlock.key ? { ...unlock, introPending: false } : unlock
          )
        );
      })
      .catch(() => {});
  }, [featureUnlocks, items, workspaceItems]);

  const achievementSummary: AchievementSummary = useMemo(
    () => evaluateAchievements(items),
    [items]
  );

  useEffect(() => {
    const completedIds = new Set(
      achievementSummary.categories.flatMap((category) =>
        category.groups.flatMap((group) =>
          group.achievements.filter((achievement) => achievement.completed).map((achievement) => achievement.id)
        )
      )
    );
    const previousCompletedIds = initialAchievementSnapshotRef.current;
    const previousItemIds = previousItemIdsRef.current;

    if (previousCompletedIds == null || previousItemIds == null) {
      initialAchievementSnapshotRef.current = completedIds;
      previousItemIdsRef.current = new Set(items.map((item) => item.id));
      return;
    }

    const newlyCompleted = achievementSummary.categories
      .flatMap((category) => category.groups.flatMap((group) => group.achievements))
      .filter(
        (achievement) =>
          achievement.completed && !previousCompletedIds.has(achievement.id)
      );

    const newlyDiscoveredItems = items.filter((item) => !previousItemIds.has(item.id));
    const newestDiscoveredItem = newlyDiscoveredItems[newlyDiscoveredItems.length - 1] ?? null;
    const celebrationNodeId =
      newestDiscoveredItem == null
        ? null
        : [...workspaceItems]
            .reverse()
            .find((workspaceItem) => workspaceItem.itemId === newestDiscoveredItem.id)?.nodeId ?? null;

    if (newlyCompleted.length > 0) {
      const earnedPoints = newlyCompleted.reduce(
        (sum, achievement) => sum + achievement.points,
        0
      );
      showProgressCelebration(
        "Achievement Earned",
        newlyCompleted.length === 1
          ? newlyCompleted[0].title
          : `${newlyCompleted.length} achievements earned`,
        newlyCompleted.length === 1
          ? `+${earnedPoints} achievement points`
          : `+${earnedPoints} achievement points added to your total.`,
        celebrationNodeId
      );
    }

    initialAchievementSnapshotRef.current = completedIds;
    previousItemIdsRef.current = new Set(items.map((item) => item.id));
  }, [achievementSummary, items, workspaceItems]);

  useEffect(() => {
    if (!isJournalOpen || journalTab !== "achievements") {
      return;
    }

    const visibleAchievements = achievementSummary.categories.flatMap((category) =>
      category.groups.flatMap((group) => group.achievements)
    );
    const missing = visibleAchievements.filter(
      (achievement) => achievementReferences[achievement.id] === undefined
    );

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      missing.map(async (achievement) => {
        try {
          const reference = await fetchQuestTargetReference(achievement.lookupName);
          return [achievement.id, reference] as const;
        } catch {
          return [achievement.id, null] as const;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setAchievementReferences((prev) => {
        const next = { ...prev };
        for (const [achievementId, reference] of results) {
          next[achievementId] = reference;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [achievementReferences, achievementSummary, isJournalOpen, journalTab]);

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
  const catalystUnlockQuests = useMemo(
    () =>
      featureUnlocks.map((unlock) => ({
        ...unlock,
        display: UNLOCK_DISPLAY[unlock.key],
      })),
    [featureUnlocks]
  );
  const nextLockedCatalystKey =
    catalystUnlockQuests.find((unlock) => !unlock.unlocked)?.key ?? null;
  const unlockedCatalystCount = catalystUnlockQuests.filter(
    (unlock) => unlock.unlocked
  ).length;
  const featuredAchievement = achievementSummary.featuredProgress[0] ?? null;
  const nextLockedCatalyst =
    catalystUnlockQuests.find((unlock) => !unlock.unlocked) ?? null;

  function openJournal(tab: "achievements" | "quests") {
    setJournalTab(tab);
    setRightPanelMode("journal");
    setIsJournalOpen(true);
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
    next.set(CATEGORY_MODIFIER_ITEM.id, CATEGORY_MODIFIER_ITEM);
    next.set(CRAFT_ITEM.id, CRAFT_ITEM);
    next.set(CREATIVE_ITEM.id, CREATIVE_ITEM);
    next.set(EVOLVE_ITEM.id, EVOLVE_ITEM);
    next.set(POP_CULTURE_ITEM.id, POP_CULTURE_ITEM);
    next.set(SPLIT_ITEM.id, SPLIT_ITEM);
    next.set(OPPOSITE_ITEM.id, OPPOSITE_ITEM);
    next.set(WORD_COMBINE_ITEM.id, WORD_COMBINE_ITEM);
    return next;
  }, [items]);
  const drawerItem = drawerItemId == null ? null : itemById.get(drawerItemId) ?? null;
  const catalystActions = useMemo(() => {
    const actions: Array<{
      key: string;
      title: string;
      icon: React.ReactNode;
      tint: string;
      iconTint: string;
      onClick: () => void;
    }> = [];

    if (isFeatureUnlocked("creative")) {
      actions.push({
        key: "creative",
        title: "Creative Spark",
        icon: <Sparkles size={16} strokeWidth={2} />,
        tint: "rgba(168, 85, 247, 0.22)",
        iconTint: "#ddd6fe",
        onClick: () => addItemToWorkspace(CREATIVE_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("split")) {
      actions.push({
        key: "split",
        title: "Split",
        icon: <Split size={16} strokeWidth={2} />,
        tint: "rgba(249, 115, 22, 0.22)",
        iconTint: "#fdba74",
        onClick: () => addItemToWorkspace(SPLIT_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("opposite")) {
      actions.push({
        key: "opposite",
        title: "Opposite",
        icon: <ArrowLeftRight size={16} strokeWidth={2} />,
        tint: "rgba(59, 130, 246, 0.22)",
        iconTint: "#bfdbfe",
        onClick: () => addItemToWorkspace(OPPOSITE_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("random_tools")) {
      actions.push({
        key: "category",
        title: "Category",
        icon: <Tags size={16} strokeWidth={2} />,
        tint: "rgba(20, 184, 166, 0.22)",
        iconTint: "#99f6e4",
        onClick: () => addItemToWorkspace(CATEGORY_MODIFIER_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("craft")) {
      actions.push({
        key: "craft",
        title: "Craft",
        icon: <Hammer size={16} strokeWidth={2} />,
        tint: "rgba(245, 158, 11, 0.22)",
        iconTint: "#fde68a",
        onClick: () => addItemToWorkspace(CRAFT_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("evolve")) {
      actions.push({
        key: "evolve",
        title: "Evolve",
        icon: <TrendingUp size={16} strokeWidth={2} />,
        tint: "rgba(236, 72, 153, 0.22)",
        iconTint: "#fbcfe8",
        onClick: () => addItemToWorkspace(EVOLVE_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("pop_culture")) {
      actions.push({
        key: "pop_culture",
        title: "Pop Culture",
        icon: <Theater size={16} strokeWidth={2} />,
        tint: "rgba(234, 179, 8, 0.22)",
        iconTint: "#fde047",
        onClick: () => addItemToWorkspace(POP_CULTURE_ITEM_ID),
      });
    }

    if (isFeatureUnlocked("word_combine")) {
      actions.push({
        key: "compound",
        title: "Compound",
        icon: <Link2 size={16} strokeWidth={2} />,
        tint: "rgba(192, 132, 252, 0.22)",
        iconTint: "#e9d5ff",
        onClick: () => addItemToWorkspace(WORD_COMBINE_ITEM_ID),
      });
    }

    return actions;
  }, [
    featureUnlocks,
    forceUnlocks,
    viewportCenter,
    items,
  ]);

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    if (itemId === CATEGORY_MODIFIER_ITEM_ID) return CATEGORY_MODIFIER_ITEM;
    if (itemId === CRAFT_ITEM_ID) return CRAFT_ITEM;
    if (itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID) {
      return COMBINE_RESULT_PLACEHOLDER_ITEM;
    }
    if (itemId === CREATIVE_ITEM_ID) return CREATIVE_ITEM;
    if (itemId === EVOLVE_ITEM_ID) return EVOLVE_ITEM;
    if (itemId === POP_CULTURE_ITEM_ID) return POP_CULTURE_ITEM;
    if (itemId === SPLIT_ITEM_ID) return SPLIT_ITEM;
    if (itemId === OPPOSITE_ITEM_ID) return OPPOSITE_ITEM;
    if (itemId === WORD_COMBINE_ITEM_ID) return WORD_COMBINE_ITEM;
    return items.find((item) => item.id === itemId);
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

  function handleLibraryReset() {
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

    const hasCreativeCatalyst = selectedItems.some((item) => item.id === CREATIVE_ITEM_ID);
    const hasEvolveCatalyst = selectedItems.some((item) => item.id === EVOLVE_ITEM_ID);
    const hasPopCultureCatalyst = selectedItems.some(
      (item) => item.id === POP_CULTURE_ITEM_ID
    );
    const hasSplitCatalyst = selectedItems.some((item) => item.id === SPLIT_ITEM_ID);
    const hasOppositeCatalyst = selectedItems.some((item) => item.id === OPPOSITE_ITEM_ID);
    const hasCraftCatalyst = selectedItems.some((item) => item.id === CRAFT_ITEM_ID);
    const hasWordCombineCatalyst = selectedItems.some(
      (item) => item.id === WORD_COMBINE_ITEM_ID
    );
    const categoryAnchors = selectedNodes.filter(
      (node) => node.categoryConstraintName && node.categoryConstraintNormalizedName
    );
    const activeCatalystCount = [
      hasCraftCatalyst,
      hasCreativeCatalyst,
      hasEvolveCatalyst,
      hasPopCultureCatalyst,
      hasSplitCatalyst,
      hasOppositeCatalyst,
      hasWordCombineCatalyst,
    ].filter(Boolean).length;
    if (activeCatalystCount > 1) {
      showError("Use only one catalyst at a time.", null);
      return false;
    }
    if (categoryAnchors.length > 1) {
      showError("Use only one Category modifier at a time.", null);
      return false;
    }
    const categoryAnchor = categoryAnchors[0] ?? null;
    const actualInputItems = selectedItems.filter(
      (item) =>
        item.id !== CATEGORY_MODIFIER_ITEM_ID &&
        item.id !== CRAFT_ITEM_ID &&
        item.id !== CREATIVE_ITEM_ID &&
        item.id !== EVOLVE_ITEM_ID &&
        item.id !== POP_CULTURE_ITEM_ID &&
        item.id !== SPLIT_ITEM_ID &&
        item.id !== OPPOSITE_ITEM_ID &&
        item.id !== WORD_COMBINE_ITEM_ID
    );
    const effectiveInputItems = selectedNodes
      .filter((node) => node.nodeId !== categoryAnchor?.nodeId)
      .map((node) => findItemById(node.itemId))
      .filter(
        (item): item is Item =>
          !!item &&
          item.id !== CATEGORY_MODIFIER_ITEM_ID &&
          item.id !== CRAFT_ITEM_ID &&
          item.id !== CREATIVE_ITEM_ID &&
          item.id !== EVOLVE_ITEM_ID &&
          item.id !== POP_CULTURE_ITEM_ID &&
          item.id !== SPLIT_ITEM_ID &&
          item.id !== OPPOSITE_ITEM_ID &&
          item.id !== WORD_COMBINE_ITEM_ID
      );
    const catalystLabel = hasCraftCatalyst
      ? "Craft"
      : hasCreativeCatalyst
        ? "Creative Spark"
      : hasEvolveCatalyst
        ? "Evolve"
      : hasPopCultureCatalyst
        ? "Pop Culture"
      : hasSplitCatalyst
        ? "Split"
      : hasOppositeCatalyst
        ? "Opposite"
      : categoryAnchor
        ? "Category"
      : hasWordCombineCatalyst
        ? "Compound"
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
      !hasCreativeCatalyst &&
      !hasEvolveCatalyst &&
      !hasPopCultureCatalyst &&
      !hasSplitCatalyst &&
      !hasOppositeCatalyst &&
      !categoryAnchor &&
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
        crafting: hasCraftCatalyst,
        creative: hasCreativeCatalyst,
        evolve: hasEvolveCatalyst,
        popCulture: hasPopCultureCatalyst,
        subtractive: hasSplitCatalyst,
        opposite: hasOppositeCatalyst,
        categoryConstraint: categoryAnchor?.categoryConstraintName ?? undefined,
        wordCombine: hasWordCombineCatalyst,
        model: selectedModel,
      });

      const producedItems =
        recipe.resultElements && recipe.resultElements.length > 0
          ? recipe.resultElements
          : recipe.resultElement
            ? [recipe.resultElement]
            : [];

      if (producedItems.length === 0) {
        showError("Combine returned no result item.", null);
        return false;
      }

      setItems((prev) => {
        const next = [...prev];
        for (const producedItem of producedItems) {
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
      <div className="app-root">
        <aside className="sidebar">
          <ElementSidebar
            items={items}
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onLibraryReset={handleLibraryReset}
            onItemsLoaded={setItems}
            randomUnlocked={isFeatureUnlocked("random_tools")}
          />
        </aside>

        <main className="main-area">
          <section className="workspace-layout">
            <div className="graph-wrapper">
              <div className="graph-header">
                <h2 className="section-title">Crafting workspace</h2>
                <div className="graph-header-actions">
                  <p className="section-help">
                    Click library items to add them, then pan, zoom, and move them around.
                  </p>
                  <a className="button graph-link-button" href="/cache">
                    View Cache
                  </a>
                  <a className="button graph-link-button" href="/clusters">
                    View Clusters
                  </a>
                  <button
                    type="button"
                    className={`admin-toggle-button${forceUnlocks ? " active" : ""}`}
                    onClick={() => setForceUnlocks((prev) => !prev)}
                    aria-pressed={forceUnlocks}
                    title="Force unlock hidden feature buttons for testing"
                  >
                    Admin
                  </button>
                  <div className="model-selector" role="group" aria-label="AI model">
                    {AI_MODELS.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className={`model-button ${
                          selectedModel === model ? "active" : ""
                        }`}
                        onClick={() => setSelectedModel(model)}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="journal-summary-strip">
                <button
                  type="button"
                  className={`journal-summary-card${isQuestCelebrating ? " is-celebrating" : ""}`}
                  onClick={() => openJournal("achievements")}
                  aria-expanded={isJournalOpen && journalTab === "achievements"}
                  aria-label="Open achievements journal"
                >
                  <span className="journal-summary-card-kicker">Achievements</span>
                  <span className="journal-summary-card-value">
                    {achievementSummary.earnedPoints} points
                  </span>
                  <span className="journal-summary-card-meta">
                    {achievementSummary.completedCount}/{achievementSummary.totalCount} earned
                  </span>
                  <span className="journal-summary-card-copy">
                    {featuredAchievement
                      ? `${featuredAchievement.title} • ${featuredAchievement.progressCurrent}/${featuredAchievement.progressTarget}`
                      : "Every visible achievement in this set is complete."}
                  </span>
                </button>
                <button
                  type="button"
                  className="journal-summary-card journal-summary-card-secondary"
                  onClick={() => openJournal("quests")}
                  aria-expanded={isJournalOpen && journalTab === "quests"}
                  aria-label="Open catalyst quests"
                >
                  <span className="journal-summary-card-kicker">Quests</span>
                  <span className="journal-summary-card-value">
                    {unlockedCatalystCount}/{catalystUnlockQuests.length} catalysts
                  </span>
                  <span className="journal-summary-card-meta">
                    {nextLockedCatalyst ? "Next unlock" : "All catalysts unlocked"}
                  </span>
                  <span className="journal-summary-card-copy">
                    {nextLockedCatalyst
                      ? `${nextLockedCatalyst.display.name} • ${nextLockedCatalyst.exampleWords
                          .slice(0, 2)
                          .join(", ")}`
                      : "Your full catalyst kit is available in the workspace."}
                  </span>
                </button>
                {questCelebration ? (
                  <div className="quest-hub-celebration" aria-live="polite">
                    {questCelebration.title}
                  </div>
                ) : null}
              </div>
              <div className="graph-canvas">
                <GraphView
                  items={items}
                  workspaceItems={workspaceItems}
                  celebratedNodeId={celebratedQuestNodeId}
                  onAttachCategoryModifier={attachCategoryModifier}
                  onWorkspaceItemsChange={setWorkspaceItems}
                  onViewportCenterChange={setViewportCenter}
                  combiningNodeIds={combiningNodeIds}
                  onClearCategoryModifier={clearCategoryModifier}
                  onClearWorkspace={clearWorkspaceItems}
                  onCombineWorkspaceItems={combineWorkspaceItems}
                  onCombineWorkspaceSelection={combineWorkspaceSelection}
                  onOpenItemDetails={openItemDetails}
                  catalystActions={catalystActions}
                />
              </div>
            </div>
              <aside className={`journal-dock${isJournalOpen ? "" : " is-collapsed"}`}>
                {isJournalOpen ? (
                <div className="journal-dock-shell">
              {rightPanelMode === "item" && drawerItem ? (
                <ItemDetailsDrawer
                  item={drawerItem}
                  itemsById={itemById}
                  canGoBack={drawerHistory.length > 0}
                  onBack={goBackInItemDetails}
                  onClose={closeItemDetails}
                  onSelectItem={openItemDetails}
                  embedded
                />
              ) : (
                <>
              <div className="quest-drawer-header">
                <div className="journal-dock-header-row">
                  <div>
                    <div className="quest-drawer-title">Journal</div>
                    <div className="quest-drawer-subtitle">
                      Permanent achievements and catalyst unlock quests.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="journal-dock-collapse"
                    onClick={() => setIsJournalOpen(false)}
                    aria-label="Collapse journal"
                    title="Collapse journal"
                  >
                    <PanelRightClose size={16} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="journal-tab-row" role="tablist" aria-label="Journal sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={journalTab === "achievements"}
                  className={`journal-tab${
                    journalTab === "achievements" ? " is-active" : ""
                  }`}
                  onClick={() => setJournalTab("achievements")}
                >
                  Achievements
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={journalTab === "quests"}
                  className={`journal-tab${journalTab === "quests" ? " is-active" : ""}`}
                  onClick={() => setJournalTab("quests")}
                >
                  Quests
                </button>
              </div>
              {journalTab === "achievements" ? (
                <div className="quest-card-list">
                  <article className="quest-card achievement-overview-card">
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">Achievement Points</div>
                        <div className="quest-card-description">
                          Curated long-term goals with permanent progress across the library.
                        </div>
                      </div>
                      <span className="quest-card-badge is-tracked">
                        {achievementSummary.earnedPoints} pts
                      </span>
                    </div>
                    <div className="achievement-overview-stats">
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.completedCount}
                        </span>
                        <span className="achievement-overview-stat-label">earned</span>
                      </div>
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.totalCount - achievementSummary.completedCount}
                        </span>
                        <span className="achievement-overview-stat-label">remaining</span>
                      </div>
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.totalPoints}
                        </span>
                        <span className="achievement-overview-stat-label">total points</span>
                      </div>
                    </div>
                    {achievementSummary.featuredProgress.length > 0 ? (
                      <div className="achievement-feature-list">
                        {achievementSummary.featuredProgress.map((achievement) => (
                          <div
                            key={achievement.id}
                            className="achievement-feature-chip"
                          >
                            <span>{achievement.title}</span>
                            <span>
                              {achievement.progressCurrent}/{achievement.progressTarget}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                  {achievementSummary.categories.map((category) => (
                    <section key={category.id} className="achievement-category">
                      <div className="achievement-category-header">
                        <div>
                          <div className="quest-section-title">{category.title}</div>
                          <div className="quest-section-subtitle">{category.summary}</div>
                        </div>
                        <div className="achievement-category-stats">
                          <span className="quest-card-badge">
                            {category.completedCount}/{category.totalCount}
                          </span>
                          <span className="quest-card-badge is-tracked">
                            {category.earnedPoints}/{category.totalPoints} pts
                          </span>
                        </div>
                      </div>
                      <div className="achievement-group-list">
                        {category.groups.map((group) => (
                          <article key={group.id} className="achievement-group">
                            <div className="achievement-group-header">
                              <div>
                                <div className="quest-card-title">{group.title}</div>
                                <div className="quest-card-description">{group.summary}</div>
                              </div>
                              <span className="quest-card-badge">
                                {group.completedCount}/{group.totalCount}
                              </span>
                            </div>
                            <div className="achievement-row-list">
                              {group.achievements.map((achievement) => {
                                const achievementReference =
                                  achievementReferences[achievement.id];
                                const progressRatio =
                                  achievement.progressTarget > 0
                                    ? achievement.progressCurrent / achievement.progressTarget
                                    : 0;
                                return (
                                  <div
                                    key={achievement.id}
                                    className={`achievement-row${
                                      achievement.completed ? " is-complete" : ""
                                    }`}
                                  >
                                    <div className="achievement-row-main">
                                      <div className="achievement-row-copy">
                                        <div className="achievement-row-title">
                                          {achievement.title}
                                        </div>
                                        <div className="achievement-row-description">
                                          {achievementReference === undefined
                                            ? "Loading reference..."
                                            : achievementReference?.summary
                                              ? truncateAchievementReference(
                                                  achievementReference.summary,
                                                  ACHIEVEMENT_REFERENCE_PREVIEW_LIMIT
                                                )
                                              : achievement.description}
                                        </div>
                                      </div>
                                      <div className="achievement-row-meta">
                                        <span
                                          className={`quest-card-badge${
                                            achievement.completed ? " is-complete" : ""
                                          }`}
                                        >
                                          {achievement.completed
                                            ? "Complete"
                                            : `${achievement.progressCurrent}/${achievement.progressTarget}`}
                                        </span>
                                        <span className="achievement-row-points">
                                          {achievement.points} pts
                                        </span>
                                      </div>
                                    </div>
                                    {achievementReference?.sourceUrl ? (
                                      <div className="achievement-row-link">
                                        <a
                                          className="item-drawer-link"
                                          href={achievementReference.sourceUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Open Wikipedia article
                                        </a>
                                      </div>
                                    ) : null}
                                    <div className="achievement-progress-bar">
                                      <span
                                        className="achievement-progress-bar-fill"
                                        style={{
                                          width: `${Math.max(
                                            0,
                                            Math.min(progressRatio, 1)
                                          ) * 100}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="quest-section">
                  <div className="quest-section-header">
                    <div className="quest-section-title">Catalyst Unlock Quests</div>
                    <div className="quest-section-subtitle">
                      Permanent mechanic unlocks that expand the workspace.
                    </div>
                  </div>
                  <article className="quest-card quest-card-featured">
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">Catalyst Progress</div>
                        <div className="quest-card-description">
                          Quests are now reserved for unlocking new catalysts and expanding what
                          the workspace can do.
                        </div>
                      </div>
                      <span className="quest-card-badge is-tracked">
                        {unlockedCatalystCount}/{catalystUnlockQuests.length}
                      </span>
                    </div>
                    <div className="quest-card-criteria">
                      {nextLockedCatalyst
                        ? `${nextLockedCatalyst.display.name} is your next unlock target.`
                        : "Every catalyst is unlocked."}
                    </div>
                  </article>
                  <div className="quest-card-list">
                    {catalystUnlockQuests.map((unlock) => {
                      const isNextLocked =
                        !unlock.unlocked && unlock.key === nextLockedCatalystKey;
                      return (
                        <article
                          key={unlock.key}
                          className={`quest-card quest-card-unlock ${unlock.display.accentClass}${
                            unlock.unlocked ? " is-complete" : ""
                          }${isNextLocked ? " is-featured-unlock" : ""}`}
                        >
                          <div className="quest-card-top">
                            <div className="quest-card-title-wrap">
                              <span className="quest-card-icon" aria-hidden="true">
                                {unlock.display.icon}
                              </span>
                              <div>
                                <div className="quest-card-title">{unlock.display.name}</div>
                                <div className="quest-card-description">
                                  {unlock.display.shortCopy}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`quest-card-badge ${
                                unlock.unlocked
                                  ? "is-complete"
                                  : isNextLocked
                                    ? "is-tracked"
                                    : "is-available"
                              }`}
                            >
                              {unlock.unlocked
                                ? "Unlocked"
                                : isNextLocked
                                  ? "Next"
                                  : "Locked"}
                            </span>
                          </div>
                          <div className="quest-card-criteria">{unlock.summary}</div>
                          <div className="quest-card-meta">
                            Example unlock words: {unlock.exampleWords.join(", ")}
                          </div>
                          {unlock.sourceItemName ? (
                            <div className="quest-card-meta">
                              Unlocked by discovering <strong>{unlock.sourceItemName}</strong>
                              {unlock.sourceMatchedWord &&
                              unlock.sourceMatchedWord.toLowerCase() !==
                                unlock.sourceItemName.toLowerCase()
                                ? `, which matched "${unlock.sourceMatchedWord}".`
                                : "."}
                            </div>
                          ) : !unlock.unlocked ? (
                            <div className="quest-card-meta">
                              This catalyst is still locked. Discover related concepts to reveal it.
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
                </>
              )}
            </div>
                ) : null}
              </aside>
          </section>
        </main>
      </div>
    </>
  );
};

export default App;
