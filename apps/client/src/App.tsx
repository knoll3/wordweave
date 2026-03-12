import React, { useState } from "react";
import { CREATIVE_ITEM, CREATIVE_ITEM_ID } from "./types";
import type { Item, WorkspaceItem } from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import GraphView from "./components/Graph/GraphView";
import {
  combineElements,
} from "./lib/api";

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

  function showError(message: string, err: unknown) {
    console.error(message, err);
    setErrorMessage(message);
  }

  function makeWorkspaceNodeId() {
    return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function findItemById(itemId: number) {
    if (itemId === CREATIVE_ITEM_ID) return CREATIVE_ITEM;
    return items.find((item) => item.id === itemId);
  }

  function addItemToWorkspace(
    itemId: number,
    position?: { x: number; y: number }
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
      },
    ]);
  }

  function duplicateWorkspaceItem(
    nodeId: string,
    position?: { x: number; y: number }
  ) {
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

    const hasCreativeCatalyst = selectedItems.some(
      (item) => item.id === CREATIVE_ITEM_ID
    );
    const actualInputItems = selectedItems.filter(
      (item) => item.id !== CREATIVE_ITEM_ID
    );
    if (actualInputItems.length === 0) {
      showError("Creative Spark needs at least one regular item to combine.", null);
      return;
    }
    if (!hasCreativeCatalyst && actualInputItems.length < 2) return;

    const inputNames = actualInputItems.map((item) => item.name);
    console.log("[combine] combine selected nodes", {
      nodeIds: uniqueNodeIds,
      inputs: inputNames,
      creative: hasCreativeCatalyst,
    });

    try {
      setIsCombining(true);
      setCombiningNodeIds(uniqueNodeIds);
      setConvergingNodeIds(options?.converge ? uniqueNodeIds : null);
      const recipe = await combineElements(inputNames, {
        creative: hasCreativeCatalyst,
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
        const withoutInputs = prev.filter(
          (node) => !uniqueNodeIds.includes(node.nodeId)
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

  async function combineWorkspaceItems(
    sourceNodeId: string,
    targetNodeId: string
  ) {
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

      <div className="app-root">
        <aside className="sidebar">
          <ElementSidebar
            onAddItemToWorkspace={addItemToWorkspace}
            onLibraryReset={handleLibraryReset}
            refreshToken={libraryRefreshToken}
            onItemsLoaded={setItems}
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
                onViewportCenterChange={setViewportCenter}
                combiningNodeIds={combiningNodeIds}
                convergingNodeIds={convergingNodeIds}
                onClearWorkspace={clearWorkspaceItems}
                onRemoveWorkspaceItem={removeWorkspaceItem}
                onDuplicateWorkspaceItem={duplicateWorkspaceItem}
                onAddItemToWorkspace={addItemToWorkspace}
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
