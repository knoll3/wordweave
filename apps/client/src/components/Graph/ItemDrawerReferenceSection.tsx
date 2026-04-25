import type { Item } from "../../types";

type CatalystGuide = {
  description: string;
  example: string;
};

type ActionTriggerSection = {
  title: string;
  description: string;
  discoveredItems: Item[];
  undiscoveredWords: string[];
};

export default function ItemDrawerReferenceSection({
  item,
  catalystGuide,
  actionTriggerSections,
  isLoadingReference,
  referenceDescription,
  referenceTitle,
  referenceImageUrl,
  referenceUrl,
  onAddItemToWorkspaceAsActionAnchor,
}: {
  item: Item;
  catalystGuide: CatalystGuide | null;
  actionTriggerSections: ActionTriggerSection[] | null;
  isLoadingReference: boolean;
  referenceDescription: string | null;
  referenceTitle: string | null;
  referenceImageUrl: string | null;
  referenceUrl: string | null;
  onAddItemToWorkspaceAsActionAnchor: (item: Item) => void;
}) {
  return (
    <section className="item-drawer-section">
      <div className="item-drawer-section-label">Reference</div>
      {catalystGuide ? (
        <>
          <p className="item-drawer-description">{catalystGuide.description}</p>
          <div className="item-drawer-example">{catalystGuide.example}</div>
          {actionTriggerSections ? (
            <div className="item-drawer-action-triggers">
              {actionTriggerSections.map((section) => (
                <div key={section.title} className="item-drawer-action-trigger-group">
                  <div className="item-drawer-action-trigger-family">{section.title}</div>
                  <div className="item-drawer-action-trigger-summary">
                    {section.description}
                  </div>
                  <div className="item-drawer-action-trigger-chips">
                    {section.discoveredItems.map((triggerItem) => (
                      <button
                        key={triggerItem.id}
                        type="button"
                        className="item-drawer-action-trigger-chip is-owned is-clickable"
                        onClick={() => onAddItemToWorkspaceAsActionAnchor(triggerItem)}
                      >
                        {triggerItem.name}
                      </button>
                    ))}
                    {section.undiscoveredWords.map((word) => (
                      <span key={word} className="item-drawer-action-trigger-chip is-disabled">
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : isLoadingReference ? (
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
                alt={referenceTitle || item.name}
                loading="lazy"
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
        <p className="item-drawer-empty">
          No reference summary found for this item yet.
        </p>
      )}
    </section>
  );
}
