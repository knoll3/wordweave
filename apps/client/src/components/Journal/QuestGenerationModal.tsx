import React from "react";
import type { QuestGenerationDraft } from "../../types";

interface Props {
  isOpen: boolean;
  isLoading: boolean;
  topic: string;
  draft: QuestGenerationDraft | null;
  selectedTargetNames: string[];
  onTopicChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onResetTopic: () => void;
  onToggleTarget: (targetName: string) => void;
  onClearSelection: () => void;
  onAccept: () => void;
}

const QuestGenerationModal: React.FC<Props> = ({
  isOpen,
  isLoading,
  topic,
  draft,
  selectedTargetNames,
  onTopicChange,
  onClose,
  onSubmit,
  onResetTopic,
  onToggleTarget,
  onClearSelection,
  onAccept,
}) => {
  if (!isOpen) {
    return null;
  }

  const selectedNames = new Set(selectedTargetNames);
  const hasLockedTopic = isLoading || !!draft;
  const modalTitle = hasLockedTopic ? "Review Quest Set" : "Choose a Topic";
  const modalCopy = hasLockedTopic
    ? "Review the suggested targets for this topic and keep the ones you want."
    : "Enter a topic to generate a themed quest set around it.";
  const loadingTitle = draft ? "Updating quest targets" : "Generating quest set";
  const loadingCopy = draft
    ? "Finding a fresh set of replacement targets for this topic."
    : "Finding a strong set of quest targets for this topic.";

  return (
    <div className="quest-topic-overlay" role="presentation" onClick={onClose}>
      <div
        className="quest-topic-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Generate quest set"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quest-topic-header">
          <div>
            <div className="quest-topic-kicker">Quest Generator</div>
            <div className="quest-topic-title">{modalTitle}</div>
            <div className="quest-topic-copy">{modalCopy}</div>
          </div>
          <button
            type="button"
            className="quest-topic-close"
            onClick={onClose}
            aria-label="Close quest generation"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="quest-topic-body">
          <label
            className="quest-topic-label"
            htmlFor={!isLoading && !draft ? "quest-topic-input" : undefined}
          >
            Topic
          </label>
          {!isLoading && !draft ? (
            <input
              id="quest-topic-input"
              className="quest-topic-input"
              type="text"
              value={topic}
              onChange={(event) => onTopicChange(event.target.value)}
              placeholder="Harry Potter spells, Pokemon, Ancient Egypt, ocean animals..."
              autoFocus
              disabled={isLoading}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
          ) : (
            <div className="quest-topic-summary">
              <div className="quest-topic-summary-value">{topic}</div>
            </div>
          )}
          {isLoading ? (
            <div
              className="quest-topic-loading"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="quest-topic-loading-head">
                <div className="quest-topic-loading-title">{loadingTitle}</div>
                <div className="quest-topic-loading-copy">{loadingCopy}</div>
              </div>
              <div className="quest-topic-chip-list quest-topic-chip-list-skeleton">
                {Array.from({ length: 12 }).map((_, index) => (
                  <span
                    key={index}
                    className="quest-topic-chip quest-topic-chip-skeleton"
                    aria-hidden="true"
                  >
                    <span className="quest-topic-chip-skeleton-icon" />
                    <span
                      className="quest-topic-chip-skeleton-line"
                      style={{
                        width:
                          index % 4 === 0
                            ? "84px"
                            : index % 3 === 0
                              ? "112px"
                              : "96px",
                      }}
                    />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {draft?.targets.length ? (
            <div className="quest-topic-results">
              <div className="quest-topic-results-label">
                Suggested targets
                <span className="quest-topic-results-meta">
                  {" "}
                  · {selectedTargetNames.length} selected
                </span>
              </div>
              <div className="quest-topic-chip-list">
                {draft.targets.map((target, index) => {
                  const isSelected = selectedNames.has(target.name);
                  const isRecommended = index < draft.recommendedCount;
                  return (
                  <button
                    key={target.name}
                    type="button"
                    className={[
                      "quest-topic-chip",
                      isSelected ? "is-selected" : "",
                      isRecommended ? "is-recommended" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleTarget(target.name)}
                    disabled={isLoading}
                    aria-pressed={isSelected}
                  >
                    <span aria-hidden="true">{target.icon}</span>
                    <span>{target.name}</span>
                  </button>
                )})}
              </div>
            </div>
          ) : null}
        </div>

        <div className="quest-topic-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          {draft ? (
            <>
              <button
                type="button"
                className="button secondary"
                onClick={onResetTopic}
                disabled={isLoading}
              >
                Try Something Else
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={onClearSelection}
                disabled={isLoading || selectedTargetNames.length === 0}
              >
                Clear Selection
              </button>
              <button
                type="button"
                className="button primary"
                onClick={onAccept}
                disabled={isLoading || selectedTargetNames.length === 0}
              >
                {isLoading ? "Accepting…" : "Accept"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button primary"
              onClick={onSubmit}
              disabled={isLoading || topic.trim().length === 0}
            >
              {isLoading ? "Generating…" : "Generate Quest Set"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuestGenerationModal;
