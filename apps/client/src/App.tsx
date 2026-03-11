import React, { useState } from "react";
import type { Item, RecentRecipe, WorkspaceItem } from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import {
  combineElements,
  fetchRecentRecipes,
} from "./lib/api";

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [recentRecipes, setRecentRecipes] = useState<RecentRecipe[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [isCombining, setIsCombining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function showError(message: string, err: unknown) {
    console.error(message, err);
    setErrorMessage(message);
  }

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    return items.find((item) => item.id === itemId);
  }

  function addItemToWorkspace(
    itemId: number,
    position?: { x: number; y: number }
  ) {
    const item = findItemById(itemId);
    if (!item) return;
    const nextPosition =
      position ??
      ({
        x: 80 + Math.random() * 360,
        y: 80 + Math.random() * 260,
      } as const);

    setWorkspaceItems((prev) => [
      ...prev,
      {
        nodeId: makeWorkspaceNodeId(),
        itemId,
        position: { x: nextPosition.x, y: nextPosition.y },
      },
    ]);
  }

  async function combineWorkspaceItems(
    sourceNodeId: string,
    targetNodeId: string
  ) {
    if (isCombining) return;
    if (sourceNodeId === targetNodeId) return;

    const source = workspaceItems.find((n) => n.nodeId === sourceNodeId);
    const target = workspaceItems.find((n) => n.nodeId === targetNodeId);
    if (!source || !target) return;

    const sourceItem = findItemById(source.itemId);
    const targetItem = findItemById(target.itemId);
    if (!sourceItem || !targetItem) return;

    const inputNames = [sourceItem.name, targetItem.name];
    console.log("[combine] node overlap combine", {
      sourceNodeId,
      targetNodeId,
      inputs: inputNames,
    });

    try {
      setIsCombining(true);
      const recipe = await combineElements(inputNames);
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
      console.log("[combine] item added", recipe.resultElement);

      const center = {
        x: (source.position.x + target.position.x) / 2,
        y: (source.position.y + target.position.y) / 2,
      };

      setWorkspaceItems((prev) => {
        const withoutInputs = prev.filter(
          (node) =>
            node.nodeId !== sourceNodeId &&
            node.nodeId !== targetNodeId
        );
        return [
          ...withoutInputs,
          {
            nodeId: makeWorkspaceNodeId(),
            itemId: recipe.resultElement!.id,
            position: center,
          },
        ];
      });

      try {
        const updatedRecent = await fetchRecentRecipes();
        console.log("[combine] recent recipes refreshed", {
          count: updatedRecent.length,
        });
        setRecentRecipes(updatedRecent);
      } catch (err) {
        console.error("[combine] failed to refresh recent recipes", err);
        showError("Failed to refresh recent recipes.", err);
      }
    } catch (err) {
      console.error("[combine] failed", err);
      showError("Failed to combine items. Please try again.", err);
    } finally {
      setIsCombining(false);
      console.log("[combine] finished");
    }
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

      <div className="app-root">
        <aside className="sidebar">
          <ElementSidebar
            onAddItemToWorkspace={addItemToWorkspace}
            onItemsLoaded={setItems}
            onRecentLoaded={setRecentRecipes}
          />
        </aside>

        <main className="main-area">
          <section className="graph-wrapper">
            <div className="graph-header">
              <h2 className="section-title">Crafting workspace</h2>
              <p className="section-help">
                Drag items onto each other in the workspace to combine.
              </p>
            </div>
            <div className="graph-canvas">
              <GraphView
                items={items}
                workspaceItems={workspaceItems}
                onWorkspaceItemsChange={setWorkspaceItems}
                onAddItemToWorkspace={addItemToWorkspace}
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
