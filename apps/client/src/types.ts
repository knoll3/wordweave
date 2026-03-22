export interface Item {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export type AiModel = "gpt-4.1" | "gpt-4.1-mini" | "gpt-4.1-nano";
export type UnlockKey =
  | "creative"
  | "split"
  | "opposite"
  | "random_tools"
  | "craft"
  | "evolve"
  | "pop_culture"
  | "word_combine";

export const CREATIVE_ITEM_ID = -1;

export const CREATIVE_ITEM: Item = {
  id: CREATIVE_ITEM_ID,
  name: "Creative Spark",
  normalizedName: "creative spark",
  icon: "✨",
};

export const SPLIT_ITEM_ID = -2;

export const SPLIT_ITEM: Item = {
  id: SPLIT_ITEM_ID,
  name: "Split",
  normalizedName: "split",
  icon: "✂️",
};

export const OPPOSITE_ITEM_ID = -3;

export const OPPOSITE_ITEM: Item = {
  id: OPPOSITE_ITEM_ID,
  name: "Opposite",
  normalizedName: "opposite",
  icon: "↔️",
};

export const CATEGORY_MODIFIER_ITEM_ID = -4;

export const CATEGORY_MODIFIER_ITEM: Item = {
  id: CATEGORY_MODIFIER_ITEM_ID,
  name: "Category",
  normalizedName: "category",
  icon: "🏷️",
};

export const CRAFT_ITEM_ID = -5;

export const CRAFT_ITEM: Item = {
  id: CRAFT_ITEM_ID,
  name: "Craft",
  normalizedName: "craft",
  icon: "🔨",
};

export const EVOLVE_ITEM_ID = -6;

export const EVOLVE_ITEM: Item = {
  id: EVOLVE_ITEM_ID,
  name: "Evolve",
  normalizedName: "evolve",
  icon: "🧬",
};

export const POP_CULTURE_ITEM_ID = -8;

export const POP_CULTURE_ITEM: Item = {
  id: POP_CULTURE_ITEM_ID,
  name: "Pop Culture",
  normalizedName: "pop culture",
  icon: "🎬",
};

export const WORD_COMBINE_ITEM_ID = -9;

export const WORD_COMBINE_ITEM: Item = {
  id: WORD_COMBINE_ITEM_ID,
  name: "Compound",
  normalizedName: "compound",
  icon: "🔗",
};

export const COMBINE_RESULT_PLACEHOLDER_ITEM_ID = -7;

export const COMBINE_RESULT_PLACEHOLDER_ITEM: Item = {
  id: COMBINE_RESULT_PLACEHOLDER_ITEM_ID,
  name: "Combining",
  normalizedName: "combining",
  icon: null,
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
  resultElements?: Item[];
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
  isNewDiscovery?: boolean;
  categoryConstraintName?: string | null;
  categoryConstraintNormalizedName?: string | null;
}

export interface SelectionCombineLayout {
  nodeIds: string[];
  nodePositions: Array<{
    nodeId: string;
    position: { x: number; y: number };
  }>;
  placeholderNodeId: string;
  placeholderPosition: { x: number; y: number };
}

export interface AchievementProgress {
  id: string;
  title: string;
  description: string;
  lookupName: string;
  points: number;
  completed: boolean;
  progressCurrent: number;
  progressTarget: number;
}

export interface AchievementGroupProgress {
  id: string;
  title: string;
  summary: string;
  achievements: AchievementProgress[];
  earnedPoints: number;
  totalPoints: number;
  completedCount: number;
  totalCount: number;
}

export interface AchievementCategoryProgress {
  id: string;
  title: string;
  summary: string;
  groups: AchievementGroupProgress[];
  earnedPoints: number;
  totalPoints: number;
  completedCount: number;
  totalCount: number;
}

export interface AchievementSummary {
  categories: AchievementCategoryProgress[];
  earnedPoints: number;
  totalPoints: number;
  completedCount: number;
  totalCount: number;
  featuredProgress: AchievementProgress[];
}

export interface CacheRecipe {
  id: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  chosenCandidateId: number | null;
  resultElement: Item | null;
  candidates: RecipeCandidate[];
  updatedAt: string;
}

export interface PaginatedCacheRecipes {
  recipes: CacheRecipe[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ClusteredLibraryItem {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
  membershipStrength: number;
  isPrimary: boolean;
}

export interface SemanticCluster {
  id: string;
  title: string;
  summary: string;
  memberCount: number;
  primaryMemberCount: number;
  isOutlierBucket: boolean;
  labelSource: "catalog" | "composed" | "fallback";
  labelConfidence: number;
  representativeTerms: string[];
  representativeItems: ClusteredLibraryItem[];
  members: ClusteredLibraryItem[];
  children?: SemanticCluster[];
}

export interface SemanticClustersResponse {
  generatedAt: string;
  totalItems: number;
  clusterCount: number;
  maxClusters: number;
  minClusterSize: number;
  overlapItemCount: number;
  clusters: SemanticCluster[];
}

export interface GeneratedCacheRecipe {
  recipeId: number;
  inputKey: string;
  inputs: string[];
  resultName: string;
  resultIcon: string;
}

export interface GenerateCacheRecipesResult {
  requestedCount: number;
  generatedCount: number;
  recipes: GeneratedCacheRecipe[];
}

export interface FeatureUnlockStatus {
  key: UnlockKey;
  title: string;
  summary: string;
  exampleWords: string[];
  unlocked: boolean;
  introPending: boolean;
  unlockedAt: string | null;
  sourceItemName: string | null;
  sourceMatchedWord: string | null;
}
