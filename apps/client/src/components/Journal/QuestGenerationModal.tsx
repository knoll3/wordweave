import React from "react";
import type { QuestGenerationDraft } from "../../types";

interface Props {
  isOpen: boolean;
  isLoading: boolean;
  topic: string;
  draft: QuestGenerationDraft | null;
  onTopicChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onAccept: () => void;
}

const QuestGenerationModal: React.FC<Props> = ({
  isOpen,
  isLoading,
  topic,
  draft,
  onTopicChange,
  onClose,
  onSubmit,
  onAccept,
}) => {
  if (!isOpen) {
    return null;
  }

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
            <div className="quest-topic-title">Choose a Topic</div>
            <div className="quest-topic-copy">
              Enter a topic and generate a themed quest set around it.
            </div>
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
          <label className="quest-topic-label" htmlFor="quest-topic-input">
            Topic
          </label>
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
          {draft?.targets.length ? (
            <div className="quest-topic-results">
              <div className="quest-topic-results-label">Generated targets</div>
              <div className="quest-topic-chip-list">
                {draft.targets.map((target) => (
                  <span key={target.name} className="quest-topic-chip">
                    <span aria-hidden="true">{target.icon}</span>
                    <span>{target.name}</span>
                  </span>
                ))}
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
                onClick={onSubmit}
                disabled={isLoading || topic.trim().length === 0}
              >
                {isLoading ? "Regenerating…" : "Reject and Regenerate"}
              </button>
              <button
                type="button"
                className="button primary"
                onClick={onAccept}
                disabled={isLoading}
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
