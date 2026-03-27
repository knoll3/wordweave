import React from "react";
import { PanelRightClose } from "lucide-react";
import type { ChallengeTarget, Item } from "../../types";
import type { ItemReference } from "../../lib/api";
import ItemDetailsDrawer from "../Graph/ItemDetailsDrawer";
import QuestDetailsPanel from "../Graph/QuestDetailsPanel";

interface Props {
  dockRef?: React.Ref<HTMLElement>;
  isOpen: boolean;
  isTransient?: boolean;
  mode: "journal" | "item" | "quest";
  questReferences: Record<string, ItemReference | null | undefined>;
  referencePreviewLimit: number;
  challengeTargets: ChallengeTarget[];
  trackedQuestNames: Set<string>;
  completedQuestNames: Set<string>;
  isGeneratingChallengeTargets: boolean;
  selectedQuest: ChallengeTarget | null;
  selectedQuestItem: Item | null;
  item: Item | null;
  items: Item[];
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  onBack: () => void;
  onAddItemToWorkspace: (item: Item) => void;
  onAddItemToWorkspaceAsActionAnchor: (item: Item) => void;
  onCloseItem: () => void;
  onCloseQuest: () => void;
  onBackToJournal: () => void;
  onSelectItem: (item: Item) => void;
  onCollapse: () => void;
  onGenerateEasyQuests: () => void;
  onGenerateHardQuests: () => void;
  onSelectQuest: (quest: ChallengeTarget) => void;
  onTrackQuest: (questName: string) => void;
  onUntrackQuest: (questName: string) => void;
  onRequestAbandonQuest: (questName: string) => void;
  truncateReference: (value: string, limit: number) => string;
}

const JournalDock: React.FC<Props> = ({
  dockRef,
  isOpen,
  isTransient = false,
  mode,
  questReferences,
  referencePreviewLimit,
  challengeTargets,
  trackedQuestNames,
  completedQuestNames,
  isGeneratingChallengeTargets,
  selectedQuest,
  selectedQuestItem,
  item,
  items,
  itemsById,
  canGoBack,
  onBack,
  onAddItemToWorkspace,
  onAddItemToWorkspaceAsActionAnchor,
  onCloseItem,
  onCloseQuest,
  onBackToJournal,
  onSelectItem,
  onCollapse,
  onGenerateEasyQuests,
  onGenerateHardQuests,
  onSelectQuest,
  onTrackQuest,
  onUntrackQuest,
  onRequestAbandonQuest,
  truncateReference,
}) => {
  const trackedQuests = challengeTargets.filter((quest) =>
    trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const availableQuests = challengeTargets.filter(
    (quest) => !trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const completedQuests = challengeTargets.filter((quest) =>
    completedQuestNames.has(quest.name)
  );

  const renderQuestCard = (
    quest: ChallengeTarget,
    section: "tracked" | "available" | "completed"
  ) => {
    const questReference = questReferences[quest.name];
    const previewText =
      questReference === undefined
        ? "Loading description…"
        : questReference?.summary
          ? truncateReference(questReference.summary, referencePreviewLimit)
          : "No reference summary found yet.";
    const isCompleted = section === "completed";
    const isTracked = section === "tracked";

    return (
      <article
        key={quest.name}
        className={`quest-card quest-card-target${isCompleted ? " is-complete" : ""}`}
      >
        <div className="quest-card-top">
          <div className="quest-card-title-wrap">
            <span className="quest-card-icon" aria-hidden="true">
              {quest.icon}
            </span>
            <div className="quest-card-title">{quest.name}</div>
          </div>
          <span
            className={`quest-card-badge${
              isCompleted ? " is-complete" : isTracked ? " is-tracked" : ""
            }`}
          >
            {isCompleted ? "Complete" : isTracked ? "Tracked" : "Available"}
          </span>
        </div>
        <div className="quest-card-description">{previewText}</div>
        <div className="quest-card-actions quest-card-actions-top">
          <button
            type="button"
            className="button secondary"
            onClick={() => onSelectQuest(quest)}
          >
            Open
          </button>
          {!isCompleted ? (
            <>
              <button
                type="button"
                className={`button ${isTracked ? "secondary" : "primary"}`}
                onClick={() =>
                  isTracked ? onUntrackQuest(quest.name) : onTrackQuest(quest.name)
                }
              >
                {isTracked ? "Untrack" : "Accept"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => onRequestAbandonQuest(quest.name)}
              >
                Abandon
              </button>
            </>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <aside
      ref={dockRef}
      className={`journal-dock${isOpen ? "" : " is-collapsed"}${
        isTransient ? " is-transient" : ""
      }`}
    >
      {isOpen ? (
        <div className="journal-dock-shell">
          {mode === "item" && item ? (
            <ItemDetailsDrawer
              item={item}
              items={items}
              itemsById={itemsById}
              canGoBack={canGoBack}
              onBack={onBack}
              onClose={onCloseItem}
              onAddItemToWorkspace={onAddItemToWorkspace}
              onAddItemToWorkspaceAsActionAnchor={onAddItemToWorkspaceAsActionAnchor}
              onSelectItem={onSelectItem}
            />
          ) : mode === "quest" && selectedQuest ? (
            <QuestDetailsPanel
              quest={selectedQuest}
              discoveredItem={selectedQuestItem}
              onBack={onBackToJournal}
              onClose={onCloseQuest}
              onAddItemToWorkspace={onAddItemToWorkspace}
            />
          ) : (
            <div className="quest-section">
              <div className="quest-drawer-header">
                <div className="journal-dock-header-row">
                  <div>
                    <div className="quest-drawer-title">Quests</div>
                    <div className="quest-drawer-subtitle">
                      Track what you want to chase next.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="journal-dock-collapse"
                    onClick={onCollapse}
                    aria-label="Collapse quests"
                    title="Collapse quests"
                  >
                    <PanelRightClose size={16} strokeWidth={2} />
                  </button>
                </div>
              </div>

              <article className="quest-card quest-card-featured">
                <div className="quest-card-top">
                  <div>
                    <div className="quest-card-title">Generate Quests</div>
                    <div className="quest-card-description">
                      Add ten more targets to the available list.
                    </div>
                  </div>
                </div>
                <div className="quest-generate-actions">
                  <button
                    type="button"
                    className="quest-generate-button quest-generate-button-secondary"
                    onClick={onGenerateEasyQuests}
                    disabled={isGeneratingChallengeTargets}
                  >
                    {isGeneratingChallengeTargets ? "Generating…" : "Generate Easier"}
                  </button>
                  <button
                    type="button"
                    className="quest-generate-button"
                    onClick={onGenerateHardQuests}
                    disabled={isGeneratingChallengeTargets}
                  >
                    {isGeneratingChallengeTargets ? "Generating…" : "Generate Hard"}
                  </button>
                </div>
              </article>

              {trackedQuests.length > 0 ? (
                <div className="quest-section-block">
                  <div className="achievement-section-label">Active</div>
                  <div className="quest-card-list">
                    {trackedQuests.map((quest) => renderQuestCard(quest, "tracked"))}
                  </div>
                </div>
              ) : (
                <div className="quest-card">
                  <div className="quest-card-criteria">
                    No active quests yet. Accept any available quest to track it here.
                  </div>
                </div>
              )}

              {availableQuests.length > 0 ? (
                <div className="quest-section-block quest-section-block-available">
                  <div className="achievement-section-label">Available</div>
                  <div className="quest-card-list">
                    {availableQuests.map((quest) => renderQuestCard(quest, "available"))}
                  </div>
                </div>
              ) : null}

              {completedQuests.length > 0 ? (
                <details className="achievement-archive quest-completed-archive">
                  <summary className="achievement-archive-toggle">
                    Completed ({completedQuests.length})
                  </summary>
                  <div className="achievement-archive-list">
                    <div className="quest-card-list">
                      {completedQuests.map((quest) => renderQuestCard(quest, "completed"))}
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
};

export default JournalDock;
