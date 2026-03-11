import React from "react";
import type { RecentRecipe } from "../../types";

interface Props {
  recent: RecentRecipe[];
}

const RecentCreations: React.FC<Props> = ({ recent }) => {
  if (!recent.length) {
    return (
      <div className="sidebar-placeholder">
        Newly crafted items will appear here.
      </div>
    );
  }

  return (
    <div className="recent-list">
      {recent.map((item) => (
        <div key={item.id} className="recent-row">
          <div className="recent-main">
            <span className="recent-icon">
              {item.resultElement.icon ||
                item.resultElement.name.charAt(0).toUpperCase()}
            </span>
            <div className="recent-text">
              <div className="recent-title">
                {item.resultElement.name}
              </div>
              <div className="recent-subtitle">
                {item.inputs.map((i) => i.name).join(" + ")}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RecentCreations;
