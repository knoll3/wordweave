import React, { useEffect, useRef } from "react";
import type { Item } from "../../types";

interface Props {
  items: Item[];
  onAddToWorkspace: (item: Item) => void;
  pendingLabel?: string | null;
  statusLabel?: string | null;
  emptyLabel?: string;
  emptyState?: React.ReactNode;
  listRef?: React.Ref<HTMLDivElement>;
}

const ElementList: React.FC<Props> = ({
  items,
  onAddToWorkspace,
  pendingLabel = null,
  statusLabel = null,
  emptyLabel = "No items yet. Start by combining the base items.",
  emptyState = null,
  listRef,
}) => {
  const suppressNextClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (suppressClickTimeoutRef.current != null) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, []);

  function suppressNextClick() {
    suppressNextClickRef.current = true;
    if (suppressClickTimeoutRef.current != null) {
      window.clearTimeout(suppressClickTimeoutRef.current);
    }
    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressClickTimeoutRef.current = null;
    }, 600);
  }

  function handleItemClick(item: Item) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      if (suppressClickTimeoutRef.current != null) {
        window.clearTimeout(suppressClickTimeoutRef.current);
        suppressClickTimeoutRef.current = null;
      }
      return;
    }
    onAddToWorkspace(item);
  }

  if (!items.length && !pendingLabel && !statusLabel) {
    return emptyState ? <>{emptyState}</> : <div className="sidebar-placeholder">{emptyLabel}</div>;
  }

  return (
    <div ref={listRef} className="element-list">
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
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") {
                return;
              }
              event.preventDefault();
              suppressNextClick();
              onAddToWorkspace(item);
            }}
            onClick={() => handleItemClick(item)}
          >
            <span className="element-icon">
              {item.icon || item.name.charAt(0).toUpperCase()}
            </span>
            <span className="element-name">{item.name}</span>
          </button>
        );
      })}
      {pendingLabel ? (
        <div className="element-list-status" role="status" aria-live="polite">
          <span className="search-pending-spinner" aria-hidden="true" />
          <span>{pendingLabel}</span>
        </div>
      ) : null}
      {statusLabel ? (
        <div className="element-list-status" role="status" aria-live="polite">
          <span>{statusLabel}</span>
        </div>
      ) : null}
    </div>
  );
};

export default ElementList;
