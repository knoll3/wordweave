import { Container, Graphics, Text } from "pixi.js";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  CREATIVE_ITEM_ID,
} from "../../types";
import { ACTION_CATALYST_BY_ID } from "../../lib/specialItems";

export type ItemVisualState = "default" | "highlight";

export type ItemView = {
  nodeId: string;
  container: Container;
  background: Graphics;
  loader: Graphics | null;
  icon: Text;
  label: Text;
  badge: Text | null;
  actionBadge: Container | null;
  categoryBadge: Container | null;
  celebration: Graphics | null;
  celebrationParticles: Graphics | null;
  itemId: number;
  hasActionModifier: boolean;
  hasCategoryModifier: boolean;
  width: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  scaleStep: number;
  contentAlpha: number;
  targetContentAlpha: number;
  destroyWhenSettled: boolean;
  celebrationProgress: number;
  celebrationTintProgress: number;
  celebrationTintHoldFrames: number;
};

export const INITIAL_WORLD_CENTER = { x: 260, y: 180 };
export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 2.25;
export const ZOOM_STEP = 0.12;
export const CARD_HEIGHT = 42;
export const CARD_HORIZONTAL_PADDING = 18;
export const CARD_RADIUS = 10;
export const CATEGORY_MODIFIER_RADIUS = CARD_HEIGHT / 2;
export const CATEGORY_MODIFIER_HEIGHT = 34;
export const GRID_SPACING = 28;
export const GRID_RADIUS = 1.15;
export const HOVER_SCALE_STEP = 0.012;
export const COMBINE_SCALE_STEP = 0.075;
export const POSITION_STEP = 26;
export const CONTENT_ALPHA_STEP = 0.11;
export const COMBINING_CONTENT_ALPHA = 0.5;
export const SPAWN_SCALE = 0.18;
export const SHRINK_SCALE = 0.18;
export const GRID_CELL_GAP_X = 18;
export const GRID_CELL_GAP_Y = 16;
export const SELECTION_PADDING = 30;
export const PLACEHOLDER_WIDTH = 120;
export const PAN_DRAG_THRESHOLD = 4;
export const DUPLICATE_OFFSET_X = 14;
export const DUPLICATE_OFFSET_Y = 14;
export const DOUBLE_CLICK_MS = 320;
export const DRAWER_OPEN_DELAY_MS = 180;
export const CLICK_MOVE_THRESHOLD = 6;
export const CELEBRATION_PROGRESS_STEP = 0.022;
export const CELEBRATION_TINT_FADE_STEP = 0.012;
export const CELEBRATION_TINT_HOLD_FRAMES = 150;
export const DOUBLE_TAP_DISTANCE_THRESHOLD = 24;

export function isCatalystItemId(itemId: number) {
  return (
    itemId === ACTION_MODIFIER_ITEM_ID ||
    itemId === CATEGORY_MODIFIER_ITEM_ID ||
    itemId === CREATIVE_ITEM_ID ||
    ACTION_CATALYST_BY_ID.has(itemId)
  );
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function moveToward(current: number, target: number, step: number) {
  if (Math.abs(target - current) <= step) {
    return target;
  }
  return current + Math.sign(target - current) * step;
}

export function getNodeTint(itemId: number) {
  if (itemId === ACTION_MODIFIER_ITEM_ID) return 0xfbbf24;
  if (itemId === CATEGORY_MODIFIER_ITEM_ID) return 0x5eead4;
  if (itemId === CREATIVE_ITEM_ID) return 0xa78bfa;
  if (itemId === -11) return 0xfb923c;
  if (itemId === -12) return 0x60a5fa;
  if (itemId === -13) return 0xc084fc;
  if (itemId === -14) return 0x4ade80;
  if (itemId === -15) return 0xf472b6;
  if (itemId === -16) return 0xfacc15;
  if (itemId === -17) return 0x2dd4bf;
  if (itemId === -18) return 0x94a3b8;
  if (itemId === COMBINE_RESULT_PLACEHOLDER_ITEM_ID) return 0x64748b;
  return 0x94a3b8;
}

export function mixColor(from: number, to: number, amount: number) {
  const t = clamp(amount, 0, 1);
  const fromR = (from >> 16) & 0xff;
  const fromG = (from >> 8) & 0xff;
  const fromB = from & 0xff;
  const toR = (to >> 16) & 0xff;
  const toG = (to >> 8) & 0xff;
  const toB = to & 0xff;
  const r = Math.round(fromR + (toR - fromR) * t);
  const g = Math.round(fromG + (toG - fromG) * t);
  const b = Math.round(fromB + (toB - fromB) * t);
  return (r << 16) | (g << 8) | b;
}

export function drawItemCard(
  background: Graphics,
  width: number,
  itemId: number,
  state: ItemVisualState,
  hasModifier = false,
  celebrationAmount = 0,
  celebrationPulse = 0
) {
  const isHighlighted = state === "highlight";
  const nodeTint = getNodeTint(itemId);
  const isCatalyst = isCatalystItemId(itemId);
  const isModifierToken =
    itemId === CATEGORY_MODIFIER_ITEM_ID || itemId === ACTION_MODIFIER_ITEM_ID;
  const celebrationFill = mixColor(0x5b2a86, 0x7c3aed, celebrationPulse);
  const celebrationStroke = mixColor(0xe9d5ff, 0xf3e8ff, celebrationPulse);
  const fillColor = mixColor(
    isHighlighted ? 0x132033 : 0x0f172a,
    isCatalyst ? nodeTint : 0x0f172a,
    isCatalyst ? 0.12 : 0
  );
  const finalFillColor = mixColor(fillColor, celebrationFill, celebrationAmount);
  const strokeColor = mixColor(
    hasModifier ? 0x5eead4 : nodeTint,
    celebrationStroke,
    celebrationAmount
  );
  background.clear();
  if (isModifierToken) {
    const modifierY = Math.round((CARD_HEIGHT - CATEGORY_MODIFIER_HEIGHT) / 2);
    background.roundRect(0, modifierY, width, CATEGORY_MODIFIER_HEIGHT, CATEGORY_MODIFIER_HEIGHT / 2).fill({
      color: finalFillColor,
      alpha: 1,
    });
    background.roundRect(
      1,
      modifierY + 1,
      width - 2,
      CATEGORY_MODIFIER_HEIGHT - 2,
      CATEGORY_MODIFIER_HEIGHT / 2 - 1
    ).stroke({
      width: 1.5,
      color: 0x5eead4,
      alpha: 0.72,
    });
    background.circle(18, CARD_HEIGHT / 2, 3).fill({
      color: 0x0f172a,
      alpha: 0.62,
    });
  } else {
    background
      .roundRect(0, 0, width, CARD_HEIGHT, CARD_RADIUS)
      .fill({ color: finalFillColor, alpha: 1 });
  }
  if (!isModifierToken) {
    background.stroke({
      width: hasModifier || isHighlighted ? 1.9 : 1.5,
      color: strokeColor,
      alpha: ((isHighlighted || hasModifier) ? 0.56 : 0.42) + celebrationAmount * 0.28,
    });
  }
}

export function drawCelebrationBurst(graphic: Graphics, width: number) {
  const radius = Math.max(width * 0.42, 26);
  graphic.clear();
  graphic.circle(0, 0, radius).stroke({
    width: 3,
    color: 0xfacc15,
    alpha: 0.92,
  });
  graphic.circle(0, 0, radius + 8).stroke({
    width: 1.5,
    color: 0x86efac,
    alpha: 0.72,
  });
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    const inner = radius + 4;
    const outer = radius + 12;
    graphic
      .moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
      .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
      .stroke({
        width: 2,
        color: 0xfef08a,
        alpha: 0.9,
      });
  }
}

export function drawCelebrationParticles(
  graphic: Graphics,
  width: number,
  progress: number
) {
  const completion = 1 - progress;
  const radiusBase = Math.max(width * 0.26, 18);
  graphic.clear();
  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + completion * 0.45;
    const distance = radiusBase + completion * 26 + (index % 2) * 6;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const size = Math.max(1.8, 4.8 - completion * 2.8);
    const color =
      index % 3 === 0 ? 0xfacc15 : index % 3 === 1 ? 0x86efac : 0xf9a8d4;
    graphic.circle(x, y, size).fill({
      color,
      alpha: Math.max(0, 0.95 - completion * 0.75),
    });
  }
}

export function setViewTopLeftPosition(view: ItemView, position: { x: number; y: number }) {
  view.container.position.set(position.x + view.width / 2, position.y + CARD_HEIGHT / 2);
  view.targetX = view.container.x;
  view.targetY = view.container.y;
}

export function setViewTargetTopLeftPosition(
  view: ItemView,
  position: { x: number; y: number }
) {
  view.targetX = position.x + view.width / 2;
  view.targetY = position.y + CARD_HEIGHT / 2;
}

export function getViewTopLeftPosition(view: ItemView) {
  return {
    x: view.container.x - view.width / 2,
    y: view.container.y - CARD_HEIGHT / 2,
  };
}
