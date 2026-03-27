import { useEffect, useState } from "react";
import type { QuestRecord } from "../types";
import { fetchQuestTargetReference, type ItemReference } from "../lib/api";

export function useQuestReferences(
  quests: QuestRecord[],
  isJournalOpen: boolean
) {
  const [questReferences, setQuestReferences] = useState<
    Record<string, ItemReference | null | undefined>
  >({});

  useEffect(() => {
    if (!isJournalOpen || quests.length === 0) {
      return;
    }

    const missing = quests.filter((quest) => questReferences[quest.name] === undefined);
    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      missing.map(async (quest) => {
        try {
          const reference = await fetchQuestTargetReference(quest.name);
          return [quest.name, reference] as const;
        } catch {
          return [quest.name, null] as const;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      setQuestReferences((prev) => {
        const next = { ...prev };
        for (const [questName, reference] of results) {
          next[questName] = reference;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isJournalOpen, questReferences, quests]);

  return questReferences;
}
