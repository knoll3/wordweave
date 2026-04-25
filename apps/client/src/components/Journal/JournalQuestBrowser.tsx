import { PanelRightClose } from "lucide-react";
import { useEffect, useState } from "react";
import type { ItemReference } from "../../lib/api";
import type { QuestRecord } from "../../types";
import JournalQuestCard from "./JournalQuestCard";

const COMPLETED_QUESTS_PAGE_SIZE = 50;

export default function JournalQuestBrowser({
  quests,
  trackedQuestNames,
  completedQuestNames,
  questReferences,
  referencePreviewLimit,
  isGeneratingQuests,
  pendingQuestAction,
  truncateReference,
  onCollapse,
  onStartQuestDraftSession,
  onSelectQuest,
  onTrackQuest,
  onUntrackQuest,
  onRequestAbandonQuest,
}: {
  quests: QuestRecord[];
  trackedQuestNames: Set<string>;
  completedQuestNames: Set<string>;
  questReferences: Record<string, ItemReference | null | undefined>;
  referencePreviewLimit: number;
  isGeneratingQuests: boolean;
  pendingQuestAction:
    | {
        name: string;
        kind: "track" | "untrack" | "abandon";
      }
    | null;
  truncateReference: (value: string, limit: number) => string;
  onCollapse: () => void;
  onStartQuestDraftSession: () => void;
  onSelectQuest: (quest: QuestRecord) => void;
  onTrackQuest: (questName: string) => void;
  onUntrackQuest: (questName: string) => void;
  onRequestAbandonQuest: (questName: string) => void;
}) {
  const trackedQuests = quests.filter(
    (quest) => trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const availableQuests = quests.filter(
    (quest) => !trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const completedQuests = quests.filter((quest) => completedQuestNames.has(quest.name));
  const [visibleCompletedCount, setVisibleCompletedCount] = useState(
    Math.min(COMPLETED_QUESTS_PAGE_SIZE, completedQuests.length)
  );

  useEffect(() => {
    setVisibleCompletedCount((prev) => {
      if (completedQuests.length <= COMPLETED_QUESTS_PAGE_SIZE) {
        return completedQuests.length;
      }
      return Math.min(
        Math.max(prev, COMPLETED_QUESTS_PAGE_SIZE),
        completedQuests.length
      );
    });
  }, [completedQuests.length]);

  const visibleCompletedQuests = completedQuests.slice(0, visibleCompletedCount);
  const hasMoreCompletedQuests = visibleCompletedCount < completedQuests.length;

  const renderQuestCard = (
    quest: QuestRecord,
    section: "tracked" | "available" | "completed"
  ) => (
    <JournalQuestCard
      key={quest.name}
      quest={quest}
      section={section}
      questReference={questReferences[quest.name]}
      referencePreviewLimit={referencePreviewLimit}
      pendingQuestAction={pendingQuestAction}
      truncateReference={truncateReference}
      onSelectQuest={onSelectQuest}
      onTrackQuest={onTrackQuest}
      onUntrackQuest={onUntrackQuest}
      onRequestAbandonQuest={onRequestAbandonQuest}
    />
  );

  return (
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
            <div className="quest-card-title">Find a Quest Set</div>
            <div className="quest-card-description">
              Open a topic prompt and generate a themed quest set.
            </div>
          </div>
        </div>
        <div className="quest-generate-actions">
          <button
            type="button"
            className="quest-generate-button"
            onClick={onStartQuestDraftSession}
            disabled={isGeneratingQuests}
          >
            {isGeneratingQuests ? "Generating…" : "Generate Quest Set"}
          </button>
        </div>
      </article>

      {trackedQuests.length > 0 ? (
        <div className="quest-section-block">
          <div className="quest-section-label">Active</div>
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
          <div className="quest-section-label">Available</div>
          <div className="quest-card-list">
            {availableQuests.map((quest) => renderQuestCard(quest, "available"))}
          </div>
        </div>
      ) : null}

      {completedQuests.length > 0 ? (
        <details className="quest-archive quest-completed-archive">
          <summary className="quest-archive-toggle">
            Completed ({completedQuests.length})
          </summary>
          <div className="quest-archive-list">
            <div className="quest-card-list">
              {visibleCompletedQuests.map((quest) => renderQuestCard(quest, "completed"))}
            </div>
            {hasMoreCompletedQuests ? (
              <div className="quest-archive-load-more">
                <button
                  type="button"
                  className="quest-generate-button quest-archive-load-more-button"
                  onClick={() =>
                    setVisibleCompletedCount((prev) =>
                      Math.min(prev + COMPLETED_QUESTS_PAGE_SIZE, completedQuests.length)
                    )
                  }
                >
                  Load More
                </button>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
