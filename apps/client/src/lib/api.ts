import type {
  AiModel,
  CacheRecipe,
  FeatureUnlockStatus,
  GenerateCacheRecipesResult,
  Item,
  PaginatedCacheRecipes,
  QuestLine,
  Recipe,
  RecentRecipe,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const itemReferenceCache = new Map<number, ItemReference | null>();
const latestRecipeCache = new Map<number, LatestRecipeContext | null>();

export interface ItemReference {
  id: number;
  provider: string;
  lookupName: string;
  status: "resolved" | "missing";
  title: string | null;
  summary: string | null;
  sourceUrl: string | null;
}

export interface LatestRecipeInput {
  id: number | null;
  name: string;
  normalizedName: string;
  icon: string | null;
}

export interface LatestRecipeContext {
  recipeId: number | null;
  summaryLine: string | null;
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
    subtractive?: boolean;
    opposite?: boolean;
    popCulture?: boolean;
    evolve?: boolean;
    randomize?: boolean;
    crafting?: boolean;
    wordCombine?: boolean;
    model?: AiModel;
  }
): Promise<Recipe> {
  console.log("[combine] request", {
    inputs,
    creative: options?.creative ?? false,
    subtractive: options?.subtractive ?? false,
    opposite: options?.opposite ?? false,
    popCulture: options?.popCulture ?? false,
    evolve: options?.evolve ?? false,
    randomize: options?.randomize ?? false,
    crafting: options?.crafting ?? false,
    wordCombine: options?.wordCombine ?? false,
    model: options?.model ?? null,
  });
  const res = await fetch(`${API_BASE}/recipes/combine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs,
      creative: options?.creative ?? false,
      subtractive: options?.subtractive ?? false,
      opposite: options?.opposite ?? false,
      popCulture: options?.popCulture ?? false,
      evolve: options?.evolve ?? false,
      randomize: options?.randomize ?? false,
      crafting: options?.crafting ?? false,
      wordCombine: options?.wordCombine ?? false,
      model: options?.model,
    }),
  });
  const data = await handleResponse<Recipe>(res);
  console.log("[combine] response", data);
  return data;
}

export async function selectCandidate(
  recipeId: number,
  candidateId: number
): Promise<{
  recipeId: number;
  chosenCandidateId: number;
  resultElement: Item | null;
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

export async function generateQuest(options?: {
  discoveredItems?: string[];
}): Promise<QuestLine> {
  const res = await fetch(`${API_BASE}/quests/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      discoveredItems: options?.discoveredItems ?? [],
    }),
  });
  return handleResponse<QuestLine>(res);
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
