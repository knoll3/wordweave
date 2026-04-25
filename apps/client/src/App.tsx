import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SharedBoardPatch, SharedRoomSnapshot } from "./liveBoardTypes";
import {
  ScrollText,
  Tags,
  Undo2,
  Zap,
} from "lucide-react";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM_ID,
} from "./types";
import type {
  AutoUnlockedActionWord,
  AiModel,
  FeatureUnlockStatus,
  Item,
  UnlockKey,
  WorkspaceItem,
} from "./types";
import ElementSidebar from "./components/Sidebar/ElementSidebar";
import AppLayout from "./components/AppLayout";
import AppRightPanel from "./components/AppRightPanel";
import GraphView from "./components/Graph/GraphView";
import type { CatalystAction } from "./components/Graph/CatalystDock";
import { useLiveBoardSubscriptions } from "./hooks/useLiveBoardSubscriptions";
import { useMobileKeyboardWorkarounds } from "./hooks/useMobileKeyboardWorkarounds";
import { useQuestReferences } from "./hooks/useQuestReferences";
import { useQuestState } from "./hooks/useQuestState";
import { useResponsiveLayout } from "./hooks/useResponsiveLayout";
import { useSettings } from "./hooks/useSettings";
import { useBoardState } from "./hooks/useBoardState";
import { fetchUnlockStatuses } from "./lib/api";
import {
  ACTION_PROMPT_FAMILY_REFERENCES,
  normalizeActionTrigger,
} from "./lib/actionPromptFamilies";
import {
  ACTION_CATALYSTS,
  SPECIAL_ITEMS,
} from "./lib/specialItems";

const AI_MODELS: AiModel[] = [
  "gpt-5.4",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
];
const MODEL_STORAGE_KEY = "wordweave.ai-model";
const FORCE_UNLOCKS_STORAGE_KEY = "wordweave.force-unlocks";
const TOAST_DURATION_MS = 3500;
const QUEST_REFERENCE_PREVIEW_LIMIT = 180;
const PORTRAIT_TABLET_LAYOUT_QUERY = "(orientation: portrait)";
const MOBILE_LAYOUT_QUERY = "(max-width: 600px)";
type ActionUnlockModalState = {
  unlockedWords: AutoUnlockedActionWord[];
};

function truncateReferencePreview(value: string, limit: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase();
}

function applyWorkspaceSnapshot(snapshot: SharedRoomSnapshot) {
  return snapshot.boardItems as WorkspaceItem[];
}

function stripWorkspaceArrivalHighlights(entries: WorkspaceItem[]) {
  return entries.map((item) => ({
    ...item,
    arrivalHighlightMode: undefined,
  }));
}

function applyWorkspacePatch(
  current: WorkspaceItem[],
  patch: SharedBoardPatch
): WorkspaceItem[] {
  const deletedIds = new Set(patch.deletedNodeIds);
  const byId = new Map(
    current
      .filter((item) => !deletedIds.has(item.nodeId))
      .map((item) => [item.nodeId, item])
  );

  for (const item of patch.upserts) {
    byId.set(item.nodeId, item as WorkspaceItem);
  }

  return [...byId.values()];
}

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [hasLoadedInitialLibrary, setHasLoadedInitialLibrary] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [featureUnlocks, setFeatureUnlocks] = useState<FeatureUnlockStatus[]>([]);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<"journal" | "item" | "quest">(
    "journal"
  );
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<number[]>([]);
  const [actionUnlockModal, setActionUnlockModal] = useState<ActionUnlockModalState | null>(
    null
  );
  const [librarySearchQuery, setLibrarySearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { isPortraitTabletLayout, isMobileLayout } = useResponsiveLayout({
    portraitTabletLayoutQuery: PORTRAIT_TABLET_LAYOUT_QUERY,
    mobileLayoutQuery: MOBILE_LAYOUT_QUERY,
  });
  const {
    selectedModel,
    setSelectedModel,
    forceUnlocks,
    setForceUnlocks,
  } = useSettings({
    modelStorageKey: MODEL_STORAGE_KEY,
    forceUnlocksStorageKey: FORCE_UNLOCKS_STORAGE_KEY,
    supportedModels: AI_MODELS,
    defaultModel: "gpt-5-mini",
  });
  const journalDockRef = useRef<HTMLElement | null>(null);
  const hasHydratedSharedSnapshotRef = useRef(false);
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const isRestoringWorkspace = false;
  const {
    androidViewportHeight,
    androidKeyboardHeight,
    clearMobileSearchFocus,
  } = useMobileKeyboardWorkarounds({
    isMobileLayout,
    isSearchFocused,
    setIsSearchFocused,
    isAndroidDevice,
  });
  const {
    quests,
    setQuests,
    visibleQuests,
    trackedQuestNames,
    completedQuestNames,
    selectedQuest,
    selectedQuestName,
    setSelectedQuestName,
    visibleTrackedQuests,
    questStats,
    questPointsHighlightKey,
    applyQuestStats,
    isQuestModalOpen,
    questTopicInput,
    questDraft,
    selectedQuestDraftTargets,
    isGeneratingQuests,
    openQuestGenerationModal,
    updateQuestTopicInput,
    closeQuestGenerationModal,
    submitQuestGenerationTopic,
    toggleQuestDraftTarget,
    clearQuestDraftSelection,
    selectAllQuestDraftTargets,
    acceptQuestGenerationDraft,
    openQuestDetails,
    pendingQuestAction,
    trackQuest,
    untrackQuest,
    pendingAbandonedQuestName,
    setPendingAbandonedQuestName,
    abandonQuest,
    questCelebration,
    questSetCelebration,
    setQuestSetCelebration,
    celebratedQuestNodeId,
    applyNewlyCompletedQuests,
    showQuestSetCelebration,
  } = useQuestState({
    setRightPanelMode,
    setIsJournalOpen,
    onError: showError,
  });

  useEffect(() => {
    if (!isPortraitTabletLayout || !isJournalOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const dock = journalDockRef.current;
      if (!(target instanceof Node) || !dock) {
        return;
      }
      if (dock.contains(target)) {
        return;
      }
      setIsJournalOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isJournalOpen, isPortraitTabletLayout]);

  useEffect(() => {
    if (!errorMessage) return;
    const timeoutId = window.setTimeout(() => {
      setErrorMessage(null);
    }, TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [errorMessage]);

  useEffect(() => {
    void loadFeatureUnlocks();
  }, []);

  const {
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
  } = useBoardState({
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
  });

  useLiveBoardSubscriptions({
    applyWorkspaceSnapshot,
    stripWorkspaceArrivalHighlights,
    applyWorkspacePatch,
    hasHydratedSharedSnapshotRef,
    setCanUndoWorkspace,
    setWorkspaceItems,
    refreshSharedItemsIfNeeded,
    setRemoteSelectedNodeIds,
    setRemoteSelectionLayout,
    setRemoteActivityNodeIds,
    setRemoteActivityLayout,
    setRemoteActivityMode,
    setQuests,
    applyQuestStats,
    setRemoteViewportCenters,
    applyNewlyCompletedQuests,
    showQuestSetCelebration,
    questStatsTotalPoints: questStats.totalPoints,
  });

  const questReferences = useQuestReferences(visibleQuests, isJournalOpen);

  function showError(message: string, err: unknown) {
    void err;
    setErrorMessage(message);
  }

  async function loadFeatureUnlocks() {
    try {
      const statuses = await fetchUnlockStatuses();
      setFeatureUnlocks(statuses);
    } catch {
    }
  }

  function isFeatureUnlocked(key: UnlockKey) {
    if (forceUnlocks) return true;
    return featureUnlocks.some((unlock) => unlock.key === key && unlock.unlocked);
  }

  function openJournal() {
    setSelectedQuestName(null);
    setRightPanelMode("journal");
    setIsJournalOpen(true);
  }
  const itemById = useMemo(() => {
    const next = new Map(items.map((item) => [item.id, item]));
    for (const item of SPECIAL_ITEMS) {
      next.set(item.id, item);
    }
    return next;
  }, [items]);
  const itemByNormalizedName = useMemo(
    () =>
      new Map(
        items.map((item) => [
          normalizeItemName(item.normalizedName || item.name),
          item,
        ] as const)
      ),
    [items]
  );
  const drawerItem = drawerItemId == null ? null : itemById.get(drawerItemId) ?? null;
  const selectedQuestItem =
    selectedQuest == null
      ? null
      : selectedQuest.matchedItemName == null
        ? null
        : itemByNormalizedName.get(normalizeItemName(selectedQuest.matchedItemName)) ?? null;
  const unlockedCatalystFamilyKeys = useMemo(() => {
    const discoveredTriggerNames = new Set(
      items.map((item) => normalizeActionTrigger(item.normalizedName || item.name))
    );
    return new Set(
      ACTION_PROMPT_FAMILY_REFERENCES.filter((family) =>
        family.triggerWords.some((word) =>
          discoveredTriggerNames.has(normalizeActionTrigger(word))
        )
      ).map((family) => family.key)
    );
  }, [items]);
  const catalystActions = useMemo(() => {
    const actions: CatalystAction[] = [];

    actions.push({
      key: "category",
      title: "Category",
      badgeLabel: "mod",
      icon: <Tags size={16} strokeWidth={2} />,
      tint: "rgba(20, 184, 166, 0.22)",
      iconTint: "#99f6e4",
      onClick: () => addItemToWorkspace(CATEGORY_MODIFIER_ITEM_ID),
    });

    actions.push({
      key: "action",
      title: "Action",
      badgeLabel: "mod",
      icon: <Zap size={16} strokeWidth={2} />,
      tint: "rgba(251, 191, 36, 0.22)",
      iconTint: "#fde68a",
      onClick: () => addItemToWorkspace(ACTION_MODIFIER_ITEM_ID),
    });

    for (const catalyst of ACTION_CATALYSTS) {
      if (!unlockedCatalystFamilyKeys.has(catalyst.familyKey)) {
        continue;
      }
      actions.push({
        key: catalyst.familyKey,
        title: catalyst.actionConstraint,
        icon: catalyst.item.icon ?? catalyst.actionConstraint.charAt(0),
        tint: catalyst.tint,
        iconTint: catalyst.iconTint,
        onClick: () => addItemToWorkspace(catalyst.item.id),
      });
    }

    return actions;
  }, [items, unlockedCatalystFamilyKeys]);

  function openItemDetails(item: Item) {
    setDrawerItemId((current) => {
      if (current === item.id) {
        setRightPanelMode("item");
        setIsJournalOpen(true);
        return current;
      }
      setDrawerHistory((history) =>
        current == null ? [] : [...history, current]
      );
      setRightPanelMode("item");
      setIsJournalOpen(true);
      return item.id;
    });
  }

  function closeItemDetails() {
    setDrawerItemId(null);
    setDrawerHistory([]);
    setIsJournalOpen(false);
  }

  function goBackInItemDetails() {
    setDrawerHistory((history) => {
      const previousItemId = history[history.length - 1] ?? null;
      setDrawerItemId(previousItemId);
      setRightPanelMode(previousItemId == null ? "journal" : "item");
      return history.slice(0, -1);
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
      {questCelebration ? (
        <div className="quest-complete-toast" aria-live="assertive" role="status">
          <div className="quest-complete-toast-kicker">{questCelebration.kicker}</div>
          <div className="quest-complete-toast-title">{questCelebration.title}</div>
          <div className="quest-complete-toast-copy">{questCelebration.copy}</div>
        </div>
      ) : null}
      {questSetCelebration ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setQuestSetCelebration(null)}
          />
          <div className="quest-set-complete-panel" role="dialog" aria-modal="true">
            <div className="quest-set-complete-kicker">Quest Set Complete</div>
            <div className="quest-set-complete-title">{questSetCelebration.title}</div>
            <div className="quest-set-complete-copy">
              You finished all {questSetCelebration.questCount} quests in this set and earned{" "}
              {questSetCelebration.earnedPoints} bonus points.
            </div>
            <div className="quest-set-complete-graph" aria-hidden="true">
              <div className="quest-set-complete-bar quest-set-complete-bar-progress">
                <span>Set finished</span>
                <strong>{questSetCelebration.questCount}/{questSetCelebration.questCount}</strong>
              </div>
              <div className="quest-set-complete-bar quest-set-complete-bar-points">
                <span>Bonus points</span>
                <strong>+{questSetCelebration.earnedPoints}</strong>
              </div>
              <div className="quest-set-complete-bar quest-set-complete-bar-total">
                <span>Total score</span>
                <strong>{questSetCelebration.totalPoints}</strong>
              </div>
            </div>
            <div className="quest-set-complete-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => setQuestSetCelebration(null)}
              >
                Nice
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {actionUnlockModal ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setActionUnlockModal(null)}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">
              {actionUnlockModal.unlockedWords.length === 1
                ? `${actionUnlockModal.unlockedWords[0].familyTitle} unlocked`
                : "New action words unlocked"}
            </h3>
            <p className="confirm-text">
              {actionUnlockModal.unlockedWords.length === 1
                ? `${actionUnlockModal.unlockedWords[0].triggerWord} belongs to the ${actionUnlockModal.unlockedWords[0].familyTitle} action family, so ${actionUnlockModal.unlockedWords[0].element.name} was added to your library automatically.`
                : "You discovered words that belong to special action families, so their main action words were added to your library automatically."}
            </p>
            <div className="item-drawer-chip-row">
              {actionUnlockModal.unlockedWords.map((entry) => (
                <button
                  key={`${entry.familyKey}-${entry.element.id}`}
                  type="button"
                  className="item-drawer-chip"
                  onClick={() => {
                    addLibraryItemToWorkspace(entry.element);
                    setActionUnlockModal(null);
                  }}
                >
                  {entry.element.name}
                </button>
              ))}
            </div>
            <p className="confirm-text">
              Add one of these words to the workspace, attach the <strong>Action</strong>{" "}
              modifier to it, then combine it with other clues to use that specialized
              action behavior.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setActionUnlockModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingAbandonedQuestName ? (
        <div className="confirm-overlay" role="presentation">
          <div
            className="confirm-backdrop"
            onClick={() => setPendingAbandonedQuestName(null)}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true">
            <h3 className="confirm-title">Abandon Quest?</h3>
            <p className="confirm-text">
              <strong>{pendingAbandonedQuestName}</strong> will be removed from the quest list.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button secondary"
                disabled={
                  pendingQuestAction?.name === pendingAbandonedQuestName &&
                  pendingQuestAction.kind === "abandon"
                }
                onClick={() => setPendingAbandonedQuestName(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={
                  pendingQuestAction?.name === pendingAbandonedQuestName &&
                  pendingQuestAction.kind === "abandon"
                }
                onClick={() => abandonQuest(pendingAbandonedQuestName)}
              >
                {pendingQuestAction?.name === pendingAbandonedQuestName &&
                pendingQuestAction.kind === "abandon"
                  ? "Abandoning…"
                  : "Abandon Quest"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <AppLayout
        rootClassName={`app-root${isMobileLayout ? " is-mobile" : ""}${
          isMobileLayout && isSearchFocused ? " is-search-focused" : ""
        }${
          isMobileLayout && !isSearchFocused && !librarySearchQuery.trim()
            ? " is-mobile-library-collapsed"
            : ""
        }`}
        rootStyle={
          isAndroidDevice && isPortraitTabletLayout && androidViewportHeight != null
            ? ({
                ["--app-viewport-height" as string]: `${androidViewportHeight}px`,
                ["--android-keyboard-height" as string]: `${androidKeyboardHeight}px`,
              } as React.CSSProperties)
            : undefined
        }
        sidebar={
          <ElementSidebar
            items={items}
            isMobileLayout={isMobileLayout}
            totalQuestPoints={questStats.totalPoints}
            questPointsHighlightKey={questPointsHighlightKey}
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onItemsLoaded={(nextItems) => {
              setItems(nextItems);
              setHasLoadedInitialLibrary(true);
            }}
            randomUnlocked={isFeatureUnlocked("random_tools")}
            canUndoWorkspace={canUndoWorkspace && !isUndoingWorkspace && combiningNodeIds.length === 0}
            onUndoWorkspace={undoWorkspaceBoardAction}
            onSearchFocusChange={setIsSearchFocused}
            onSearchQueryChange={setLibrarySearchQuery}
          />
        }
        workspace={
          <div className="graph-wrapper">
            {isPortraitTabletLayout ? null : (
              <div className="graph-header">
                <h2 className="section-title">Crafting workspace</h2>
              </div>
            )}
            <div className="graph-canvas">
              {isMobileLayout ? (
                <div className="graph-undo-button-overlay">
                  <button
                    type="button"
                    className="graph-overlay-icon-button graph-undo-button-trigger"
                    onClick={() => void undoWorkspaceBoardAction()}
                    disabled={
                      !canUndoWorkspace ||
                      isUndoingWorkspace ||
                      combiningNodeIds.length > 0
                    }
                    aria-label="Undo last board action"
                    title="Undo last board action"
                  >
                    <Undo2 size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {isPortraitTabletLayout ? (
                <div className="graph-quests-button-overlay">
                  <button
                    type="button"
                    className="graph-overlay-icon-button graph-quests-button-trigger"
                    onClick={() => openJournal()}
                    aria-label="Open quests"
                    title="Open quests"
                  >
                    <ScrollText size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                  {visibleTrackedQuests.length > 0 ? (
                    <div className="graph-quest-target-chip-list">
                      {visibleTrackedQuests.map((quest) => (
                        <button
                          key={quest.name}
                          type="button"
                          className="graph-quest-target-chip"
                          onClick={() => openJournal()}
                          title={quest.name}
                        >
                          <span className="graph-quest-target-chip-marker" aria-hidden="true">
                            ◎
                          </span>
                          <span className="graph-quest-target-chip-label">{quest.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <GraphView
                items={items}
                workspaceItems={workspaceItems}
                isRestoringWorkspace={isRestoringWorkspace}
                celebratedNodeId={celebratedQuestNodeId}
                onAttachActionModifier={attachActionModifier}
                onAttachCategoryModifier={attachCategoryModifier}
                onMoveWorkspaceItems={moveSharedWorkspaceItems}
                onDeleteWorkspaceItems={deleteSharedWorkspaceItems}
                onDuplicateWorkspaceItem={duplicateSharedWorkspaceItem}
                onClaimWorkspaceDrag={claimSharedWorkspaceDrag}
                onDragWorkspaceItem={dragSharedWorkspaceItem}
                onReleaseWorkspaceDrag={releaseSharedWorkspaceDrag}
                onDragWorkspaceGroup={dragSharedWorkspaceGroup}
                remoteSelectedNodeIds={remoteSelectedNodeIds}
                remoteSelectionLayout={remoteSelectionLayout}
                remoteActivityNodeIds={remoteActivityNodeIds}
                remoteActivityLayout={remoteActivityLayout}
                remoteActivityMode={remoteActivityMode}
                remoteViewportCenters={remoteViewportCenters}
                dragAbortSignal={dragAbortSignal}
                onSelectionStateChange={publishSharedSelection}
                onViewportCenterChange={handleViewportCenterChange}
                combiningNodeIds={visibleCombiningNodeIds}
                webSearchingNodeIds={webSearchingNodeIds}
                onClearActionModifier={clearActionModifier}
                onClearCategoryModifier={clearCategoryModifier}
                onClearWorkspace={clearWorkspaceItems}
                onCombineWorkspaceItems={combineWorkspaceItems}
                onCombineWorkspaceSelection={combineWorkspaceSelection}
                onOpenItemDetails={openItemDetails}
                catalystActions={catalystActions}
                closeCatalystMenuOnSelect={isMobileLayout}
              />
            </div>
          </div>
        }
        rightPanel={
          <AppRightPanel
            dockRef={journalDockRef}
            isOpen={isJournalOpen}
            isTransient={isPortraitTabletLayout}
            mode={rightPanelMode}
            questReferences={questReferences}
            referencePreviewLimit={QUEST_REFERENCE_PREVIEW_LIMIT}
            quests={visibleQuests}
            trackedQuestNames={trackedQuestNames}
            completedQuestNames={completedQuestNames}
            isGeneratingQuests={isGeneratingQuests}
            selectedQuest={selectedQuest}
            selectedQuestItem={selectedQuestItem}
            item={drawerItem}
            items={items}
            itemsById={itemById}
            canGoBack={drawerHistory.length > 0}
            onBack={goBackInItemDetails}
            onAddItemToWorkspace={addLibraryItemToWorkspace}
            onAddItemToWorkspaceAsActionAnchor={addLibraryItemToWorkspaceAsActionAnchor}
            onCloseItem={closeItemDetails}
            onCloseQuest={() => {
              setRightPanelMode("journal");
              setSelectedQuestName(null);
            }}
            onBackToJournal={openJournal}
            onSelectItem={openItemDetails}
            onCollapse={() => setIsJournalOpen(false)}
            onStartQuestDraftSession={openQuestGenerationModal}
            onSelectQuest={openQuestDetails}
            onTrackQuest={trackQuest}
            onUntrackQuest={untrackQuest}
            onRequestAbandonQuest={setPendingAbandonedQuestName}
            pendingQuestAction={pendingQuestAction}
            truncateReference={truncateReferencePreview}
            isQuestModalOpen={isQuestModalOpen}
            questTopicInput={questTopicInput}
            questDraft={questDraft}
            selectedQuestDraftTargets={selectedQuestDraftTargets}
            onTopicChange={updateQuestTopicInput}
            onCloseQuestModal={closeQuestGenerationModal}
            onSubmitQuestTopic={() => {
              void submitQuestGenerationTopic();
            }}
            onToggleQuestTarget={toggleQuestDraftTarget}
            onSelectAllQuestTargets={selectAllQuestDraftTargets}
            onDeselectAllQuestTargets={clearQuestDraftSelection}
            onAcceptQuestDraft={() => {
              void acceptQuestGenerationDraft();
            }}
          />
        }
      />
    </>
  );
};

export default App;
