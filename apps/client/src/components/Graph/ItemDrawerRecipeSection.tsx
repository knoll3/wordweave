import React from "react";
import type { LatestRecipeCatalyst, LatestRecipeInput } from "../../lib/api";
import type { Item } from "../../types";

export default function ItemDrawerRecipeSection({
  item,
  catalystGuide,
  isBaseItem,
  isLoadingRecipe,
  recipeCatalyst,
  linkedRecipeInputs,
  onSelectItem,
}: {
  item: Item;
  catalystGuide: { description: string; example: string } | null;
  isBaseItem: boolean;
  isLoadingRecipe: boolean;
  recipeCatalyst: LatestRecipeCatalyst | null;
  linkedRecipeInputs: Array<
    LatestRecipeInput & {
      item: Item | null;
    }
  >;
  onSelectItem: (item: Item) => void;
}) {
  return (
    <section className="item-drawer-section">
      <div className="item-drawer-section-label">Recipe</div>
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
      ) : linkedRecipeInputs.length > 0 ? (
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
                    onClick={() => {
                      if (input.item) {
                        onSelectItem(input.item);
                      }
                    }}
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
  );
}
