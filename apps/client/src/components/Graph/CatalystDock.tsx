import React from "react";
import { ChevronDown, Sparkles } from "lucide-react";

export interface CatalystAction {
  key: string;
  title: string;
  badgeLabel?: string;
  icon: React.ReactNode;
  tint: string;
  iconTint: string;
  onClick: () => void;
}

interface Props {
  catalystActions: CatalystAction[];
  isOpen: boolean;
  onToggle: () => void;
  closeOnSelect?: boolean;
}

const CatalystDock: React.FC<Props> = ({
  catalystActions,
  isOpen,
  onToggle,
  closeOnSelect = false,
}) => {
  if (catalystActions.length === 0) {
    return null;
  }

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
            <span className="graph-catalyst-dock-meta">{catalystActions.length} ready</span>
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
              className="graph-catalyst-button"
              onClick={() => {
                action.onClick();
                if (closeOnSelect && isOpen) {
                  onToggle();
                }
              }}
              style={{ ["--catalyst-tint" as string]: action.tint }}
              aria-label={action.title}
              title={action.title}
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
