import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../../types";
import ElementSearch from "./ElementSearch";
import ElementList from "./ElementList";
import {
  fetchCacheStats,
  fetchItems,
  resetCache,
  resetLibrary,
} from "../../lib/api";

interface Props {
  items: Item[];
  onAddItemToWorkspace: (item: Item) => void;
  onLibraryReset?: () => void;
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

const ElementSidebar: React.FC<Props> = ({
  items,
  onAddItemToWorkspace,
  onLibraryReset,
  onItemsLoaded,
  randomUnlocked = false,
}) => {
  const [search, setSearch] = useState("");
  const [semanticItems, setSemanticItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [semanticPending, setSemanticPending] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [isResettingLibrary, setIsResettingLibrary] = useState(false);
  const [isResettingCache, setIsResettingCache] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetCacheConfirm, setShowResetCacheConfirm] = useState(false);
  const [cacheRecipeCount, setCacheRecipeCount] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");
  const latestRequestIdRef = useRef(0);
  const latestSemanticRequestIdRef = useRef(0);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);

  useEffect(() => {
    void loadLibraryItems();
  }, []);

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
      console.error("Failed to load items", err);
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
    } catch (err) {
      console.error("Failed to load semantic items", err);
    } finally {
      if (requestId === latestSemanticRequestIdRef.current) {
        setSemanticLoading(false);
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

  async function openResetCacheConfirm() {
    setShowResetCacheConfirm(true);
    try {
      const stats = await fetchCacheStats();
      setCacheRecipeCount(stats.recipeCount);
    } catch (err) {
      console.error("Failed to load cache stats", err);
      setCacheRecipeCount(null);
    }
  }

  async function handleConfirmResetLibrary() {
    if (isResettingLibrary) return;
    try {
      setIsResettingLibrary(true);
      await resetLibrary();
      setShowResetConfirm(false);
      setSearch("");
      setSemanticItems([]);
      onLibraryReset?.();
      await loadLibraryItems();
    } catch (err) {
      console.error("Failed to reset library", err);
    } finally {
      setIsResettingLibrary(false);
    }
  }

  async function handleConfirmResetCache() {
    if (isResettingCache) return;
    try {
      setIsResettingCache(true);
      const result = await resetCache();
      setCacheRecipeCount(0);
      setShowResetCacheConfirm(false);
      console.log("[cache] cleared", result);
    } catch (err) {
      console.error("Failed to reset cache", err);
    } finally {
      setIsResettingCache(false);
    }
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
          <div className="sort-controls" role="group" aria-label="Sort library">
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
        </div>
        <ElementSearch value={search} onChange={handleSearchChange} />
        {loadingItems ? (
          <div className="sidebar-placeholder">Loading items…</div>
        ) : libraryLoadError ? (
          <div className="sidebar-placeholder">{libraryLoadError}</div>
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
        <div className="library-danger-actions">
          <button
            type="button"
            className="button secondary clear-library-button"
            onClick={() => setShowResetConfirm(true)}
            disabled={isResettingLibrary || isResettingCache}
          >
            Clear Library
          </button>
          <button
            type="button"
            className="button danger"
            onClick={() => void openResetCacheConfirm()}
            disabled={isResettingLibrary || isResettingCache}
          >
            Clear Cache
          </button>
        </div>
      </section>
      {showResetConfirm ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => (isResettingLibrary ? null : setShowResetConfirm(false))}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">Clear Library?</h3>
            <p className="confirm-text">
              This removes discovered items from the library and keeps only Fire,
              Water, Earth, and Air. Cached combinations are preserved.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowResetConfirm(false)}
                disabled={isResettingLibrary}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void handleConfirmResetLibrary()}
                disabled={isResettingLibrary}
              >
                {isResettingLibrary ? "Clearing..." : "Clear Library"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showResetCacheConfirm ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() =>
              isResettingCache ? null : setShowResetCacheConfirm(false)
            }
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">Clear Cache?</h3>
            <p className="confirm-text">
              This clears the saved combination cache used to reduce API cost.
              If reset, every combination will be generated again.
            </p>
            <p className="confirm-text confirm-metric">
              Cached combinations to clear:{" "}
              {cacheRecipeCount == null ? "Loading..." : cacheRecipeCount}
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowResetCacheConfirm(false)}
                disabled={isResettingCache}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void handleConfirmResetCache()}
                disabled={isResettingCache}
              >
                {isResettingCache ? "Clearing..." : "Clear Cache"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ElementSidebar;
