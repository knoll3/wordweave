import {
  ACTION_MODIFIER_ITEM,
  ACTION_MODIFIER_ITEM_ID,
  COMMON_CATALYST_ITEM,
  COMMON_CATALYST_ITEM_ID,
  CATEGORY_MODIFIER_ITEM,
  CATEGORY_MODIFIER_ITEM_ID,
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  COMPOUND_CATALYST_ITEM,
  COMPOUND_CATALYST_ITEM_ID,
  CREATIVE_ITEM,
  CREATIVE_ITEM_ID,
  EVOLVE_CATALYST_ITEM,
  EVOLVE_CATALYST_ITEM_ID,
  OPPOSITE_CATALYST_ITEM,
  OPPOSITE_CATALYST_ITEM_ID,
  POP_CULTURE_CATALYST_ITEM,
  POP_CULTURE_CATALYST_ITEM_ID,
  PONDERIFICATE_CATALYST_ITEM,
  PONDERIFICATE_CATALYST_ITEM_ID,
  ROOT_CATALYST_ITEM,
  ROOT_CATALYST_ITEM_ID,
  SPLIT_CATALYST_ITEM,
  SPLIT_CATALYST_ITEM_ID,
  SYNONYM_CATALYST_ITEM,
  SYNONYM_CATALYST_ITEM_ID,
} from "../types";

export const SPECIAL_ITEMS = [
  ACTION_MODIFIER_ITEM,
  CATEGORY_MODIFIER_ITEM,
  COMBINE_RESULT_PLACEHOLDER_ITEM,
  CREATIVE_ITEM,
  SPLIT_CATALYST_ITEM,
  OPPOSITE_CATALYST_ITEM,
  SYNONYM_CATALYST_ITEM,
  EVOLVE_CATALYST_ITEM,
  POP_CULTURE_CATALYST_ITEM,
  COMPOUND_CATALYST_ITEM,
  ROOT_CATALYST_ITEM,
  COMMON_CATALYST_ITEM,
  PONDERIFICATE_CATALYST_ITEM,
] as const;

export const SPECIAL_ITEM_BY_ID = new Map(
  SPECIAL_ITEMS.map((item) => [item.id, item] as const)
);

export const ACTION_CATALYSTS = [
  {
    item: SPLIT_CATALYST_ITEM,
    familyKey: "split",
    actionConstraint: "Split",
    tint: "rgba(251, 146, 60, 0.24)",
    iconTint: "#fdba74",
  },
  {
    item: OPPOSITE_CATALYST_ITEM,
    familyKey: "opposite",
    actionConstraint: "Opposite",
    tint: "rgba(96, 165, 250, 0.24)",
    iconTint: "#bfdbfe",
  },
  {
    item: SYNONYM_CATALYST_ITEM,
    familyKey: "synonym",
    actionConstraint: "Synonym",
    tint: "rgba(192, 132, 252, 0.24)",
    iconTint: "#e9d5ff",
  },
  {
    item: EVOLVE_CATALYST_ITEM,
    familyKey: "evolve",
    actionConstraint: "Evolve",
    tint: "rgba(74, 222, 128, 0.24)",
    iconTint: "#bbf7d0",
  },
  {
    item: POP_CULTURE_CATALYST_ITEM,
    familyKey: "pop_culture",
    actionConstraint: "Pop Culture",
    tint: "rgba(244, 114, 182, 0.24)",
    iconTint: "#fbcfe8",
  },
  {
    item: COMPOUND_CATALYST_ITEM,
    familyKey: "compound",
    actionConstraint: "Compound",
    tint: "rgba(250, 204, 21, 0.24)",
    iconTint: "#fde68a",
  },
  {
    item: ROOT_CATALYST_ITEM,
    familyKey: "root",
    actionConstraint: "Root",
    tint: "rgba(45, 212, 191, 0.24)",
    iconTint: "#99f6e4",
  },
  {
    item: COMMON_CATALYST_ITEM,
    familyKey: "common",
    actionConstraint: "Common",
    tint: "rgba(148, 163, 184, 0.26)",
    iconTint: "#e2e8f0",
  },
] as const;

export const ACTION_CATALYST_BY_ID = new Map(
  ACTION_CATALYSTS.map((entry) => [entry.item.id, entry] as const)
);

export const RECIPE_CATALYST_ITEM_IDS = new Set<number>([
  CREATIVE_ITEM_ID,
  SPLIT_CATALYST_ITEM_ID,
  OPPOSITE_CATALYST_ITEM_ID,
  SYNONYM_CATALYST_ITEM_ID,
  EVOLVE_CATALYST_ITEM_ID,
  POP_CULTURE_CATALYST_ITEM_ID,
  COMPOUND_CATALYST_ITEM_ID,
  ROOT_CATALYST_ITEM_ID,
  COMMON_CATALYST_ITEM_ID,
  PONDERIFICATE_CATALYST_ITEM_ID,
]);

export const NON_INGREDIENT_ITEM_IDS = new Set<number>([
  ACTION_MODIFIER_ITEM_ID,
  CATEGORY_MODIFIER_ITEM_ID,
  ...RECIPE_CATALYST_ITEM_IDS,
]);
