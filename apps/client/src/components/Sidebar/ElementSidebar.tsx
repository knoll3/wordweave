import React, { useEffect, useMemo, useRef, useState } from "react";
import { SquareMinus, SquarePlus } from "lucide-react";
import type { Item, SemanticCluster } from "../../types";
import ElementSearch from "./ElementSearch";
import ElementList from "./ElementList";
import {
  fetchSemanticClusters,
  fetchItems,
} from "../../lib/api";

interface Props {
  items: Item[];
  onAddItemToWorkspace: (item: Item) => void;
  onItemsLoaded?: (items: Item[]) => void;
  randomUnlocked?: boolean;
}

const RANDOM_SPAWN_COUNT = 4;

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = new Array(right.length + 1).fill(0);
  const next = new Array(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) prev[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = next[j];
  }

  return prev[right.length];
}

function lexicalScore(query: string, candidateName: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidateName.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return 4;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 3;
  if (normalizedCandidate.includes(normalizedQuery)) return 2;

  const queryTokens = tokenize(normalizedQuery);
  const candidateTokens = tokenize(normalizedCandidate);
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (overlap > 0) {
    return 1 + overlap / queryTokens.length;
  }

  return 0;
}

function getCorrectedQuery(query: string, items: Item[]) {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 3) return null;

  const hasStrongDirectMatch = items.some((item) => {
    const normalizedName = item.name.trim().toLowerCase();
    return (
      normalizedName === trimmed ||
      normalizedName.startsWith(trimmed) ||
      normalizedName.includes(trimmed)
    );
  });
  if (hasStrongDirectMatch) return null;

  let bestName: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const normalizedName = item.name.trim().toLowerCase();
    const distance = levenshtein(trimmed, normalizedName);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = item.name;
    }
  }

  if (!bestName) return null;

  const normalizedBest = bestName.trim().toLowerCase();
  const relativeDistance = bestDistance / Math.max(trimmed.length, normalizedBest.length);
  if (bestDistance <= 2 || relativeDistance <= 0.25) {
    return bestName;
  }
  return null;
}

function compareItemsByName(left: Item, right: Item) {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}

function collectClusterIds(clusters: SemanticCluster[]): Set<string> {
  const ids = new Set<string>();

  const visit = (cluster: SemanticCluster) => {
    ids.add(cluster.id);
    cluster.children?.forEach(visit);
  };

  clusters.forEach(visit);
  return ids;
}

const ElementSidebar: React.FC<Props> = ({
  items,
  onAddItemToWorkspace,
  onItemsLoaded,
  randomUnlocked = false,
}) => {
  const [search, setSearch] = useState("");
  const [semanticItems, setSemanticItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [semanticPending, setSemanticPending] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");
  const [browseMode, setBrowseMode] = useState<"all" | "tree">("tree");
  const [clusters, setClusters] = useState<SemanticCluster[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersStale, setClustersStale] = useState(false);
  const [expandedClusterIds, setExpandedClusterIds] = useState<string[]>([]);
  const latestRequestIdRef = useRef(0);
  const latestSemanticRequestIdRef = useRef(0);
  const latestClustersRequestIdRef = useRef(0);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);

  useEffect(() => {
    void loadLibraryItems();
    void loadSemanticClusters();
  }, []);

  useEffect(() => {
    if (latestRequestIdRef.current === 0) {
      return;
    }
    setClustersStale(true);
  }, [items]);

  useEffect(() => {
    if (browseMode !== "tree" || !clustersStale) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadSemanticClusters();
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [browseMode, clustersStale]);

  const correctedSearchQuery = useMemo(
    () => getCorrectedQuery(search, items),
    [items, search]
  );

  useEffect(() => {
    if (!search.trim()) {
      setSemanticPending(false);
      setSemanticLoading(false);
      setSemanticItems([]);
      return;
    }
    setSemanticPending(true);
    const timeoutId = window.setTimeout(() => {
      void loadSemanticItems(correctedSearchQuery ?? search);
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [correctedSearchQuery, search]);

  async function loadLibraryItems() {
    const requestId = ++latestRequestIdRef.current;
    try {
      setLoadingItems(true);
      setLibraryLoadError(null);
      const data = await fetchItems();
      if (requestId !== latestRequestIdRef.current) return;
      onItemsLoaded?.(data);
    } catch (err) {
      if (requestId === latestRequestIdRef.current) {
        setLibraryLoadError(
          err instanceof Error ? err.message : "Failed to load library items"
        );
      }
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoadingItems(false);
      }
    }
  }

  async function loadSemanticItems(query: string) {
    const requestId = ++latestSemanticRequestIdRef.current;
    try {
      setSemanticPending(false);
      setSemanticLoading(true);
      const data = await fetchItems(query);
      if (requestId !== latestSemanticRequestIdRef.current) return;
      setSemanticItems(data);
    } catch {
    } finally {
      if (requestId === latestSemanticRequestIdRef.current) {
        setSemanticLoading(false);
      }
    }
  }

  async function loadSemanticClusters() {
    const requestId = ++latestClustersRequestIdRef.current;
    try {
      setClustersLoading(true);
      const response = await fetchSemanticClusters();
      if (requestId !== latestClustersRequestIdRef.current) return;
      setClusters(response.clusters);
      setClustersStale(false);
      const availableClusterIds = collectClusterIds(response.clusters);
      setExpandedClusterIds((current) =>
        current.length > 0
          ? current.filter((clusterId) => availableClusterIds.has(clusterId))
          : []
      );
    } catch {
    } finally {
      if (requestId === latestClustersRequestIdRef.current) {
        setClustersLoading(false);
      }
    }
  }

  const lexicalSearchItems = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    const corrected = correctedSearchQuery?.trim().toLowerCase() ?? "";
    if (!trimmed) return items;

    const scored = items
      .map((item) => {
        const rawScore = lexicalScore(trimmed, item.name);
        const correctedScore = corrected ? lexicalScore(corrected, item.name) - 0.15 : 0;
        return {
          item,
          score: Math.max(rawScore, correctedScore),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.item.name.localeCompare(right.item.name, "en", {
          sensitivity: "base",
        });
      });

    return scored.map((entry) => entry.item);
  }, [correctedSearchQuery, items, search]);

  const displayedItems = useMemo(() => {
    if (search.trim()) {
      const deduped = new Map<number, Item>();
      for (const item of lexicalSearchItems) {
        deduped.set(item.id, item);
      }
      for (const item of semanticItems) {
        if (!deduped.has(item.id)) {
          deduped.set(item.id, item);
        }
      }
      return [...deduped.values()];
    }

    if (sortBy === "time") {
      // Keep API order (created_at ASC) so newest items stay toward the end.
      return items;
    }
    return [...items].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
  }, [items, lexicalSearchItems, search, semanticItems, sortBy]);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

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

  const isSearchAwaitingMore = Boolean(search.trim()) && (semanticPending || semanticLoading);

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
    setExpandedClusterIds(
      clusters.flatMap((cluster) => [
        cluster.id,
        ...(cluster.children?.map((child) => child.id) ?? []),
      ])
    );
  }

  function collapseAllClusters() {
    setExpandedClusterIds([]);
  }

  function renderTreeLeaves(cluster: SemanticCluster, depth: number) {
    return cluster.members
      .map((member) => {
        const item = itemsById.get(member.id);
        return item ? { item, isPrimary: member.isPrimary } : null;
      })
      .filter(Boolean)
      .sort((left, right) => compareItemsByName(left!.item, right!.item))
      .map((entry) => (
        <button
          key={`${cluster.id}-${entry!.item.id}`}
          type="button"
          className={`library-tree-leaf${entry!.isPrimary ? "" : " is-secondary"}`}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          onClick={() => onAddItemToWorkspace(entry!.item)}
        >
          <span className="library-tree-branch" aria-hidden="true">
            └
          </span>
          <span className="element-icon">
            {entry!.item.icon || entry!.item.name.charAt(0).toUpperCase()}
          </span>
          <span className="library-tree-leaf-name">{entry!.item.name}</span>
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

      {randomUnlocked ? (
        <div className="sidebar-quick-actions">
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
        </div>
      ) : null}

      <section className="sidebar-section library-section">
        <div className="library-header-row">
          <h2 className="section-title">Library</h2>
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
            </div>
          </div>
        </div>
        <ElementSearch value={search} onChange={handleSearchChange} />
        {loadingItems ? (
          <div className="sidebar-placeholder">Loading items…</div>
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
              listRef={elementListRef}
            />
          </div>
        )}
      </section>
    </>
  );
};

export default ElementSidebar;
