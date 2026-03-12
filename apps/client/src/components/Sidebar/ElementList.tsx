import React from "react";
import type { Item } from "../../types";

interface Props {
  items: Item[];
  onAddToWorkspace: (item: Item) => void;
}

const ElementList: React.FC<Props> = ({
  items,
  onAddToWorkspace,
}) => {
  if (!items.length) {
    return (
      <div className="sidebar-placeholder">
        No items yet. Start by combining the base items.
      </div>
    );
  }

  return (
    <div className="element-list">
      {items.map((item) => {
        return (
          <button
            key={item.id}
            className="element-row"
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/wordweave-item-id",
                String(item.id)
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAddToWorkspace(item)}
          >
            <span className="element-icon">
              {item.icon || item.name.charAt(0).toUpperCase()}
            </span>
            <span className="element-name">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ElementList;
