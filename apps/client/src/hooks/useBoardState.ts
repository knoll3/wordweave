import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveActionPromptFamilyKey } from "../lib/actionPromptFamilies";
import {
  attachBoardActionModifier,
  attachBoardCategoryModifier,
  clearBoardItems as clearSharedBoardItems,
  combineBoardItems,
  combineElements,
  createBoardItem,
  deleteBoardItems,
  duplicateBoardItem,
  fetchBoardSnapshot,
  fetchItems,
  fetchQuests,
  moveBoardItems,
  undoBoard,
  updateBoardItem,
  updateQuestStatus,
} from "../lib/api";
import {
  claimBoardDrag,
  endBoardDrag,
  publishBoardActivityState,
  publishBoardSelectionState,
  publishViewportCenter,
  sendBoardDragMove,
  sendBoardGroupMove,
} from "../lib/liveBoardSocket";
import {
  ACTION_CATALYSTS,
  ACTION_CATALYST_BY_ID,
  NON_INGREDIENT_ITEM_IDS,
  SPECIAL_ITEM_BY_ID,
} from "../lib/specialItems";
import type {
  SharedBoardActivityMode,
  SharedPlayerViewportCenter,
  SharedRoomSnapshot,
} from "../liveBoardTypes";
import type {
  AiModel,
  AutoUnlockedActionWord,
  Item,
  PlayerQuestStats,
  QuestRecord,
  SelectionCombineLayout,
  WorkspaceItem,
} from "../types";
import {
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM_ID
} from "../types";

const VIEWPORT_CENTER_PUBLISH_INTERVAL_MS = 120;
const VIEWPORT_CENTER_MIN_DELTA = 12;

export type DragAbortSignal = {
  nodeId: string;
  nonce: number;
};

function normalizeItemName(value: string) {
  return value.trim().toLowerCase();
}

function makeWorkspaceNodeId() {
  return `workspace-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function upsertWorkspaceItems(
  current: WorkspaceItem[],
  upserts: WorkspaceItem[]
): WorkspaceItem[] {
  const byId = new Map(current.map((item) => [item.nodeId, item]));
  for (const item of upserts) {
    byId.set(item.nodeId, item);
  }
  return [...byId.values()];
}

function collectMissingWorkspaceItemIds(
  workspaceEntries: WorkspaceItem[],
  knownItems: Item[]
) {
  const knownIds = new Set(knownItems.map((item) => item.id));
  return workspaceEntries
    .map((item) => item.itemId)
    .filter((itemId) => itemId > 0 && !knownIds.has(itemId));
}

export function useBoardState({
  items,
  setItems,
  setHasLoadedInitialLibrary,
  isMobileLayout,
  isSearchFocused,
  clearMobileSearchFocus,
  selectedModel,
  setQuests,
  applyQuestStats,
  loadFeatureUnlocks,
  setActionUnlockModal,
  showError,
  applyWorkspaceSnapshot,
}: {
  items: Item[];
  setItems: Dispatch<SetStateAction<Item[]>>;
  setHasLoadedInitialLibrary: Dispatch<SetStateAction<boolean>>;
  isMobileLayout: boolean;
  isSearchFocused: boolean;
  clearMobileSearchFocus: () => void;
  selectedModel: AiModel;
  setQuests: Dispatch<SetStateAction<QuestRecord[]>>;
  applyQuestStats: (stats: PlayerQuestStats) => void;
  loadFeatureUnlocks: () => Promise<void>;
  setActionUnlockModal: Dispatch<
    SetStateAction<{ unlockedWords: AutoUnlockedActionWord[] } | null>
  >;
  showError: (message: string, err: unknown) => void;
  applyWorkspaceSnapshot: (snapshot: SharedRoomSnapshot) => WorkspaceItem[];
}) {
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [canUndoWorkspace, setCanUndoWorkspace] = useState(false);
  const [isUndoingWorkspace, setIsUndoingWorkspace] = useState(false);
  const [combiningNodeIds, setCombiningNodeIds] = useState<string[]>([]);
  const [webSearchingNodeIds, setWebSearchingNodeIds] = useState<string[]>([]);
  const [remoteSelectedNodeIds, setRemoteSelectedNodeIds] = useState<string[]>([]);
  const [remoteSelectionLayout, setRemoteSelectionLayout] =
    useState<SelectionCombineLayout | null>(null);
  const [remoteActivityNodeIds, setRemoteActivityNodeIds] = useState<string[]>([]);
  const [remoteActivityLayout, setRemoteActivityLayout] =
    useState<SelectionCombineLayout | null>(null);
  const [remoteActivityMode, setRemoteActivityMode] =
    useState<SharedBoardActivityMode | null>(null);
  const [remoteViewportCenters, setRemoteViewportCenters] = useState<
    SharedPlayerViewportCenter[]
  >([]);
  const [dragAbortSignal, setDragAbortSignal] = useState<DragAbortSignal | null>(null);
  const itemsRef = useRef<Item[]>([]);
  const viewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastPublishedViewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastPublishedViewportAtRef = useRef(0);
  const viewportCenterPublishTimeoutRef = useRef<number | null>(null);
  const activeDragNodeIdRef = useRef<string | null>(null);
  const dragSequenceRef = useRef(0);
  const lastDragSentAtRef = useRef(0);
  const dragAbortNonceRef = useRef(0);

  itemsRef.current = items;

  useEffect(
    () => () => {
      if (viewportCenterPublishTimeoutRef.current != null) {
        window.clearTimeout(viewportCenterPublishTimeoutRef.current);
      }
    },
    []
  );

  function refreshSharedItemsIfNeeded(workspaceEntries: WorkspaceItem[]) {
    if (collectMissingWorkspaceItemIds(workspaceEntries, itemsRef.current).length === 0) {
      return Promise.resolve();
    }
    return fetchItems()
      .then((nextItems) => {
        setItems(nextItems);
        setHasLoadedInitialLibrary(true);
      })
      .catch(() => {});
  }

  function publishSharedViewportCenter(center: { x: number; y: number }) {
    const now = Date.now();
    const lastCenter = lastPublishedViewportCenterRef.current;
    const distanceFromLast =
      lastCenter == null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(center.x - lastCenter.x, center.y - lastCenter.y);

    const flushPublish = (nextCenter: { x: number; y: number }) => {
      lastPublishedViewportCenterRef.current = nextCenter;
      lastPublishedViewportAtRef.current = Date.now();
      publishViewportCenter(nextCenter);
    };

    if (
      lastCenter == null ||
      distanceFromLast >= VIEWPORT_CENTER_MIN_DELTA ||
      now - lastPublishedViewportAtRef.current >= VIEWPORT_CENTER_PUBLISH_INTERVAL_MS
    ) {
      if (viewportCenterPublishTimeoutRef.current != null) {
        window.clearTimeout(viewportCenterPublishTimeoutRef.current);
        viewportCenterPublishTimeoutRef.current = null;
      }
      flushPublish(center);
      return;
    }

    if (viewportCenterPublishTimeoutRef.current != null) {
      window.clearTimeout(viewportCenterPublishTimeoutRef.current);
    }
    viewportCenterPublishTimeoutRef.current = window.setTimeout(() => {
      viewportCenterPublishTimeoutRef.current = null;
      flushPublish(center);
    }, VIEWPORT_CENTER_PUBLISH_INTERVAL_MS);
  }

  function findItemById(itemId: number) {
    return SPECIAL_ITEM_BY_ID.get(itemId) ?? items.find((item) => item.id === itemId);
  }

  async function undoWorkspaceBoardAction() {
    if (combiningNodeIds.length > 0 || isUndoingWorkspace) {
      return;
    }
    setIsUndoingWorkspace(true);
    try {
      const snapshot = await undoBoard();
      setCanUndoWorkspace(Boolean(snapshot.canUndo));
      setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
      void refreshSharedItemsIfNeeded(applyWorkspaceSnapshot(snapshot));
    } catch (err) {
      if (err instanceof Error && err.message === "Nothing to undo") {
        setCanUndoWorkspace(false);
      } else {
        showError(
          err instanceof Error ? err.message : "Failed to undo the last board action.",
          err
        );
      }
    } finally {
      setIsUndoingWorkspace(false);
    }
  }

  function addItemToWorkspace(
    itemId: number,
    position?: { x: number; y: number },
    options?: { isNewDiscovery?: boolean; arrivalHighlightMode?: "library" | "combine" }
  ) {
    const item = findItemById(itemId);
    if (!item) {
      return;
    }
    const anchorPosition = position ?? viewportCenterRef.current ?? { x: 260, y: 180 };
    const nextPosition = position
      ? anchorPosition
      : {
          x: anchorPosition.x + (Math.random() - 0.5) * 160,
          y: anchorPosition.y + (Math.random() - 0.5) * 120,
        };
    const nodeId = makeWorkspaceNodeId();
    const optimisticItem: WorkspaceItem = {
      nodeId,
      itemId,
      position: { x: nextPosition.x, y: nextPosition.y },
      isNewDiscovery: options?.isNewDiscovery ?? false,
      arrivalHighlightMode: options?.arrivalHighlightMode,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));
    void createBoardItem({
      nodeId,
      itemId,
      position: { x: nextPosition.x, y: nextPosition.y },
      isNewDiscovery: options?.isNewDiscovery ?? false,
      arrivalHighlightMode: options?.arrivalHighlightMode ?? null,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((entry) => entry.nodeId !== nodeId));
        showError(
          err instanceof Error ? err.message : "Failed to add item to the shared board.",
          err
        );
      });
  }

  function addLibraryItemToWorkspace(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );

    if (isMobileLayout && isSearchFocused) {
      clearMobileSearchFocus();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          addItemToWorkspace(item.id, viewportCenterRef.current ?? undefined, {
            arrivalHighlightMode: "library",
          });
        });
      });
      return;
    }

    addItemToWorkspace(item.id, undefined, { arrivalHighlightMode: "library" });
  }

  function addLibraryItemToWorkspaceAsActionAnchor(item: Item) {
    setItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [...prev, item]
    );

    const anchorPosition = viewportCenterRef.current ?? { x: 260, y: 180 };
    const nodeId = makeWorkspaceNodeId();
    const nextPosition = {
      x: anchorPosition.x + (Math.random() - 0.5) * 160,
      y: anchorPosition.y + (Math.random() - 0.5) * 120,
    };
    const optimisticItem: WorkspaceItem = {
      nodeId,
      itemId: item.id,
      position: nextPosition,
      arrivalHighlightMode: "library",
      actionConstraintName: item.name,
      actionConstraintNormalizedName: item.normalizedName,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));

    void createBoardItem({
      nodeId,
      itemId: item.id,
      position: nextPosition,
      arrivalHighlightMode: "library",
      actionConstraintName: item.name,
      actionConstraintNormalizedName: item.normalizedName,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((entry) => entry.nodeId !== nodeId));
        showError(
          err instanceof Error ? err.message : "Failed to add item to the shared board.",
          err
        );
      });
  }

  function attachCategoryModifier(sourceNodeId: string, targetNodeId: string) {
    void attachBoardCategoryModifier({ sourceNodeId, targetNodeId }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to attach the category modifier.",
        err
      );
    });
  }

  function attachActionModifier(sourceNodeId: string, targetNodeId: string) {
    void attachBoardActionModifier({ sourceNodeId, targetNodeId }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to attach the action modifier.",
        err
      );
    });
  }

  function clearCategoryModifier(nodeId: string) {
    void updateBoardItem(nodeId, {
      categoryConstraintName: null,
      categoryConstraintNormalizedName: null,
    }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to clear the category modifier.",
        err
      );
    });
  }

  function clearActionModifier(nodeId: string) {
    void updateBoardItem(nodeId, {
      actionConstraintName: null,
      actionConstraintNormalizedName: null,
    }).catch((err) => {
      showError(
        err instanceof Error ? err.message : "Failed to clear the action modifier.",
        err
      );
    });
  }

  function clearWorkspaceItems() {
    void clearSharedBoardItems()
      .then(() => {
        setWorkspaceItems([]);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to clear the shared board.", err);
      });
  }

  function handleViewportCenterChange(position: { x: number; y: number }) {
    viewportCenterRef.current = position;
    publishSharedViewportCenter(position);
  }

  function moveSharedWorkspaceItems(
    nextItems: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) {
    if (nextItems.length === 0) {
      return;
    }
    setWorkspaceItems((prev) =>
      prev.map((item) => {
        const moved = nextItems.find((entry) => entry.nodeId === item.nodeId);
        return moved ? { ...item, position: moved.position } : item;
      })
    );
    void moveBoardItems(nextItems).catch((err) => {
      showError(err instanceof Error ? err.message : "Failed to move board items.", err);
      void fetchBoardSnapshot().then((snapshot) => {
        setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
      });
    });
  }

  function dragSharedWorkspaceGroup(
    nextItems: Array<{ nodeId: string; position: { x: number; y: number } }>
  ) {
    if (nextItems.length === 0) {
      return;
    }
    const now = Date.now();
    if (now - lastDragSentAtRef.current < 45) {
      return;
    }
    lastDragSentAtRef.current = now;
    sendBoardGroupMove(nextItems);
  }

  function deleteSharedWorkspaceItems(nodeIds: string[]) {
    if (nodeIds.length === 0) {
      return;
    }
    const removedItems = workspaceItems.filter((item) => nodeIds.includes(item.nodeId));
    setWorkspaceItems((prev) => prev.filter((item) => !nodeIds.includes(item.nodeId)));
    void deleteBoardItems(nodeIds).catch((err) => {
      setWorkspaceItems((prev) => upsertWorkspaceItems(prev, removedItems));
      showError(err instanceof Error ? err.message : "Failed to delete board items.", err);
    });
  }

  function duplicateSharedWorkspaceItem(nodeId: string) {
    const sourceItem = workspaceItems.find((item) => item.nodeId === nodeId);
    if (!sourceItem) {
      return;
    }
    const optimisticNodeId = makeWorkspaceNodeId();
    const optimisticItem: WorkspaceItem = {
      nodeId: optimisticNodeId,
      itemId: sourceItem.itemId,
      position: {
        x: sourceItem.position.x + 12,
        y: sourceItem.position.y + 12,
      },
      isNewDiscovery: false,
      categoryConstraintName: sourceItem.categoryConstraintName ?? null,
      categoryConstraintNormalizedName:
        sourceItem.categoryConstraintNormalizedName ?? null,
      actionConstraintName: sourceItem.actionConstraintName ?? null,
      actionConstraintNormalizedName:
        sourceItem.actionConstraintNormalizedName ?? null,
    };
    setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [optimisticItem]));
    void duplicateBoardItem(nodeId, {
      nodeId: optimisticNodeId,
      position: optimisticItem.position,
    })
      .then((created) => {
        setWorkspaceItems((prev) => upsertWorkspaceItems(prev, [created as WorkspaceItem]));
      })
      .catch((err) => {
        setWorkspaceItems((prev) => prev.filter((item) => item.nodeId !== optimisticNodeId));
        showError(err instanceof Error ? err.message : "Failed to duplicate board item.", err);
      });
  }

  function claimSharedWorkspaceDrag(nodeId: string) {
    activeDragNodeIdRef.current = nodeId;
    dragSequenceRef.current = 0;
    lastDragSentAtRef.current = 0;
    void claimBoardDrag({ nodeId }).then((result) => {
      if (result.ok || activeDragNodeIdRef.current !== nodeId) {
        return;
      }
      activeDragNodeIdRef.current = null;
      dragAbortNonceRef.current += 1;
      setDragAbortSignal({
        nodeId,
        nonce: dragAbortNonceRef.current,
      });
      if (result.position != null) {
        const claimedPosition = result.position;
        setWorkspaceItems((prev) =>
          prev.map((item) =>
            item.nodeId === nodeId ? { ...item, position: claimedPosition } : item
          )
        );
      } else {
        void fetchBoardSnapshot().then((snapshot) => {
          setWorkspaceItems(applyWorkspaceSnapshot(snapshot));
        });
      }
    });
  }

  function dragSharedWorkspaceItem(nodeId: string, position: { x: number; y: number }) {
    if (activeDragNodeIdRef.current !== nodeId) {
      return;
    }
    const now = Date.now();
    if (now - lastDragSentAtRef.current < 45) {
      return;
    }
    lastDragSentAtRef.current = now;
    dragSequenceRef.current += 1;
    sendBoardDragMove({
      nodeId,
      position,
      sequence: dragSequenceRef.current,
    });
  }

  function releaseSharedWorkspaceDrag(nodeId: string, position: { x: number; y: number }) {
    activeDragNodeIdRef.current = null;
    dragSequenceRef.current += 1;
    setWorkspaceItems((prev) =>
      prev.map((item) => (item.nodeId === nodeId ? { ...item, position } : item))
    );
    void endBoardDrag({
      nodeId,
      position,
      sequence: dragSequenceRef.current,
    }).then((result) => {
      if (!result.ok && result.position != null) {
        const releasedPosition = result.position;
        setWorkspaceItems((prev) =>
          prev.map((item) =>
            item.nodeId === nodeId ? { ...item, position: releasedPosition } : item
          )
        );
      }
    });
  }

  function publishSharedSelection(nodeIds: string[], layout?: SelectionCombineLayout | null) {
    publishBoardSelectionState({
      nodeIds,
      layout: layout ?? null,
    });
  }

  function publishSharedActivity(
    nodeIds: string[],
    mode: SharedBoardActivityMode | null,
    layout?: SelectionCombineLayout | null
  ) {
    publishBoardActivityState({
      nodeIds,
      layout: layout ?? null,
      mode,
    });
  }

  async function combineWorkspaceNodeIds(
    nodeIds: string[],
    options?: {
      mode?: "selection" | "direct";
      selectionLayout?: SelectionCombineLayout | null;
      resultCenter?: { x: number; y: number } | null;
    }
  ): Promise<boolean> {
    const uniqueNodeIds = Array.from(new Set(nodeIds));
    if (uniqueNodeIds.length < 2) {
      return false;
    }
    if (uniqueNodeIds.some((nodeId) => combiningNodeIds.includes(nodeId))) {
      showError("One or more selected items are already combining.", null);
      return false;
    }
    let operationCombiningIds = uniqueNodeIds;

    const selectedNodes = uniqueNodeIds
      .map((nodeId) => workspaceItems.find((entry) => entry.nodeId === nodeId))
      .filter(Boolean) as WorkspaceItem[];
    if (selectedNodes.length < 2) {
      return false;
    }

    const selectedItems = selectedNodes
      .map((node) => findItemById(node.itemId))
      .filter(Boolean) as Item[];
    if (selectedItems.length < 2) {
      return false;
    }

    const creativeCatalyst = selectedItems.find((item) => item.id === CREATIVE_ITEM_ID) ?? null;
    const actionCatalysts = selectedItems
      .map((item) => ACTION_CATALYST_BY_ID.get(item.id) ?? null)
      .filter((entry): entry is NonNullable<(typeof ACTION_CATALYSTS)[number]> => entry != null);
    const categoryAnchors = selectedNodes.filter(
      (node) => node.categoryConstraintName && node.categoryConstraintNormalizedName
    );
    const actionAnchors = selectedNodes.filter(
      (node) => node.actionConstraintName && node.actionConstraintNormalizedName
    );
    const activeCatalystCount = [creativeCatalyst, actionCatalysts[0] ?? null].filter(Boolean)
      .length;
    if (activeCatalystCount > 1 || actionCatalysts.length > 1) {
      showError("Use only one catalyst at a time.", null);
      return false;
    }
    if (categoryAnchors.length > 1) {
      showError("Use only one Category modifier at a time.", null);
      return false;
    }
    if (actionAnchors.length > 1) {
      showError("Use only one Action modifier at a time.", null);
      return false;
    }
    const categoryAnchor = categoryAnchors[0] ?? null;
    const actionAnchor = actionAnchors[0] ?? null;
    const actionCatalyst = actionCatalysts[0] ?? null;
    const effectiveActionConstraint =
      actionAnchor?.actionConstraintName ?? actionCatalyst?.actionConstraint ?? null;
    const resolvedActionFamilyKey = resolveActionPromptFamilyKey(effectiveActionConstraint);
    const isCompoundCombine = resolvedActionFamilyKey === "compound";
    const usesWebSearch = resolvedActionFamilyKey === "pop_culture";
    const actualInputItems = selectedItems.filter((item) => !NON_INGREDIENT_ITEM_IDS.has(item.id));
    const effectiveInputNodes = selectedNodes
      .filter(
        (node) =>
          node.nodeId !== categoryAnchor?.nodeId && node.nodeId !== actionAnchor?.nodeId
      )
      .filter((node) => {
        const item = findItemById(node.itemId);
        return !!item && !NON_INGREDIENT_ITEM_IDS.has(item.id);
      });
    if (isCompoundCombine) {
      effectiveInputNodes.sort((left, right) => {
        if (left.position.x !== right.position.x) {
          return left.position.x - right.position.x;
        }
        return left.position.y - right.position.y;
      });
    }
    const effectiveInputItems = effectiveInputNodes
      .map((node) => findItemById(node.itemId))
      .filter((item): item is Item => !!item);
    const catalystLabel = creativeCatalyst
      ? "Creative Spark"
      : actionCatalyst
        ? actionCatalyst.actionConstraint
      : categoryAnchor && actionAnchor
        ? "Category + Action"
      : categoryAnchor
        ? "Category"
      : actionAnchor
        ? "Action"
        : null;
    if (effectiveInputItems.length === 0) {
      showError(
        catalystLabel
          ? `${catalystLabel} needs at least one regular item to combine.`
          : "No regular items selected.",
        null
      );
      return false;
    }
    if (
      !creativeCatalyst &&
      !actionCatalyst &&
      !categoryAnchor &&
      !actionAnchor &&
      actualInputItems.length < 2
    ) {
      return false;
    }

    const inputNames = effectiveInputItems.map((item) => item.name);
    const combineMode = options?.mode ?? "direct";
    const usesPendingPlaceholder = combineMode === "selection";
    let pendingPlaceholderNodeId: string | null = null;
    let publishedActivityNodeIds = uniqueNodeIds;
    const activityMode: SharedBoardActivityMode = usesWebSearch ? "searching" : "combining";

    try {
      const selectionLayout = options?.selectionLayout ?? null;
      const center =
        options?.resultCenter ??
        (() => {
          const centerSum = selectedNodes.reduce(
            (acc, node) => ({
              x: acc.x + node.position.x,
              y: acc.y + node.position.y,
            }),
            { x: 0, y: 0 }
          );
          return {
            x: centerSum.x / selectedNodes.length,
            y: centerSum.y / selectedNodes.length,
          };
        })();
      const placeholderPosition = selectionLayout?.placeholderPosition ?? center;
      if (usesPendingPlaceholder) {
        const pendingPlaceholder = await createBoardItem({
          nodeId: selectionLayout?.placeholderNodeId,
          itemId: COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
          position: placeholderPosition,
        });
        pendingPlaceholderNodeId = pendingPlaceholder.nodeId;
        operationCombiningIds = [...uniqueNodeIds, pendingPlaceholder.nodeId];
      }
      publishedActivityNodeIds = operationCombiningIds;

      setCombiningNodeIds((prev) => Array.from(new Set([...prev, ...operationCombiningIds])));
      if (usesWebSearch) {
        setWebSearchingNodeIds((prev) =>
          Array.from(new Set([...prev, ...operationCombiningIds]))
        );
      }
      publishSharedActivity(
        publishedActivityNodeIds,
        activityMode,
        usesPendingPlaceholder ? selectionLayout : null
      );
      const recipe = await combineElements(inputNames, {
        creative: Boolean(creativeCatalyst),
        ponderificate: false,
        categoryConstraint: categoryAnchor?.categoryConstraintName ?? undefined,
        actionConstraint: effectiveActionConstraint ?? undefined,
        model: selectedModel,
      });

      const producedItems =
        recipe.resultElements && recipe.resultElements.length > 0
          ? recipe.resultElements
          : recipe.resultElement
            ? [recipe.resultElement]
            : [];
      const autoUnlockedActionWords = recipe.autoUnlockedActionWords ?? [];
      const newlyCompletedQuestNames = recipe.newlyCompletedQuestNames ?? [];
      const completedQuestMatches = recipe.completedQuestMatches ?? [];

      if (producedItems.length === 0) {
        showError("Combine returned no result item.", null);
        return false;
      }

      setItems((prev) => {
        const next = [...prev];
        for (const producedItem of [
          ...producedItems,
          ...autoUnlockedActionWords.map((entry) => entry.element),
        ]) {
          if (!next.some((entry) => entry.id === producedItem.id)) {
            next.push(producedItem);
          }
        }
        return next;
      });
      const producedItemsWithDiscovery = producedItems.map((producedItem) => ({
        item: producedItem,
        isNewDiscovery: !items.some((entry) => entry.id === producedItem.id),
      }));
      const hasNewDiscovery = producedItemsWithDiscovery.some((produced) => produced.isNewDiscovery);
      const newlyDiscoveredProducedItems = producedItemsWithDiscovery.filter(
        (produced) => produced.isNewDiscovery
      );
      const newestDiscoveredItem =
        newlyDiscoveredProducedItems.length > 0
          ? newlyDiscoveredProducedItems[newlyDiscoveredProducedItems.length - 1].item
          : null;
      if (autoUnlockedActionWords.length > 0) {
        setActionUnlockModal({
          unlockedWords: autoUnlockedActionWords,
        });
      }

      const spawnOffset = producedItemsWithDiscovery.length > 1 ? 56 : 0;
      const producedBoardItems = producedItemsWithDiscovery.map((produced, index) => ({
        itemId: produced.item.id,
        position: {
          x: placeholderPosition.x + index * 112 - spawnOffset,
          y: placeholderPosition.y,
        },
        isNewDiscovery: produced.isNewDiscovery,
        arrivalHighlightMode: "combine" as const,
      }));
      const celebrationMatchedItemName =
        completedQuestMatches.find((match) =>
          producedItemsWithDiscovery.some(
            (produced) =>
              normalizeItemName(produced.item.normalizedName || produced.item.name) ===
              normalizeItemName(match.matchedItemName)
          )
        )?.matchedItemName ?? null;
      const celebrationItemIndex =
        celebrationMatchedItemName != null
          ? producedItemsWithDiscovery.findIndex(
              (produced) =>
                normalizeItemName(produced.item.normalizedName || produced.item.name) ===
                normalizeItemName(celebrationMatchedItemName)
            )
          : newestDiscoveredItem != null
            ? producedItemsWithDiscovery.findIndex(
                (produced) => produced.item.id === newestDiscoveredItem.id
              )
            : -1;
      await combineBoardItems({
        consumedNodeIds: uniqueNodeIds,
        placeholderNodeId: pendingPlaceholderNodeId ?? undefined,
        producedItems: producedBoardItems,
        questSync:
          newlyCompletedQuestNames.length > 0 ||
          (recipe.completedQuestSets && recipe.completedQuestSets.length > 0) ||
          recipe.totalPoints != null
            ? {
                newlyCompletedQuestNames,
                completedQuestSets: recipe.completedQuestSets,
                totalPoints: recipe.totalPoints,
                celebrationProducedItemIndex:
                  celebrationItemIndex >= 0 ? celebrationItemIndex : null,
              }
            : undefined,
      });
      if (
        newlyCompletedQuestNames.length > 0 ||
        (recipe.completedQuestSets && recipe.completedQuestSets.length > 0)
      ) {
        try {
          const result = await fetchQuests();
          const hasTrackedQuest = result.quests.some((quest) => quest.status === "tracked");
          const nextAvailableQuest = result.quests.find((quest) => quest.status === "available");

          if (!hasTrackedQuest && nextAvailableQuest) {
            const trackedResult = await updateQuestStatus({
              name: nextAvailableQuest.name,
              status: "tracked",
            });
            setQuests(trackedResult.quests);
            applyQuestStats(trackedResult.stats);
          } else {
            setQuests(result.quests);
            applyQuestStats(result.stats);
          }
        } catch {
        }
      }
      if (hasNewDiscovery) {
        void loadFeatureUnlocks();
      }
      return true;
    } catch (err) {
      if (pendingPlaceholderNodeId) {
        void deleteBoardItems([pendingPlaceholderNodeId]).catch(() => {});
      }
      showError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to combine items. Please try again.",
        err
      );
      return false;
    } finally {
      publishSharedActivity([], null, null);
      setCombiningNodeIds((prev) =>
        prev.filter((nodeId) => !operationCombiningIds.includes(nodeId))
      );
      setWebSearchingNodeIds((prev) =>
        prev.filter((nodeId) => !operationCombiningIds.includes(nodeId))
      );
    }
  }

  async function combineWorkspaceItems(
    sourceNodeId: string,
    targetNodeId: string,
    resultCenter?: { x: number; y: number }
  ) {
    if (sourceNodeId === targetNodeId) {
      return;
    }
    await combineWorkspaceNodeIds([sourceNodeId, targetNodeId], {
      mode: "direct",
      resultCenter: resultCenter ?? null,
    });
  }

  async function combineWorkspaceSelection(selectionLayout: SelectionCombineLayout) {
    await combineWorkspaceNodeIds(selectionLayout.nodeIds, {
      mode: "selection",
      selectionLayout,
    });
  }

  const visibleCombiningNodeIds = useMemo(
    () => Array.from(new Set([...combiningNodeIds, ...remoteActivityNodeIds])),
    [combiningNodeIds, remoteActivityNodeIds]
  );

  return {
    workspaceItems,
    setWorkspaceItems,
    canUndoWorkspace,
    setCanUndoWorkspace,
    isUndoingWorkspace,
    combiningNodeIds,
    webSearchingNodeIds,
    remoteSelectedNodeIds,
    setRemoteSelectedNodeIds,
    remoteSelectionLayout,
    setRemoteSelectionLayout,
    remoteActivityNodeIds,
    setRemoteActivityNodeIds,
    remoteActivityLayout,
    setRemoteActivityLayout,
    remoteActivityMode,
    setRemoteActivityMode,
    remoteViewportCenters,
    setRemoteViewportCenters,
    dragAbortSignal,
    refreshSharedItemsIfNeeded,
    undoWorkspaceBoardAction,
    addItemToWorkspace,
    addLibraryItemToWorkspace,
    addLibraryItemToWorkspaceAsActionAnchor,
    attachCategoryModifier,
    attachActionModifier,
    clearCategoryModifier,
    clearActionModifier,
    clearWorkspaceItems,
    handleViewportCenterChange,
    moveSharedWorkspaceItems,
    dragSharedWorkspaceGroup,
    deleteSharedWorkspaceItems,
    duplicateSharedWorkspaceItem,
    claimSharedWorkspaceDrag,
    dragSharedWorkspaceItem,
    releaseSharedWorkspaceDrag,
    publishSharedSelection,
    combineWorkspaceItems,
    combineWorkspaceSelection,
    visibleCombiningNodeIds,
  };
}
