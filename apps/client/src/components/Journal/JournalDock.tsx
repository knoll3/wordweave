import React from "react";
import { PanelRightClose } from "lucide-react";
import type { AchievementSummary, ChallengeTarget, Item } from "../../types";
import type { ItemReference } from "../../lib/api";
import ItemDetailsDrawer from "../Graph/ItemDetailsDrawer";
import QuestDetailsPanel from "../Graph/QuestDetailsPanel";

interface Props {
  dockRef?: React.Ref<HTMLElement>;
  isOpen: boolean;
  isTransient?: boolean;
  mode: "journal" | "item" | "quest";
  journalTab: "achievements" | "quests";
  achievementSummary: AchievementSummary;
  achievementReferences: Record<string, ItemReference | null | undefined>;
  questReferences: Record<string, ItemReference | null | undefined>;
  achievementReferencePreviewLimit: number;
  challengeTargets: ChallengeTarget[];
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
  onBackToJournal: (tab: "achievements" | "quests") => void;
  onSelectItem: (item: Item) => void;
  onCollapse: () => void;
  onSetJournalTab: (tab: "achievements" | "quests") => void;
  onGenerateEasyQuests: () => void;
  onGenerateHardQuests: () => void;
  onSelectQuest: (quest: ChallengeTarget) => void;
  truncateAchievementReference: (value: string, limit: number) => string;
}

const JournalDock: React.FC<Props> = ({
  dockRef,
  isOpen,
  isTransient = false,
  mode,
  journalTab,
  achievementSummary,
  achievementReferences,
  questReferences,
  achievementReferencePreviewLimit,
  challengeTargets,
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
  onSetJournalTab,
  onGenerateEasyQuests,
  onGenerateHardQuests,
  onSelectQuest,
  truncateAchievementReference,
}) => {
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
              onBack={() => onBackToJournal("quests")}
              onClose={onCloseQuest}
              onAddItemToWorkspace={onAddItemToWorkspace}
            />
          ) : (
            <>
              <div className="quest-drawer-header">
                <div className="journal-dock-header-row">
                  <div>
                    <div className="quest-drawer-title">Journal</div>
                    <div className="quest-drawer-subtitle">
                      Permanent achievements and generated challenge targets.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="journal-dock-collapse"
                    onClick={onCollapse}
                    aria-label="Collapse journal"
                    title="Collapse journal"
                  >
                    <PanelRightClose size={16} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="journal-tab-row" role="tablist" aria-label="Journal sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={journalTab === "achievements"}
                  className={`journal-tab${journalTab === "achievements" ? " is-active" : ""}`}
                  onClick={() => onSetJournalTab("achievements")}
                >
                  Achievements
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={journalTab === "quests"}
                  className={`journal-tab${journalTab === "quests" ? " is-active" : ""}`}
                  onClick={() => onSetJournalTab("quests")}
                >
                  Quests
                </button>
              </div>
              {journalTab === "achievements" ? (
                <div className="quest-card-list">
                  <article className="quest-card achievement-overview-card">
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">Achievement Points</div>
                        <div className="quest-card-description">
                          Curated long-term goals with permanent progress across the library.
                        </div>
                      </div>
                      <span className="quest-card-badge is-tracked">
                        {achievementSummary.earnedPoints} pts
                      </span>
                    </div>
                    <div className="achievement-overview-stats">
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.completedCount}
                        </span>
                        <span className="achievement-overview-stat-label">earned</span>
                      </div>
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.totalCount - achievementSummary.completedCount}
                        </span>
                        <span className="achievement-overview-stat-label">remaining</span>
                      </div>
                      <div className="achievement-overview-stat">
                        <span className="achievement-overview-stat-value">
                          {achievementSummary.totalPoints}
                        </span>
                        <span className="achievement-overview-stat-label">total points</span>
                      </div>
                    </div>
                    {achievementSummary.featuredProgress.length > 0 ? (
                      <div className="achievement-feature-list">
                        {achievementSummary.featuredProgress.map((achievement) => (
                          <div key={achievement.id} className="achievement-feature-chip">
                            <span>{achievement.title}</span>
                            <span>
                              {achievement.progressCurrent}/{achievement.progressTarget}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                  {(() => {
                    const activeCategories = achievementSummary.categories.filter(
                      (category) => category.completedCount < category.totalCount
                    );
                    const completedCategories = achievementSummary.categories.filter(
                      (category) => category.completedCount >= category.totalCount
                    );

                    const renderCategory = (
                      category: typeof achievementSummary.categories[number],
                      options?: { archived?: boolean }
                    ) => (
                      <section
                        key={category.id}
                        className={`achievement-category${
                          options?.archived ? " is-archived" : ""
                        }`}
                      >
                      <div className="achievement-category-header">
                        <div>
                          <div className="quest-section-title">{category.title}</div>
                          <div className="quest-section-subtitle">{category.summary}</div>
                        </div>
                        <div className="achievement-category-stats">
                          <span className="quest-card-badge">
                            {category.completedCount}/{category.totalCount}
                          </span>
                          <span className="quest-card-badge is-tracked">
                            {category.earnedPoints}/{category.totalPoints} pts
                          </span>
                        </div>
                      </div>
                      <div className="achievement-group-list">
                        {category.groups
                          .slice()
                          .sort((left, right) => {
                            const leftIncomplete = left.totalCount - left.completedCount;
                            const rightIncomplete = right.totalCount - right.completedCount;
                            if (leftIncomplete !== rightIncomplete) {
                              return rightIncomplete - leftIncomplete;
                            }
                            return left.title.localeCompare(right.title);
                          })
                          .map((group) => (
                          <article key={group.id} className="achievement-group">
                            <div className="achievement-group-header">
                              <div>
                                <div className="quest-card-title">{group.title}</div>
                                <div className="quest-card-description">{group.summary}</div>
                              </div>
                              <span className="quest-card-badge">
                                {group.completedCount}/{group.totalCount}
                              </span>
                            </div>
                            {(() => {
                              const incompleteAchievements = group.achievements.filter(
                                (achievement) => !achievement.completed
                              );
                              const completeAchievements = group.achievements.filter(
                                (achievement) => achievement.completed
                              );
                              const renderAchievementRow = (achievement: typeof group.achievements[number]) => {
                                const achievementReference = achievementReferences[achievement.id];
                                const progressRatio =
                                  achievement.progressTarget > 0
                                    ? achievement.progressCurrent / achievement.progressTarget
                                    : 0;
                                const detailText =
                                  achievementReference === undefined
                                    ? "Loading reference..."
                                    : achievementReference?.summary
                                      ? truncateAchievementReference(
                                          achievementReference.summary,
                                          achievementReferencePreviewLimit
                                        )
                                      : achievement.description;

                                return (
                                  <div
                                    key={achievement.id}
                                    className={`achievement-row${
                                      achievement.completed ? " is-complete" : ""
                                    }`}
                                  >
                                    <div className="achievement-row-main">
                                      <div className="achievement-row-copy">
                                        <div className="achievement-row-title">
                                          {achievement.title}
                                        </div>
                                      </div>
                                      <div className="achievement-row-meta">
                                        <span
                                          className={`quest-card-badge${
                                            achievement.completed ? " is-complete" : ""
                                          }`}
                                        >
                                          {achievement.completed
                                            ? "Complete"
                                            : `${achievement.progressCurrent}/${achievement.progressTarget}`}
                                        </span>
                                        <span className="achievement-row-points">
                                          {achievement.points} pts
                                        </span>
                                      </div>
                                    </div>
                                    <details className="achievement-row-details">
                                      <summary className="achievement-row-details-toggle">
                                        Details
                                      </summary>
                                      <div className="achievement-row-description">
                                        {detailText}
                                      </div>
                                      {achievementReference?.sourceUrl ? (
                                        <div className="achievement-row-link">
                                          <a
                                            className="item-drawer-link"
                                            href={achievementReference.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Open Wikipedia article
                                          </a>
                                        </div>
                                      ) : null}
                                    </details>
                                    <div className="achievement-progress-bar">
                                      <span
                                        className="achievement-progress-bar-fill"
                                        style={{
                                          width: `${Math.max(
                                            0,
                                            Math.min(progressRatio, 1)
                                          ) * 100}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              };

                              return (
                                <>
                                  {incompleteAchievements.length > 0 ? (
                                    <div className="achievement-section">
                                      <div className="achievement-section-label">
                                        Incomplete
                                      </div>
                                      <div className="achievement-row-list">
                                        {incompleteAchievements.map(renderAchievementRow)}
                                      </div>
                                    </div>
                                  ) : null}
                                  {completeAchievements.length > 0 ? (
                                    <div className="achievement-section">
                                      <div className="achievement-section-label">
                                        Complete
                                      </div>
                                      <div className="achievement-row-list">
                                        {completeAchievements.map(renderAchievementRow)}
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </article>
                        ))}
                      </div>
                    </section>
                    );

                    return (
                      <>
                        {activeCategories.map((category) => renderCategory(category))}
                        {completedCategories.length > 0 ? (
                          <details className="achievement-archive">
                            <summary className="achievement-archive-toggle">
                              Completed Categories ({completedCategories.length})
                            </summary>
                            <div className="achievement-archive-list">
                              {completedCategories.map((category) =>
                                renderCategory(category, { archived: true })
                              )}
                            </div>
                          </details>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="quest-section">
                  <div className="quest-section-header">
                    <div className="quest-section-title">Quest Generator</div>
                    <div className="quest-section-subtitle">
                      Roll a fresh batch of hard quests to chase in the sandbox.
                    </div>
                  </div>
                  <article className="quest-card quest-card-featured">
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">Quest Generator</div>
                        <div className="quest-card-description">
                          Generates challenging words and fixed concepts that are tough to reach without relying on cheap adjective-noun phrases.
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
                    </div>
                    <div className="quest-card-criteria">
                      {challengeTargets.length > 0
                        ? "These quests are meant to feel difficult, slippery, referential, or abstract while still being legitimate words to chase."
                        : "Generate a batch when you want a new set of difficult quests."}
                    </div>
                  </article>
                  {challengeTargets.length > 0 ? (
                    (() => {
                      const activeQuests = challengeTargets.filter(
                        (quest) => !completedQuestNames.has(quest.name)
                      );
                      const completedQuests = challengeTargets.filter((quest) =>
                        completedQuestNames.has(quest.name)
                      );

                      const renderQuestCard = (quest: ChallengeTarget, isCompleted: boolean) => {
                        const questReference = questReferences[quest.name];
                        const previewText =
                          questReference === undefined
                            ? "Loading description…"
                            : questReference?.summary
                              ? truncateAchievementReference(
                                  questReference.summary,
                                  achievementReferencePreviewLimit
                                )
                              : "No reference summary found yet.";

                        return (
                          <button
                            key={quest.name}
                            type="button"
                            className={`quest-card quest-card-target${
                              isCompleted ? " is-complete" : ""
                            }`}
                            onClick={() => onSelectQuest(quest)}
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
                                  isCompleted ? " is-complete" : " is-tracked"
                                }`}
                              >
                                {isCompleted ? "Complete" : "Quest"}
                              </span>
                            </div>
                            <div className="quest-card-description">{previewText}</div>
                          </button>
                        );
                      };

                      return (
                        <>
                          {activeQuests.length > 0 ? (
                            <div className="quest-section-block">
                              <div className="achievement-section-label">Active</div>
                              <div className="quest-card-list">
                                {activeQuests.map((quest) => renderQuestCard(quest, false))}
                              </div>
                            </div>
                          ) : (
                            <div className="quest-card">
                              <div className="quest-card-criteria">
                                Every current quest is complete. Generate a fresh batch when you want more.
                              </div>
                            </div>
                          )}
                          {completedQuests.length > 0 ? (
                            <details className="achievement-archive">
                              <summary className="achievement-archive-toggle">
                                Completed Quests ({completedQuests.length})
                              </summary>
                              <div className="achievement-archive-list">
                                <div className="quest-card-list">
                                  {completedQuests.map((quest) => renderQuestCard(quest, true))}
                                </div>
                              </div>
                            </details>
                          ) : null}
                        </>
                      );
                    })()
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
};

export default JournalDock;
