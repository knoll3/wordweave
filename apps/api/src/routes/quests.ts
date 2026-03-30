import express from "express";
import { z } from "zod";
import { getDb, persistDatabase } from "../db";
import {
  generateQuestTargetVariants,
  generateQuestTargets,
} from "../openaiClient";
import {
  createQuestSet,
  findGeneratedQuestTargetsTooCloseToDiscoveries,
  getPlayerQuestStats,
  importLegacyQuests,
  insertQuest,
  listQuests,
  normalizeQuestName,
  replaceQuestTargetVariants,
  syncQuestCompletions,
  updateQuestStatus,
} from "../questState";
import { getOrCreateReferenceByName } from "../referenceLookup";

const router = express.Router();
function createQuestSetId() {
  return `set-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatQuestSetTitle(topic: string) {
  return topic
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function backfillQuestTargetVariants(targetNames: string[]) {
  const uniqueTargetNames = Array.from(
    new Set(targetNames.map((name) => name.trim()).filter(Boolean))
  );
  if (uniqueTargetNames.length === 0) {
    return;
  }

  try {
    const result = await generateQuestTargetVariants({
      targets: uniqueTargetNames,
    });
    const db = await getDb();
    const requestedTargets = new Set(
      uniqueTargetNames.map((targetName) => normalizeQuestName(targetName))
    );
    for (const target of result.targets) {
      if (!requestedTargets.has(normalizeQuestName(target.name))) {
        continue;
      }
      replaceQuestTargetVariants(db, {
        questName: target.name,
        variants: target.alternateSpellings,
      });
    }
    persistDatabase(db);
    console.log("[api][quests] stored quest target variants", {
      targetCount: uniqueTargetNames.length,
    });
  } catch (err) {
    console.error("[api][quests] failed to backfill quest target variants", err);
  }
}

const generateTargetsRequestSchema = z.object({
  topic: z.string().min(1).max(120),
  excludeTargets: z.array(z.string().min(1).max(64)).max(500).optional(),
});

const acceptGeneratedTargetsRequestSchema = z.object({
  topic: z.string().min(1).max(120),
  targets: z.array(
    z.object({
      name: z.string().min(1).max(64),
      icon: z.string().min(1).max(8),
    })
  ).min(1).max(20),
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
    return res.json({ quests: listQuests(db), stats: getPlayerQuestStats(db) });
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
    return res.json({ quests: listQuests(db), stats: getPlayerQuestStats(db) });
  } catch (err) {
    console.error("[api][quests] failed to import legacy quests", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to import legacy quests",
    });
  }
});

router.post("/generate", async (req, res) => {
  console.log("[api][quests] generate route hit", {
    body: req.body,
  });
  const parsed = generateTargetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("[api][quests] invalid generate request", {
      issues: parsed.error.issues,
      body: req.body,
    });
    return res.status(400).json({ error: "Invalid quest generation request" });
  }

  const count = 12;
  const generatedCount = 30;
  const topic = parsed.data.topic.trim();
  const sessionExcludedTargets = Array.from(
    new Set(
      (parsed.data.excludeTargets ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  console.log("[api][quests] generate request", {
    topic,
    excludeTargetCount: sessionExcludedTargets.length,
  });

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
    const sessionExcludedSet = new Set(
      sessionExcludedTargets.map((target) => normalizeQuestName(target))
    );

    const discoveredSet = new Set<string>();
    const discoveredStmt = db.prepare("SELECT normalized_name FROM elements");
    while (discoveredStmt.step()) {
      const row = discoveredStmt.getAsObject() as Record<string, unknown>;
      discoveredSet.add(normalizeQuestName(String(row.normalized_name ?? "")));
    }
    discoveredStmt.free();

    const seen = new Set<string>(sessionExcludedSet);
    const generated = await generateQuestTargets({
      count: generatedCount,
      topic,
      recentTargets,
      completedTargets,
      sessionExcludedTargets,
    });
    const semanticallyDiscoveredTargets = await findGeneratedQuestTargetsTooCloseToDiscoveries(
      db,
      generated.targets.map((target) => target.name)
    );
    const acceptedTargets: Array<{ name: string; icon: string }> = [];

    for (const target of generated.targets) {
      const normalized = normalizeQuestName(target.name);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      if (existingQuestNames.has(normalized)) continue;
      if (discoveredSet.has(normalized)) continue;
      if (semanticallyDiscoveredTargets.has(normalized)) continue;
      seen.add(normalized);
      acceptedTargets.push(target);
      if (acceptedTargets.length >= generatedCount) break;
    }

    return res.json({
      draft: {
        topic,
        targets: acceptedTargets,
        recommendedCount: Math.min(count, acceptedTargets.length),
      },
    });
  } catch (err) {
    console.error("[api][quests] failed to generate quest targets", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate quest targets",
    });
  }
});

router.post("/generate/accept", async (req, res) => {
  const parsed = acceptGeneratedTargetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid generated quest accept request" });
  }

  try {
    const db = await getDb();
    const setId = createQuestSetId();
    const setTitle = formatQuestSetTitle(parsed.data.topic);
    const existingQuests = listQuests(db, { includeAbandoned: true });
    const existingQuestNames = new Set(
      existingQuests.map((quest) => normalizeQuestName(quest.name))
    );

    const discoveredSet = new Set<string>();
    const discoveredStmt = db.prepare("SELECT normalized_name FROM elements");
    while (discoveredStmt.step()) {
      const row = discoveredStmt.getAsObject() as Record<string, unknown>;
      discoveredSet.add(normalizeQuestName(String(row.normalized_name ?? "")));
    }
    discoveredStmt.free();

    const semanticallyDiscoveredTargets = await findGeneratedQuestTargetsTooCloseToDiscoveries(
      db,
      parsed.data.targets.map((target) => target.name)
    );

    const acceptedTargets: Array<{ name: string; icon: string }> = [];
    const seen = new Set<string>();
    for (const term of parsed.data.targets) {
      const normalized = normalizeQuestName(term.name);
      if (!normalized || seen.has(normalized)) continue;
      if (existingQuestNames.has(normalized)) continue;
      if (discoveredSet.has(normalized)) continue;
      if (semanticallyDiscoveredTargets.has(normalized)) continue;
      seen.add(normalized);
      acceptedTargets.push(term);
    }

    if (acceptedTargets.length === 0) {
      return res.status(409).json({
        error: "This quest set overlaps too much with existing progress. Try regenerating it.",
      });
    }

    createQuestSet(db, {
      id: setId,
      title: setTitle,
      topic: parsed.data.topic,
      totalQuestCount: acceptedTargets.length,
    });

    for (const target of acceptedTargets) {
      insertQuest(db, {
        ...target,
        setId,
        setTitle,
      });
    }

    await syncQuestCompletions(db, {
      targetNames: acceptedTargets.map((target) => target.name),
    });

    persistDatabase(db);
    console.log("[api][quests] accepted generated quest set", {
      topic: parsed.data.topic,
      acceptedCount: acceptedTargets.length,
    });
    const response = { quests: listQuests(db), stats: getPlayerQuestStats(db) };
    res.json(response);
    void backfillQuestTargetVariants(acceptedTargets.map((target) => target.name));
    return;
  } catch (err) {
    console.error("[api][quests] failed to accept generated quest set", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to accept generated quest set",
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
    return res.json({ quests: listQuests(db), stats: getPlayerQuestStats(db) });
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
