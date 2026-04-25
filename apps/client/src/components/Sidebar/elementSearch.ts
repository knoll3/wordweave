import type { Item } from "../../types";

export const MAX_VISIBLE_SEARCH_RESULTS = 100;
export const MAX_ITEMS_TO_SHOW_WITHOUT_SEARCH = 250;

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = new Array(right.length + 1).fill(0);
  const next = new Array(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[right.length];
}

export function compareItemsByName(left: Item, right: Item) {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}

export function lexicalScore(query: string, candidateName: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidateName.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return 4;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 3;
  if (normalizedCandidate.includes(normalizedQuery)) return 2;

  const queryTokens = tokenize(normalizedQuery);
  const candidateTokens = tokenize(normalizedCandidate);
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (overlap > 0) {
    return 1 + overlap / queryTokens.length;
  }

  return 0;
}

export function getCorrectedQuery(query: string, items: Item[]) {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 3) return null;

  const hasStrongDirectMatch = items.some((item) => {
    const normalizedName = item.name.trim().toLowerCase();
    return (
      normalizedName === trimmed ||
      normalizedName.startsWith(trimmed) ||
      normalizedName.includes(trimmed)
    );
  });
  if (hasStrongDirectMatch) return null;

  let bestName: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const normalizedName = item.name.trim().toLowerCase();
    const distance = levenshtein(trimmed, normalizedName);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = item.name;
    }
  }

  if (!bestName) return null;

  const normalizedBest = bestName.trim().toLowerCase();
  const relativeDistance = bestDistance / Math.max(trimmed.length, normalizedBest.length);
  if (bestDistance <= 2 || relativeDistance <= 0.25) {
    return bestName;
  }
  return null;
}

export function buildLexicalSearchItems(
  items: Item[],
  search: string,
  correctedSearchQuery: string | null
) {
  const trimmed = search.trim().toLowerCase();
  const corrected = correctedSearchQuery?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return items;
  }

  const scored = items
    .map((item) => {
      const rawScore = lexicalScore(trimmed, item.name);
      const correctedScore = corrected ? lexicalScore(corrected, item.name) - 0.15 : 0;
      return {
        item,
        score: Math.max(rawScore, correctedScore),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return compareItemsByName(left.item, right.item);
    });

  return scored.map((entry) => entry.item);
}

export function buildDisplayedItems({
  items,
  lexicalSearchItems,
  semanticItems,
  search,
  sortBy,
}: {
  items: Item[];
  lexicalSearchItems: Item[];
  semanticItems: Item[];
  search: string;
  sortBy: "time" | "name";
}) {
  if (search.trim()) {
    const deduped = new Map<number, Item>();
    for (const item of lexicalSearchItems) {
      deduped.set(item.id, item);
    }
    for (const item of semanticItems) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
    return [...deduped.values()].slice(0, MAX_VISIBLE_SEARCH_RESULTS);
  }

  if (items.length < MAX_ITEMS_TO_SHOW_WITHOUT_SEARCH) {
    return sortBy === "name" ? [...items].sort(compareItemsByName) : items;
  }

  return [];
}

export function countSearchMatches(lexicalSearchItems: Item[], semanticItems: Item[]) {
  const deduped = new Set<number>();
  for (const item of lexicalSearchItems) {
    deduped.add(item.id);
  }
  for (const item of semanticItems) {
    deduped.add(item.id);
  }
  return deduped.size;
}
