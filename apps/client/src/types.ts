export interface Item {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export type AiModel = "gpt-4.1" | "gpt-4.1-mini" | "gpt-4.1-nano";
export type UnlockKey =
  | "creative"
  | "random_tools"
  | "action";

export const CREATIVE_ITEM_ID = -1;

export const CREATIVE_ITEM: Item = {
  id: CREATIVE_ITEM_ID,
  name: "Creative Spark",
  normalizedName: "creative spark",
  icon: "✨",
};

export const CATEGORY_MODIFIER_ITEM_ID = -4;

export const CATEGORY_MODIFIER_ITEM: Item = {
  id: CATEGORY_MODIFIER_ITEM_ID,
  name: "Category",
  normalizedName: "category",
  icon: "🏷️",
};

export const ACTION_MODIFIER_ITEM_ID = -10;

export const ACTION_MODIFIER_ITEM: Item = {
  id: ACTION_MODIFIER_ITEM_ID,
  name: "Action",
  normalizedName: "action",
  icon: "⚡",
};

export const SPLIT_CATALYST_ITEM_ID = -11;
export const OPPOSITE_CATALYST_ITEM_ID = -12;
export const SYNONYM_CATALYST_ITEM_ID = -13;
export const EVOLVE_CATALYST_ITEM_ID = -14;
export const POP_CULTURE_CATALYST_ITEM_ID = -15;
export const COMPOUND_CATALYST_ITEM_ID = -16;
export const ESSENCE_CATALYST_ITEM_ID = -17;
export const COMMON_CATALYST_ITEM_ID = -18;

export const SPLIT_CATALYST_ITEM: Item = {
  id: SPLIT_CATALYST_ITEM_ID,
  name: "Split",
  normalizedName: "split",
  icon: "✂️",
};

export const OPPOSITE_CATALYST_ITEM: Item = {
  id: OPPOSITE_CATALYST_ITEM_ID,
  name: "Opposite",
  normalizedName: "opposite",
  icon: "↔️",
};

export const SYNONYM_CATALYST_ITEM: Item = {
  id: SYNONYM_CATALYST_ITEM_ID,
  name: "Synonym",
  normalizedName: "synonym",
  icon: "🪞",
};

export const EVOLVE_CATALYST_ITEM: Item = {
  id: EVOLVE_CATALYST_ITEM_ID,
  name: "Evolve",
  normalizedName: "evolve",
  icon: "🧬",
};

export const POP_CULTURE_CATALYST_ITEM: Item = {
  id: POP_CULTURE_CATALYST_ITEM_ID,
  name: "Pop Culture",
  normalizedName: "pop culture",
  icon: "🎬",
};

export const COMPOUND_CATALYST_ITEM: Item = {
  id: COMPOUND_CATALYST_ITEM_ID,
  name: "Compound",
  normalizedName: "compound",
  icon: "🧩",
};

export const ESSENCE_CATALYST_ITEM: Item = {
  id: ESSENCE_CATALYST_ITEM_ID,
  name: "Essence",
  normalizedName: "essence",
  icon: "💧",
};

export const COMMON_CATALYST_ITEM: Item = {
  id: COMMON_CATALYST_ITEM_ID,
  name: "Common",
  normalizedName: "common",
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

export interface AutoUnlockedActionWord {
  familyKey: string;
  familyTitle: string;
  triggerWord: string;
  element: Item;
}

export interface Recipe {
  recipeId: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  candidates: RecipeCandidate[];
  chosenCandidateId: number | null;
  resultElement?: Item;
  resultElements?: Item[];
  autoUnlockedActionWords?: AutoUnlockedActionWord[];
  newlyCompletedQuestNames?: string[];
  completedQuestSets?: QuestSetCompletion[];
  awardedPoints?: number;
  totalPoints?: number;
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
  actionConstraintName?: string | null;
  actionConstraintNormalizedName?: string | null;
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

export interface PromptDefinition {
  key: string;
  title: string;
  description: string;
  kind: "combine" | "recipe_batch";
  actionFamilyKey: string | null;
  showsActionConstraint: boolean;
  requiresActionConstraint: boolean;
  showsCategoryConstraint: boolean;
  requiresCategoryConstraint: boolean;
  supportsCreative: boolean;
  defaultActionConstraint: string | null;
}

export interface PromptCatalogResponse {
  defaultModel: AiModel;
  models: AiModel[];
  prompts: PromptDefinition[];
}

export interface PromptBatchPair {
  left: string;
  right: string;
}

export interface PromptTestResponse {
  promptKey: string;
  promptTitle: string;
  model: AiModel;
  renderedPrompt: string;
  resolvedActionFamilyKey?: string | null;
  result: unknown;
}

export type QuestStatus = "available" | "tracked" | "completed" | "abandoned";

export interface QuestRecord {
  name: string;
  icon: string;
  setId: string | null;
  setTitle: string | null;
  pointsAwarded: number;
  status: QuestStatus;
  matchedItemName: string | null;
  completionMethod: "exact" | "embedding" | "judge" | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface QuestSetCompletion {
  id: string;
  title: string;
  topic: string;
  questCount: number;
  earnedPoints: number;
}

export interface PlayerQuestStats {
  totalPoints: number;
}

export interface QuestListResponse {
  quests: QuestRecord[];
  stats: PlayerQuestStats;
}

export interface QuestGenerationDraftTarget {
  name: string;
  icon: string;
}

export interface QuestGenerationDraft {
  topic: string;
  targets: QuestGenerationDraftTarget[];
}

export interface QuestGenerationDraftResponse {
  draft: QuestGenerationDraft;
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
  sourceMatchedWordCurrent: boolean;
}
