import express from "express";
import { z } from "zod";
import { getDb, persistDatabase } from "../db";
import { generateChallengeTargets, type OpenAiModel } from "../openaiClient";
import {
  findGeneratedQuestTargetsTooCloseToDiscoveries,
  importLegacyQuests,
  insertQuest,
  listQuests,
  normalizeQuestName,
  syncQuestCompletions,
  updateQuestStatus,
} from "../questState";
import { getOrCreateReferenceByName } from "../referenceLookup";

const router = express.Router();

const generateTargetsRequestSchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
  difficulty: z.enum(["easy", "hard"]).optional(),
  model: z.enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"]).optional(),
});

const updateQuestStatusRequestSchema = z.object({
  name: z.string().min(1).max(128),
  status: z.enum(["available", "tracked", "abandoned"]),
});

const importLegacyQuestsRequestSchema = z.object({
  quests: z.array(
    z.object({
      name: z.string().min(1).max(128),
      icon: z.string().min(1).max(32),
    })
  ).max(500),
  trackedNames: z.array(z.string().min(1).max(128)).optional(),
  abandonedNames: z.array(z.string().min(1).max(128)).optional(),
});

router.get("/", async (_req, res) => {
  try {
    const db = await getDb();
    return res.json({ quests: listQuests(db) });
  } catch (err) {
    console.error("[api][quests] failed to load quests", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load quests",
    });
  }
});

router.post("/import-legacy", async (req, res) => {
  const parsed = importLegacyQuestsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid legacy quest import payload" });
  }

  try {
    const db = await getDb();
    importLegacyQuests(db, parsed.data);
    await syncQuestCompletions(db, {
      targetNames: parsed.data.quests.map((quest) => quest.name),
      log: false,
    });
    persistDatabase(db);
    return res.json({ quests: listQuests(db) });
  } catch (err) {
    console.error("[api][quests] failed to import legacy quests", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to import legacy quests",
    });
  }
});

router.post("/generate", async (req, res) => {
  const parsed = generateTargetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid challenge target request" });
  }

  const count = parsed.data.count ?? 10;
  const requestCount = Math.min(count + 6, 20);
  const difficulty = parsed.data.difficulty ?? "hard";
  const model: OpenAiModel | undefined = parsed.data.model;

  try {
    const db = await getDb();
    const existingQuests = listQuests(db, { includeAbandoned: true });
    const existingQuestNames = new Set(
      existingQuests.map((quest) => normalizeQuestName(quest.name))
    );
    const recentTargets = existingQuests
      .filter((quest) => quest.status !== "completed" && quest.status !== "abandoned")
      .map((quest) => quest.name)
      .slice(-50);
    const completedTargets = existingQuests
      .filter((quest) => quest.status === "completed")
      .map((quest) => quest.name)
      .slice(-50);

    const discoveredSet = new Set<string>();
    const discoveredStmt = db.prepare("SELECT normalized_name FROM elements");
    while (discoveredStmt.step()) {
      const row = discoveredStmt.getAsObject() as Record<string, unknown>;
      discoveredSet.add(normalizeQuestName(String(row.normalized_name ?? "")));
    }
    discoveredStmt.free();

    const acceptedTargets: Array<{ name: string; icon: string }> = [];
    const seen = new Set<string>();

    for (let attempt = 0; attempt < 2 && acceptedTargets.length < count; attempt += 1) {
      const generated = await generateChallengeTargets({
        count: requestCount,
        difficulty,
        recentTargets: [...recentTargets, ...acceptedTargets.map((target) => target.name)],
        completedTargets,
        model,
      });
      const semanticallyDiscoveredTargets = await findGeneratedQuestTargetsTooCloseToDiscoveries(
        db,
        generated.targets.map((target) => target.name)
      );

      for (const target of generated.targets) {
        const normalized = normalizeQuestName(target.name);
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        if (existingQuestNames.has(normalized)) continue;
        if (discoveredSet.has(normalized)) continue;
        if (semanticallyDiscoveredTargets.has(normalized)) continue;
        seen.add(normalized);
        acceptedTargets.push(target);
        if (acceptedTargets.length >= count) break;
      }
    }

    for (const target of acceptedTargets) {
      insertQuest(db, target);
    }

    if (acceptedTargets.length > 0) {
      await syncQuestCompletions(db, {
        targetNames: acceptedTargets.map((target) => target.name),
      });
    }

    persistDatabase(db);
    return res.json({ quests: listQuests(db) });
  } catch (err) {
    console.error("[api][quests] failed to generate challenge targets", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate challenge targets",
    });
  }
});

router.post("/status", async (req, res) => {
  const parsed = updateQuestStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid quest status request" });
  }

  try {
    const db = await getDb();
    updateQuestStatus(db, parsed.data);
    persistDatabase(db);
    return res.json({ quests: listQuests(db) });
  } catch (err) {
    console.error("[api][quests] failed to update quest status", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to update quest status",
    });
  }
});

router.get("/reference", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.status(400).json({ error: "Missing quest target query" });
  }

  try {
    const db = await getDb();
    const reference = await getOrCreateReferenceByName(db, q);
    persistDatabase(db);
    if (!reference) {
      return res.status(404).json({ error: "Reference not found" });
    }
    return res.json(reference);
  } catch (err) {
    console.error("[api][target-reference] failed to load target reference", err);
    return res.status(500).json({ error: "Failed to load target reference" });
  }
});

export default router;
