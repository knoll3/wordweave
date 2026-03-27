export const LEGACY_QUESTS_STORAGE_KEY = "wordweave.challenge-targets";
export const LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY = "wordweave.tracked-quests";
export const LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY = "wordweave.abandoned-quests";

export type LegacyQuestRecord = {
  name: string;
  icon: string;
};

export function loadLegacyStoredQuests(): LegacyQuestRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = window.localStorage.getItem(LEGACY_QUESTS_STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is LegacyQuestRecord =>
        !!entry &&
        typeof entry.name === "string" &&
        entry.name.trim().length > 0 &&
        typeof entry.icon === "string" &&
        entry.icon.trim().length > 0
    );
  } catch {
    return [];
  }
}

export function loadStoredNameSet(storageKey: string): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

export function clearLegacyQuestStorage() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LEGACY_QUESTS_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY);
}
