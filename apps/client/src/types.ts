export interface Item {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export const CREATIVE_ITEM_ID = -1;

export const CREATIVE_ITEM: Item = {
  id: CREATIVE_ITEM_ID,
  name: "Creative Spark",
  normalizedName: "creative spark",
  icon: "✨",
};

export const SUBTRACTION_ITEM_ID = -2;

export const SUBTRACTION_ITEM: Item = {
  id: SUBTRACTION_ITEM_ID,
  name: "Subtraction",
  normalizedName: "subtraction",
  icon: "➖",
};

export interface RecipeCandidate {
  id: number;
  name: string;
  icon: string;
  orderIndex: number;
}

export interface Recipe {
  recipeId: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  candidates: RecipeCandidate[];
  chosenCandidateId: number | null;
  resultElement?: Item;
}

export interface RecentRecipe {
  id: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  resultElement: Item;
  updatedAt: string;
}

export interface WorkspaceItem {
  nodeId: string;
  itemId: number;
  position: { x: number; y: number };
}
