import React from "react";
import type { Item } from "../../types";

interface Props {
  selectedElements: Item[];
  isCombining: boolean;
  onClear: () => void;
  onCombine: () => void;
}

const CombineTray: React.FC<Props> = ({
  selectedElements,
  isCombining,
  onClear,
  onCombine,
}) => {
  const disabled = selectedElements.length === 0 || isCombining;

  return (
    <section className="combine-tray">
      <div className="combine-inputs">
        {selectedElements.length === 0 ? (
          <span className="pill muted">
            Select one or more items to combine.
          </span>
        ) : (
          selectedElements.map((el) => (
            <span key={el.id} className="pill">
              <span className="pill-icon">
                {el.icon || el.name.charAt(0).toUpperCase()}
              </span>
              <span>{el.name}</span>
            </span>
          ))
        )}
      </div>
      <div className="combine-actions">
        <button
          className="button secondary"
          type="button"
          disabled={selectedElements.length === 0 || isCombining}
          onClick={onClear}
        >
          Clear
        </button>
        <button
          className="button primary"
          type="button"
          disabled={disabled}
          onClick={onCombine}
        >
          {isCombining ? "Combining…" : "Combine"}
        </button>
      </div>
    </section>
  );
};

export default CombineTray;
