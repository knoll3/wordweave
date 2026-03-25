import React, { useEffect, useMemo, useState } from "react";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  CREATIVE_ITEM_ID,
} from "../../types";
import type { Item } from "../../types";
import {
  fetchItemReference,
  fetchLatestRecipeContext,
  type LatestRecipeCatalyst,
  type LatestRecipeInput,
} from "../../lib/api";
import {
  ACTION_PROMPT_FAMILY_REFERENCES,
  normalizeActionTrigger,
} from "../../lib/actionPromptFamilies";

type CatalystGuide = {
  description: string;
  example: string;
};

const CATALYST_GUIDES: Record<number, CatalystGuide> = {
  [ACTION_MODIFIER_ITEM_ID]: {
    description:
      "Action is a modifier token that can be attached to any item. That item becomes the action being performed, and the other combined items act as clues for what happens when that action is applied. Most anchor words use the general action behavior, while certain words like Split, Opposite, Synonym, Translate, Distill, Simplify, and Common switch to specialized tuned behavior.",
    example:
      "Example: Action -> Common, then Common + Cat + Monkey -> Mammal. Action -> Split, then Split + Steam Engine -> Steam + Engine.",
  },
  [CATEGORY_MODIFIER_ITEM_ID]: {
    description:
      "Category is a modifier token. Drop it onto an item to turn that item into a category constraint, then combine that modified item with clue items to get something that stays inside that category.",
    example: "Example: Category -> Pokemon, then Pokemon + Bird -> a bird-like Pokemon",
  },
  [CREATIVE_ITEM_ID]: {
    description:
      "Pushes the combination away from the most literal answer and toward something more playful, silly, vivid, and memorable. It prefers expressive or delightfully weird ideas over dry or academic ones, and it can invent a fun made-up term if it still clearly fits the inputs.",
    example: "Example: Shark + Tornado + Creative Spark -> Sharknado",
  },
};

interface Props {
  item: Item;
  items: Item[];
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onAddItemToWorkspace: (item: Item) => void;
  onAddItemToWorkspaceAsActionAnchor: (item: Item) => void;
  onSelectItem: (item: Item) => void;
}

const ItemDetailsDrawer: React.FC<Props> = ({
  item,
  items,
  itemsById,
  canGoBack,
  onBack,
  onClose,
  onAddItemToWorkspace,
  onAddItemToWorkspaceAsActionAnchor,
  onSelectItem,
}) => {
  const catalystGuide = item.id < 0 ? CATALYST_GUIDES[item.id] ?? null : null;
  const isBaseItem =
    item.normalizedName === "fire" ||
    item.normalizedName === "water" ||
    item.normalizedName === "earth" ||
    item.normalizedName === "air";
  const [referenceDescription, setReferenceDescription] = useState<string | null>(null);
  const [referenceTitle, setReferenceTitle] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [isLoadingReference, setIsLoadingReference] = useState(false);
  const [recipeCatalyst, setRecipeCatalyst] = useState<LatestRecipeCatalyst | null>(null);
  const [recipeInputs, setRecipeInputs] = useState<LatestRecipeInput[]>([]);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (item.id < 0) {
      setReferenceDescription(null);
      setReferenceTitle(null);
      setReferenceImageUrl(null);
      setReferenceUrl(null);
      setIsLoadingReference(false);
      setRecipeCatalyst(null);
      setRecipeInputs([]);
      setIsLoadingRecipe(false);
      return;
    }

    setIsLoadingReference(true);
    setReferenceDescription(null);
    setReferenceTitle(null);
    setReferenceImageUrl(null);
    setReferenceUrl(null);
    void fetchItemReference(item.id)
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

    setIsLoadingRecipe(true);
    setRecipeCatalyst(null);
    setRecipeInputs([]);
    void fetchLatestRecipeContext(item.id)
      .then((latestRecipe) => {
        if (cancelled) return;
        setRecipeCatalyst(latestRecipe?.catalyst ?? null);
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
  const actionTriggerSections = useMemo(() => {
    if (item.id !== ACTION_MODIFIER_ITEM_ID) {
      return null;
    }

    const itemByNormalizedTrigger = new Map(
      items.map((entry) => [normalizeActionTrigger(entry.normalizedName), entry] as const)
    );
    return ACTION_PROMPT_FAMILY_REFERENCES.map((family) => {
      const discoveredItems = family.triggerWords
        .map((word) => itemByNormalizedTrigger.get(normalizeActionTrigger(word)) ?? null)
        .filter((entry): entry is Item => entry != null)
        .filter(
          (entry, index, array) =>
            array.findIndex((candidate) => candidate.id === entry.id) === index
        );
      const undiscoveredWords = family.triggerWords.filter(
        (word) => !itemByNormalizedTrigger.has(normalizeActionTrigger(word))
      );

      return {
        title: family.title,
        description: family.description,
        discoveredItems,
        undiscoveredWords,
      };
    });
  }, [item.id, items]);

  return (
    <aside className="item-drawer item-drawer-panel" aria-label={`${item.name} details`}>
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

        <section className="item-drawer-section">
          <div className="item-drawer-section-label">Latest recipe</div>
          {catalystGuide ? (
            <p className="item-drawer-empty">
              Catalysts are tools you combine with other items, not recipe results themselves.
            </p>
          ) : isBaseItem ? (
            <p className="item-drawer-empty">
              Base elements do not show recipe history here.
            </p>
          ) : isLoadingRecipe ? (
            <div className="item-drawer-status" aria-live="polite">
              <span className="search-pending-spinner" aria-hidden="true" />
              <span>Loading first recipe…</span>
            </div>
          ) : recipeInputs.length > 0 ? (
            <>
              <div className="item-drawer-chip-row item-drawer-recipe-row">
                {recipeCatalyst ? (
                  <>
                    <span className="item-drawer-chip is-disabled">
                      <span aria-hidden="true">
                        {recipeCatalyst.icon || recipeCatalyst.name.charAt(0).toUpperCase()}
                      </span>
                      <span>{recipeCatalyst.name}</span>
                    </span>
                    <span className="item-drawer-recipe-separator" aria-hidden="true">
                      +
                    </span>
                  </>
                ) : null}
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
  );
};

export default ItemDetailsDrawer;
