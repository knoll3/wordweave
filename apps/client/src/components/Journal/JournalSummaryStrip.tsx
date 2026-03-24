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
  unlockedCatalystCount: number;
  isQuestCelebrating: boolean;
  isJournalOpen: boolean;
  journalTab: "achievements" | "quests";
  questCelebrationTitle: string | null;
  onOpenJournal: (tab: "achievements" | "quests") => void;
}

const JournalSummaryStrip: React.FC<Props> = ({
  achievementSummary,
  catalystUnlockQuests,
  unlockedCatalystCount,
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
      </button>
      <button
        type="button"
        className="journal-summary-card journal-summary-card-secondary"
        onClick={() => onOpenJournal("quests")}
        aria-expanded={isJournalOpen && journalTab === "quests"}
        aria-label="Open quests"
      >
        <span className="journal-summary-card-kicker">Quests</span>
        <span className="journal-summary-card-value">
          {unlockedCatalystCount}/{catalystUnlockQuests.length} unlocks
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
