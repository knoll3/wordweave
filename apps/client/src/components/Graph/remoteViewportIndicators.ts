import type { SharedPlayerViewportCenter } from "../../liveBoardTypes";

export type RemoteViewportSnapshot = {
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
};

export type RemoteViewportIndicator = {
  playerId: string;
  x: number;
  y: number;
  angle: number;
  colorHue: number;
};

export function calculateRemoteViewportIndicators(
  viewportSnapshot: RemoteViewportSnapshot | null,
  remoteViewportCenters: SharedPlayerViewportCenter[]
): RemoteViewportIndicator[] {
  if (!viewportSnapshot || remoteViewportCenters.length === 0) {
    return [];
  }

  const inset = 26;
  const centerScreenX = viewportSnapshot.width / 2;
  const centerScreenY = viewportSnapshot.height / 2;
  const halfWidth = Math.max(1, centerScreenX - inset);
  const halfHeight = Math.max(1, centerScreenY - inset);

  const indicators = remoteViewportCenters
    .map((entry) => {
      const screenX = entry.center.x * viewportSnapshot.zoom + viewportSnapshot.cameraX;
      const screenY = entry.center.y * viewportSnapshot.zoom + viewportSnapshot.cameraY;
      if (
        screenX >= 0 &&
        screenX <= viewportSnapshot.width &&
        screenY >= 0 &&
        screenY <= viewportSnapshot.height
      ) {
        return null;
      }

      const deltaX = screenX - centerScreenX;
      const deltaY = screenY - centerScreenY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const scale =
        absDeltaX === 0 && absDeltaY === 0
          ? 0
          : Math.min(
              absDeltaX === 0 ? Number.POSITIVE_INFINITY : halfWidth / absDeltaX,
              absDeltaY === 0 ? Number.POSITIVE_INFINITY : halfHeight / absDeltaY
            );
      const clampedScale = Number.isFinite(scale) ? scale : 0;
      const angle = Math.atan2(deltaY, deltaX);
      const edgeX = centerScreenX + deltaX * clampedScale;
      const edgeY = centerScreenY + deltaY * clampedScale;
      const colorSeed = [...entry.playerId].reduce(
        (sum, char) => sum + char.charCodeAt(0),
        0
      );
      return {
        playerId: entry.playerId,
        x: edgeX,
        y: edgeY,
        angle,
        colorHue: colorSeed % 360,
      };
    })
    .filter((indicator): indicator is RemoteViewportIndicator => indicator !== null)
    .sort((left, right) => left.angle - right.angle);

  return indicators.map((indicator, index) => {
    const previous = indicators[index - 1];
    const angleGap = previous == null ? Number.POSITIVE_INFINITY : indicator.angle - previous.angle;
    const stackOffset = angleGap < 0.28 ? 18 : 0;
    const tangentX = -Math.sin(indicator.angle);
    const tangentY = Math.cos(indicator.angle);
    return {
      ...indicator,
      x: indicator.x + tangentX * stackOffset,
      y: indicator.y + tangentY * stackOffset,
    };
  });
}
