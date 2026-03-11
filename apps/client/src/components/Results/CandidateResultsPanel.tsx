import React from "react";
import type { Recipe, RecipeCandidate } from "../../types";

interface Props {
  recipe: Recipe | null;
  isSelecting: boolean;
  onSelectCandidate: (candidate: RecipeCandidate) => void;
  onClose: () => void;
}

const CandidateResultsPanel: React.FC<Props> = ({
  recipe,
  isSelecting,
  onSelectCandidate,
  onClose,
}) => {
  if (!recipe) return null;

  return (
    <div className="results-overlay">
      <div className="results-backdrop" onClick={onClose} />
      <div className="results-panel" role="dialog" aria-modal="true">
        <header className="results-header">
          <div>
            <h2 className="results-title">Choose your result</h2>
            <p className="results-subtitle">
              Based on: {recipe.inputs.map((i) => i.name).join(" + ")}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="results-grid">
          {recipe.candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className="result-card"
              disabled={isSelecting}
              onClick={() => onSelectCandidate(c)}
            >
              <div className="result-icon">{c.icon}</div>
              <div className="result-name">{c.name}</div>
            </button>
          ))}
        </div>

        <footer className="results-footer">
          <p className="results-hint">
            Your choice becomes the canonical result for this exact
            combination.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default CandidateResultsPanel;

