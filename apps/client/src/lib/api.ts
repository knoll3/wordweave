import type {
  AiModel,
  CacheRecipe,
  FeatureUnlockStatus,
  GenerateCacheRecipesResult,
  Item,
  PaginatedCacheRecipes,
  PromptBatchPair,
  PromptCatalogResponse,
  PlayerQuestStats,
  PromptTestResponse,
  QuestGenerationDraft,
  QuestGenerationDraftResponse,
  QuestListResponse,
  QuestRecord,
  QuestSetCompletion,
  Recipe,
  RecentRecipe,
  SemanticClustersResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const itemReferenceCache = new Map<number, ItemReference | null>();
const latestRecipeCache = new Map<number, LatestRecipeContext | null>();
const questReferenceCache = new Map<string, ItemReference | null>();

export interface ItemReference {
  id: number;
  provider: string;
  lookupName: string;
  status: "resolved" | "missing";
  title: string | null;
  summary: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
}

export interface LatestRecipeInput {
  id: number | null;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export interface LatestRecipeCatalyst {
  name: string;
  normalizedName: string;
  icon: string | null;
}

export interface LatestRecipeContext {
  recipeId: number | null;
  summaryLine: string | null;
  catalyst: LatestRecipeCatalyst | null;
  inputs: LatestRecipeInput[];
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function fetchItems(query?: string): Promise<Item[]> {
  const url = new URL(`${API_BASE}/elements`, window.location.origin);
  if (query && query.trim()) {
    url.searchParams.set("q", query.trim());
  }
  const res = await fetch(url.toString());
  const data = await handleResponse<unknown>(res);
  if (!Array.isArray(data)) {
    throw new Error("Items response was not an array");
  }
  return data as Item[];
}

export async function fetchUnlockStatuses(): Promise<FeatureUnlockStatus[]> {
  const res = await fetch(`${API_BASE}/elements/unlocks`);
  return handleResponse<FeatureUnlockStatus[]>(res);
}

export async function markUnlockIntroSeen(key: FeatureUnlockStatus["key"]): Promise<{
  ok: boolean;
}> {
  const res = await fetch(`${API_BASE}/elements/unlocks/${key}/mark-seen`, {
    method: "POST",
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function fetchRecentRecipes(): Promise<RecentRecipe[]> {
  const res = await fetch(`${API_BASE}/elements/recent-recipes`);
  return handleResponse<RecentRecipe[]>(res);
}

export async function resetLibrary(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/elements/reset-library`, {
    method: "POST",
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function fetchCacheStats(): Promise<{
  recipeCount: number;
  candidateCount: number;
}> {
  const res = await fetch(`${API_BASE}/elements/cache-stats`);
  return handleResponse<{
    recipeCount: number;
    candidateCount: number;
  }>(res);
}

export async function fetchCacheRecipes(options?: {
  page?: number;
  limit?: number;
}): Promise<PaginatedCacheRecipes> {
  const url = new URL(`${API_BASE}/elements/cache-recipes`, window.location.origin);
  if (options?.page != null) {
    url.searchParams.set("page", String(options.page));
  }
  if (options?.limit != null) {
    url.searchParams.set("limit", String(options.limit));
  }
  const res = await fetch(url.toString());
  return handleResponse<PaginatedCacheRecipes>(res);
}

export async function fetchSemanticClusters(options?: {
  maxClusters?: number;
}): Promise<SemanticClustersResponse> {
  const url = new URL(`${API_BASE}/elements/clusters`, window.location.origin);
  if (options?.maxClusters != null) {
    url.searchParams.set("maxClusters", String(options.maxClusters));
  }
  const res = await fetch(url.toString());
  return handleResponse<SemanticClustersResponse>(res);
}

export async function generateCacheRecipes(): Promise<GenerateCacheRecipesResult> {
  const res = await fetch(`${API_BASE}/recipes/generate-cache`, {
    method: "POST",
  });
  return handleResponse<GenerateCacheRecipesResult>(res);
}

export async function resetCache(): Promise<{
  ok: boolean;
  clearedRecipeCount: number;
  clearedCandidateCount: number;
}> {
  const res = await fetch(`${API_BASE}/elements/reset-cache`, {
    method: "POST",
  });
  return handleResponse<{
    ok: boolean;
    clearedRecipeCount: number;
    clearedCandidateCount: number;
  }>(res);
}

export async function combineElements(
  inputs: string[],
  options?: {
    creative?: boolean;
    ponderificate?: boolean;
    useWebSearch?: boolean;
    categoryConstraint?: string;
    actionConstraint?: string;
    model?: AiModel;
  }
): Promise<Recipe> {
  const res = await fetch(`${API_BASE}/recipes/combine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs,
      creative: options?.creative ?? false,
      ponderificate: options?.ponderificate ?? false,
      useWebSearch: options?.useWebSearch ?? false,
      categoryConstraint: options?.categoryConstraint ?? null,
      actionConstraint: options?.actionConstraint ?? null,
      model: options?.model,
    }),
  });
  return handleResponse<Recipe>(res);
}

export async function selectCandidate(
  recipeId: number,
  candidateId: number
): Promise<{
  recipeId: number;
  chosenCandidateId: number;
  resultElement: Item | null;
  newlyCompletedQuestNames?: string[];
  completedQuestSets?: QuestSetCompletion[];
  awardedPoints?: number;
  totalPoints?: number;
  autoUnlockedActionWords?: Array<{
    familyKey: string;
    familyTitle: string;
    triggerWord: string;
    element: Item;
  }>;
}> {
  const res = await fetch(`${API_BASE}/recipes/${recipeId}/select`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ candidateId }),
  });
  return handleResponse(res);
}

export async function fetchQuestTargetReference(
  target: string
): Promise<ItemReference | null> {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  if (questReferenceCache.has(normalizedTarget)) {
    return questReferenceCache.get(normalizedTarget) ?? null;
  }

  const url = new URL(`${API_BASE}/quests/reference`, window.location.origin);
  url.searchParams.set("q", target.trim());
  const res = await fetch(url.toString());
  if (!res.ok) {
    if (res.status === 404) {
      questReferenceCache.set(normalizedTarget, null);
      return null;
    }
    throw new Error(`Failed to load quest target reference (${res.status})`);
  }

  const reference = (await res.json()) as ItemReference;
  questReferenceCache.set(normalizedTarget, reference);
  return reference;
}

export async function generateQuestDraft(params: {
  topic: string;
  excludeTargets?: string[];
}): Promise<QuestGenerationDraft> {
  const res = await fetch(`${API_BASE}/quests/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: params.topic,
      excludeTargets: params.excludeTargets,
    }),
  });
  const data = await handleResponse<QuestGenerationDraftResponse>(res);
  return data.draft;
}

export async function acceptGeneratedQuestSet(params: {
  topic: string;
  targets: QuestGenerationDraft["targets"];
}): Promise<{ quests: QuestRecord[]; stats: PlayerQuestStats }> {
  const res = await fetch(`${API_BASE}/quests/generate/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = await handleResponse<QuestListResponse>(res);
  return { quests: data.quests ?? [], stats: data.stats };
}

export async function fetchQuests(): Promise<{ quests: QuestRecord[]; stats: PlayerQuestStats }> {
  const res = await fetch(`${API_BASE}/quests`);
  const data = await handleResponse<QuestListResponse>(res);
  return { quests: data.quests ?? [], stats: data.stats };
}

export async function updateQuestStatus(params: {
  name: string;
  status: "available" | "tracked" | "abandoned";
}): Promise<{ quests: QuestRecord[]; stats: PlayerQuestStats }> {
  const res = await fetch(`${API_BASE}/quests/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = await handleResponse<QuestListResponse>(res);
  return { quests: data.quests ?? [], stats: data.stats };
}

export async function importLegacyQuestState(params: {
  quests: Array<{ name: string; icon: string }>;
  trackedNames?: string[];
  abandonedNames?: string[];
}): Promise<{ quests: QuestRecord[]; stats: PlayerQuestStats }> {
  const res = await fetch(`${API_BASE}/quests/import-legacy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = await handleResponse<QuestListResponse>(res);
  return { quests: data.quests ?? [], stats: data.stats };
}

export async function fetchItemReference(elementId: number): Promise<ItemReference | null> {
  if (itemReferenceCache.has(elementId)) {
    return itemReferenceCache.get(elementId) ?? null;
  }

  const res = await fetch(`${API_BASE}/elements/${elementId}/reference`);
  if (!res.ok) {
    if (res.status === 404) {
      itemReferenceCache.set(elementId, null);
      return null;
    }
    throw new Error(`Failed to load item reference (${res.status})`);
  }

  const reference = (await res.json()) as ItemReference;
  itemReferenceCache.set(elementId, reference);
  return reference;
}

export async function fetchLatestRecipeContext(
  elementId: number
): Promise<LatestRecipeContext | null> {
  if (latestRecipeCache.has(elementId)) {
    return latestRecipeCache.get(elementId) ?? null;
  }

  const res = await fetch(`${API_BASE}/elements/${elementId}/latest-recipe`);
  if (!res.ok) {
    if (res.status === 404) {
      latestRecipeCache.set(elementId, null);
      return null;
    }
    throw new Error(`Failed to load latest recipe (${res.status})`);
  }

  const latestRecipe = (await res.json()) as LatestRecipeContext;
  latestRecipeCache.set(elementId, latestRecipe);
  return latestRecipe;
}

export async function fetchPromptCatalog(): Promise<PromptCatalogResponse> {
  const res = await fetch(`${API_BASE}/prompts`);
  return handleResponse<PromptCatalogResponse>(res);
}

export async function testPrompt(params: {
  promptKey: string;
  model: AiModel;
  inputs?: string[];
  actionConstraint?: string | null;
  categoryConstraint?: string | null;
  pairs?: PromptBatchPair[];
}): Promise<PromptTestResponse> {
  const body: Record<string, unknown> = {
    promptKey: params.promptKey,
    model: params.model,
  };

  if (params.inputs != null) {
    body.inputs = params.inputs;
  }
  if (params.actionConstraint != null) {
    body.actionConstraint = params.actionConstraint;
  }
  if (params.categoryConstraint != null) {
    body.categoryConstraint = params.categoryConstraint;
  }
  if (params.pairs != null) {
    body.pairs = params.pairs;
  }

  const res = await fetch(`${API_BASE}/prompts/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return handleResponse<PromptTestResponse>(res);
}
