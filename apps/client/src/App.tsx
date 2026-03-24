import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  Tags,
} from "lucide-react";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM_ID,
} from "./types";
import type {
  AchievementSummary,
  AutoUnlockedActionWord,
  AiModel,
  FeatureUnlockStatus,
  Item,
  SelectionCombineLayout,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import JournalDock from "./components/Journal/JournalDock";
import JournalSummaryStrip from "./components/Journal/JournalSummaryStrip";
import { evaluateAchievements } from "./lib/achievements";
import {
  combineElements,
  fetchQuestTargetReference,
  fetchUnlockStatuses,
  markUnlockIntroSeen,
  type ItemReference,
} from "./lib/api";
import {
  NON_INGREDIENT_ITEM_IDS,
  SPECIAL_ITEM_BY_ID,
  SPECIAL_ITEMS,
} from "./lib/specialItems";

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

type ActionUnlockModalState = {
  unlockedWords: AutoUnlockedActionWord[];
};

const VISIBLE_UNLOCK_KEYS: UnlockKey[] = ["random_tools"];

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
    shortCopy: "Pushes combinations toward sillier, wilder, more memorable ideas.",
  },
  random_tools: {
    name: "Random",
    icon: "🔀",
    accentClass: "is-randomize",
    shortCopy: "Lets you drop a random discovered library item into the workspace.",
  },
  action: {
    name: "Action",
    icon: "⚡",
    accentClass: "is-action",
    shortCopy: "Adds a modifier token that turns another item into an action anchor.",
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
  const [actionUnlockModal, setActionUnlockModal] = useState<ActionUnlockModalState | null>(
    null
  );
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
    const pendingUnlock = featureUnlocks.find(
      (unlock) => unlock.introPending && VISIBLE_UNLOCK_KEYS.includes(unlock.key)
    );
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
      newestDiscoveredItem != null
        ? [...workspaceItems]
            .reverse()
            .find((workspaceItem) => workspaceItem.itemId === newestDiscoveredItem.id)?.nodeId ?? null
        : drawerItemId == null
          ? null
          : [...workspaceItems]
              .reverse()
              .find((workspaceItem) => workspaceItem.itemId === drawerItemId)?.nodeId ?? null;

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
  }, [achievementSummary, drawerItemId, items, workspaceItems]);

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
      featureUnlocks
        .filter((unlock) => VISIBLE_UNLOCK_KEYS.includes(unlock.key))
        .map((unlock) => ({
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
    for (const item of SPECIAL_ITEMS) {
      next.set(item.id, item);
    }
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
      onClick: () => {
        addItemToWorkspace(ACTION_MODIFIER_ITEM_ID);
        const actionItem = findItemById(ACTION_MODIFIER_ITEM_ID);
        if (actionItem) {
          openItemDetails(actionItem);
        }
      },
    });

    return actions;
  }, [viewportCenter, items]);

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
    const categoryAnchors = selectedNodes.filter(
      (node) => node.categoryConstraintName && node.categoryConstraintNormalizedName
    );
    const actionAnchors = selectedNodes.filter(
      (node) => node.actionConstraintName && node.actionConstraintNormalizedName
    );
    const activeCatalystCount = [hasCreativeCatalyst].filter(Boolean).length;
    if (activeCatalystCount > 1) {
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
    const catalystLabel = hasCreativeCatalyst
      ? "Creative Spark"
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
      !hasCreativeCatalyst &&
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
        creative: hasCreativeCatalyst,
        categoryConstraint: categoryAnchor?.categoryConstraintName ?? undefined,
        actionConstraint: actionAnchor?.actionConstraintName ?? undefined,
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
                  <a className="button graph-link-button" href="/prompts">
                    Prompt Lab
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
              <JournalSummaryStrip
                achievementSummary={achievementSummary}
                catalystUnlockQuests={catalystUnlockQuests}
                unlockedCatalystCount={unlockedCatalystCount}
                isQuestCelebrating={isQuestCelebrating}
                isJournalOpen={isJournalOpen}
                journalTab={journalTab}
                questCelebrationTitle={questCelebration?.title ?? null}
                onOpenJournal={openJournal}
              />
              <div className="graph-canvas">
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
                isOpen={isJournalOpen}
                mode={rightPanelMode}
                journalTab={journalTab}
                achievementSummary={achievementSummary}
                achievementReferences={achievementReferences}
                achievementReferencePreviewLimit={ACHIEVEMENT_REFERENCE_PREVIEW_LIMIT}
                catalystUnlockQuests={catalystUnlockQuests}
                nextLockedCatalystKey={nextLockedCatalystKey}
                nextLockedCatalyst={nextLockedCatalyst}
                unlockedCatalystCount={unlockedCatalystCount}
                item={drawerItem}
                items={items}
                itemsById={itemById}
                canGoBack={drawerHistory.length > 0}
                onBack={goBackInItemDetails}
                onAddItemToWorkspace={addLibraryItemToWorkspace}
                onAddItemToWorkspaceAsActionAnchor={addLibraryItemToWorkspaceAsActionAnchor}
                onCloseItem={closeItemDetails}
                onSelectItem={openItemDetails}
                onCollapse={() => setIsJournalOpen(false)}
                onSetJournalTab={setJournalTab}
                truncateAchievementReference={truncateAchievementReference}
              />
          </section>
        </main>
      </div>
    </>
  );
};

export default App;
