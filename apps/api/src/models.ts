import type { Database } from "./db";

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
  resultElements?: ElementDTO[];
  autoUnlockedActionWords?: Array<{
    familyKey: string;
    familyTitle: string;
    triggerWord: string;
    element: ElementDTO;
  }>;
  newlyCompletedQuestNames?: string[];
  completedQuestSets?: Array<{
    id: string;
    title: string;
    topic: string;
    questCount: number;
    earnedPoints: number;
  }>;
  awardedPoints?: number;
  totalPoints?: number;
}

export interface RecentRecipeDTO {
  id: number;
  inputKey: string;
  inputs: { name: string; normalized: string }[];
  resultElement: ElementDTO;
  updatedAt: string;
}

export interface NormalizedInput {
  name: string;
  normalized: string;
}

export function toTitleCaseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeInputs(
  rawInputs: string[],
  options?: { preserveOrder?: boolean }
): { normalizedInputs: NormalizedInput[]; inputKey: string } {
  const seen = new Map<string, string>();

  for (const raw of rawInputs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (!seen.has(normalized)) {
      seen.set(normalized, trimmed);
    }
  }

  const normalizedInputs: NormalizedInput[] = Array.from(seen.entries()).map(
    ([normalized, name]) => ({ name, normalized })
  );

  if (!options?.preserveOrder) {
    normalizedInputs.sort((a, b) =>
      a.normalized.localeCompare(b.normalized, "en")
    );
  }

  const inputKey = normalizedInputs.map((i) => i.normalized).join("|");

  return { normalizedInputs, inputKey };
}

export function mapElementRow(row: any): ElementDTO {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    icon: row.icon ?? null,
  };
}

export function mapCandidateRow(row: any): RecipeCandidateDTO {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    orderIndex: row.order_index,
  };
}

export function buildCombineResponse(params: {
  recipeRow: any;
  candidates: any[];
  resultElement?: ElementDTO;
  resultElements?: ElementDTO[];
  autoUnlockedActionWords?: RecipeDTO["autoUnlockedActionWords"];
  newlyCompletedQuestNames?: string[];
  completedQuestSets?: RecipeDTO["completedQuestSets"];
  awardedPoints?: number;
  totalPoints?: number;
}): RecipeDTO {
  const {
    recipeRow,
    candidates,
    resultElement,
    resultElements,
    autoUnlockedActionWords,
    newlyCompletedQuestNames,
    completedQuestSets,
    awardedPoints,
    totalPoints,
  } = params;

  const inputs = JSON.parse(recipeRow.input_display_json) as {
    name: string;
    normalized: string;
  }[];

  return {
    recipeId: recipeRow.id,
    inputKey: recipeRow.input_key,
    inputs,
    candidates: candidates.map(mapCandidateRow),
    chosenCandidateId: recipeRow.chosen_candidate_id ?? null,
    resultElement: resultElement ?? undefined,
    resultElements:
      resultElements && resultElements.length > 0 ? resultElements : resultElement ? [resultElement] : undefined,
    autoUnlockedActionWords:
      autoUnlockedActionWords && autoUnlockedActionWords.length > 0
        ? autoUnlockedActionWords
        : undefined,
    newlyCompletedQuestNames:
      newlyCompletedQuestNames && newlyCompletedQuestNames.length > 0
        ? newlyCompletedQuestNames
        : undefined,
    completedQuestSets:
      completedQuestSets && completedQuestSets.length > 0 ? completedQuestSets : undefined,
    awardedPoints: awardedPoints && awardedPoints > 0 ? awardedPoints : undefined,
    totalPoints: totalPoints != null ? totalPoints : undefined,
  };
}

export function mapRecentRecipeRow(row: any): RecentRecipeDTO {
  const inputs = JSON.parse(row.input_display_json) as {
    name: string;
    normalized: string;
  }[];

  return {
    id: row.id,
    inputKey: row.input_key,
    inputs,
    resultElement: {
      id: row.element_id,
      name: row.element_name,
      normalizedName: row.element_normalized_name,
      icon: row.element_icon ?? null,
    },
    updatedAt: row.updated_at,
  };
}

export function getElementById(
  db: Database,
  id: number
): ElementDTO | undefined {
  const stmt = db.prepare(
    "SELECT id, name, normalized_name, icon FROM elements WHERE id = ?"
  );
  const row = stmt.getAsObject([id]);
  stmt.free();
  if (!row || row.id === undefined) {
    return undefined;
  }
  return mapElementRow(row);
}

export function getElementByNormalizedName(
  db: Database,
  normalizedName: string
): ElementDTO | undefined {
  const stmt = db.prepare(
    "SELECT id, name, normalized_name, icon FROM elements WHERE normalized_name = ?"
  );
  const row = stmt.getAsObject([normalizedName]);
  stmt.free();
  if (!row || row.id === undefined) {
    return undefined;
  }
  return mapElementRow(row);
}
