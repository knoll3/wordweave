import React from "react";
import type { ItemReference } from "../lib/api";
import type { Item, QuestGenerationDraft, QuestRecord } from "../types";
import JournalDock from "./Journal/JournalDock";
import QuestGenerationModal from "./Journal/QuestGenerationModal";

type Props = {
  dockRef: React.RefObject<HTMLElement>;
  isOpen: boolean;
  isTransient: boolean;
  mode: "journal" | "item" | "quest";
  questReferences: Record<string, ItemReference | null | undefined>;
  referencePreviewLimit: number;
  quests: QuestRecord[];
  trackedQuestNames: Set<string>;
  completedQuestNames: Set<string>;
  isGeneratingQuests: boolean;
  selectedQuest: QuestRecord | null;
  selectedQuestItem: Item | null;
  item: Item | null;
  items: Item[];
  itemsById: Map<number, Item>;
  canGoBack: boolean;
  onBack: () => void;
  onAddItemToWorkspace: (item: Item) => void;
  onAddItemToWorkspaceAsActionAnchor: (item: Item) => void;
  onCloseItem: () => void;
  onCloseQuest: () => void;
  onBackToJournal: () => void;
  onSelectItem: (item: Item) => void;
  onCollapse: () => void;
  onStartQuestDraftSession: () => void;
  onSelectQuest: (quest: QuestRecord) => void;
  onTrackQuest: (questName: string) => void;
  onUntrackQuest: (questName: string) => void;
  onRequestAbandonQuest: (questName: string | null) => void;
  pendingQuestAction: {
    name: string;
    kind: "track" | "untrack" | "abandon";
  } | null;
  truncateReference: (value: string, limit: number) => string;
  isQuestModalOpen: boolean;
  questTopicInput: string;
  questDraft: QuestGenerationDraft | null;
  selectedQuestDraftTargets: string[];
  onTopicChange: (value: string) => void;
  onCloseQuestModal: () => void;
  onSubmitQuestTopic: () => void;
  onToggleQuestTarget: (targetName: string) => void;
  onSelectAllQuestTargets: () => void;
  onDeselectAllQuestTargets: () => void;
  onAcceptQuestDraft: () => void;
};

export default function AppRightPanel({
  dockRef,
  isOpen,
  isTransient,
  mode,
  questReferences,
  referencePreviewLimit,
  quests,
  trackedQuestNames,
  completedQuestNames,
  isGeneratingQuests,
  selectedQuest,
  selectedQuestItem,
  item,
  items,
  itemsById,
  canGoBack,
  onBack,
  onAddItemToWorkspace,
  onAddItemToWorkspaceAsActionAnchor,
  onCloseItem,
  onCloseQuest,
  onBackToJournal,
  onSelectItem,
  onCollapse,
  onStartQuestDraftSession,
  onSelectQuest,
  onTrackQuest,
  onUntrackQuest,
  onRequestAbandonQuest,
  pendingQuestAction,
  truncateReference,
  isQuestModalOpen,
  questTopicInput,
  questDraft,
  selectedQuestDraftTargets,
  onTopicChange,
  onCloseQuestModal,
  onSubmitQuestTopic,
  onToggleQuestTarget,
  onSelectAllQuestTargets,
  onDeselectAllQuestTargets,
  onAcceptQuestDraft,
}: Props) {
  return (
    <>
      <JournalDock
        dockRef={dockRef}
        isOpen={isOpen}
        isTransient={isTransient}
        mode={mode}
        questReferences={questReferences}
        referencePreviewLimit={referencePreviewLimit}
        quests={quests}
        trackedQuestNames={trackedQuestNames}
        completedQuestNames={completedQuestNames}
        isGeneratingQuests={isGeneratingQuests}
        selectedQuest={selectedQuest}
        selectedQuestItem={selectedQuestItem}
        item={item}
        items={items}
        itemsById={itemsById}
        canGoBack={canGoBack}
        onBack={onBack}
        onAddItemToWorkspace={onAddItemToWorkspace}
        onAddItemToWorkspaceAsActionAnchor={onAddItemToWorkspaceAsActionAnchor}
        onCloseItem={onCloseItem}
        onCloseQuest={onCloseQuest}
        onBackToJournal={onBackToJournal}
        onSelectItem={onSelectItem}
        onCollapse={onCollapse}
        onStartQuestDraftSession={onStartQuestDraftSession}
        onSelectQuest={onSelectQuest}
        onTrackQuest={onTrackQuest}
        onUntrackQuest={onUntrackQuest}
        onRequestAbandonQuest={onRequestAbandonQuest}
        pendingQuestAction={pendingQuestAction}
        truncateReference={truncateReference}
      />
      <QuestGenerationModal
        isOpen={isQuestModalOpen}
        isLoading={isGeneratingQuests}
        topic={questTopicInput}
        draft={questDraft}
        selectedTargetNames={selectedQuestDraftTargets}
        onTopicChange={onTopicChange}
        onClose={onCloseQuestModal}
        onSubmit={onSubmitQuestTopic}
        onToggleTarget={onToggleQuestTarget}
        onSelectAll={onSelectAllQuestTargets}
        onDeselectAll={onDeselectAllQuestTargets}
        onAccept={onAcceptQuestDraft}
      />
    </>
  );
}
