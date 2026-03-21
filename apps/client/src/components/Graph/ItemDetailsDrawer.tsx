import React, { useEffect, useMemo, useState } from "react";
import {
  fetchItemReference,
  fetchLatestRecipeContext,
  type LatestRecipeInput,
} from "../../lib/api";
import type { Item } from "../../types";

interface Props {
  item: Item;
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  isClosing: boolean;
  onBack: () => void;
  onClose: () => void;
  onSelectItem: (item: Item) => void;
}

const ItemDetailsDrawer: React.FC<Props> = ({
  item,
  itemsById,
  canGoBack,
  isClosing,
  onBack,
  onClose,
  onSelectItem,
}) => {
  const isBaseItem =
    item.normalizedName === "fire" ||
    item.normalizedName === "water" ||
    item.normalizedName === "earth" ||
    item.normalizedName === "air";
  const [referenceDescription, setReferenceDescription] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [isLoadingReference, setIsLoadingReference] = useState(false);
  const [recipeInputs, setRecipeInputs] = useState<LatestRecipeInput[]>([]);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (item.id < 0) {
      setReferenceDescription(null);
      setReferenceUrl(null);
      setIsLoadingReference(false);
      setRecipeInputs([]);
      setIsLoadingRecipe(false);
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
      .finally(() => {
        if (cancelled) return;
        setIsLoadingReference(false);
      });

    setIsLoadingRecipe(true);
    setRecipeInputs([]);
    void fetchLatestRecipeContext(item.id)
      .then((latestRecipe) => {
        if (cancelled) return;
        setRecipeInputs(latestRecipe?.inputs ?? []);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingRecipe(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const linkedRecipeInputs = useMemo(
    () =>
      recipeInputs.map((input) => ({
        ...input,
        item:
          input.id == null
            ? null
            : itemsById.get(input.id) ?? {
                id: input.id,
                name: input.name,
                normalizedName: input.normalizedName,
                icon: input.icon,
              },
      })),
    [itemsById, recipeInputs]
  );

  return (
    <div
      className={`item-drawer-layer${isClosing ? " is-closing" : ""}`}
      role="presentation"
    >
      <button
        type="button"
        className="item-drawer-backdrop"
        aria-label="Close item details"
        onClick={onClose}
      />
      <aside className="item-drawer" role="dialog" aria-label={`${item.name} details`}>
        <div className="item-drawer-header">
          <div className="item-drawer-header-actions">
            {canGoBack ? (
              <button
                type="button"
                className="item-drawer-back"
                onClick={onBack}
                aria-label="Go back to the previous item"
              >
                <span aria-hidden="true">←</span>
                <span>Back</span>
              </button>
            ) : null}
          </div>
          <div className="item-drawer-title-wrap">
            <span className="item-drawer-icon" aria-hidden="true">
              {item.icon || item.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <div className="item-drawer-title">{item.name}</div>
              <div className="item-drawer-subtitle">Item details</div>
            </div>
          </div>
          <button
            type="button"
            className="item-drawer-close"
            onClick={onClose}
            aria-label="Close item details"
          >
            ×
          </button>
        </div>

        <section className="item-drawer-section">
          <div className="item-drawer-section-label">Reference</div>
          {isLoadingReference ? (
            <div className="item-drawer-status" aria-live="polite">
              <span className="search-pending-spinner" aria-hidden="true" />
              <span>Loading reference…</span>
            </div>
          ) : referenceDescription ? (
            <>
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

        <section className="item-drawer-section">
          <div className="item-drawer-section-label">Latest recipe</div>
          {isBaseItem ? (
            <p className="item-drawer-empty">
              Base elements do not show recipe history here.
            </p>
          ) : isLoadingRecipe ? (
            <div className="item-drawer-status" aria-live="polite">
              <span className="search-pending-spinner" aria-hidden="true" />
              <span>Loading latest recipe…</span>
            </div>
          ) : recipeInputs.length > 0 ? (
            <>
              <div className="item-drawer-chip-row item-drawer-recipe-row">
                {linkedRecipeInputs.map((input, index) => (
                  <React.Fragment key={`${input.normalizedName}-${input.id ?? "missing"}`}>
                    {index > 0 ? (
                      <span className="item-drawer-recipe-separator" aria-hidden="true">
                        +
                      </span>
                    ) : null}
                    {input.item ? (
                      <button
                        type="button"
                        className="item-drawer-chip"
                        onClick={() => onSelectItem(input.item!)}
                      >
                        <span aria-hidden="true">
                          {input.icon || input.name.charAt(0).toUpperCase()}
                        </span>
                        <span>{input.name}</span>
                      </button>
                    ) : (
                      <span className="item-drawer-chip is-disabled">
                        <span aria-hidden="true">
                          {input.icon || input.name.charAt(0).toUpperCase()}
                        </span>
                        <span>{input.name}</span>
                      </span>
                    )}
                  </React.Fragment>
                ))}
                <span className="item-drawer-recipe-separator" aria-hidden="true">
                  →
                </span>
                <span className="item-drawer-chip is-result">
                  <span aria-hidden="true">
                    {item.icon || item.name.charAt(0).toUpperCase()}
                  </span>
                  <span>{item.name}</span>
                </span>
              </div>
            </>
          ) : (
            <p className="item-drawer-empty">
              No saved recipe is linked to this item yet.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
};

export default ItemDetailsDrawer;
