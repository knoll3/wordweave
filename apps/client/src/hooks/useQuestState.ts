import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlayerQuestStats,
  QuestGenerationDraft,
  QuestRecord,
  QuestSetCompletion,
} from "../types";
import {
  acceptGeneratedQuestSet,
  fetchQuests,
  generateQuestDraft,
  importLegacyQuestState,
  updateQuestStatus,
} from "../lib/api";
import {
  clearLegacyQuestStorage,
  LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY,
  LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY,
  loadLegacyStoredQuests,
  loadStoredNameSet,
} from "../lib/legacyQuestStorage";

const QUEST_CELEBRATION_DURATION_MS = 2600;

type QuestCelebrationState = {
  kicker: string;
  title: string;
  copy: string;
};

type QuestSetCelebrationState = QuestSetCompletion & {
  totalPoints: number;
};

export function useQuestState({
  setRightPanelMode,
  setIsJournalOpen,
  onError,
}: {
  setRightPanelMode: React.Dispatch<React.SetStateAction<"journal" | "item" | "quest">>;
  setIsJournalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onError: (message: string, err: unknown) => void;
}) {
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [questStats, setQuestStats] = useState<PlayerQuestStats>({ totalPoints: 0 });
  const [questPointsHighlightKey, setQuestPointsHighlightKey] = useState(0);
  const [isQuestModalOpen, setIsQuestModalOpen] = useState(false);
  const [questTopicInput, setQuestTopicInput] = useState("");
  const [questDraft, setQuestDraft] = useState<QuestGenerationDraft | null>(null);
  const [questDraftSeenTargets, setQuestDraftSeenTargets] = useState<string[]>([]);
  const [selectedQuestDraftTargets, setSelectedQuestDraftTargets] = useState<string[]>([]);
  const [isGeneratingQuests, setIsGeneratingQuests] = useState(false);
  const [questCelebration, setQuestCelebration] = useState<QuestCelebrationState | null>(null);
  const [questSetCelebration, setQuestSetCelebration] =
    useState<QuestSetCelebrationState | null>(null);
  const [isQuestCelebrating, setIsQuestCelebrating] = useState(false);
  const [celebratedQuestNodeId, setCelebratedQuestNodeId] = useState<string | null>(null);
  const [selectedQuestName, setSelectedQuestName] = useState<string | null>(null);
  const [pendingAbandonedQuestName, setPendingAbandonedQuestName] = useState<string | null>(null);
  const [pendingQuestAction, setPendingQuestAction] = useState<{
    name: string;
    kind: "track" | "untrack" | "abandon";
  } | null>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let nextQuestData = await fetchQuests();
        if (!cancelled && nextQuestData.quests.length === 0) {
          const legacyQuests = loadLegacyStoredQuests();
          if (legacyQuests.length > 0) {
            nextQuestData = await importLegacyQuestState({
              quests: legacyQuests.map((quest) => ({
                name: quest.name,
                icon: quest.icon,
              })),
              trackedNames: [...loadStoredNameSet(LEGACY_TRACKED_QUEST_NAMES_STORAGE_KEY)],
              abandonedNames: [...loadStoredNameSet(LEGACY_ABANDONED_QUEST_NAMES_STORAGE_KEY)],
            });
            clearLegacyQuestStorage();
          }
        }
        if (!cancelled) {
          setQuests(nextQuestData.quests);
          applyQuestStats(nextQuestData.stats);
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (celebrationTimeoutRef.current != null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
    },
    []
  );

  const visibleQuests = useMemo(
    () => quests.filter((quest) => quest.status !== "abandoned"),
    [quests]
  );
  const trackedQuestNames = useMemo(
    () =>
      new Set(
        visibleQuests
          .filter((quest) => quest.status === "tracked")
          .map((quest) => quest.name)
      ),
    [visibleQuests]
  );
  const completedQuestNames = useMemo(
    () =>
      new Set(
        visibleQuests
          .filter((quest) => quest.status === "completed")
          .map((quest) => quest.name)
      ),
    [visibleQuests]
  );
  const selectedQuest =
    selectedQuestName == null
      ? null
      : visibleQuests.find((entry) => entry.name === selectedQuestName) ?? null;
  const activeTrackedQuests = visibleQuests.filter(
    (quest) => trackedQuestNames.has(quest.name) && !completedQuestNames.has(quest.name)
  );
  const visibleTrackedQuests = activeTrackedQuests.slice(0, 5);

  function applyQuestStats(nextStats: PlayerQuestStats) {
    setQuestStats((prev) => {
      const nextTotalPoints = Math.max(prev.totalPoints, nextStats.totalPoints);
      if (nextTotalPoints > prev.totalPoints) {
        setQuestPointsHighlightKey((current) => current + 1);
      }
      if (nextTotalPoints === prev.totalPoints) {
        return prev;
      }
      return { totalPoints: nextTotalPoints };
    });
  }

  function openQuestGenerationModal() {
    setIsQuestModalOpen(true);
    setRightPanelMode("journal");
    setIsJournalOpen(true);
  }

  function updateQuestTopicInput(value: string) {
    setQuestTopicInput(value);
    setQuestDraft(null);
    setQuestDraftSeenTargets([]);
    setSelectedQuestDraftTargets([]);
  }

  function closeQuestGenerationModal() {
    if (isGeneratingQuests) {
      return;
    }
    setIsQuestModalOpen(false);
    setQuestTopicInput("");
    setQuestDraft(null);
    setQuestDraftSeenTargets([]);
    setSelectedQuestDraftTargets([]);
  }

  async function submitQuestGenerationTopic() {
    const topic = questTopicInput.trim();
    if (!topic) {
      return;
    }
    setIsGeneratingQuests(true);
    try {
      const nextDraft = await generateQuestDraft({
        topic,
        excludeTargets: questDraftSeenTargets,
      });
      setQuestDraft(nextDraft);
      setQuestDraftSeenTargets((prev) => {
        const seen = new Set(prev);
        nextDraft.targets.forEach((target) => seen.add(target.name));
        return [...seen];
      });
      setSelectedQuestDraftTargets(
        nextDraft.targets.slice(0, nextDraft.recommendedCount).map((target) => target.name)
      );
    } catch (err) {
      onError("Failed to generate quest set.", err);
    } finally {
      setIsGeneratingQuests(false);
    }
  }

  function toggleQuestDraftTarget(targetName: string) {
    if (!questDraft || isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets((current) =>
      current.includes(targetName)
        ? current.filter((name) => name !== targetName)
        : [...current, targetName]
    );
  }

  function clearQuestDraftSelection() {
    if (isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets([]);
  }

  function selectAllQuestDraftTargets() {
    if (!questDraft || isGeneratingQuests) {
      return;
    }
    setSelectedQuestDraftTargets(questDraft.targets.map((target) => target.name));
  }

  async function acceptQuestGenerationDraft() {
    if (!questDraft) {
      return;
    }
    const selectedTargets = questDraft.targets.filter((target) =>
      selectedQuestDraftTargets.includes(target.name)
    );
    if (selectedTargets.length === 0) {
      return;
    }
    setIsGeneratingQuests(true);
    try {
      const nextQuests = await acceptGeneratedQuestSet({
        topic: questDraft.topic,
        targets: selectedTargets,
      });
      setQuests(nextQuests.quests);
      applyQuestStats(nextQuests.stats);
      setIsQuestModalOpen(false);
      setQuestTopicInput("");
      setQuestDraft(null);
      setQuestDraftSeenTargets([]);
      setSelectedQuestDraftTargets([]);
      setRightPanelMode("journal");
      setIsJournalOpen(true);
    } catch (err) {
      onError("Failed to accept quest set.", err);
    } finally {
      setIsGeneratingQuests(false);
    }
  }

  function openQuestDetails(quest: QuestRecord) {
    setSelectedQuestName(quest.name);
    setRightPanelMode("quest");
    setIsJournalOpen(true);
  }

  async function trackQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }
    setPendingQuestAction({ name: questName, kind: "track" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "tracked" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
    } catch (err) {
      onError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "track" ? null : current
      );
    }
  }

  async function untrackQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }
    setPendingQuestAction({ name: questName, kind: "untrack" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "available" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
    } catch (err) {
      onError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "untrack" ? null : current
      );
    }
  }

  async function abandonQuest(questName: string) {
    if (pendingQuestAction) {
      return;
    }
    setPendingQuestAction({ name: questName, kind: "abandon" });
    try {
      const result = await updateQuestStatus({ name: questName, status: "abandoned" });
      setQuests(result.quests);
      applyQuestStats(result.stats);
      if (selectedQuestName === questName) {
        setSelectedQuestName(null);
        setRightPanelMode("journal");
      }
      setPendingAbandonedQuestName(null);
    } catch (err) {
      onError("Failed to update quest.", err);
    } finally {
      setPendingQuestAction((current) =>
        current?.name === questName && current.kind === "abandon" ? null : current
      );
    }
  }

  function showProgressCelebration(
    kicker: string,
    title: string,
    copy: string,
    nodeId: string | null
  ) {
    if (celebrationTimeoutRef.current != null) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    setQuestCelebration({ kicker, title, copy });
    setIsQuestCelebrating(true);
    setCelebratedQuestNodeId(nodeId);
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setIsQuestCelebrating(false);
      setQuestCelebration(null);
      setCelebratedQuestNodeId(null);
      celebrationTimeoutRef.current = null;
    }, QUEST_CELEBRATION_DURATION_MS);
  }

  function applyNewlyCompletedQuests(
    newlyCompletedQuestNames: string[],
    celebrationNodeId: string | null
  ) {
    if (newlyCompletedQuestNames.length === 0) {
      return;
    }

    const completedNameSet = new Set(newlyCompletedQuestNames);
    const newlyCompletedTrackedCount = quests.filter(
      (quest) => completedNameSet.has(quest.name) && quest.status === "tracked"
    ).length;

    setQuests((prev) =>
      prev.map((quest) =>
        completedNameSet.has(quest.name)
          ? {
              ...quest,
              status: "completed",
            }
          : quest
      )
    );

    showProgressCelebration(
      "Quest Complete",
      newlyCompletedQuestNames.length === 1
        ? newlyCompletedQuestNames[0]
        : `${newlyCompletedQuestNames.length} quests completed`,
      newlyCompletedQuestNames.length === 1
        ? newlyCompletedTrackedCount === 1
          ? "You discovered one of your active quests."
          : "You discovered one of your available quests."
        : newlyCompletedTrackedCount === newlyCompletedQuestNames.length
          ? "You completed multiple active quests."
          : newlyCompletedTrackedCount === 0
            ? "You completed multiple available quests."
            : "You completed multiple quests.",
      celebrationNodeId
    );
  }

  function showQuestSetCelebration(completedSet: QuestSetCompletion, totalPoints: number) {
    setQuestSetCelebration({
      ...completedSet,
      totalPoints,
    });
  }

  return {
    quests,
    setQuests,
    visibleQuests,
    trackedQuestNames,
    completedQuestNames,
    selectedQuest,
    selectedQuestName,
    setSelectedQuestName,
    visibleTrackedQuests,
    questStats,
    questPointsHighlightKey,
    applyQuestStats,
    isQuestModalOpen,
    questTopicInput,
    questDraft,
    selectedQuestDraftTargets,
    isGeneratingQuests,
    openQuestGenerationModal,
    updateQuestTopicInput,
    closeQuestGenerationModal,
    submitQuestGenerationTopic,
    toggleQuestDraftTarget,
    clearQuestDraftSelection,
    selectAllQuestDraftTargets,
    acceptQuestGenerationDraft,
    openQuestDetails,
    pendingQuestAction,
    trackQuest,
    untrackQuest,
    pendingAbandonedQuestName,
    setPendingAbandonedQuestName,
    abandonQuest,
    questCelebration,
    questSetCelebration,
    setQuestSetCelebration,
    isQuestCelebrating,
    celebratedQuestNodeId,
    applyNewlyCompletedQuests,
    showQuestSetCelebration,
  };
}
