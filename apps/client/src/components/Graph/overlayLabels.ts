import type { SharedBoardActivityMode } from "../../liveBoardTypes";

export type ActivityOverlayLabels = {
  title: string;
  copy: string;
};

export function getLocalActivityOverlayLabels(
  hasWebSearchActivity: boolean
): ActivityOverlayLabels {
  return hasWebSearchActivity
    ? {
        title: "Searching",
        copy: "Searching the web for better results.",
      }
    : {
        title: "Ponderificating",
        copy: "Thinking harder for a better result.",
      };
}

export function getRemoteActivityOverlayLabels(
  remoteActivityMode: SharedBoardActivityMode | null
): ActivityOverlayLabels {
  if (remoteActivityMode === "searching") {
    return {
      title: "Searching",
      copy: "Searching the web for better results.",
    };
  }

  if (remoteActivityMode === "pondering") {
    return {
      title: "Ponderificating",
      copy: "Thinking harder for a better result.",
    };
  }

  return {
    title: "Combining",
    copy: "Another player is combining these items.",
  };
}
