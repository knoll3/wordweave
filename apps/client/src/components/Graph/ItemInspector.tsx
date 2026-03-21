import React, { useEffect, useState } from "react";
import { fetchItemReference } from "../../lib/api";
import type { Item } from "../../types";

const DESCRIPTION_CHARACTER_LIMIT = 180;

interface Props {
  item: Item;
  categoryLabel: string;
  description: string;
  helperText: string;
  position: {
    left: number;
    top: number;
    placement: "left" | "right";
  };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const ItemInspector: React.FC<Props> = ({
  item,
  categoryLabel,
  description,
  helperText,
  position,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [referenceDescription, setReferenceDescription] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [isLoadingReference, setIsLoadingReference] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsExpanded(false);

    if (item.id < 0) {
      setReferenceDescription(null);
      setReferenceUrl(null);
      setIsLoadingReference(false);
      return;
    }

    setIsLoadingReference(true);
    setReferenceDescription(null);
    setReferenceUrl(null);

    void fetchItemReference(item.id)
      .then((reference) => {
        if (cancelled) return;
        setReferenceDescription(reference?.summary ?? null);
        setReferenceUrl(reference?.sourceUrl ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setReferenceDescription(null);
        setReferenceUrl(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingReference(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.name]);

  const resolvedDescription = item.id < 0 ? description : referenceDescription;
  const isDescriptionTruncated =
    resolvedDescription != null &&
    resolvedDescription.length > DESCRIPTION_CHARACTER_LIMIT;
  const visibleDescription =
    !resolvedDescription
      ? null
      : isExpanded || !isDescriptionTruncated
      ? resolvedDescription
      : `${resolvedDescription.slice(0, DESCRIPTION_CHARACTER_LIMIT).trimEnd()}…`;

  return (
    <aside
      className={`item-inspector item-inspector-${position.placement}`}
      style={{
        left: position.left,
        top: position.top,
      }}
      role="tooltip"
      aria-label={`${item.name} details`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="item-inspector-header">
        <div className="item-inspector-title-wrap">
          <span className="item-inspector-icon" aria-hidden="true">
            {item.icon || item.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <div className="item-inspector-name">{item.name}</div>
            <div className="item-inspector-badge">{categoryLabel}</div>
          </div>
        </div>
      </div>
      {visibleDescription ? (
        <p className="item-inspector-description">{visibleDescription}</p>
      ) : null}
      {isDescriptionTruncated ? (
        <button
          type="button"
          className="item-inspector-more"
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      ) : null}
      {helperText ? <p className="item-inspector-helper">{helperText}</p> : null}
      {isLoadingReference ? (
        <div className="item-inspector-status" aria-live="polite">
          <span className="search-pending-spinner" aria-hidden="true" />
          <span>Loading reference…</span>
        </div>
      ) : item.id >= 0 && !referenceDescription ? (
        <div className="item-inspector-empty">
          No reference summary found for this item yet.
        </div>
      ) : referenceDescription ? (
        <div className="item-inspector-source">
          <span>Source: Wikipedia</span>
          {isExpanded && referenceUrl ? (
            <a
              className="item-inspector-link"
              href={referenceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open article
            </a>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
};

export default ItemInspector;
