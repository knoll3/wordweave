import React from "react";
import type { AchievementSummary, FeatureUnlockStatus } from "../../types";

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
  achievementSummary: AchievementSummary;
  catalystUnlockQuests: CatalystUnlockQuest[];
  nextLockedCatalyst: CatalystUnlockQuest | null;
  unlockedCatalystCount: number;
  featuredAchievement: AchievementSummary["featuredProgress"][number] | null;
  isQuestCelebrating: boolean;
  isJournalOpen: boolean;
  journalTab: "achievements" | "quests";
  questCelebrationTitle: string | null;
  onOpenJournal: (tab: "achievements" | "quests") => void;
}

const JournalSummaryStrip: React.FC<Props> = ({
  achievementSummary,
  catalystUnlockQuests,
  nextLockedCatalyst,
  unlockedCatalystCount,
  featuredAchievement,
  isQuestCelebrating,
  isJournalOpen,
  journalTab,
  questCelebrationTitle,
  onOpenJournal,
}) => {
  return (
    <div className="journal-summary-strip">
      <button
        type="button"
        className={`journal-summary-card${isQuestCelebrating ? " is-celebrating" : ""}`}
        onClick={() => onOpenJournal("achievements")}
        aria-expanded={isJournalOpen && journalTab === "achievements"}
        aria-label="Open achievements journal"
      >
        <span className="journal-summary-card-kicker">Achievements</span>
        <span className="journal-summary-card-value">
          {achievementSummary.earnedPoints} points
        </span>
        <span className="journal-summary-card-meta">
          {achievementSummary.completedCount}/{achievementSummary.totalCount} earned
        </span>
        <span className="journal-summary-card-copy">
          {featuredAchievement
            ? `${featuredAchievement.title} • ${featuredAchievement.progressCurrent}/${featuredAchievement.progressTarget}`
            : "Every visible achievement in this set is complete."}
        </span>
      </button>
      <button
        type="button"
        className="journal-summary-card journal-summary-card-secondary"
        onClick={() => onOpenJournal("quests")}
        aria-expanded={isJournalOpen && journalTab === "quests"}
        aria-label="Open catalyst quests"
      >
        <span className="journal-summary-card-kicker">Quests</span>
        <span className="journal-summary-card-value">
          {unlockedCatalystCount}/{catalystUnlockQuests.length} catalysts
        </span>
        <span className="journal-summary-card-meta">
          {nextLockedCatalyst ? "Next unlock" : "All catalysts unlocked"}
        </span>
        <span className="journal-summary-card-copy">
          {nextLockedCatalyst
            ? `${nextLockedCatalyst.display.name} • ${nextLockedCatalyst.exampleWords
                .slice(0, 2)
                .join(", ")}`
            : "Your full catalyst kit is available in the workspace."}
        </span>
      </button>
      {questCelebrationTitle ? (
        <div className="quest-hub-celebration" aria-live="polite">
          {questCelebrationTitle}
        </div>
      ) : null}
    </div>
  );
};

export default JournalSummaryStrip;
