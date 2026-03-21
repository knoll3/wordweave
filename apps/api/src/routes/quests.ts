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
const QUEST_GENERATION_CANDIDATE_COUNT = 8;
const QUEST_SLOT_EXCLUSION_LIMIT = 12;
const VARIATION_THEME_POOL = [
  "nature",
  "pop culture",
  "mythology",
  "science",
  "fiction",
  "places",
  "creatures",
  "objects",
  "materials",
  "inventions",
  "history",
  "music",
  "movies",
  "technology",
  "art",
  "landmarks",
  "internet culture",
] as const;
const QUEST_TARGET_STYLE_GUIDANCE = [
  "Keep the batch broad and varied instead of clustering around one type of concept.",
  "Lean noticeably toward silly, playful, surprising, referential, and imaginative targets.",
  "Let some results feel delightfully odd, funny, chaotic, or challenge-run worthy, while still staying recognizable and achievable.",
  "Do not make the whole batch only that; keep a little room for striking or iconic targets too.",
  "Keep the results open-ended and varied.",
] as const;
const QUEST_HARD_RULES = [
  "Every target must be a real recognizable noun-like concept or named concept.",
  "Do not return descriptive adjective+noun phrases unless they are a fixed famous name.",
  "Prefer one-word targets or clean, well-known named concepts.",
  "Avoid vague filler terms, generic abstractions, and invented phrases.",
  "Do not repeat anything from the recent-targets exclusion list for the matching difficulty.",
  "Keep the list varied.",
  "Match the requested difficulty closely.",
  "Do not explain anything outside the JSON.",
] as const;
const QUEST_DIFFICULTY_DEFINITIONS: Record<DifficultyTier, string> = {
  easy: "Common, concrete, broadly recognizable targets.",
  medium: "Recognizable but less obvious, more specific, or more referential targets.",
  hard:
    "Challenging, varied, and interesting targets. Favor specific, surprising, playful, weird, referential, or imaginative concepts that feel fun to chase and a little unhinged in a good way, without collapsing into one narrow category of result.",
};
const QUEST_HARD_AVOID = [
  "dry textbook terms",
  "overly scholarly or academic-only targets",
  "overly repetitive category clusters",
  "too many plain everyday objects in a row",
  "too many obvious first-association nouns in a row",
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
  difficulty: "easy" | "medium" | "hard";
  flavor: string;
  teaser: string;
};

type DifficultyTier = TargetQuest["difficulty"];

const CATALYST_QUEST_POWER: Record<string, number> = {
  pop_culture: 3,
  creative: 2.5,
  split: 2.25,
  evolve: 2.25,
  craft: 1.75,
  word_combine: 1.5,
  opposite: 1.25,
  random_tools: 0.75,
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

function loadUnlockedCatalystKeys(db: Database) {
  const stmt = db.prepare("SELECT feature_key FROM player_unlocks");
  const keys = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    keys.add(String(row.feature_key));
  }
  stmt.free();
  return keys;
}

function buildDifficultyPlan(count: number, unlockedCatalystKeys: Set<string>) {
  const catalystPower = [...unlockedCatalystKeys].reduce(
    (sum, key) => sum + (CATALYST_QUEST_POWER[key] ?? 0),
    0
  );

  let difficulty: DifficultyTier;
  let guidance: string;
  if (catalystPower >= 7) {
    difficulty = "hard";
    guidance =
      "Use hard difficulty. Bias the batch toward fun, weird, playful, and surprising targets that feel like exciting challenge-run goals. Keep them difficult and recognizable, not dry.";
  } else if (catalystPower >= 4) {
    difficulty = "medium";
    guidance =
      "Use medium difficulty. Make the targets recognizable but not too obvious, and keep them playful and varied.";
  } else if (catalystPower >= 1.5) {
    difficulty = "medium";
    guidance =
      "Use medium difficulty. Keep the targets approachable enough to feel possible, but still interesting and a little surprising.";
  } else {
    difficulty = "easy";
    guidance =
      "Use easy difficulty. Favor clean, recognizable, fun targets that feel achievable without advanced catalyst tricks.";
  }

  return {
    catalystPower,
    guidance,
    difficulty,
    count,
  };
}

function loadRecentQuestHistory(db: Database, limit: number) {
  const stmt = db.prepare(
    `
    SELECT target, normalized_target, difficulty
    FROM target_quest_history
    ORDER BY generated_at DESC, id DESC
    LIMIT ?
    `
  );
  stmt.bind([limit]);

  const rows: Array<{
    target: string;
    normalizedTarget: string;
    difficulty: DifficultyTier;
  }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      target: String(row.target),
      normalizedTarget: String(row.normalized_target),
      difficulty:
        String(row.difficulty) === "stretch"
          ? "hard"
          : (String(row.difficulty) as DifficultyTier),
    });
  }
  stmt.free();
  return rows;
}

function buildPromptHistoryByDifficulty(
  history: Array<{ target: string; difficulty: DifficultyTier }>,
  limit: number
) {
  const grouped: Record<DifficultyTier, string[]> = {
    easy: [],
    medium: [],
    hard: [],
  };

  for (const entry of history) {
    const bucket = grouped[entry.difficulty];
    if (!bucket || bucket.length >= limit) {
      continue;
    }
    bucket.push(entry.target);
  }

  return grouped;
}

function pushPromptExclusion(
  grouped: Record<DifficultyTier, string[]>,
  difficulty: DifficultyTier,
  target: string,
  limit: number
) {
  const bucket = grouped[difficulty];
  if (!bucket) {
    return;
  }
  if (bucket.includes(target) || bucket.length >= limit) {
    return;
  }
  bucket.push(target);
}

function buildQuestPromptConfig() {
  return {
    targetDomainsText: QUEST_TARGET_STYLE_GUIDANCE.map((line) => `- ${line}`).join("\n"),
    hardRulesText: QUEST_HARD_RULES.map((rule) => `- ${rule}`).join("\n"),
  };
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
    const unlockedCatalystKeys = loadUnlockedCatalystKeys(db);
    const difficultyPlan = buildDifficultyPlan(
      parsedBody.data.count,
      unlockedCatalystKeys
    );
    const knownElementNames = loadKnownElementNames(db);
    const recentHistory = loadRecentQuestHistory(db, QUEST_HISTORY_LIMIT);
    const promptHistoryByDifficulty = buildPromptHistoryByDifficulty(
      recentHistory,
      QUEST_PROMPT_HISTORY_LIMIT
    );
    const recentTargetSet = new Set(recentHistory.map((entry) => entry.normalizedTarget));
    const acceptedInRun = new Set<string>();
    const requestedCount = parsedBody.data.count;
    const generatedCountPerAttempt = QUEST_GENERATION_CANDIDATE_COUNT;
    const usageSummaries: Array<UsageCostSummary | null> = [];
    let responseModel: string = QUEST_MODEL;
    let generatedQuests: TargetQuest[] = [];

    for (let attempt = 0; attempt < QUEST_RETRY_LIMIT; attempt += 1) {
      const generation = await generateTargetQuests({
        model: QUEST_MODEL,
        count: generatedCountPerAttempt,
        variationThemes: sampleVariationThemes(),
        activeDifficulty: {
          difficulty: difficultyPlan.difficulty,
          guidance: QUEST_DIFFICULTY_DEFINITIONS[difficultyPlan.difficulty],
          recentTargetsToAvoid: promptHistoryByDifficulty[
            difficultyPlan.difficulty
          ].slice(0, QUEST_SLOT_EXCLUSION_LIMIT),
          avoid:
            difficultyPlan.difficulty === "hard"
              ? [...QUEST_HARD_AVOID]
              : [],
        },
        difficultyGuidance: difficultyPlan.guidance,
        promptConfig: buildQuestPromptConfig(),
      });

      responseModel = generation.responseModel;
      usageSummaries.push(generation.usage);

      const nextAccepted: TargetQuest[] = [];
      const rejectedThisAttempt: Array<{
        target: string;
        difficulty: DifficultyTier;
      }> = [];

      for (const quest of generation.selection.quests) {
        const normalizedTarget = normalizeTarget(quest.target);
        if (!looksAchievableTarget(quest.target)) {
          rejectedThisAttempt.push({
            target: quest.target,
            difficulty: difficultyPlan.difficulty,
          });
          continue;
        }
        if (
          recentTargetSet.has(normalizedTarget) ||
          knownElementNames.has(normalizedTarget) ||
          acceptedInRun.has(normalizedTarget)
        ) {
          rejectedThisAttempt.push({
            target: quest.target,
            difficulty: difficultyPlan.difficulty,
          });
          continue;
        }

        nextAccepted.push({
          target: titleCaseWords(quest.target),
          normalizedTarget,
          difficulty: difficultyPlan.difficulty,
          flavor: quest.flavor.trim(),
          teaser: quest.teaser.trim(),
        });
        acceptedInRun.add(normalizedTarget);
      }

      generatedQuests.push(...nextAccepted);
      for (const rejected of rejectedThisAttempt) {
        pushPromptExclusion(
          promptHistoryByDifficulty,
          rejected.difficulty,
          rejected.target,
          QUEST_PROMPT_HISTORY_LIMIT
        );
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
      recentExclusionCount: Math.min(recentHistory.length, QUEST_PROMPT_HISTORY_LIMIT),
      catalystPower: Number(difficultyPlan.catalystPower.toFixed(2)),
      cost: aggregateUsageCost(usageSummaries),
      quests: generatedQuests,
    });
  } catch (err) {
    console.error("[api][target-quests] failed to generate target quests", err);
    return res.status(500).json({ error: "Failed to generate target quests" });
  }
});

export default router;
