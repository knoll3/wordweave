import { randomUUID } from "crypto";
import express from "express";
import {
  DEFAULT_ROOM_ID,
  clearBoardItems,
  deleteBoardItem,
  deleteBoardItems,
  getBoardItemById,
  getRoomSnapshot,
  insertBoardItem,
  loadBoardItemsByIds,
  updateBoardItemPosition,
  updateBoardItemMetadata,
} from "../boardState";
import { getDb, persistDatabase } from "../db";
import { emitBoardPatch, emitQuestCelebration, emitQuestSync, emitRoomSnapshot } from "../liveBoardEvents";
import { getElementById } from "../models";
import { getPlayerQuestStats, listQuests } from "../questState";
import {
  attachBoardModifierRequestSchema,
  combineBoardRequestSchema,
  createBoardItemWithIdRequestSchema,
  deleteBoardItemsRequestSchema,
  duplicateBoardItemRequestSchema,
  moveBoardItemsRequestSchema,
  updateBoardItemRequestSchema,
} from "../validation";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const db = await getDb();
    return res.json(getRoomSnapshot(db, DEFAULT_ROOM_ID));
  } catch (err) {
    console.error("Error in GET /board", err);
    return res.status(500).json({ error: "Failed to load board state" });
  }
});

router.post("/items", async (req, res) => {
  const parsed = createBoardItemWithIdRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid board item request" });
  }

  try {
    const db = await getDb();
    const item = insertBoardItem(db, {
      roomId: DEFAULT_ROOM_ID,
      nodeId: parsed.data.nodeId?.trim() || randomUUID(),
      item: {
        ...parsed.data,
        arrivalHighlightMode: parsed.data.arrivalHighlightMode ?? undefined,
      },
    });
    persistDatabase(db);
    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: [item],
    });
    return res.json(item);
  } catch (err) {
    console.error("Error in POST /board/items", err);
    return res.status(500).json({ error: "Failed to create board item" });
  }
});

router.post("/items/:id/duplicate", async (req, res) => {
  const nodeId = String(req.params.id ?? "");
  const parsed = duplicateBoardItemRequestSchema.safeParse(req.body ?? {});
  if (!nodeId) {
    return res.status(400).json({ error: "Invalid node id" });
  }
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid duplicate request" });
  }

  try {
    const db = await getDb();
    const existing = getBoardItemById(db, nodeId);
    if (!existing) {
      return res.status(404).json({ error: "Board item not found" });
    }
    const item = insertBoardItem(db, {
      roomId: DEFAULT_ROOM_ID,
      nodeId: parsed.data.nodeId?.trim() || randomUUID(),
      item: {
        itemId: Number(existing.item_id),
        position: parsed.data.position
          ? {
              x: Number(parsed.data.position.x),
              y: Number(parsed.data.position.y),
            }
          : {
              x: Number(existing.position_x) + 12,
              y: Number(existing.position_y) + 12,
            },
        isNewDiscovery: false,
        arrivalHighlightMode: undefined,
        categoryConstraintName:
          existing.category_constraint_name == null
            ? null
            : String(existing.category_constraint_name),
        categoryConstraintNormalizedName:
          existing.category_constraint_normalized_name == null
            ? null
            : String(existing.category_constraint_normalized_name),
        actionConstraintName:
          existing.action_constraint_name == null
            ? null
            : String(existing.action_constraint_name),
        actionConstraintNormalizedName:
          existing.action_constraint_normalized_name == null
            ? null
            : String(existing.action_constraint_normalized_name),
      },
    });
    persistDatabase(db);
    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: [item],
    });
    return res.json(item);
  } catch (err) {
    console.error("Error in POST /board/items/:id/duplicate", err);
    return res.status(500).json({ error: "Failed to duplicate board item" });
  }
});

router.patch("/items/:id", async (req, res) => {
  const nodeId = String(req.params.id ?? "");
  const parsed = updateBoardItemRequestSchema.safeParse(req.body);
  if (!nodeId || !parsed.success) {
    return res.status(400).json({ error: "Invalid board item patch request" });
  }

  try {
    const db = await getDb();
    const updated = updateBoardItemMetadata(db, {
      nodeId,
      itemId: parsed.data.itemId,
      isNewDiscovery:
        parsed.data.isNewDiscovery == null ? undefined : Boolean(parsed.data.isNewDiscovery),
      arrivalHighlightMode:
        parsed.data.arrivalHighlightMode == null ? null : parsed.data.arrivalHighlightMode,
      categoryConstraintName:
        parsed.data.categoryConstraintName == null || parsed.data.categoryConstraintName === ""
          ? null
          : parsed.data.categoryConstraintName,
      categoryConstraintNormalizedName:
        parsed.data.categoryConstraintNormalizedName == null ||
        parsed.data.categoryConstraintNormalizedName === ""
          ? null
          : parsed.data.categoryConstraintNormalizedName,
      actionConstraintName:
        parsed.data.actionConstraintName == null || parsed.data.actionConstraintName === ""
          ? null
          : parsed.data.actionConstraintName,
      actionConstraintNormalizedName:
        parsed.data.actionConstraintNormalizedName == null ||
        parsed.data.actionConstraintNormalizedName === ""
          ? null
          : parsed.data.actionConstraintNormalizedName,
    });
    persistDatabase(db);
    if (!updated) {
      return res.status(404).json({ error: "Board item not found" });
    }

    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: [updated],
    });
    return res.json(updated);
  } catch (err) {
    console.error("Error in PATCH /board/items/:id", err);
    return res.status(500).json({ error: "Failed to update board item" });
  }
});

router.post("/items/move", async (req, res) => {
  const parsed = moveBoardItemsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid move request" });
  }

  try {
    const db = await getDb();
    const updated = parsed.data.items
      .map((item) =>
        updateBoardItemPosition(db, {
          nodeId: item.nodeId,
          x: Math.round(item.position.x),
          y: Math.round(item.position.y),
        })
      )
      .filter((item): item is NonNullable<typeof item> => item != null);
    persistDatabase(db);

    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: updated,
    });
    return res.json({ ok: true, items: updated });
  } catch (err) {
    console.error("Error in POST /board/items/move", err);
    return res.status(500).json({ error: "Failed to move board items" });
  }
});

router.delete("/items/:id", async (req, res) => {
  const nodeId = String(req.params.id ?? "");
  if (!nodeId) {
    return res.status(400).json({ error: "Invalid node id" });
  }

  try {
    const db = await getDb();
    deleteBoardItem(db, nodeId);
    persistDatabase(db);
    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      deletedNodeIds: [nodeId],
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in DELETE /board/items/:id", err);
    return res.status(500).json({ error: "Failed to delete board item" });
  }
});

router.post("/items/delete", async (req, res) => {
  const parsed = deleteBoardItemsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid delete request" });
  }

  try {
    const db = await getDb();
    deleteBoardItems(db, parsed.data.nodeIds);
    persistDatabase(db);
    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      deletedNodeIds: parsed.data.nodeIds,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /board/items/delete", err);
    return res.status(500).json({ error: "Failed to delete board items" });
  }
});

router.post("/attach-action", async (req, res) => {
  const parsed = attachBoardModifierRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid modifier attachment request" });
  }

  try {
    const db = await getDb();
    const target = getBoardItemById(db, parsed.data.targetNodeId);
    if (!target) {
      return res.status(404).json({ error: "Target board item not found" });
    }
    const targetElement = getElementById(db, Number(target.item_id));
    if (!targetElement) {
      return res.status(400).json({ error: "Action modifier can only attach to normal items" });
    }

    deleteBoardItem(db, parsed.data.sourceNodeId);
    const updated = updateBoardItemMetadata(db, {
      nodeId: parsed.data.targetNodeId,
      actionConstraintName: targetElement.name,
      actionConstraintNormalizedName: targetElement.normalizedName,
    });
    persistDatabase(db);

    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: updated ? [updated] : [],
      deletedNodeIds: [parsed.data.sourceNodeId],
    });
    return res.json({ ok: true, item: updated });
  } catch (err) {
    console.error("Error in POST /board/attach-action", err);
    return res.status(500).json({ error: "Failed to attach action modifier" });
  }
});

router.post("/attach-category", async (req, res) => {
  const parsed = attachBoardModifierRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid modifier attachment request" });
  }

  try {
    const db = await getDb();
    const target = getBoardItemById(db, parsed.data.targetNodeId);
    if (!target) {
      return res.status(404).json({ error: "Target board item not found" });
    }
    const targetElement = getElementById(db, Number(target.item_id));
    if (!targetElement) {
      return res.status(400).json({ error: "Category modifier can only attach to normal items" });
    }

    deleteBoardItem(db, parsed.data.sourceNodeId);
    const updated = updateBoardItemMetadata(db, {
      nodeId: parsed.data.targetNodeId,
      categoryConstraintName: targetElement.name,
      categoryConstraintNormalizedName: targetElement.normalizedName,
    });
    persistDatabase(db);

    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: updated ? [updated] : [],
      deletedNodeIds: [parsed.data.sourceNodeId],
    });
    return res.json({ ok: true, item: updated });
  } catch (err) {
    console.error("Error in POST /board/attach-category", err);
    return res.status(500).json({ error: "Failed to attach category modifier" });
  }
});

router.post("/combine", async (req, res) => {
  const parsed = combineBoardRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid board combine request" });
  }

  try {
    const db = await getDb();
    const existing = loadBoardItemsByIds(db, parsed.data.consumedNodeIds);
    if (existing.length !== parsed.data.consumedNodeIds.length) {
      return res.status(409).json({ error: "One or more board items are no longer available" });
    }
    const created = [];
    const placeholderNodeId = parsed.data.placeholderNodeId?.trim() || null;
    const consumedNodeIds = [...parsed.data.consumedNodeIds];

    let deletedNodeIds: string[] = [];

    if (placeholderNodeId) {
      const placeholder = getBoardItemById(db, placeholderNodeId);
      if (!placeholder) {
        return res.status(409).json({ error: "Pending result item is no longer available" });
      }
      const firstProduced = parsed.data.producedItems[0];
      if (!firstProduced) {
        return res.status(400).json({ error: "No produced items were provided" });
      }
      const updatedPlaceholder = updateBoardItemMetadata(db, {
        nodeId: placeholderNodeId,
        itemId: firstProduced.itemId,
        isNewDiscovery: firstProduced.isNewDiscovery ?? false,
        arrivalHighlightMode: firstProduced.arrivalHighlightMode ?? null,
        categoryConstraintName: firstProduced.categoryConstraintName ?? null,
        categoryConstraintNormalizedName: firstProduced.categoryConstraintNormalizedName ?? null,
        actionConstraintName: firstProduced.actionConstraintName ?? null,
        actionConstraintNormalizedName: firstProduced.actionConstraintNormalizedName ?? null,
      });
      if (!updatedPlaceholder) {
        return res.status(409).json({ error: "Pending result item could not be updated" });
      }
      created.push(updatedPlaceholder);
      for (const item of parsed.data.producedItems.slice(1)) {
        created.push(
          insertBoardItem(db, {
            roomId: DEFAULT_ROOM_ID,
            nodeId: randomUUID(),
            item: {
              ...item,
              arrivalHighlightMode: item.arrivalHighlightMode ?? undefined,
            },
          })
        );
      }
    } else {
      for (const item of parsed.data.producedItems) {
        created.push(
          insertBoardItem(db, {
            roomId: DEFAULT_ROOM_ID,
            nodeId: randomUUID(),
            item: {
              ...item,
              arrivalHighlightMode: item.arrivalHighlightMode ?? undefined,
            },
          })
        );
      }
    }
    if (!placeholderNodeId) {
      deleteBoardItems(db, consumedNodeIds);
      deletedNodeIds = consumedNodeIds;
    }
    persistDatabase(db);

    emitBoardPatch({
      roomId: DEFAULT_ROOM_ID,
      upserts: created,
      deletedNodeIds,
    });

    if (parsed.data.questSync) {
      const quests = listQuests(db);
      const stats = getPlayerQuestStats(db);
      emitQuestSync({
        roomId: DEFAULT_ROOM_ID,
        quests,
        stats,
      });
      const celebrationIndex =
        parsed.data.questSync.celebrationProducedItemIndex == null
          ? null
          : parsed.data.questSync.celebrationProducedItemIndex;
      emitQuestCelebration({
        roomId: DEFAULT_ROOM_ID,
        newlyCompletedQuestNames: parsed.data.questSync.newlyCompletedQuestNames,
        completedQuestSets: parsed.data.questSync.completedQuestSets,
        totalPoints: parsed.data.questSync.totalPoints,
        celebrationNodeId:
          celebrationIndex != null && celebrationIndex >= 0
            ? created[celebrationIndex]?.nodeId ?? null
            : null,
      });
    }

    return res.json({
      ok: true,
      created,
      deletedNodeIds,
    });
  } catch (err) {
    console.error("Error in POST /board/combine", err);
    return res.status(500).json({ error: "Failed to apply board combine" });
  }
});

router.post("/clear", async (_req, res) => {
  try {
    const db = await getDb();
    clearBoardItems(db, DEFAULT_ROOM_ID);
    persistDatabase(db);
    emitRoomSnapshot(getRoomSnapshot(db, DEFAULT_ROOM_ID));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /board/clear", err);
    return res.status(500).json({ error: "Failed to clear board" });
  }
});

export default router;
