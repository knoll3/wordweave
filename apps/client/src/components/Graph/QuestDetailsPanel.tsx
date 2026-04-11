import React, { useEffect, useState } from "react";
import type { Item } from "../../types";
import { fetchQuestTargetReference } from "../../lib/api";

interface Props {
  quest: {
    name: string;
    icon: string;
  };
  discoveredItem: Item | null;
  onBack: () => void;
  onClose: () => void;
  onAddItemToWorkspace: (item: Item) => void;
}

const QuestDetailsPanel: React.FC<Props> = ({
  quest,
  discoveredItem,
  onBack,
  onClose,
  onAddItemToWorkspace,
}) => {
  const [isLoadingReference, setIsLoadingReference] = useState(false);
  const [referenceTitle, setReferenceTitle] = useState<string | null>(null);
  const [referenceDescription, setReferenceDescription] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setIsLoadingReference(true);
    setReferenceTitle(null);
    setReferenceDescription(null);
    setReferenceImageUrl(null);
    setReferenceUrl(null);

    void fetchQuestTargetReference(quest.name)
      .then((reference) => {
        if (cancelled) return;
        setReferenceTitle(reference?.title ?? null);
        setReferenceDescription(reference?.summary ?? null);
        setReferenceImageUrl(reference?.imageUrl ?? null);
        setReferenceUrl(reference?.sourceUrl ?? null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingReference(false);
      });

    return () => {
      cancelled = true;
    };
  }, [quest.name]);

  return (
    <aside className="item-drawer item-drawer-panel" aria-label={`${quest.name} quest details`}>
      <div className="item-drawer-header">
        <div className="item-drawer-header-actions">
          <button
            type="button"
            className="item-drawer-back"
            onClick={onBack}
            aria-label="Back to quests"
          >
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </button>
        </div>
        <div className="item-drawer-title-wrap">
          <span className="item-drawer-icon" aria-hidden="true">
            {quest.icon}
          </span>
          <div>
            <div className="item-drawer-title">{quest.name}</div>
            <div className="item-drawer-subtitle">Quest reference</div>
          </div>
        </div>
        <button
          type="button"
          className="item-drawer-close"
          onClick={onClose}
          aria-label="Close quest details"
        >
          ×
        </button>
      </div>

      <section className="item-drawer-section">
        <div className="item-drawer-section-label">Status</div>
        <div className="quest-reference-status-row">
          <span
            className={`quest-card-badge${discoveredItem ? " is-complete" : " is-tracked"}`}
          >
            {discoveredItem ? "Discovered" : "Undiscovered"}
          </span>
          {discoveredItem ? (
            <button
              type="button"
              className="item-drawer-action"
              onClick={() => onAddItemToWorkspace(discoveredItem)}
            >
              Add to workspace
            </button>
          ) : null}
        </div>
      </section>

      <section className="item-drawer-section">
        <div className="item-drawer-section-label">Reference</div>
        {isLoadingReference ? (
          <div className="item-drawer-status" aria-live="polite">
            <span className="search-pending-spinner" aria-hidden="true" />
            <span>Loading reference…</span>
          </div>
        ) : referenceDescription ? (
          <>
            {referenceImageUrl ? (
              <div className="item-drawer-media">
                <img
                  className="item-drawer-media-image"
                  src={referenceImageUrl}
                  alt={referenceTitle || quest.name}
                />
              </div>
            ) : null}
            <p className="item-drawer-description">{referenceDescription}</p>
            {referenceUrl ? (
              <a
                className="item-drawer-link"
                href={referenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Wikipedia article
              </a>
            ) : null}
          </>
        ) : (
          <div className="item-drawer-empty">
            No reference summary found for this quest yet.
          </div>
        )}
      </section>
      <div className="item-drawer-bottom-spacer" aria-hidden="true" />
    </aside>
  );
};

export default QuestDetailsPanel;
