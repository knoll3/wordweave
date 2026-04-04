import React from "react";
import { ChevronDown, Sparkles } from "lucide-react";

export interface CatalystAction {
  key: string;
  title: string;
  badgeLabel?: string;
  disabled?: boolean;
  disabledReason?: string | null;
  icon: React.ReactNode;
  tint: string;
  iconTint: string;
  onClick: () => void;
}

interface Props {
  catalystActions: CatalystAction[];
  isOpen: boolean;
  onToggle: () => void;
}

const CatalystDock: React.FC<Props> = ({ catalystActions, isOpen, onToggle }) => {
  if (catalystActions.length === 0) {
    return null;
  }

  const readyCount = catalystActions.filter((action) => !action.disabled).length;
  const unavailableCount = catalystActions.length - readyCount;

  return (
    <div className={`graph-catalyst-dock${isOpen ? "" : " is-collapsed"}`} aria-label="Catalysts">
      <button
        type="button"
        className="graph-catalyst-dock-header"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="graph-catalyst-list"
      >
        <span className="graph-catalyst-dock-header-main">
          <span className="graph-catalyst-dock-badge" aria-hidden="true">
            <Sparkles size={14} strokeWidth={2} />
          </span>
          <span className="graph-catalyst-dock-copy">
            <span className="graph-catalyst-dock-label">Catalysts</span>
            <span className="graph-catalyst-dock-meta">
              {unavailableCount > 0
                ? `${readyCount} ready · ${unavailableCount} unavailable`
                : `${readyCount} ready`}
            </span>
          </span>
        </span>
        <span className="graph-catalyst-dock-header-end">
          <span className="graph-catalyst-dock-count">{catalystActions.length}</span>
          <span className="graph-catalyst-dock-toggle" aria-hidden="true">
            <ChevronDown size={16} strokeWidth={2.25} />
          </span>
        </span>
      </button>
      <div
        id="graph-catalyst-list"
        className={`graph-catalyst-list-wrap${isOpen ? "" : " is-collapsed"}`}
      >
        <div className="graph-catalyst-list">
          {catalystActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`graph-catalyst-button${action.disabled ? " is-disabled" : ""}`}
              onClick={action.onClick}
              title={action.disabledReason ?? undefined}
              aria-disabled={action.disabled ? true : undefined}
              style={{ ["--catalyst-tint" as string]: action.tint }}
            >
              <span
                className="graph-catalyst-button-icon"
                aria-hidden="true"
                style={{ color: action.iconTint }}
              >
                {action.icon}
              </span>
              <span className="graph-catalyst-button-copy">
                <span className="graph-catalyst-button-title">{action.title}</span>
                {action.badgeLabel ? (
                  <span className="graph-catalyst-button-badge">{action.badgeLabel}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CatalystDock;
