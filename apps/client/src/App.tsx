import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Shuffle,
  Hammer,
  Sparkles,
  TrendingUp,
  Theater,
  Link2,
  Split,
  ArrowLeftRight,
} from "lucide-react";
import {
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
  RANDOMIZE_ITEM,
  RANDOMIZE_ITEM_ID,
  SPLIT_ITEM,
  SPLIT_ITEM_ID,
  WORD_COMBINE_ITEM,
  WORD_COMBINE_ITEM_ID,
} from "./types";
import type {
  AiModel,
  FeatureUnlockStatus,
  Item,
  SelectionCombineLayout,
  TargetQuestList,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import ItemDetailsDrawer from "./components/Graph/ItemDetailsDrawer";
import {
  combineElements,
  fetchUnlockStatuses,
  fetchQuestTargetReference,
  generateTargetQuests,
  markUnlockIntroSeen,
} from "./lib/api";

const AI_MODELS: AiModel[] = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const TARGET_QUEST_LIST_STORAGE_KEY = "wordweave.target-quest-list";
const TRACKED_TARGET_QUEST_STORAGE_KEY = "wordweave.tracked-target-quest";
const WORKSPACE_STORAGE_KEY = "wordweave.workspace-items";
const TOAST_DURATION_MS = 3500;
const ITEM_DRAWER_EXIT_MS = 220;
const QUEST_CELEBRATION_DURATION_MS = 2600;

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

const loadStoredTargetQuestList = (): TargetQuestList | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const storedQuestList = window.localStorage.getItem(TARGET_QUEST_LIST_STORAGE_KEY);
  if (!storedQuestList) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedQuestList) as TargetQuestList;
    if (!parsed || !Array.isArray(parsed.quests)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const loadStoredTrackedTargetQuestKey = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTrackedQuest = window.localStorage.getItem(
    TRACKED_TARGET_QUEST_STORAGE_KEY
  );
  return storedTrackedQuest?.trim() || null;
};

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
  const [targetQuestList, setTargetQuestList] = useState<TargetQuestList | null>(
    loadStoredTargetQuestList
  );
  const [trackedTargetQuestKey, setTrackedTargetQuestKey] = useState<string | null>(
    loadStoredTrackedTargetQuestKey
  );
  const [isQuestDrawerOpen, setIsQuestDrawerOpen] = useState(false);
  const [isGeneratingTargetQuests, setIsGeneratingTargetQuests] = useState(false);
  const [targetQuestError, setTargetQuestError] = useState<string | null>(null);
  const [trackedQuestDescription, setTrackedQuestDescription] = useState<string | null>(null);
  const [trackedQuestUrl, setTrackedQuestUrl] = useState<string | null>(null);
  const [isLoadingTrackedQuestReference, setIsLoadingTrackedQuestReference] =
    useState(false);
  const [questCelebrationText, setQuestCelebrationText] = useState<string | null>(null);
  const [isQuestCelebrating, setIsQuestCelebrating] = useState(false);
  const [celebratedQuestNodeId, setCelebratedQuestNodeId] = useState<string | null>(null);
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<number[]>([]);
  const [renderedDrawerItemId, setRenderedDrawerItemId] = useState<number | null>(null);
  const [isDrawerClosing, setIsDrawerClosing] = useState(false);
  const lastCelebratedQuestKeyRef = useRef<string | null>(null);
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
    if (!trackedTargetQuestKey) {
      window.localStorage.removeItem(TRACKED_TARGET_QUEST_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(TRACKED_TARGET_QUEST_STORAGE_KEY, trackedTargetQuestKey);
  }, [trackedTargetQuestKey]);

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
  }, [items]);

  const pendingUnlockIntro =
    featureUnlocks.find((unlock) => unlock.introPending) ?? null;

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

  async function loadTargetQuestList() {
    try {
      setIsGeneratingTargetQuests(true);
      setTargetQuestError(null);
      const next = await generateTargetQuests({ count: 4 });
      setTargetQuestList(next);
      setTrackedTargetQuestKey((current) =>
        current && next.quests.some((quest) => quest.normalizedTarget === current)
          ? current
          : next.quests[0]?.normalizedTarget ?? null
      );
    } catch (err) {
      setTargetQuestError(
        err instanceof Error ? err.message : "Failed to generate target quests."
      );
    } finally {
      setIsGeneratingTargetQuests(false);
    }
  }

  function isFeatureUnlocked(key: UnlockKey) {
    if (forceUnlocks) return true;
    return featureUnlocks.some((unlock) => unlock.key === key && unlock.unlocked);
  }

  const quests = useMemo(
    () =>
      (targetQuestList?.quests ?? []).map((quest) => ({
        ...quest,
        completed: items.some(
          (item) => item.normalizedName === quest.normalizedTarget
        ),
      })),
    [items, targetQuestList]
  );

  useEffect(() => {
    if (trackedTargetQuestKey && quests.some((quest) => quest.normalizedTarget === trackedTargetQuestKey)) {
      return;
    }
    setTrackedTargetQuestKey(quests[0]?.normalizedTarget ?? null);
  }, [quests, trackedTargetQuestKey]);

  const trackedQuest =
    quests.find((quest) => quest.normalizedTarget === trackedTargetQuestKey) ??
    quests[0] ??
    null;

  const trackedQuestCompletionKey = trackedQuest?.completed
    ? trackedQuest.normalizedTarget
    : null;
  const trackedQuestWorkspaceNodeId = useMemo(() => {
    if (!trackedQuest) {
      return null;
    }
    const trackedItemId =
      items.find((item) => item.normalizedName === trackedQuest.normalizedTarget)?.id ?? null;
    if (trackedItemId == null) {
      return null;
    }
    return (
      [...workspaceItems]
        .reverse()
        .find((workspaceItem) => workspaceItem.itemId === trackedItemId)?.nodeId ?? null
    );
  }, [items, trackedQuest, workspaceItems]);

  function trackNextAvailableQuest() {
    if (!trackedQuest) {
      setTrackedTargetQuestKey(quests[0]?.normalizedTarget ?? null);
      return;
    }

    const nextQuest =
      quests.find(
        (quest) =>
          !quest.completed &&
          quest.normalizedTarget !== trackedQuest.normalizedTarget
      ) ?? null;

    setTrackedTargetQuestKey(nextQuest?.normalizedTarget ?? null);
  }

  function showQuestCelebration(text: string, nodeId: string | null) {
    if (celebrationTimeoutRef.current != null) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    setQuestCelebrationText(text);
    setIsQuestCelebrating(true);
    setCelebratedQuestNodeId(nodeId);
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setIsQuestCelebrating(false);
      setQuestCelebrationText(null);
      setCelebratedQuestNodeId(null);
      celebrationTimeoutRef.current = null;
    }, QUEST_CELEBRATION_DURATION_MS);
  }

  useEffect(() => {
    let cancelled = false;

    if (!trackedQuest) {
      setTrackedQuestDescription(null);
      setTrackedQuestUrl(null);
      setIsLoadingTrackedQuestReference(false);
      return;
    }

    setIsLoadingTrackedQuestReference(true);
    setTrackedQuestDescription(null);
    setTrackedQuestUrl(null);
    void fetchQuestTargetReference(trackedQuest.target)
      .then((reference) => {
        if (cancelled) return;
        setTrackedQuestDescription(reference?.summary ?? null);
        setTrackedQuestUrl(reference?.sourceUrl ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setTrackedQuestDescription(null);
        setTrackedQuestUrl(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingTrackedQuestReference(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trackedQuest]);

  useEffect(() => {
    if (!trackedQuestCompletionKey || !trackedQuest) {
      lastCelebratedQuestKeyRef.current = null;
      return;
    }
    if (lastCelebratedQuestKeyRef.current === trackedQuestCompletionKey) {
      return;
    }
    lastCelebratedQuestKeyRef.current = trackedQuestCompletionKey;
    showQuestCelebration(`Target complete: ${trackedQuest.target}`, trackedQuestWorkspaceNodeId);
  }, [trackedQuest?.target, trackedQuestCompletionKey, trackedQuestWorkspaceNodeId]);

  useEffect(
    () => () => {
      if (celebrationTimeoutRef.current != null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!targetQuestList) {
      window.localStorage.removeItem(TARGET_QUEST_LIST_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      TARGET_QUEST_LIST_STORAGE_KEY,
      JSON.stringify(targetQuestList)
    );
  }, [targetQuestList]);
  const itemById = useMemo(() => {
    const next = new Map(items.map((item) => [item.id, item]));
    next.set(CRAFT_ITEM.id, CRAFT_ITEM);
    next.set(CREATIVE_ITEM.id, CREATIVE_ITEM);
    next.set(EVOLVE_ITEM.id, EVOLVE_ITEM);
    next.set(POP_CULTURE_ITEM.id, POP_CULTURE_ITEM);
    next.set(SPLIT_ITEM.id, SPLIT_ITEM);
    next.set(OPPOSITE_ITEM.id, OPPOSITE_ITEM);
    next.set(RANDOMIZE_ITEM.id, RANDOMIZE_ITEM);
    next.set(WORD_COMBINE_ITEM.id, WORD_COMBINE_ITEM);
    return next;
  }, [items]);
  const drawerItem = drawerItemId == null ? null : itemById.get(drawerItemId) ?? null;
  const renderedDrawerItem =
    renderedDrawerItemId == null ? null : itemById.get(renderedDrawerItemId) ?? null;
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
        key: "randomize",
        title: "Randomize",
        icon: <Shuffle size={16} strokeWidth={2} />,
        tint: "rgba(16, 185, 129, 0.22)",
        iconTint: "#a7f3d0",
        onClick: () => addItemToWorkspace(RANDOMIZE_ITEM_ID),
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

  useEffect(() => {
    if (drawerItemId == null) {
      return;
    }
    setRenderedDrawerItemId(drawerItemId);
    setIsDrawerClosing(false);
  }, [drawerItemId]);

  useEffect(() => {
    if (!isDrawerClosing) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setIsDrawerClosing(false);
      setRenderedDrawerItemId(null);
    }, ITEM_DRAWER_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isDrawerClosing]);

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    if (itemId === CRAFT_ITEM_ID) return CRAFT_ITEM;
    if (itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID) {
      return COMBINE_RESULT_PLACEHOLDER_ITEM;
    }
    if (itemId === CREATIVE_ITEM_ID) return CREATIVE_ITEM;
    if (itemId === EVOLVE_ITEM_ID) return EVOLVE_ITEM;
    if (itemId === POP_CULTURE_ITEM_ID) return POP_CULTURE_ITEM;
    if (itemId === SPLIT_ITEM_ID) return SPLIT_ITEM;
    if (itemId === OPPOSITE_ITEM_ID) return OPPOSITE_ITEM;
    if (itemId === RANDOMIZE_ITEM_ID) return RANDOMIZE_ITEM;
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

  function openItemDetails(item: Item) {
    setDrawerItemId((current) => {
      if (current === item.id) {
        return current;
      }
      setDrawerHistory((history) =>
        current == null ? [] : [...history, current]
      );
      return item.id;
    });
  }

  function closeItemDetails() {
    setDrawerItemId(null);
    setDrawerHistory([]);
    setIsDrawerClosing(true);
  }

  function goBackInItemDetails() {
    setDrawerHistory((history) => {
      const previousItemId = history[history.length - 1] ?? null;
      setDrawerItemId(previousItemId);
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
    const hasRandomizeCatalyst = selectedItems.some((item) => item.id === RANDOMIZE_ITEM_ID);
    const hasCraftCatalyst = selectedItems.some((item) => item.id === CRAFT_ITEM_ID);
    const hasWordCombineCatalyst = selectedItems.some(
      (item) => item.id === WORD_COMBINE_ITEM_ID
    );
    const activeCatalystCount = [
      hasCraftCatalyst,
      hasCreativeCatalyst,
      hasEvolveCatalyst,
      hasPopCultureCatalyst,
      hasSplitCatalyst,
      hasOppositeCatalyst,
      hasRandomizeCatalyst,
      hasWordCombineCatalyst,
    ].filter(Boolean).length;
    if (activeCatalystCount > 1) {
      showError("Use only one catalyst at a time.", null);
      return false;
    }
    const actualInputItems = selectedItems.filter(
      (item) =>
        item.id !== CRAFT_ITEM_ID &&
        item.id !== CREATIVE_ITEM_ID &&
        item.id !== EVOLVE_ITEM_ID &&
        item.id !== POP_CULTURE_ITEM_ID &&
        item.id !== SPLIT_ITEM_ID &&
        item.id !== OPPOSITE_ITEM_ID &&
        item.id !== RANDOMIZE_ITEM_ID &&
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
      : hasRandomizeCatalyst
        ? "Randomize"
      : hasWordCombineCatalyst
        ? "Compound"
        : null;
    if (actualInputItems.length === 0) {
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
      !hasRandomizeCatalyst &&
      actualInputItems.length < 2
    ) {
      return false;
    }

    const inputNames = actualInputItems.map((item) => item.name);

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
        randomize: hasRandomizeCatalyst,
        wordCombine: hasWordCombineCatalyst,
        model: selectedModel,
      });

      if (!recipe.resultElement) {
        showError("Combine returned no result item.", null);
        return false;
      }

      setItems((prev) => {
        const exists = prev.some((el) => el.id === recipe.resultElement!.id);
        if (exists) return prev;
        return [...prev, recipe.resultElement!];
      });
      const isNewDiscovery = !items.some((el) => el.id === recipe.resultElement!.id);

      if (selectionLayout) {
        setWorkspaceItems((prev) =>
          prev.map((node) => {
            const nextNode =
              node.nodeId === selectionLayout.placeholderNodeId
                ? {
                    ...node,
                    itemId: recipe.resultElement!.id,
                    isNewDiscovery,
                  }
                : node;
            return nextNode;
          })
        );
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
          return [
            ...withoutInputs,
            {
              nodeId: makeWorkspaceNodeId(),
              itemId: recipe.resultElement!.id,
              position: center,
              isNewDiscovery,
            },
          ];
        });
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
      {questCelebrationText ? (
        <div className="quest-complete-toast" aria-live="assertive" role="status">
          <div className="quest-complete-toast-kicker">Quest Complete</div>
          <div className="quest-complete-toast-title">{questCelebrationText}</div>
          <div className="quest-complete-toast-copy">
            Your tracked target has been discovered.
          </div>
        </div>
      ) : null}
      {pendingUnlockIntro ? (
        <div className="results-overlay" role="presentation">
          <div className="results-backdrop" />
          <div className="results-panel quest-complete-panel" role="dialog" aria-modal="true">
            <div className="results-header">
              <div>
                <h3 className="results-title">{pendingUnlockIntro.title}</h3>
                <p className="results-subtitle">{pendingUnlockIntro.summary}</p>
                {pendingUnlockIntro.sourceItemName ? (
                  <p className="results-subtitle">
                    Unlocked by discovering{" "}
                    <strong>{pendingUnlockIntro.sourceItemName}</strong>
                    {pendingUnlockIntro.sourceMatchedWord &&
                    pendingUnlockIntro.sourceMatchedWord.toLowerCase() !==
                      pendingUnlockIntro.sourceItemName.toLowerCase()
                      ? `, which matched "${pendingUnlockIntro.sourceMatchedWord}".`
                      : "."}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="button primary"
                onClick={async () => {
                  try {
                    await markUnlockIntroSeen(pendingUnlockIntro.key);
                    setFeatureUnlocks((prev) =>
                      prev.map((unlock) =>
                        unlock.key === pendingUnlockIntro.key
                          ? { ...unlock, introPending: false }
                          : unlock
                      )
                    );
                  } catch {
                  }
                }}
              >
                Continue
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
          <section className="graph-wrapper">
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
            <div className="quest-hub quest-hub-inline">
              <button
                type="button"
                className={`quest-hub-trigger${isQuestCelebrating ? " is-celebrating" : ""}`}
                onClick={() => setIsQuestDrawerOpen((prev) => !prev)}
                aria-expanded={isQuestDrawerOpen}
                aria-label="Open target quests"
              >
                <span
                  className={`quest-status-dot ${
                    trackedQuest?.completed ? "is-complete" : "is-active"
                  }`}
                  aria-hidden="true"
                />
                  <span className="quest-hub-label">Target</span>
                <span className="quest-hub-copy">
                  <span className="quest-hub-current">
                    {isGeneratingTargetQuests
                      ? "Generating targets..."
                      : targetQuestError
                        ? "Quest generation failed"
                        : trackedQuest?.completed
                          ? `${trackedQuest.target} complete`
                          : trackedQuest?.target ?? "Generate targets"}
                  </span>
                  {trackedQuest ? (
                    <span className="quest-hub-summary">
                      {trackedQuest.completed
                        ? "Target discovered. Choose another one when you're ready."
                        : isLoadingTrackedQuestReference
                          ? "Loading description..."
                          : trackedQuestDescription ?? trackedQuest.teaser}
                    </span>
                  ) : null}
                </span>
                <span className="quest-hub-chevron" aria-hidden="true">
                  {isQuestDrawerOpen ? "▴" : "▾"}
                </span>
              </button>
              {questCelebrationText ? (
                <div className="quest-hub-celebration" aria-live="polite">
                  {questCelebrationText}
                </div>
              ) : null}
            </div>
            <div className="graph-canvas">
              <GraphView
                items={items}
                workspaceItems={workspaceItems}
                celebratedNodeId={celebratedQuestNodeId}
                onWorkspaceItemsChange={setWorkspaceItems}
                onViewportCenterChange={setViewportCenter}
                combiningNodeIds={combiningNodeIds}
                onClearWorkspace={clearWorkspaceItems}
                onCombineWorkspaceItems={combineWorkspaceItems}
                onCombineWorkspaceSelection={combineWorkspaceSelection}
                onOpenItemDetails={openItemDetails}
                catalystActions={catalystActions}
              />
            </div>
          </section>
        </main>
      </div>
      {renderedDrawerItem ? (
        <ItemDetailsDrawer
          item={renderedDrawerItem}
          itemsById={itemById}
          canGoBack={drawerHistory.length > 0}
          isClosing={isDrawerClosing}
          onBack={goBackInItemDetails}
          onClose={closeItemDetails}
          onSelectItem={openItemDetails}
        />
      ) : null}
      {isQuestDrawerOpen ? (
        <div className="quest-popover-layer" role="presentation">
          <button
            type="button"
            className="quest-popover-backdrop"
            aria-label="Close target quests"
            onClick={() => setIsQuestDrawerOpen(false)}
          />
          <div className="quest-popover" role="dialog" aria-label="Target quests">
            <div className="quest-drawer-header">
              <div className="quest-drawer-title">Targets</div>
              <div className="quest-drawer-subtitle">
                AI-generated target terms to chase next. Generated with{" "}
                {targetQuestList?.model ?? "gpt-5-nano"}.
              </div>
              {targetQuestList?.cost ? (
                <div className="quest-drawer-subtitle">
                  Last generation cost about ${targetQuestList.cost.totalCostUsd.toFixed(5)}
                  {" "}using {targetQuestList.cost.promptTokens} prompt tokens and{" "}
                  {targetQuestList.cost.completionTokens} output tokens.
                </div>
              ) : null}
            </div>
            {trackedQuest ? (
              <article
                className={`quest-card quest-card-featured${
                  trackedQuest.completed ? " is-complete" : ""
                }`}
              >
                <div className="quest-card-top">
                  <div>
                    <div className="quest-card-title">{trackedQuest.target}</div>
                    <div className="quest-card-description">
                      {trackedQuest.completed
                        ? "You discovered this target. Pick another one to keep the run going."
                        : isLoadingTrackedQuestReference
                          ? "Loading target description..."
                          : trackedQuestDescription ?? trackedQuest.teaser}
                    </div>
                  </div>
                  <span
                    className={`quest-card-badge ${
                      trackedQuest.completed ? "is-complete" : "is-tracked"
                    }`}
                  >
                    {trackedQuest.completed ? "Complete" : trackedQuest.difficulty}
                  </span>
                </div>
                <div className="quest-card-criteria">{trackedQuest.flavor}</div>
                {trackedQuestUrl ? (
                  <div className="quest-card-link-row">
                    <a
                      className="item-drawer-link"
                      href={trackedQuestUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Wikipedia article
                    </a>
                  </div>
                ) : null}
                {trackedQuest.completed ? (
                  <div className="quest-card-actions quest-card-actions-complete">
                    <button
                      type="button"
                      className="button primary"
                      onClick={trackNextAvailableQuest}
                      disabled={!quests.some((quest) => !quest.completed)}
                    >
                      {quests.some((quest) => !quest.completed)
                        ? "Choose Next Target"
                        : "All Current Targets Complete"}
                    </button>
                  </div>
                ) : null}
              </article>
            ) : null}
            <div className="quest-card-actions quest-card-actions-top">
              <button
                type="button"
                className="button secondary"
                onClick={() => void loadTargetQuestList()}
                disabled={isGeneratingTargetQuests}
              >
                {isGeneratingTargetQuests ? "Generating..." : "Refresh Targets"}
              </button>
            </div>
            {targetQuestError ? (
              <div className="quest-card-list">
                <article className="quest-card">
                  <div className="quest-card-description">{targetQuestError}</div>
                </article>
              </div>
            ) : (
              <div className="quest-card-list">
                {quests.map((quest) => {
                  const isTracked =
                    trackedTargetQuestKey === quest.normalizedTarget;
                  return (
                    <article
                      key={quest.normalizedTarget}
                      className={`quest-card${quest.completed ? " is-complete" : ""}${
                        isTracked ? " is-tracked" : ""
                      }`}
                    >
                      <div className="quest-card-top">
                        <div>
                          <div className="quest-card-title">{quest.target}</div>
                          <div className="quest-card-description">{quest.teaser}</div>
                        </div>
                        <span
                          className={`quest-card-badge ${
                            quest.completed
                              ? "is-complete"
                              : isTracked
                                ? "is-tracked"
                                : "is-available"
                          }`}
                        >
                          {quest.completed
                            ? "Complete"
                            : isTracked
                              ? "Tracking"
                              : quest.difficulty}
                        </span>
                      </div>
                      <div className="quest-card-criteria">{quest.flavor}</div>
                      <div className="quest-card-actions">
                        {quest.completed ? (
                          <span className="quest-card-action-note">Completed</span>
                        ) : (
                          <button
                            type="button"
                            className={`button ${isTracked ? "secondary" : "primary"}`}
                            onClick={() => {
                              setTrackedTargetQuestKey(quest.normalizedTarget);
                              setIsQuestDrawerOpen(false);
                            }}
                          >
                            {isTracked ? "Tracking" : "Track"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default App;
