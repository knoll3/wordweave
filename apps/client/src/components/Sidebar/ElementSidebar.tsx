import React, { useEffect, useMemo, useRef, useState } from "react";
import { SquareMinus, SquarePlus } from "lucide-react";
import type { Item, SemanticCluster } from "../../types";
import ElementSearch from "./ElementSearch";
import ElementList from "./ElementList";
import {
  expandAllClusterIds,
  getSortedClusterLeafEntries,
} from "./elementClusters";
import {
  MAX_ITEMS_TO_SHOW_WITHOUT_SEARCH,
} from "./elementSearch";
import { useElementSearch } from "./useElementSearch";

interface Props {
  items: Item[];
  isMobileLayout?: boolean;
  totalQuestPoints?: number;
  questPointsHighlightKey?: number;
  onAddItemToWorkspace: (item: Item) => void;
  onItemsLoaded?: (items: Item[]) => void;
  randomUnlocked?: boolean;
  canUndoWorkspace?: boolean;
  onUndoWorkspace?: () => void;
  onSearchFocusChange?: (isFocused: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
}

const RANDOM_SPAWN_COUNT = 4;

const ElementSidebar: React.FC<Props> = ({
  items,
  isMobileLayout = false,
  totalQuestPoints = 0,
  questPointsHighlightKey = 0,
  onAddItemToWorkspace,
  onItemsLoaded,
  randomUnlocked = false,
  canUndoWorkspace = false,
  onUndoWorkspace,
  onSearchFocusChange,
  onSearchQueryChange,
}) => {
  const {
    search,
    setSearch,
    sortBy,
    setSortBy,
    browseMode,
    setBrowseMode,
    loadingItems,
    libraryLoadError,
    clusters,
    clustersLoading,
    displayedItems,
    isSearchAwaitingMore,
    shouldHideLibraryResultsOnMobile,
    searchStatusLabel,
    availableClusterIds,
  } = useElementSearch({
    items,
    isMobileLayout,
    onItemsLoaded,
    onSearchQueryChange,
  });
  const [expandedClusterIds, setExpandedClusterIds] = useState<string[]>([]);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const [isQuestPointsHighlighted, setIsQuestPointsHighlighted] = useState(false);

  useEffect(() => {
    if (questPointsHighlightKey <= 0) {
      return;
    }
    setIsQuestPointsHighlighted(true);
    const timeoutId = window.setTimeout(() => {
      setIsQuestPointsHighlighted(false);
    }, 950);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [questPointsHighlightKey]);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  useEffect(() => {
    // Keep the tree open state stable when the cluster API refreshes, but drop
    // any ids that no longer exist in the latest library grouping.
    setExpandedClusterIds((current) =>
      current.length > 0
        ? current.filter((clusterId) => availableClusterIds.has(clusterId))
        : []
    );
  }, [availableClusterIds]);

  useEffect(() => {
    if (pendingScrollRestoreRef.current == null) return;
    if (!elementListRef.current) return;

    const nextScrollTop = pendingScrollRestoreRef.current;
    const rafId = window.requestAnimationFrame(() => {
      if (!elementListRef.current) return;
      elementListRef.current.scrollTop = nextScrollTop;
      pendingScrollRestoreRef.current = null;
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [displayedItems]);

  function handleSearchChange(value: string) {
    setSearch(value);
  }

  function handleAddRandomItems() {
    if (!items.length) return;

    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    pool.slice(0, Math.min(RANDOM_SPAWN_COUNT, pool.length)).forEach((item) => {
      onAddItemToWorkspace(item);
    });
  }

  function toggleCluster(clusterId: string) {
    setExpandedClusterIds((current) =>
      current.includes(clusterId)
        ? current.filter((id) => id !== clusterId)
        : [...current, clusterId]
    );
  }

  function expandAllClusters() {
    setExpandedClusterIds(expandAllClusterIds(clusters));
  }

  function collapseAllClusters() {
    setExpandedClusterIds([]);
  }

  function renderTreeLeaves(cluster: SemanticCluster, depth: number) {
    return getSortedClusterLeafEntries(cluster, itemsById).map((entry) => (
        <button
          key={`${cluster.id}-${entry.item.id}`}
          type="button"
          className={`library-tree-leaf${entry.isPrimary ? "" : " is-secondary"}`}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          onClick={() => onAddItemToWorkspace(entry.item)}
        >
          <span className="library-tree-branch" aria-hidden="true">
            └
          </span>
          <span className="element-icon">
            {entry.item.icon || entry.item.name.charAt(0).toUpperCase()}
          </span>
          <span className="library-tree-leaf-name">{entry.item.name}</span>
        </button>
      ));
  }

  function renderTreeCluster(cluster: SemanticCluster, depth = 0) {
    const isExpanded = expandedClusterIds.includes(cluster.id);
    const hasChildren = (cluster.children?.length ?? 0) > 0;

    return (
      <div key={cluster.id} className="library-tree-group">
        <button
          type="button"
          className={`library-tree-node${depth > 0 ? " is-child" : ""}`}
          role="treeitem"
          aria-expanded={isExpanded}
          onClick={() => toggleCluster(cluster.id)}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          <span className="library-tree-caret" aria-hidden="true">
            {isExpanded ? "▾" : "▸"}
          </span>
          <span className="library-tree-label">{cluster.title}</span>
          <span className="library-tree-count">{cluster.primaryMemberCount}</span>
        </button>
        {isExpanded ? (
          <div className="library-tree-children" role="group">
            {hasChildren
              ? cluster.children!.map((child) => renderTreeCluster(child, depth + 1))
              : renderTreeLeaves(cluster, depth + 1)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <header className="sidebar-header">
        <h1 className="app-title">Wordweave</h1>
        <p className="app-subtitle">
          Combine items to discover new concepts.
        </p>
      </header>

      <section className="sidebar-section library-section">
        <div className="library-toolbar">
          <div
            className="sort-controls library-mode-controls"
            role="group"
            aria-label="Browse library"
          >
            <button
              type="button"
              className={`sort-button ${browseMode === "all" ? "active" : ""}`}
              onClick={() => setBrowseMode("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`sort-button ${browseMode === "tree" ? "active" : ""}`}
              onClick={() => setBrowseMode("tree")}
            >
              Tree
            </button>
          </div>
          <div className="library-secondary-slot">
            <div className="library-secondary-controls">
              {browseMode === "all" ? (
                <div
                  className="sort-controls library-sort-controls"
                  role="group"
                  aria-label="Sort library"
                >
                  <button
                    type="button"
                    className={`sort-button ${sortBy === "time" ? "active" : ""}`}
                    onClick={() => setSortBy("time")}
                  >
                    Time
                  </button>
                  <button
                    type="button"
                    className={`sort-button ${sortBy === "name" ? "active" : ""}`}
                    onClick={() => setSortBy("name")}
                  >
                    Name
                  </button>
                </div>
              ) : (
                <div
                  className="library-tree-actions"
                  role="group"
                  aria-label="Tree controls"
                >
                  <button
                    type="button"
                    className="button secondary library-action-button"
                    onClick={expandAllClusters}
                    disabled={clusters.length === 0}
                    aria-label="Expand all"
                    title="Expand all"
                  >
                    <SquarePlus aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button secondary library-action-button"
                    onClick={collapseAllClusters}
                    disabled={expandedClusterIds.length === 0}
                    aria-label="Collapse all"
                    title="Collapse all"
                  >
                    <SquareMinus aria-hidden="true" />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="sort-button library-undo-button"
                onClick={() => onUndoWorkspace?.()}
                disabled={!canUndoWorkspace}
              >
                Undo
              </button>
            </div>
            <div
              className={`library-points-label ${
                isQuestPointsHighlighted ? "library-points-label-highlighted" : ""
              }`}
              aria-live="polite"
            >
              {totalQuestPoints} points
            </div>
          </div>
          <div className="library-count-label" aria-live="polite">
            {loadingItems ? (
              <span
                className="library-count-skeleton"
                aria-hidden="true"
              />
            ) : (
              `${items.length} items`
            )}
          </div>
          {randomUnlocked ? (
            <button
              type="button"
              className="button secondary random-items-button"
              onClick={handleAddRandomItems}
              disabled={loadingItems || items.length === 0}
              title="Add random library items to the workspace"
              aria-label="Add random library items to the workspace"
            >
              <span className="random-items-icon" aria-hidden="true">
                🎲
              </span>
              Random
            </button>
          ) : null}
        </div>
        <ElementSearch
          value={search}
          onChange={handleSearchChange}
          onFocusChange={onSearchFocusChange}
        />
        {shouldHideLibraryResultsOnMobile ? null : loadingItems ? (
            <div className="library-results">
              <div className="library-empty-state" role="status" aria-live="polite">
                <span className="search-pending-spinner library-loading-spinner" aria-hidden="true" />
                <p className="library-empty-state-copy">Loading library</p>
              </div>
            </div>
          ) : libraryLoadError ? (
            <div className="sidebar-placeholder">{libraryLoadError}</div>
          ) : !search.trim() && browseMode === "tree" ? (
            <div ref={elementListRef} className="library-results library-tree-results">
              {clusters.length > 0 ? (
                <>
                  <div className="library-tree" role="tree" aria-label="Clustered library">
                    {clusters.map((cluster) => renderTreeCluster(cluster))}
                  </div>
                  {clustersLoading ? (
                    <div className="library-cluster-status">
                      <span className="search-pending-spinner" aria-hidden="true" />
                      <span>Updating tree…</span>
                    </div>
                  ) : null}
                </>
              ) : clustersLoading ? (
                <div className="library-cluster-status">
                  <span className="search-pending-spinner" aria-hidden="true" />
                  <span>Building clusters…</span>
                </div>
              ) : (
                <div className="sidebar-placeholder">
                  Not enough items are available to form semantic clusters yet.
                </div>
              )}
            </div>
          ) : (
            <div className="library-results">
              <ElementList
                items={displayedItems}
                onAddToWorkspace={onAddItemToWorkspace}
                pendingLabel={isSearchAwaitingMore ? "Searching more results…" : null}
                statusLabel={searchStatusLabel}
                emptyLabel={
                  search.trim()
                    ? "No matching items found."
                    : "Search to show matching library items."
                }
                emptyState={
                  search.trim() || items.length < MAX_ITEMS_TO_SHOW_WITHOUT_SEARCH ? null : (
                    <div className="library-empty-state" role="status" aria-live="polite">
                      <p className="library-empty-state-copy">
                        {items.length.toLocaleString()} items loaded
                      </p>
                      <div className="library-empty-state-title">Search to browse the library</div>
                    </div>
                  )
                }
                listRef={elementListRef}
              />
            </div>
          )}
      </section>
    </>
  );
};

export default ElementSidebar;
