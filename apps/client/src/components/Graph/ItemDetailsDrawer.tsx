import React, { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_MODIFIER_ITEM_ID,
  CRAFT_ITEM_ID,
  CREATIVE_ITEM_ID,
  EVOLVE_ITEM_ID,
  OPPOSITE_ITEM_ID,
  POP_CULTURE_ITEM_ID,
  SPLIT_ITEM_ID,
  WORD_COMBINE_ITEM_ID,
} from "../../types";
import type { Item } from "../../types";
import {
  fetchItemReference,
  fetchLatestRecipeContext,
  type LatestRecipeCatalyst,
  type LatestRecipeInput,
} from "../../lib/api";

type CatalystGuide = {
  description: string;
  example: string;
};

const CATALYST_GUIDES: Record<number, CatalystGuide> = {
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
  [SPLIT_ITEM_ID]: {
    description:
      "Treats the inputs as something to split apart. Two-word names split directly into those two words, and recognized compound words split directly into their component words. Otherwise it looks for the most meaningful part, component, constituent element, or resulting piece that would plausibly appear if the item were divided, broken down, separated, or split into its underlying parts.",
    example: "Example: Sandcastle + Split + Sand -> Castle",
  },
  [OPPOSITE_ITEM_ID]: {
    description:
      "Looks for the clearest and most widely recognized opposite of the dominant input meaning. It favors a direct inverse over something poetic, clever, or loosely contrasting.",
    example: "Example: Victory + Opposite -> Defeat",
  },
  [CRAFT_ITEM_ID]: {
    description:
      "Looks for the clearest synonym, alias, alternate name, or equivalent term for the dominant input meaning. It should return a direct rewording, not a merely related concept or example.",
    example: "Example: Car + Synonym -> Automobile",
  },
  [EVOLVE_ITEM_ID]: {
    description:
      "Pushes the input toward a stronger next stage. It favors progression, development, refinement, maturity, or upgrade over a sideways variation that is merely related.",
    example: "Example: Hut + Evolve -> House",
  },
  [POP_CULTURE_ITEM_ID]: {
    description:
      "Treats the inputs as clues pointing toward one specific and recognizable pop culture reference. It prefers a named character, place, celebrity, franchise, scene, or entertainment concept over a broad genre.",
    example: "Example: Billionaire + Suit + Pop Culture -> Iron Man",
  },
  [WORD_COMBINE_ITEM_ID]: {
    description:
      "Looks for a real established compound word or common phrase formed by the inputs. It is intentionally strict and should only resolve when the result feels like something you would actually find in a dictionary, encyclopedia, or common usage.",
    example: "Example: Snow + Man + Compound -> Snowman",
  },
};

interface Props {
  item: Item;
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onSelectItem: (item: Item) => void;
}

const ItemDetailsDrawer: React.FC<Props> = ({
  item,
  itemsById,
  canGoBack,
  onBack,
  onClose,
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
    setReferenceUrl(null);
    void fetchItemReference(item.id)
      .then((reference) => {
        if (cancelled) return;
        setReferenceTitle(reference?.title ?? null);
        setReferenceDescription(reference?.summary ?? null);
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
            </>
          ) : isLoadingReference ? (
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
              <span>Loading latest recipe…</span>
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
