import React, { useEffect, useMemo, useState } from "react";
import {
  CRAFT_ITEM,
  CRAFT_ITEM_ID,
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
  EVOLVE_ITEM,
  EVOLVE_ITEM_ID,
  OPPOSITE_ITEM,
  OPPOSITE_ITEM_ID,
  RANDOMIZE_ITEM,
  RANDOMIZE_ITEM_ID,
  SPLIT_ITEM,
  SPLIT_ITEM_ID,
} from "./types";
import type {
  AiModel,
  FeatureUnlockStatus,
  Item,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import {
  combineElements,
  fetchUnlockStatuses,
  markUnlockIntroSeen,
} from "./lib/api";

const AI_MODELS: AiModel[] = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const TRACKED_QUEST_STORAGE_KEY = "wordweave.tracked-quest";
const TOAST_DURATION_MS = 3500;

const FEATURE_QUESTS: Array<{
  key: UnlockKey;
  title: string;
  description: string;
  criteria: string;
}> = [
  {
    key: "creative",
    title: "Unlock Creative Spark",
    description:
      "Gain the Creative Spark catalyst so you can push a combination toward a more imaginative result.",
    criteria:
      "Discover something close to ideas, inspiration, imagination, design, art, or creativity.",
  },
  {
    key: "split",
    title: "Unlock Split",
    description:
      "Gain the Split catalyst so you can remove one concept from another instead of combining them normally.",
    criteria:
      "Discover something close to split, divide, remove, subtract, difference, or separation.",
  },
  {
    key: "opposite",
    title: "Unlock Opposite",
    description:
      "Gain the Opposite catalyst so you can ask for the direct opposite of an input concept.",
    criteria:
      "Discover something close to opposite, reverse, inverse, contrast, or counterpart.",
  },
  {
    key: "random_tools",
    title: "Unlock Random Tools",
    description:
      "Gain the Random library action and the Randomize catalyst for chance-driven experimentation.",
    criteria:
      "Discover something close to random, chance, chaos, luck, surprise, shuffle, or entropy.",
  },
  {
    key: "craft",
    title: "Unlock Craft",
    description:
      "Gain the Craft catalyst so combinations can resolve as a physical built or manufactured result.",
    criteria:
      "Discover something close to craft, build, forge, tool, maker, workshop, or construction.",
  },
  {
    key: "evolve",
    title: "Unlock Evolve",
    description:
      "Gain the Evolve catalyst so a concept can advance into its next stronger, more developed form.",
    criteria:
      "Discover something close to evolution, progress, growth, upgrade, development, or transformation.",
  },
];

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [isCombining, setIsCombining] = useState(false);
  const [combiningNodeIds, setCombiningNodeIds] = useState<string[] | null>(null);
  const [convergingNodeIds, setConvergingNodeIds] = useState<string[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);
  const [viewportCenter, setViewportCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState<AiModel>("gpt-4.1-nano");
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [forceUnlocks, setForceUnlocks] = useState(false);
  const [trackedQuestKey, setTrackedQuestKey] = useState<UnlockKey | null>(null);
  const [isQuestDrawerOpen, setIsQuestDrawerOpen] = useState(false);

  useEffect(() => {
    const storedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (storedModel && AI_MODELS.includes(storedModel as AiModel)) {
      setSelectedModel(storedModel as AiModel);
    }
    setForceUnlocks(window.localStorage.getItem(FORCE_UNLOCKS_STORAGE_KEY) === "true");
    const storedTrackedQuest = window.localStorage.getItem(
      TRACKED_QUEST_STORAGE_KEY
    ) as UnlockKey | null;
    if (
      storedTrackedQuest &&
      FEATURE_QUESTS.some((quest) => quest.key === storedTrackedQuest)
    ) {
      setTrackedQuestKey(storedTrackedQuest);
    }
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
    if (!trackedQuestKey) return;
    window.localStorage.setItem(TRACKED_QUEST_STORAGE_KEY, trackedQuestKey);
  }, [trackedQuestKey]);

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
    console.error(message, err);
    setErrorMessage(message);
  }

  async function loadFeatureUnlocks() {
    try {
      const statuses = await fetchUnlockStatuses();
      setFeatureUnlocks(statuses);
    } catch (err) {
      console.error("Failed to load feature unlocks", err);
    }
  }

  function isFeatureUnlocked(key: UnlockKey) {
    if (forceUnlocks) return true;
    return featureUnlocks.some((unlock) => unlock.key === key && unlock.unlocked);
  }

  const quests = useMemo(
    () =>
      FEATURE_QUESTS.map((quest) => ({
        ...quest,
        completed: isFeatureUnlocked(quest.key),
      })),
    [featureUnlocks, forceUnlocks]
  );

  useEffect(() => {
    if (trackedQuestKey && quests.some((quest) => quest.key === trackedQuestKey)) {
      return;
    }
    const firstIncomplete = quests.find((quest) => !quest.completed) ?? quests[0] ?? null;
    setTrackedQuestKey(firstIncomplete?.key ?? null);
  }, [quests, trackedQuestKey]);

  const trackedQuest =
    quests.find((quest) => quest.key === trackedQuestKey) ?? quests[0] ?? null;

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    if (itemId === CRAFT_ITEM_ID) return CRAFT_ITEM;
    if (itemId === CREATIVE_ITEM_ID) return CREATIVE_ITEM;
    if (itemId === EVOLVE_ITEM_ID) return EVOLVE_ITEM;
    if (itemId === SPLIT_ITEM_ID) return SPLIT_ITEM;
    if (itemId === OPPOSITE_ITEM_ID) return OPPOSITE_ITEM;
    if (itemId === RANDOMIZE_ITEM_ID) return RANDOMIZE_ITEM;
    return items.find((item) => item.id === itemId);
  }

  function addItemToWorkspace(itemId: number, position?: { x: number; y: number }) {
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
      },
    ]);
  }

  function addLibraryItemToWorkspace(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );
    addItemToWorkspace(item.id);
  }

  function duplicateWorkspaceItem(nodeId: string, position?: { x: number; y: number }) {
    const source = workspaceItems.find((item) => item.nodeId === nodeId);
    if (!source) return;
    addItemToWorkspace(source.itemId, position);
  }

  function removeWorkspaceItem(nodeId: string) {
    setWorkspaceItems((prev) => prev.filter((item) => item.nodeId !== nodeId));
  }

  function clearWorkspaceItems() {
    setWorkspaceItems([]);
  }

  function handleLibraryReset() {
    setWorkspaceItems([]);
  }

  async function combineWorkspaceNodeIds(
    nodeIds: string[],
    options?: { converge?: boolean }
  ) {
    if (isCombining) return;
    const uniqueNodeIds = Array.from(new Set(nodeIds));
    if (uniqueNodeIds.length < 2) return;

    const selectedNodes = uniqueNodeIds
      .map((nodeId) => workspaceItems.find((n) => n.nodeId === nodeId))
      .filter(Boolean) as WorkspaceItem[];
    if (selectedNodes.length < 2) return;

    const selectedItems = selectedNodes
      .map((node) => findItemById(node.itemId))
      .filter(Boolean) as Item[];
    if (selectedItems.length < 2) return;

    const hasCreativeCatalyst = selectedItems.some((item) => item.id === CREATIVE_ITEM_ID);
    const hasEvolveCatalyst = selectedItems.some((item) => item.id === EVOLVE_ITEM_ID);
    const hasSplitCatalyst = selectedItems.some((item) => item.id === SPLIT_ITEM_ID);
    const hasOppositeCatalyst = selectedItems.some((item) => item.id === OPPOSITE_ITEM_ID);
    const hasRandomizeCatalyst = selectedItems.some((item) => item.id === RANDOMIZE_ITEM_ID);
    const hasCraftCatalyst = selectedItems.some((item) => item.id === CRAFT_ITEM_ID);
    const activeCatalystCount = [
      hasCraftCatalyst,
      hasCreativeCatalyst,
      hasEvolveCatalyst,
      hasSplitCatalyst,
      hasOppositeCatalyst,
      hasRandomizeCatalyst,
    ].filter(Boolean).length;
    if (activeCatalystCount > 1) {
      showError("Use only one catalyst at a time.", null);
      return;
    }
    const actualInputItems = selectedItems.filter(
      (item) =>
        item.id !== CRAFT_ITEM_ID &&
        item.id !== CREATIVE_ITEM_ID &&
        item.id !== EVOLVE_ITEM_ID &&
        item.id !== SPLIT_ITEM_ID &&
        item.id !== OPPOSITE_ITEM_ID &&
        item.id !== RANDOMIZE_ITEM_ID
    );
    const catalystLabel = hasCraftCatalyst
      ? "Craft"
      : hasCreativeCatalyst
        ? "Creative Spark"
        : hasEvolveCatalyst
          ? "Evolve"
          : hasSplitCatalyst
            ? "Split"
            : hasOppositeCatalyst
              ? "Opposite"
              : hasRandomizeCatalyst
                ? "Randomize"
                : null;
    if (actualInputItems.length === 0) {
      showError(
        catalystLabel
          ? `${catalystLabel} needs at least one regular item to combine.`
          : "No regular items selected.",
        null
      );
      return;
    }
    if (hasRandomizeCatalyst && actualInputItems.length !== 1) {
      showError("Randomize needs exactly one regular item to transform.", null);
      return;
    }
    if (
      !hasCreativeCatalyst &&
      !hasSplitCatalyst &&
      !hasOppositeCatalyst &&
      !hasRandomizeCatalyst &&
      actualInputItems.length < 2
    ) {
      return;
    }

    const inputNames = actualInputItems.map((item) => item.name);
    console.log("[combine] combine selected nodes", {
      nodeIds: uniqueNodeIds,
      inputs: inputNames,
      crafting: hasCraftCatalyst,
      creative: hasCreativeCatalyst,
      evolve: hasEvolveCatalyst,
      subtractive: hasSplitCatalyst,
      opposite: hasOppositeCatalyst,
      randomize: hasRandomizeCatalyst,
    });

    try {
      setIsCombining(true);
      setCombiningNodeIds(uniqueNodeIds);
      setConvergingNodeIds(options?.converge ? uniqueNodeIds : null);
      const recipe = await combineElements(inputNames, {
        crafting: hasCraftCatalyst,
        creative: hasCreativeCatalyst,
        evolve: hasEvolveCatalyst,
        subtractive: hasSplitCatalyst,
        opposite: hasOppositeCatalyst,
        randomize: hasRandomizeCatalyst,
        model: selectedModel,
      });
      console.log("[combine] recipe received", recipe);

      if (!recipe.resultElement) {
        console.warn("[combine] missing resultElement in response", recipe);
        showError("Combine returned no result item.", null);
        return;
      }

      setItems((prev) => {
        const exists = prev.some((el) => el.id === recipe.resultElement!.id);
        if (exists) return prev;
        return [...prev, recipe.resultElement!];
      });
      setLibraryRefreshToken((prev) => prev + 1);
      console.log("[combine] item added", recipe.resultElement);

      const centerSum = selectedNodes.reduce(
        (acc, node) => ({
          x: acc.x + node.position.x,
          y: acc.y + node.position.y,
        }),
        { x: 0, y: 0 }
      );
      const center = {
        x: centerSum.x / selectedNodes.length,
        y: centerSum.y / selectedNodes.length,
      };

      setWorkspaceItems((prev) => {
        const withoutInputs = prev.filter((node) => !uniqueNodeIds.includes(node.nodeId));
        return [
          ...withoutInputs,
          {
            nodeId: makeWorkspaceNodeId(),
            itemId: recipe.resultElement!.id,
            position: center,
          },
        ];
      });
    } catch (err) {
      console.error("[combine] failed", err);
      showError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to combine items. Please try again.",
        err
      );
    } finally {
      setIsCombining(false);
      setCombiningNodeIds(null);
      setConvergingNodeIds(null);
      console.log("[combine] finished");
    }
  }

  async function combineWorkspaceItems(sourceNodeId: string, targetNodeId: string) {
    if (sourceNodeId === targetNodeId) return;
    await combineWorkspaceNodeIds([sourceNodeId, targetNodeId], {
      converge: false,
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
                  } catch (err) {
                    console.error("Failed to mark unlock intro as seen", err);
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
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onLibraryReset={handleLibraryReset}
            refreshToken={libraryRefreshToken}
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
                  Drag items onto each other in the workspace to combine.
                </p>
                <a className="button graph-link-button" href="/cache">
                  View Cache
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
            {trackedQuest ? (
              <div className="quest-hub quest-hub-inline">
                <button
                  type="button"
                  className="quest-hub-trigger"
                  onClick={() => setIsQuestDrawerOpen((prev) => !prev)}
                  aria-expanded={isQuestDrawerOpen}
                  aria-label="Open quests"
                >
                  <span
                    className={`quest-status-dot ${
                      trackedQuest.completed ? "is-complete" : "is-active"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="quest-hub-label">Quest</span>
                  <span className="quest-hub-current">{trackedQuest.title}</span>
                  <span className="quest-hub-chevron" aria-hidden="true">
                    {isQuestDrawerOpen ? "▴" : "▾"}
                  </span>
                </button>
              </div>
            ) : null}
            <div className="graph-canvas">
              <GraphView
                items={items}
                workspaceItems={workspaceItems}
                onWorkspaceItemsChange={setWorkspaceItems}
                onViewportCenterChange={setViewportCenter}
                combiningNodeIds={combiningNodeIds}
                convergingNodeIds={convergingNodeIds}
                onClearWorkspace={clearWorkspaceItems}
                onRemoveWorkspaceItem={removeWorkspaceItem}
                onDuplicateWorkspaceItem={duplicateWorkspaceItem}
                onAddItemToWorkspace={addItemToWorkspace}
                craftUnlocked={isFeatureUnlocked("craft")}
                creativeUnlocked={isFeatureUnlocked("creative")}
                evolveUnlocked={isFeatureUnlocked("evolve")}
                splitUnlocked={isFeatureUnlocked("split")}
                oppositeUnlocked={isFeatureUnlocked("opposite")}
                randomizeUnlocked={isFeatureUnlocked("random_tools")}
                onCombineWorkspaceSelection={(nodeIds) =>
                  combineWorkspaceNodeIds(nodeIds, { converge: true })
                }
                onCombineWorkspaceItems={combineWorkspaceItems}
              />
            </div>
          </section>
        </main>
      </div>
      {isQuestDrawerOpen && trackedQuest ? (
        <div className="quest-popover-layer" role="presentation">
          <button
            type="button"
            className="quest-popover-backdrop"
            aria-label="Close quests"
            onClick={() => setIsQuestDrawerOpen(false)}
          />
          <div className="quest-popover" role="dialog" aria-label="Quests">
            <div className="quest-drawer-header">
              <div className="quest-drawer-title">Milestones</div>
              <div className="quest-drawer-subtitle">
                Track one quest here. All milestones still complete automatically in the background.
              </div>
            </div>
            <div className="quest-card-list">
              {quests.map((quest) => {
                const isTracked = trackedQuestKey === quest.key;
                return (
                  <article
                    key={quest.key}
                    className={`quest-card${quest.completed ? " is-complete" : ""}${
                      isTracked ? " is-tracked" : ""
                    }`}
                  >
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">{quest.title}</div>
                        <div className="quest-card-description">{quest.description}</div>
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
                            ? "Tracked"
                            : "Available"}
                      </span>
                    </div>
                    <div className="quest-card-criteria">{quest.criteria}</div>
                    <div className="quest-card-actions">
                      <button
                        type="button"
                        className={`button ${isTracked ? "secondary" : "primary"}`}
                        onClick={() => {
                          setTrackedQuestKey(quest.key);
                          setIsQuestDrawerOpen(false);
                        }}
                      >
                        {isTracked ? "Tracking" : "Track"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default App;
