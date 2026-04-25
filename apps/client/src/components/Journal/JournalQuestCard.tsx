import React from "react";
import type { QuestRecord } from "../../types";
import type { ItemReference } from "../../lib/api";

export default function JournalQuestCard({
  quest,
  section,
  questReference,
  referencePreviewLimit,
  pendingQuestAction,
  truncateReference,
  onSelectQuest,
  onTrackQuest,
  onUntrackQuest,
  onRequestAbandonQuest,
}: {
  quest: QuestRecord;
  section: "tracked" | "available" | "completed";
  questReference: ItemReference | null | undefined;
  referencePreviewLimit: number;
  pendingQuestAction:
    | {
        name: string;
        kind: "track" | "untrack" | "abandon";
      }
    | null;
  truncateReference: (value: string, limit: number) => string;
  onSelectQuest: (quest: QuestRecord) => void;
  onTrackQuest: (questName: string) => void;
  onUntrackQuest: (questName: string) => void;
  onRequestAbandonQuest: (questName: string) => void;
}) {
  const previewText =
    questReference === undefined
      ? "Loading description…"
      : questReference?.summary
        ? truncateReference(questReference.summary, referencePreviewLimit)
        : "No reference summary found yet.";
  const isCompleted = section === "completed";
  const isTracked = section === "tracked";
  const isPendingForQuest = pendingQuestAction?.name === quest.name;
  const primaryActionLabel = isTracked
    ? isPendingForQuest && pendingQuestAction?.kind === "untrack"
      ? "Untracking…"
      : "Untrack"
    : isPendingForQuest && pendingQuestAction?.kind === "track"
      ? "Accepting…"
      : "Accept";
  const isAbandonPending = isPendingForQuest && pendingQuestAction?.kind === "abandon";

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
              disabled={isPendingForQuest}
              onClick={() =>
                isTracked ? onUntrackQuest(quest.name) : onTrackQuest(quest.name)
              }
            >
              {primaryActionLabel}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={isPendingForQuest}
              onClick={() => onRequestAbandonQuest(quest.name)}
            >
              {isAbandonPending ? "Abandoning…" : "Abandon"}
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}
