import CatalystDock, { type CatalystAction } from "./CatalystDock";

interface Props {
  catalystActions: CatalystAction[];
  isCatalystDockOpen: boolean;
  onToggleCatalystDock: () => void;
  closeCatalystMenuOnSelect: boolean;
  isSelectionMode: boolean;
  hasSelection: boolean;
  onToggleSelectionMode: () => void;
  onClear: () => void;
}

function GraphControls({
  catalystActions,
  isCatalystDockOpen,
  onToggleCatalystDock,
  closeCatalystMenuOnSelect,
  isSelectionMode,
  hasSelection,
  onToggleSelectionMode,
  onClear,
}: Props) {
  return (
    <>
      <CatalystDock
        catalystActions={catalystActions}
        isOpen={isCatalystDockOpen}
        onToggle={onToggleCatalystDock}
        closeOnSelect={closeCatalystMenuOnSelect}
      />
      <button
        type="button"
        className={`button ${isSelectionMode || hasSelection ? "primary" : "secondary"} graph-selection-button`}
        aria-label={
          isSelectionMode
            ? "Cancel selection mode"
            : hasSelection
              ? "Clear selection"
              : "Enter selection mode"
        }
        onClick={onToggleSelectionMode}
      >
        <span aria-hidden="true">{isSelectionMode ? "×" : "⬚"}</span>
      </button>
      <button
        type="button"
        className="button secondary graph-clear-button"
        aria-label={hasSelection ? "Clear selected items" : "Clear workspace"}
        title={hasSelection ? "Clear selected" : "Clear"}
        onClick={onClear}
      >
        {hasSelection ? "Clear Selected" : "Clear"}
      </button>
    </>
  );
}

export default GraphControls;
