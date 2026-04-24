import type { CSSProperties } from "react";
import type { SharedBoardActivityMode } from "../../liveBoardTypes";
import type { ActivityOverlayLabels } from "./overlayLabels";
import type { RemoteViewportIndicator } from "./remoteViewportIndicators";

type ScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

interface Props {
  selectionDragRect: ScreenRect | null;
  activeActivityOverlayRect: ScreenRect | null;
  localActivityLabels: ActivityOverlayLabels;
  remoteActivityOverlayRect: ScreenRect | null;
  remoteActivityMode: SharedBoardActivityMode | null;
  remoteActivityLabels: ActivityOverlayLabels;
  selectionOverlayRect: ScreenRect | null;
  selectedNodeCount: number;
  isSelectionCombining: boolean;
  onCombineSelection: () => void;
  remoteSelectionOverlayRect: ScreenRect | null;
  remoteSelectedNodeCount: number;
  remoteViewportIndicators: RemoteViewportIndicator[];
}

function GraphActivityOverlay({
  rect,
  labels,
}: {
  rect: ScreenRect;
  labels: ActivityOverlayLabels;
}) {
  return (
    <div
      className="graph-activity-overlay"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div className="graph-activity-overlay-sheen" aria-hidden="true" />
      <div className="graph-activity-overlay-content" role="status" aria-live="polite">
        <div className="graph-activity-overlay-loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="graph-activity-overlay-title">{labels.title}</div>
        <div className="graph-activity-overlay-copy">{labels.copy}</div>
      </div>
    </div>
  );
}

function GraphOverlays({
  selectionDragRect,
  activeActivityOverlayRect,
  localActivityLabels,
  remoteActivityOverlayRect,
  remoteActivityMode,
  remoteActivityLabels,
  selectionOverlayRect,
  selectedNodeCount,
  isSelectionCombining,
  onCombineSelection,
  remoteSelectionOverlayRect,
  remoteSelectedNodeCount,
  remoteViewportIndicators,
}: Props) {
  return (
    <>
      {selectionDragRect ? (
        <div
          className="graph-selection-drag-box"
          style={{
            left: selectionDragRect.left,
            top: selectionDragRect.top,
            width: selectionDragRect.width,
            height: selectionDragRect.height,
          }}
        />
      ) : null}
      {activeActivityOverlayRect ? (
        <GraphActivityOverlay rect={activeActivityOverlayRect} labels={localActivityLabels} />
      ) : null}
      {remoteActivityOverlayRect &&
      (remoteActivityMode === "searching" || remoteActivityMode === "pondering") ? (
        <GraphActivityOverlay rect={remoteActivityOverlayRect} labels={remoteActivityLabels} />
      ) : null}
      {selectionOverlayRect && selectedNodeCount >= 2 ? (
        <div
          className="graph-selection-overlay"
          style={{
            left: selectionOverlayRect.left,
            top: selectionOverlayRect.top,
            width: selectionOverlayRect.width,
            height: selectionOverlayRect.height,
          }}
        >
          <button
            type="button"
            className="button primary graph-selection-combine-button"
            onClick={onCombineSelection}
            disabled={isSelectionCombining}
          >
            {isSelectionCombining ? "Combining..." : "Combine"}
          </button>
        </div>
      ) : null}
      {remoteSelectionOverlayRect && remoteSelectedNodeCount >= 2 ? (
        <div
          className="graph-selection-overlay graph-selection-overlay-remote"
          style={{
            left: remoteSelectionOverlayRect.left,
            top: remoteSelectionOverlayRect.top,
            width: remoteSelectionOverlayRect.width,
            height: remoteSelectionOverlayRect.height,
          }}
        />
      ) : null}
      {remoteViewportIndicators.map((indicator) => (
        <div
          key={indicator.playerId}
          className="graph-remote-viewport-indicator"
          style={
            {
              left: indicator.x,
              top: indicator.y,
              transform: `translate(-50%, -50%) rotate(${indicator.angle}rad)`,
              ["--remote-player-hue" as string]: String(indicator.colorHue),
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span className="graph-remote-viewport-indicator-pill">
            <span className="graph-remote-viewport-indicator-dot" />
            <span className="graph-remote-viewport-indicator-arrow">➜</span>
          </span>
        </div>
      ))}
    </>
  );
}

export default GraphOverlays;
