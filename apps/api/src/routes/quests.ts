import express from "express";
import type { Database } from "sql.js";
import { getDb, persistDatabase } from "../db";
import {
  generateTargetQuests,
  type OpenAiModel,
} from "../openaiClient";
import { getOrCreateReferenceByName } from "../referenceLookup";
import { generateTargetQuestRequestSchema } from "../validation";

const router = express.Router();

const QUEST_MODEL: OpenAiModel = "gpt-5-nano";
const QUEST_RETRY_LIMIT = 3;
const QUEST_HISTORY_LIMIT = 120;
const QUEST_PROMPT_HISTORY_LIMIT = 40;
const QUEST_GENERATION_MULTIPLIER = 2;
const VARIATION_THEME_POOL = [
  "pop culture",
  "history",
  "mythology",
  "science",
  "animals",
  "places",
  "inventions",
  "materials",
  "famous objects",
  "space",
  "oceans",
  "music",
  "movies",
  "folklore",
  "technology",
] as const;

type UsageCostSummary = {
  pricingModel: string;
  promptTokens: number;
  cachedPromptTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  promptCostUsd: number;
  completionCostUsd: number;
  totalCostUsd: number;
};

type TargetQuest = {
  target: string;
  normalizedTarget: string;
  difficulty: "easy" | "medium" | "stretch";
  flavor: string;
  teaser: string;
};

function normalizeTarget(value: string) {
  return value.trim().toLowerCase();
}

function titleCaseWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9][A-Z0-9'’-]*$/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function sampleVariationThemes() {
  const pool = [...VARIATION_THEME_POOL];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4);
}

function loadRecentQuestHistory(db: Database, limit: number) {
  const stmt = db.prepare(
    `
    SELECT target, normalized_target
    FROM target_quest_history
    ORDER BY generated_at DESC, id DESC
    LIMIT ?
    `
  );
  stmt.bind([limit]);

  const rows: Array<{ target: string; normalizedTarget: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      target: String(row.target),
      normalizedTarget: String(row.normalized_target),
    });
  }
  stmt.free();
  return rows;
}

function loadKnownElementNames(db: Database) {
  const stmt = db.prepare("SELECT normalized_name FROM elements");
  const names = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    names.add(String(row.normalized_name));
  }
  stmt.free();
  return names;
}

function aggregateUsageCost(summaries: Array<UsageCostSummary | null>) {
  const valid = summaries.filter(Boolean) as UsageCostSummary[];
  if (valid.length === 0) {
    return null;
  }

  const first = valid[0];
  return {
    pricingModel: first.pricingModel,
    promptTokens: valid.reduce((sum, item) => sum + item.promptTokens, 0),
    cachedPromptTokens: valid.reduce((sum, item) => sum + item.cachedPromptTokens, 0),
    uncachedPromptTokens: valid.reduce((sum, item) => sum + item.uncachedPromptTokens, 0),
    completionTokens: valid.reduce((sum, item) => sum + item.completionTokens, 0),
    promptCostUsd: Number(
      valid.reduce((sum, item) => sum + item.promptCostUsd, 0).toFixed(8)
    ),
    completionCostUsd: Number(
      valid.reduce((sum, item) => sum + item.completionCostUsd, 0).toFixed(8)
    ),
    totalCostUsd: Number(
      valid.reduce((sum, item) => sum + item.totalCostUsd, 0).toFixed(8)
    ),
  };
}

function looksAchievableTarget(target: string) {
  const trimmed = target.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 3) {
    return false;
  }

  const normalizedWords = words.map((word) => word.toLowerCase());
  const bannedLeadingDescriptors = new Set([
    "colorful",
    "beautiful",
    "ancient",
    "modern",
    "big",
    "small",
    "tiny",
    "giant",
    "little",
    "dark",
    "light",
    "happy",
    "sad",
    "shiny",
    "mysterious",
    "famous",
  ]);

  if (words.length > 1 && bannedLeadingDescriptors.has(normalizedWords[0])) {
    return false;
  }

  const bannedTargets = new Set([
    "thing",
    "stuff",
    "object",
    "person",
    "place",
    "item",
    "concept",
    "idea",
    "energy",
  ]);
  if (bannedTargets.has(trimmed.toLowerCase())) {
    return false;
  }

  return /^[\p{L}\p{N}'’ -]+$/u.test(trimmed);
}

function insertQuestHistory(db: Database, quests: TargetQuest[], model: string) {
  const stmt = db.prepare(
    `
    INSERT INTO target_quest_history (
      target,
      normalized_target,
      difficulty,
      flavor,
      teaser,
      model
    ) VALUES (?, ?, ?, ?, ?, ?)
    `
  );

  for (const quest of quests) {
    stmt.run([
      quest.target,
      quest.normalizedTarget,
      quest.difficulty,
      quest.flavor,
      quest.teaser,
      model,
    ]);
  }

  stmt.free();
}

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
    console.error("[api][target-quests] failed to load target reference", err);
    return res.status(500).json({ error: "Failed to load target reference" });
  }
});

router.post("/targets", async (req, res) => {
  const parsedBody = generateTargetQuestRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const db = await getDb();
    const knownElementNames = loadKnownElementNames(db);
    const recentHistory = loadRecentQuestHistory(db, QUEST_HISTORY_LIMIT);
    const recentTargetNames = recentHistory.map((entry) => entry.target);
    const recentTargetSet = new Set(recentHistory.map((entry) => entry.normalizedTarget));
    const acceptedInRun = new Set<string>();
    const promptExclusions = new Set(
      recentTargetNames.slice(0, QUEST_PROMPT_HISTORY_LIMIT)
    );
    const requestedCount = parsedBody.data.count;
    const generatedCountPerAttempt = Math.min(6, requestedCount * QUEST_GENERATION_MULTIPLIER);
    const usageSummaries: Array<UsageCostSummary | null> = [];
    let responseModel: string = QUEST_MODEL;
    let generatedQuests: TargetQuest[] = [];

    for (let attempt = 0; attempt < QUEST_RETRY_LIMIT; attempt += 1) {
      const generation = await generateTargetQuests({
        model: QUEST_MODEL,
        count: generatedCountPerAttempt,
        recentTargets: [...promptExclusions],
        variationThemes: sampleVariationThemes(),
      });

      responseModel = generation.responseModel;
      usageSummaries.push(generation.usage);

      const nextAccepted: TargetQuest[] = [];
      const rejectedThisAttempt: string[] = [];

      for (const quest of generation.selection.quests) {
        const normalizedTarget = normalizeTarget(quest.target);
        if (!looksAchievableTarget(quest.target)) {
          rejectedThisAttempt.push(quest.target);
          continue;
        }
        if (
          recentTargetSet.has(normalizedTarget) ||
          knownElementNames.has(normalizedTarget) ||
          acceptedInRun.has(normalizedTarget)
        ) {
          rejectedThisAttempt.push(quest.target);
          continue;
        }

        nextAccepted.push({
          target: titleCaseWords(quest.target),
          normalizedTarget,
          difficulty: quest.difficulty,
          flavor: quest.flavor.trim(),
          teaser: quest.teaser.trim(),
        });
        acceptedInRun.add(normalizedTarget);
      }

      generatedQuests.push(...nextAccepted);
      for (const rejected of rejectedThisAttempt) {
        promptExclusions.add(rejected);
      }

      if (generatedQuests.length >= requestedCount) {
        generatedQuests = generatedQuests.slice(0, requestedCount);
        break;
      }
    }

    if (generatedQuests.length === 0) {
      return res.status(502).json({ error: "Failed to generate usable quest targets" });
    }

    insertQuestHistory(db, generatedQuests, responseModel);
    persistDatabase(db);

    return res.json({
      generatedAt: new Date().toISOString(),
      model: responseModel,
      retryCount: usageSummaries.length,
      recentExclusionCount: Math.min(recentTargetNames.length, QUEST_PROMPT_HISTORY_LIMIT),
      cost: aggregateUsageCost(usageSummaries),
      quests: generatedQuests,
    });
  } catch (err) {
    console.error("[api][target-quests] failed to generate target quests", err);
    return res.status(500).json({ error: "Failed to generate target quests" });
  }
});

export default router;
