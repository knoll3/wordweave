import React from "react";
import { PanelRightClose } from "lucide-react";
import type {
  AchievementSummary,
  FeatureUnlockStatus,
  Item,
} from "../../types";
import type { ItemReference } from "../../lib/api";
import ItemDetailsDrawer from "../Graph/ItemDetailsDrawer";

type UnlockDisplay = {
  name: string;
  icon: string;
  accentClass: string;
  shortCopy: string;
};

type CatalystUnlockQuest = FeatureUnlockStatus & {
  display: UnlockDisplay;
};

interface Props {
  isOpen: boolean;
  mode: "journal" | "item";
  journalTab: "achievements" | "quests";
  achievementSummary: AchievementSummary;
  achievementReferences: Record<string, ItemReference | null | undefined>;
  achievementReferencePreviewLimit: number;
  catalystUnlockQuests: CatalystUnlockQuest[];
  nextLockedCatalystKey: string | null;
  nextLockedCatalyst: CatalystUnlockQuest | null;
  unlockedCatalystCount: number;
  item: Item | null;
  items: Item[];
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  onBack: () => void;
  onAddItemToWorkspace: (item: Item) => void;
  onAddItemToWorkspaceAsActionAnchor: (item: Item) => void;
  onCloseItem: () => void;
  onSelectItem: (item: Item) => void;
  onCollapse: () => void;
  onSetJournalTab: (tab: "achievements" | "quests") => void;
  truncateAchievementReference: (value: string, limit: number) => string;
}

const JournalDock: React.FC<Props> = ({
  isOpen,
  mode,
  journalTab,
  achievementSummary,
  achievementReferences,
  achievementReferencePreviewLimit,
  catalystUnlockQuests,
  nextLockedCatalystKey,
  nextLockedCatalyst,
  unlockedCatalystCount,
  item,
  items,
  itemsById,
  canGoBack,
  onBack,
  onAddItemToWorkspace,
  onAddItemToWorkspaceAsActionAnchor,
  onCloseItem,
  onSelectItem,
  onCollapse,
  onSetJournalTab,
  truncateAchievementReference,
}) => {
  return (
    <aside className={`journal-dock${isOpen ? "" : " is-collapsed"}`}>
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
          ) : (
            <>
              <div className="quest-drawer-header">
                <div className="journal-dock-header-row">
                  <div>
                    <div className="quest-drawer-title">Journal</div>
                    <div className="quest-drawer-subtitle">
                      Permanent achievements and catalyst unlock quests.
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
                    <div className="quest-section-title">Unlock Quests</div>
                    <div className="quest-section-subtitle">
                      Permanent mechanic unlocks that add more tools to the workspace.
                    </div>
                  </div>
                  <article className="quest-card quest-card-featured">
                    <div className="quest-card-top">
                      <div>
                        <div className="quest-card-title">Unlock Progress</div>
                        <div className="quest-card-description">
                          Quests are now reserved for unlocking additional workspace tools.
                        </div>
                      </div>
                      <span className="quest-card-badge is-tracked">
                        {unlockedCatalystCount}/{catalystUnlockQuests.length}
                      </span>
                    </div>
                    <div className="quest-card-criteria">
                      {nextLockedCatalyst
                        ? `${nextLockedCatalyst.display.name} is your next unlock target.`
                        : "Every visible unlock is complete."}
                    </div>
                  </article>
                  <div className="quest-card-list">
                    {catalystUnlockQuests.map((unlock) => {
                      const isNextLocked =
                        !unlock.unlocked && unlock.key === nextLockedCatalystKey;
                      return (
                        <article
                          key={unlock.key}
                          className={`quest-card quest-card-unlock ${unlock.display.accentClass}${
                            unlock.unlocked ? " is-complete" : ""
                          }${isNextLocked ? " is-featured-unlock" : ""}`}
                        >
                          <div className="quest-card-top">
                            <div className="quest-card-title-wrap">
                              <span className="quest-card-icon" aria-hidden="true">
                                {unlock.display.icon}
                              </span>
                              <div>
                                <div className="quest-card-title">{unlock.display.name}</div>
                                <div className="quest-card-description">
                                  {unlock.display.shortCopy}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`quest-card-badge ${
                                unlock.unlocked
                                  ? "is-complete"
                                  : isNextLocked
                                    ? "is-tracked"
                                    : "is-available"
                              }`}
                            >
                              {unlock.unlocked
                                ? "Unlocked"
                                : isNextLocked
                                  ? "Next"
                                  : "Locked"}
                            </span>
                          </div>
                          <div className="quest-card-criteria">{unlock.summary}</div>
                          <div className="quest-card-meta">
                            Example unlock words: {unlock.exampleWords.join(", ")}
                          </div>
                          {unlock.sourceItemName &&
                          (unlock.sourceMatchedWord == null || unlock.sourceMatchedWordCurrent) ? (
                            <div className="quest-card-meta">
                              Unlocked by discovering <strong>{unlock.sourceItemName}</strong>
                              {unlock.sourceMatchedWordCurrent &&
                              unlock.sourceMatchedWord &&
                              unlock.sourceMatchedWord.toLowerCase() !==
                                unlock.sourceItemName.toLowerCase()
                                ? `, which matched "${unlock.sourceMatchedWord}".`
                                : "."}
                            </div>
                          ) : !unlock.unlocked ? (
                            <div className="quest-card-meta">
                              This unlock is still locked. Discover related concepts to reveal it.
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
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
