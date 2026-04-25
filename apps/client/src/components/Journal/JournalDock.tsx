import React from "react";
import type { Item, QuestRecord } from "../../types";
import type { ItemReference } from "../../lib/api";
import ItemDetailsDrawer from "../Graph/ItemDetailsDrawer";
import QuestDetailsPanel from "../Graph/QuestDetailsPanel";
import JournalQuestBrowser from "./JournalQuestBrowser";

interface Props {
  dockRef?: React.Ref<HTMLElement>;
  isOpen: boolean;
  isTransient?: boolean;
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
  onRequestAbandonQuest: (questName: string) => void;
  pendingQuestAction:
    | {
        name: string;
        kind: "track" | "untrack" | "abandon";
      }
    | null;
  truncateReference: (value: string, limit: number) => string;
}

const JournalDock: React.FC<Props> = ({
  dockRef,
  isOpen,
  isTransient = false,
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
}) => {
  return (
    <aside
      ref={dockRef}
      className={`journal-dock${isOpen ? "" : " is-collapsed"}${
        isTransient ? " is-transient" : ""
      }`}
    >
      {isOpen ? (
        <div className="journal-dock-shell">
          {mode === "item" && item ? (
            <ItemDetailsDrawer
              item={item}
              items={items}
              itemsById={itemsById}
              canGoBack={canGoBack}
              onBack={onBack}
              onClose={onCloseItem}
              onAddItemToWorkspace={onAddItemToWorkspace}
              onAddItemToWorkspaceAsActionAnchor={onAddItemToWorkspaceAsActionAnchor}
              onSelectItem={onSelectItem}
            />
          ) : mode === "quest" && selectedQuest ? (
            <QuestDetailsPanel
              quest={selectedQuest}
              discoveredItem={selectedQuestItem}
              onBack={onBackToJournal}
              onClose={onCloseQuest}
              onAddItemToWorkspace={onAddItemToWorkspace}
            />
          ) : (
            <JournalQuestBrowser
              quests={quests}
              trackedQuestNames={trackedQuestNames}
              completedQuestNames={completedQuestNames}
              questReferences={questReferences}
              referencePreviewLimit={referencePreviewLimit}
              isGeneratingQuests={isGeneratingQuests}
              pendingQuestAction={pendingQuestAction}
              truncateReference={truncateReference}
              onCollapse={onCollapse}
              onStartQuestDraftSession={onStartQuestDraftSession}
              onSelectQuest={onSelectQuest}
              onTrackQuest={onTrackQuest}
              onUntrackQuest={onUntrackQuest}
              onRequestAbandonQuest={onRequestAbandonQuest}
            />
          )}
        </div>
      ) : null}
    </aside>
  );
};

export default JournalDock;
