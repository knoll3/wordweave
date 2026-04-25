import React from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { Item } from "../../types";
import type { LatestRecipeCatalyst, LatestRecipeContext, LatestRecipeInput } from "../../lib/api";

export default function ItemDrawerRecipeSection({
  item,
  catalystGuide,
  isBaseItem,
  isLoadingRecipe,
  recipeCatalyst,
  linkedRecipeInputs,
  showRecipeFeedback,
  pendingFeedbackSentiment,
  isSubmittingFeedback,
  expectedResultInput,
  canSubmitDownFeedback,
  feedbackNotice,
  recipeFeedback,
  onSelectItem,
  onExpectedResultInputChange,
  onClearFeedback,
  onSubmitFeedback,
  onOpenNegativeFeedback,
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
  showRecipeFeedback: boolean;
  pendingFeedbackSentiment: "up" | "down" | null;
  isSubmittingFeedback: boolean;
  expectedResultInput: string;
  canSubmitDownFeedback: boolean;
  feedbackNotice: string | null;
  recipeFeedback: LatestRecipeContext["feedback"];
  onSelectItem: (item: Item) => void;
  onExpectedResultInputChange: (value: string) => void;
  onClearFeedback: () => void;
  onSubmitFeedback: (sentiment: "up" | "down") => void;
  onOpenNegativeFeedback: () => void;
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
          {showRecipeFeedback ? (
            <div className="item-drawer-feedback">
              <div className="item-drawer-feedback-header">
                <div className="item-drawer-feedback-title">Was this result good?</div>
                <div className="item-drawer-feedback-copy">
                  Help improve future combinations.
                </div>
              </div>
              <div className="item-drawer-feedback-actions">
                <button
                  type="button"
                  className={`item-drawer-feedback-button ${
                    pendingFeedbackSentiment === "up" ? "is-active is-positive" : ""
                  }`}
                  disabled={isSubmittingFeedback}
                  onClick={() =>
                    pendingFeedbackSentiment === "up"
                      ? onClearFeedback()
                      : onSubmitFeedback("up")
                  }
                >
                  <ThumbsUp size={16} />
                  <span>Good</span>
                </button>
                <button
                  type="button"
                  className={`item-drawer-feedback-button ${
                    pendingFeedbackSentiment === "down" ? "is-active is-negative" : ""
                  }`}
                  disabled={isSubmittingFeedback}
                  onClick={() => {
                    if (pendingFeedbackSentiment === "down") {
                      onClearFeedback();
                      return;
                    }
                    onOpenNegativeFeedback();
                  }}
                >
                  <ThumbsDown size={16} />
                  <span>Bad</span>
                </button>
              </div>
              {pendingFeedbackSentiment === "down" ? (
                <div className="item-drawer-feedback-form">
                  <label className="item-drawer-feedback-label" htmlFor={`feedback-${item.id}`}>
                    What did you expect instead?
                  </label>
                  <input
                    id={`feedback-${item.id}`}
                    className="item-drawer-feedback-input"
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="text"
                    maxLength={128}
                    placeholder="Optional expected result"
                    value={expectedResultInput}
                    onChange={(event) => onExpectedResultInputChange(event.target.value)}
                  />
                  <div className="item-drawer-feedback-form-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={!canSubmitDownFeedback}
                      onClick={() => onSubmitFeedback("down")}
                    >
                      {isSubmittingFeedback ? "Saving..." : "Send Feedback"}
                    </button>
                  </div>
                </div>
              ) : null}
              {feedbackNotice ? (
                <div className="item-drawer-feedback-notice" aria-live="polite">
                  {feedbackNotice}
                </div>
              ) : recipeFeedback ? (
                <div className="item-drawer-feedback-meta">
                  Saved {new Date(recipeFeedback.updatedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="item-drawer-empty">
          No saved recipe is linked to this item yet.
        </p>
      )}
    </section>
  );
}
