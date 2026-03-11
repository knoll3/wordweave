export interface ElementDTO {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export interface RecipeCandidateDTO {
  id: number;
  name: string;
  icon: string;
  orderIndex: number;
}

export interface RecipeDTO {
  recipeId: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  candidates: RecipeCandidateDTO[];
  chosenCandidateId: number | null;
  resultElement?: ElementDTO;
}

export interface RecentRecipeDTO {
  id: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  resultElement: ElementDTO;
  updatedAt: string;
}
