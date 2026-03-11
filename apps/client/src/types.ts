export interface Item {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
}

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
