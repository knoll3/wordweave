import type {
  SharedBoardCombineInput,
  SharedBoardCreateItemInput,
  SharedBoardItem,
  SharedRoomSnapshot,
} from "../liveBoardTypes";
import type {
  AiModel,
  FeatureUnlockStatus,
  GenerateCacheRecipesResult,
  Item,
  PaginatedCacheRecipes,
  PlayerQuestStats,
  PromptBatchPair,
  PromptCatalogResponse,
  PromptTestResponse,
  QuestGenerationDraft,
  QuestGenerationDraftResponse,
  QuestListResponse,
  QuestRecord,
  QuestSetCompletion,
  RecentRecipe,
  Recipe,
  SemanticClustersResponse
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
  combinationRunId: number | null;
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

export async function fetchBoardSnapshot(): Promise<SharedRoomSnapshot> {
  const res = await fetch(`${API_BASE}/board`);
  return handleResponse<SharedRoomSnapshot>(res);
}

export async function createBoardItem(
  item: SharedBoardCreateItemInput
): Promise<SharedBoardItem> {
  const res = await fetch(`${API_BASE}/board/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });
  return handleResponse<SharedBoardItem>(res);
}

export async function duplicateBoardItem(
  nodeId: string,
  payload?: {
    nodeId?: string;
    position?: { x: number; y: number };
  }
): Promise<SharedBoardItem> {
  const res = await fetch(`${API_BASE}/board/items/${encodeURIComponent(nodeId)}/duplicate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });
  return handleResponse<SharedBoardItem>(res);
}

export async function updateBoardItem(
  nodeId: string,
  payload: {
    itemId?: number;
    isNewDiscovery?: boolean | null;
    arrivalHighlightMode?: "library" | "combine" | null;
    categoryConstraintName?: string | null;
    categoryConstraintNormalizedName?: string | null;
    actionConstraintName?: string | null;
    actionConstraintNormalizedName?: string | null;
  }
): Promise<SharedBoardItem> {
  const res = await fetch(`${API_BASE}/board/items/${encodeURIComponent(nodeId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<SharedBoardItem>(res);
}

export async function moveBoardItems(
  items: Array<{ nodeId: string; position: { x: number; y: number } }>
): Promise<{ ok: boolean; items: SharedBoardItem[] }> {
  const res = await fetch(`${API_BASE}/board/items/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
  return handleResponse<{ ok: boolean; items: SharedBoardItem[] }>(res);
}

export async function deleteBoardItem(nodeId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/board/items/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function deleteBoardItems(nodeIds: string[]): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/board/items/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nodeIds }),
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function attachBoardActionModifier(payload: {
  sourceNodeId: string;
  targetNodeId: string;
}): Promise<{ ok: boolean; item: SharedBoardItem | null }> {
  const res = await fetch(`${API_BASE}/board/attach-action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ ok: boolean; item: SharedBoardItem | null }>(res);
}

export async function attachBoardCategoryModifier(payload: {
  sourceNodeId: string;
  targetNodeId: string;
}): Promise<{ ok: boolean; item: SharedBoardItem | null }> {
  const res = await fetch(`${API_BASE}/board/attach-category`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ ok: boolean; item: SharedBoardItem | null }>(res);
}

export async function combineBoardItems(
  payload: SharedBoardCombineInput
): Promise<{
  ok: boolean;
  created: SharedBoardItem[];
  deletedNodeIds: string[];
}> {
  const res = await fetch(`${API_BASE}/board/combine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<{
    ok: boolean;
    created: SharedBoardItem[];
    deletedNodeIds: string[];
  }>(res);
}

export async function clearBoardItems(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/board/clear`, {
    method: "POST",
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function undoBoard(): Promise<SharedRoomSnapshot> {
  const res = await fetch(`${API_BASE}/board/undo`, {
    method: "POST",
  });
  return handleResponse<SharedRoomSnapshot>(res);
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
}> {
  const res = await fetch(`${API_BASE}/elements/cache-stats`);
  return handleResponse<{
    recipeCount: number;
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
}> {
  const res = await fetch(`${API_BASE}/elements/reset-cache`, {
    method: "POST",
  });
  return handleResponse<{
    ok: boolean;
    clearedRecipeCount: number;
  }>(res);
}

export async function combineElements(
  inputs: string[],
  options?: {
    creative?: boolean;
    ponderificate?: boolean;
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
      categoryConstraint: options?.categoryConstraint ?? null,
      actionConstraint: options?.actionConstraint ?? null,
      model: options?.model,
    }),
  });
  return handleResponse<Recipe>(res);
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
  const cacheKey = Number(`${elementId}`);
  if (latestRecipeCache.has(cacheKey)) {
    return latestRecipeCache.get(cacheKey) ?? null;
  }

  const res = await fetch(`${API_BASE}/elements/${elementId}/latest-recipe`);
  if (!res.ok) {
    if (res.status === 404) {
      latestRecipeCache.set(cacheKey, null);
      return null;
    }
    throw new Error(`Failed to load latest recipe (${res.status})`);
  }

  const latestRecipe = (await res.json()) as LatestRecipeContext;
  latestRecipeCache.set(cacheKey, latestRecipe);
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
