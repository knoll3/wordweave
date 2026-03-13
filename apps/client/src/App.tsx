import React, { useEffect, useState } from "react";
import {
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
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
  QuestLine,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import {
  combineElements,
  fetchUnlockStatuses,
  generateQuest,
  markUnlockIntroSeen,
} from "./lib/api";

const AI_MODELS: AiModel[] = ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";

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
  const [activeQuest, setActiveQuest] = useState<QuestLine | null>(null);
  const [isGeneratingQuest, setIsGeneratingQuest] = useState(false);
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [forceUnlocks, setForceUnlocks] = useState(false);
  const [dismissedCompletedQuestKey, setDismissedCompletedQuestKey] = useState<
    string | null
  >(null);
  const [isQuestExpanded, setIsQuestExpanded] = useState(false);

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
    void loadFeatureUnlocks();
  }, [items]);

  const hasCompletedActiveQuest =
    activeQuest != null &&
    items.some((item) => item.normalizedName === activeQuest.normalizedName);
  const showQuestCompleteModal =
    activeQuest != null &&
    hasCompletedActiveQuest &&
    dismissedCompletedQuestKey !== activeQuest.normalizedName;
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

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    if (itemId === CREATIVE_ITEM_ID) return CREATIVE_ITEM;
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

  async function handleGenerateQuest() {
    if (isGeneratingQuest) return;
    try {
      setIsGeneratingQuest(true);
      const quest = await generateQuest({
        discoveredItems: items.map((item) => item.name),
      });
      setActiveQuest(quest);
      setDismissedCompletedQuestKey(null);
      setIsQuestExpanded(false);
    } catch (err) {
      console.error("[quest] failed", err);
      showError("Failed to generate quest. Please try again.", err);
    } finally {
      setIsGeneratingQuest(false);
    }
  }

  function handleResetQuest() {
    setActiveQuest(null);
    setDismissedCompletedQuestKey(null);
    setIsQuestExpanded(false);
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
    const hasSplitCatalyst = selectedItems.some((item) => item.id === SPLIT_ITEM_ID);
    const hasOppositeCatalyst = selectedItems.some((item) => item.id === OPPOSITE_ITEM_ID);
    const hasRandomizeCatalyst = selectedItems.some((item) => item.id === RANDOMIZE_ITEM_ID);
    const activeCatalystCount = [
      hasCreativeCatalyst,
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
        item.id !== CREATIVE_ITEM_ID &&
        item.id !== SPLIT_ITEM_ID &&
        item.id !== OPPOSITE_ITEM_ID &&
        item.id !== RANDOMIZE_ITEM_ID
    );
    const catalystLabel = hasCreativeCatalyst
      ? "Creative Spark"
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
      creative: hasCreativeCatalyst,
      subtractive: hasSplitCatalyst,
      opposite: hasOppositeCatalyst,
      randomize: hasRandomizeCatalyst,
    });

    try {
      setIsCombining(true);
      setCombiningNodeIds(uniqueNodeIds);
      setConvergingNodeIds(options?.converge ? uniqueNodeIds : null);
      const recipe = await combineElements(inputNames, {
        creative: hasCreativeCatalyst,
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
      showError("Failed to combine items. Please try again.", err);
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
      {showQuestCompleteModal && activeQuest ? (
        <div className="results-overlay" role="presentation">
          <div
            className="results-backdrop"
            onClick={() => setDismissedCompletedQuestKey(activeQuest.normalizedName)}
          />
          <div className="results-panel quest-complete-panel" role="dialog" aria-modal="true">
            <div className="results-header">
              <div>
                <h3 className="results-title">Quest Complete</h3>
                <p className="results-subtitle">
                  You discovered <strong>{activeQuest.name}</strong>.
                </p>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => setDismissedCompletedQuestKey(activeQuest.normalizedName)}
              >
                Continue
              </button>
            </div>
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
            <div className="graph-canvas">
              <div className="quest-panel">
                <div className="quest-panel-header">
                  <div>
                    <div className="quest-panel-label">Quest</div>
                    <div className="quest-panel-target">
                      {activeQuest ? activeQuest.name : "No target set"}
                    </div>
                  </div>
                  {activeQuest ? (
                    <button
                      type="button"
                      className="quest-reset-button"
                      onClick={handleResetQuest}
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="button primary quest-generate-button"
                  disabled={isGeneratingQuest}
                  onClick={() => void handleGenerateQuest()}
                >
                  {isGeneratingQuest ? "Generating..." : "Generate Quest"}
                </button>
                {activeQuest?.steps.length ? (
                  <>
                    <button
                      type="button"
                      className="button secondary quest-expand-button"
                      onClick={() => setIsQuestExpanded((prev) => !prev)}
                    >
                      {isQuestExpanded ? "Hide Steps" : "Show Steps"}
                    </button>
                    {isQuestExpanded ? (
                      <ol className="quest-step-list">
                        {activeQuest.steps.map((step) => (
                          <li
                            key={`${step.recipeId}-${step.normalizedTarget}`}
                            className="quest-step-item"
                          >
                            <span className="quest-step-target">{step.target}</span>
                            <span className="quest-step-formula">
                              {step.inputs.join(" + ")}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </>
                ) : null}
                <div className="quest-panel-help">
                  {isGeneratingQuest
                    ? "Generating quest..."
                    : activeQuest
                      ? `${activeQuest.steps.length} steps from base elements to ${activeQuest.name}.`
                      : "Generate a cached quest path for testing."}
                </div>
              </div>
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
                creativeUnlocked={isFeatureUnlocked("creative")}
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
    </>
  );
};

export default App;
