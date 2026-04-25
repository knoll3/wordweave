import { useEffect, useMemo, useRef, useState } from "react";
import { fetchItems, fetchSemanticClusters } from "../../lib/api";
import type { Item, SemanticCluster } from "../../types";
import { collectClusterIds } from "./elementClusters";
import {
  buildDisplayedItems,
  buildLexicalSearchItems,
  countSearchMatches,
  getCorrectedQuery,
  MAX_VISIBLE_SEARCH_RESULTS,
} from "./elementSearch";

type UseElementSearchArgs = {
  items: Item[];
  isMobileLayout: boolean;
  onItemsLoaded?: (items: Item[]) => void;
  onSearchQueryChange?: (query: string) => void;
};

// This hook owns the sidebar's "browse the library" behavior:
// initial load, debounced search, semantic suggestions, and tree metadata refresh.
export function useElementSearch({
  items,
  isMobileLayout,
  onItemsLoaded,
  onSearchQueryChange,
}: UseElementSearchArgs) {
  const [search, setSearch] = useState("");
  const [semanticItems, setSemanticItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [semanticPending, setSemanticPending] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");
  const [browseMode, setBrowseMode] = useState<"all" | "tree">("all");
  const [clusters, setClusters] = useState<SemanticCluster[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersStale, setClustersStale] = useState(false);
  const latestRequestIdRef = useRef(0);
  const latestSemanticRequestIdRef = useRef(0);
  const latestClustersRequestIdRef = useRef(0);

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

  useEffect(() => {
    onSearchQueryChange?.(search);
  }, [onSearchQueryChange, search]);

  async function loadLibraryItems() {
    const requestId = ++latestRequestIdRef.current;
    try {
      setLoadingItems(true);
      setLibraryLoadError(null);
      const data = await fetchItems();
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
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
      if (requestId !== latestSemanticRequestIdRef.current) {
        return;
      }
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
      if (requestId !== latestClustersRequestIdRef.current) {
        return;
      }
      setClusters(response.clusters);
      setClustersStale(false);
    } catch {
    } finally {
      if (requestId === latestClustersRequestIdRef.current) {
        setClustersLoading(false);
      }
    }
  }

  const lexicalSearchItems = useMemo(
    () => buildLexicalSearchItems(items, search, correctedSearchQuery),
    [correctedSearchQuery, items, search]
  );

  const displayedItems = useMemo(
    () =>
      buildDisplayedItems({
        items,
        lexicalSearchItems,
        semanticItems,
        search,
        sortBy,
      }),
    [items, lexicalSearchItems, search, semanticItems, sortBy]
  );

  const totalSearchMatches = useMemo(() => {
    if (!search.trim()) {
      return 0;
    }
    return countSearchMatches(lexicalSearchItems, semanticItems);
  }, [lexicalSearchItems, search, semanticItems]);

  const isSearchAwaitingMore = Boolean(search.trim()) && (semanticPending || semanticLoading);
  const shouldHideLibraryResultsOnMobile =
    isMobileLayout && !loadingItems && !libraryLoadError && !search.trim();
  const searchStatusLabel = useMemo(() => {
    if (!search.trim() || isSearchAwaitingMore) {
      return null;
    }
    if (totalSearchMatches > MAX_VISIBLE_SEARCH_RESULTS) {
      return `Showing top ${MAX_VISIBLE_SEARCH_RESULTS} of ${totalSearchMatches} matches.`;
    }
    return null;
  }, [isSearchAwaitingMore, search, totalSearchMatches]);
  const availableClusterIds = useMemo(() => collectClusterIds(clusters), [clusters]);

  return {
    search,
    setSearch,
    sortBy,
    setSortBy,
    browseMode,
    setBrowseMode,
    semanticItems,
    loadingItems,
    libraryLoadError,
    clusters,
    clustersLoading,
    correctedSearchQuery,
    displayedItems,
    isSearchAwaitingMore,
    shouldHideLibraryResultsOnMobile,
    searchStatusLabel,
    availableClusterIds,
  };
}
