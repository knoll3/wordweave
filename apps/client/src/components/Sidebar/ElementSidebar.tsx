import React, { useEffect, useState } from "react";
import type { Item, RecentRecipe } from "../../types";
import ElementSearch from "./ElementSearch";
import ElementList from "./ElementList";
import RecentCreations from "../Results/RecentCreations";
import { fetchItems, fetchRecentRecipes } from "../../lib/api";

interface Props {
  onAddItemToWorkspace: (itemId: number) => void;
  onItemsLoaded?: (items: Item[]) => void;
  onRecentLoaded?: (recent: RecentRecipe[]) => void;
}

const ElementSidebar: React.FC<Props> = ({
  onAddItemToWorkspace,
  onItemsLoaded,
  onRecentLoaded,
}) => {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [recent, setRecent] = useState<RecentRecipe[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    void loadItems();
    void loadRecent();
  }, []);

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

  async function loadRecent() {
    try {
      const data = await fetchRecentRecipes();
      setRecent(data);
      onRecentLoaded?.(data);
    } catch (err) {
      console.error("Failed to load recent recipes", err);
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    void loadItems(value);
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
        <h2 className="section-title">Library</h2>
        <ElementSearch value={search} onChange={handleSearchChange} />
        {loadingItems ? (
          <div className="sidebar-placeholder">Loading items…</div>
        ) : (
          <ElementList
            items={items}
            onAddToWorkspace={onAddItemToWorkspace}
          />
        )}
      </section>

      <section className="sidebar-section recent-section">
        <h2 className="section-title">Recent creations</h2>
        <RecentCreations recent={recent} />
      </section>
    </>
  );
};

export default ElementSidebar;
