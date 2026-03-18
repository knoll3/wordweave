import type {
  AiModel,
  CacheRecipe,
  FeatureUnlockStatus,
  GenerateCacheRecipesResult,
  Item,
  QuestLine,
  Recipe,
  RecentRecipe,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

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

export async function fetchCacheRecipes(): Promise<CacheRecipe[]> {
  const res = await fetch(`${API_BASE}/elements/cache-recipes`);
  return handleResponse<CacheRecipe[]>(res);
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
