import React, { useEffect, useMemo, useState } from "react";
import type { Item } from "../../types";
import ElementSearch from "./ElementSearch";
import ElementList from "./ElementList";
import { fetchItems, resetLibrary } from "../../lib/api";

interface Props {
  onAddItemToWorkspace: (itemId: number) => void;
  onLibraryReset?: () => void;
  refreshToken?: number;
  onItemsLoaded?: (items: Item[]) => void;
}

const ElementSidebar: React.FC<Props> = ({
  onAddItemToWorkspace,
  onLibraryReset,
  refreshToken = 0,
  onItemsLoaded,
}) => {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [isResettingLibrary, setIsResettingLibrary] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    void loadItems(search);
  }, [refreshToken]);

  async function loadItems(query?: string) {
    try {
      setLoadingItems(true);
      const data = await fetchItems(query);
      setItems(data);
      if (!query || !query.trim()) {
        onItemsLoaded?.(data);
      }
    } catch (err) {
      console.error("Failed to load items", err);
    } finally {
      setLoadingItems(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    void loadItems(value);
  }

  async function handleConfirmResetLibrary() {
    if (isResettingLibrary) return;
    try {
      setIsResettingLibrary(true);
      await resetLibrary();
      setShowResetConfirm(false);
      setSearch("");
      onLibraryReset?.();
      await loadItems();
    } catch (err) {
      console.error("Failed to reset library", err);
    } finally {
      setIsResettingLibrary(false);
    }
  }

  const displayedItems = useMemo(() => {
    if (sortBy === "time") {
      // Keep API order (created_at ASC) so newest items stay toward the end.
      return items;
    }
    return [...items].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
  }, [items, sortBy]);

  return (
    <>
      <header className="sidebar-header">
        <h1 className="app-title">Wordweave</h1>
        <p className="app-subtitle">
          Combine items to discover new concepts.
        </p>
      </header>

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
          <ElementList
            items={displayedItems}
            onAddToWorkspace={onAddItemToWorkspace}
          />
        )}
        <button
          type="button"
          className="button secondary clear-library-button"
          onClick={() => setShowResetConfirm(true)}
          disabled={isResettingLibrary}
        >
          Clear Library
        </button>
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
    </>
  );
};

export default ElementSidebar;
