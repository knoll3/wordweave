import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
} from "pixi.js";
import type { Item, WorkspaceItem } from "../../types";
import {
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
} from "../../types";
import {
  CARD_HEIGHT,
  CARD_HORIZONTAL_PADDING,
  HOVER_SCALE_STEP,
  ItemView,
  PLACEHOLDER_WIDTH,
  drawCelebrationBurst,
  drawItemCard,
  setViewTopLeftPosition,
} from "./graphViewHelpers";

const ITEM_HITBOX_PADDING = 10;

type CreateItemViewOptions = {
  onActionBadgePointerDown: (
    event: FederatedPointerEvent,
    workspaceItem: WorkspaceItem
  ) => void;
  onCategoryBadgePointerDown: (
    event: FederatedPointerEvent,
    workspaceItem: WorkspaceItem
  ) => void;
  onContainerPointerDown: (
    event: FederatedPointerEvent,
    view: ItemView,
    workspaceItem: WorkspaceItem,
    item: Item
  ) => void;
};

export function createItemView(
  workspaceItem: WorkspaceItem,
  item: Item,
  {
    onActionBadgePointerDown,
    onCategoryBadgePointerDown,
    onContainerPointerDown,
  }: CreateItemViewOptions
): ItemView {
  const container = new Container();
  container.eventMode = "static";
  container.cursor = "grab";
  const isPlaceholder = item.id === COMBINE_RESULT_PLACEHOLDER_ITEM_ID;
  const hasActionModifier = Boolean(
    workspaceItem.actionConstraintName && workspaceItem.actionConstraintNormalizedName
  );
  const hasCategoryModifier = Boolean(
    workspaceItem.categoryConstraintName && workspaceItem.categoryConstraintNormalizedName
  );

  const isModifierItem =
    item.id === CATEGORY_MODIFIER_ITEM_ID || item.id === ACTION_MODIFIER_ITEM_ID;
  const icon = new Text({
    text: isPlaceholder ? "" : item.icon || "•",
    style: {
      fill: 0xe5e7eb,
      fontFamily: "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif",
      fontSize: isModifierItem ? 17 : 20,
      fontWeight: "600",
      wordWrap: false,
      breakWords: false,
    },
  });
  const labelValue = isPlaceholder ? "" : item.name;
  const label = new Text({
    text: labelValue,
    style: {
      fill: 0xe5e7eb,
      fontFamily: "Trebuchet MS, Verdana, sans-serif",
      fontSize: isModifierItem ? 15 : 17,
      fontWeight: "600",
      wordWrap: false,
      breakWords: false,
    },
  });
  const loader = isPlaceholder ? new Graphics() : null;
  const badge = workspaceItem.isNewDiscovery
    ? new Text({
        text: "✦",
        style: {
          fill: 0xfacc15,
          fontFamily: "Trebuchet MS, Verdana, sans-serif",
          fontSize: 15,
          fontWeight: "700",
        },
      })
    : null;
  const actionBadge = hasActionModifier ? new Container() : null;
  const categoryBadge = hasCategoryModifier ? new Container() : null;
  const celebration = isPlaceholder ? null : new Graphics();
  const celebrationParticles = isPlaceholder ? null : new Graphics();

  const background = new Graphics();
  if (loader) {
    loader
      .arc(0, 0, 7, 0.2 * Math.PI, 1.7 * Math.PI)
      .stroke({ width: 3, color: 0xe5e7eb, alpha: 0.95 });
  }
  const contentWidth = isPlaceholder
    ? PLACEHOLDER_WIDTH
    : CARD_HORIZONTAL_PADDING * 2 +
      icon.width +
      (isModifierItem ? 8 : 10) +
      label.width;
  const cardWidth = contentWidth;
  drawItemCard(
    background,
    cardWidth,
    item.id,
    "default",
    hasCategoryModifier || hasActionModifier
  );

  icon.x = isModifierItem ? 14 : CARD_HORIZONTAL_PADDING;
  icon.y = Math.round((CARD_HEIGHT - icon.height) / 2) - 1;

  label.x = icon.x + icon.width + (isModifierItem ? 8 : 10);
  label.y = Math.round((CARD_HEIGHT - label.height) / 2) - 1;

  if (loader) {
    loader.x = Math.round(cardWidth / 2);
    loader.y = Math.round(CARD_HEIGHT / 2);
  }

  if (badge) {
    badge.x = cardWidth - badge.width - 6;
    badge.y = CARD_HEIGHT - badge.height + 10;
  }
  if (actionBadge) {
    const chipBg = new Graphics();
    const chipLabel = new Text({
      text: "Action ×",
      style: {
        fill: 0xfef3c7,
        fontFamily: "Trebuchet MS, Verdana, sans-serif",
        fontSize: 10,
        fontWeight: "700",
      },
    });
    const chipWidth = chipLabel.width + 12;
    chipBg
      .roundRect(0, 0, chipWidth, 18, 9)
      .fill({ color: 0x78350f, alpha: 0.96 })
      .stroke({ width: 1, color: 0xd97706, alpha: 0.72 });
    chipLabel.x = 6;
    chipLabel.y = Math.round((18 - chipLabel.height) / 2) - 1;
    actionBadge.addChild(chipBg, chipLabel);
    actionBadge.x = 8;
    actionBadge.y = -9;
    actionBadge.eventMode = "static";
    actionBadge.cursor = "pointer";
    actionBadge.on("pointerdown", (event) => {
      onActionBadgePointerDown(event, workspaceItem);
    });
  }
  if (categoryBadge) {
    const chipBg = new Graphics();
    const chipLabel = new Text({
      text: "Category ×",
      style: {
        fill: 0xccfbf1,
        fontFamily: "Trebuchet MS, Verdana, sans-serif",
        fontSize: 10,
        fontWeight: "700",
      },
    });
    const chipWidth = chipLabel.width + 12;
    chipBg
      .roundRect(0, 0, chipWidth, 18, 9)
      .fill({ color: 0x134e4a, alpha: 0.96 })
      .stroke({ width: 1, color: 0x5eead4, alpha: 0.8 });
    chipLabel.x = 6;
    chipLabel.y = Math.round((18 - chipLabel.height) / 2) - 1;
    categoryBadge.addChild(chipBg, chipLabel);
    categoryBadge.x = Math.max(6, cardWidth - chipWidth - 8);
    categoryBadge.y = -9;
    categoryBadge.eventMode = "static";
    categoryBadge.cursor = "pointer";
    categoryBadge.on("pointerdown", (event) => {
      onCategoryBadgePointerDown(event, workspaceItem);
    });
  }
  if (celebration) {
    drawCelebrationBurst(celebration, cardWidth);
    celebration.x = Math.round(cardWidth / 2);
    celebration.y = Math.round(CARD_HEIGHT / 2);
    celebration.visible = false;
    celebration.alpha = 0;
  }
  if (celebrationParticles) {
    celebrationParticles.x = Math.round(cardWidth / 2);
    celebrationParticles.y = Math.round(CARD_HEIGHT / 2);
    celebrationParticles.visible = false;
    celebrationParticles.alpha = 0;
  }

  container.addChild(background);
  if (loader) {
    container.addChild(loader);
  } else {
    container.addChild(icon);
    container.addChild(label);
  }
  if (badge) {
    container.addChild(badge);
  }
  if (actionBadge) {
    container.addChild(actionBadge);
  }
  if (categoryBadge) {
    container.addChild(categoryBadge);
  }
  if (celebration) {
    container.addChild(celebration);
  }
  if (celebrationParticles) {
    container.addChild(celebrationParticles);
  }

  container.pivot.set(cardWidth / 2, CARD_HEIGHT / 2);
  container.hitArea = new Rectangle(
    -ITEM_HITBOX_PADDING,
    -ITEM_HITBOX_PADDING,
    cardWidth + ITEM_HITBOX_PADDING * 2,
    CARD_HEIGHT + ITEM_HITBOX_PADDING * 2
  );

  const view: ItemView = {
    nodeId: workspaceItem.nodeId,
    container,
    background,
    loader,
    icon,
    label,
    badge,
    actionBadge,
    categoryBadge,
    celebration,
    celebrationParticles,
    itemId: item.id,
    hasActionModifier,
    hasCategoryModifier,
    width: cardWidth,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    scaleStep: HOVER_SCALE_STEP,
    contentAlpha: 1,
    targetContentAlpha: 1,
    destroyWhenSettled: false,
    arrivalTintProgress: 0,
    arrivalHighlightUntil: null,
    arrivalHighlightStartedAt: null,
    celebrationProgress: 0,
    celebrationTintProgress: 0,
    celebrationTintHoldFrames: 0,
  };

  container.on("pointerdown", (event) => {
    onContainerPointerDown(event, view, workspaceItem, item);
  });

  setViewTopLeftPosition(view, workspaceItem.position);
  return view;
}
