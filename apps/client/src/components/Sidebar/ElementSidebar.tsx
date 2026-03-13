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
  onAddItemToWorkspace: (item: Item) => void;
  onLibraryReset?: () => void;
  refreshToken?: number;
  onItemsLoaded?: (items: Item[]) => void;
}

const RANDOM_SPAWN_COUNT = 4;

const ElementSidebar: React.FC<Props> = ({
  onAddItemToWorkspace,
  onLibraryReset,
  refreshToken = 0,
  onItemsLoaded,
}) => {
  const [search, setSearch] = useState("");
  const [libraryItems, setLibraryItems] = useState<Item[]>([]);
  const [semanticItems, setSemanticItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [semanticPending, setSemanticPending] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [isResettingLibrary, setIsResettingLibrary] = useState(false);
  const [isResettingCache, setIsResettingCache] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetCacheConfirm, setShowResetCacheConfirm] = useState(false);
  const [cacheRecipeCount, setCacheRecipeCount] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");
  const latestRequestIdRef = useRef(0);
  const latestSemanticRequestIdRef = useRef(0);

  useEffect(() => {
    void loadLibraryItems();
  }, []);

  useEffect(() => {
    void loadLibraryItems();
  }, [refreshToken]);

  useEffect(() => {
    if (!search.trim()) {
      setSemanticPending(false);
      setSemanticLoading(false);
      setSemanticItems([]);
      return;
    }
    setSemanticPending(true);
    const timeoutId = window.setTimeout(() => {
      void loadSemanticItems(search);
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [search]);

  async function loadLibraryItems() {
    const requestId = ++latestRequestIdRef.current;
    try {
      setLoadingItems(true);
      const data = await fetchItems();
      if (requestId !== latestRequestIdRef.current) return;
      setLibraryItems(data);
      onItemsLoaded?.(data);
    } catch (err) {
      console.error("Failed to load items", err);
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
    if (!trimmed) return libraryItems;

    const scored = libraryItems
      .map((item) => {
        const normalizedName = item.name.trim().toLowerCase();
        let score = 0;
        if (normalizedName === trimmed) {
          score = 4;
        } else if (normalizedName.startsWith(trimmed)) {
          score = 3;
        } else if (normalizedName.includes(trimmed)) {
          score = 2;
        } else {
          const queryTokens = trimmed.split(/\s+/).filter(Boolean);
          const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
          const overlap = queryTokens.filter((token) => nameTokens.includes(token)).length;
          if (overlap > 0) {
            score = 1 + overlap / queryTokens.length;
          }
        }
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.item.name.localeCompare(right.item.name, "en", {
          sensitivity: "base",
        });
      });

    return scored.map((entry) => entry.item);
  }, [libraryItems, search]);

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
      return libraryItems;
    }
    return [...libraryItems].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
  }, [libraryItems, lexicalSearchItems, search, semanticItems, sortBy]);

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
    if (!libraryItems.length) return;

    const pool = [...libraryItems];
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

      <div className="sidebar-quick-actions">
        <button
          type="button"
          className="button secondary random-items-button"
          onClick={handleAddRandomItems}
          disabled={loadingItems || libraryItems.length === 0}
          title="Add random library items to the workspace"
          aria-label="Add random library items to the workspace"
        >
          <span className="random-items-icon" aria-hidden="true">
            🎲
          </span>
          Random
        </button>
      </div>

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
        ) : (
          <div className="library-results">
            <ElementList
              items={displayedItems}
              onAddToWorkspace={onAddItemToWorkspace}
              pendingLabel={isSearchAwaitingMore ? "Searching more results…" : null}
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
