import type { Database } from "sql.js";
import { DEFAULT_EMBEDDING_MODEL_NAME, generateEmbeddings, judgeQuestCompletionCandidate } from "./openaiClient";
import {
  buildEmbeddingSearchText,
  cosineSimilarity,
  loadEmbeddingsByElementId,
  loadQueryEmbedding,
  saveQueryEmbedding,
} from "./embeddingStore";
import { ensureSearchIndexForElementIds } from "./search";

export type QuestStatus = "available" | "tracked" | "completed" | "abandoned";

export interface QuestRecord {
  name: string;
  normalizedName: string;
  icon: string;
  setId: string | null;
  setTitle: string | null;
  pointsAwarded: number;
  status: QuestStatus;
  matchedItemName: string | null;
  completionMethod: "exact" | "embedding" | "judge" | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface CompletedQuestSet {
  id: string;
  title: string;
  topic: string;
  questCount: number;
  earnedPoints: number;
}

export interface PlayerQuestStats {
  totalPoints: number;
}

export const QUEST_COMPLETION_SIMILARITY_THRESHOLD = 0.865;
export const QUEST_COMPLETION_JUDGE_THRESHOLD = 0.7;
export const QUEST_POINTS_PER_TARGET = 10;
export const QUEST_SET_COMPLETION_BONUS_POINTS = 50;

const questJudgeDecisionCache = new Map<string, boolean>();

export function normalizeQuestName(value: string) {
  return value.trim().toLowerCase();
}

function uniqueNormalized(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeQuestName(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function mapQuestRow(row: Record<string, unknown>): QuestRecord {
  return {
    name: String(row.name ?? ""),
    normalizedName: String(row.normalized_name ?? ""),
    icon: String(row.icon ?? "🎯"),
    setId: row.set_id == null ? null : String(row.set_id),
    setTitle: row.set_title == null ? null : String(row.set_title),
    pointsAwarded: Number(row.points_awarded ?? QUEST_POINTS_PER_TARGET),
    status: String(row.status ?? "available") as QuestStatus,
    matchedItemName:
      row.matched_item_name == null ? null : String(row.matched_item_name),
    completionMethod:
      row.completion_method == null
        ? null
        : (String(row.completion_method) as QuestRecord["completionMethod"]),
    createdAt: row.created_at == null ? null : String(row.created_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

export function listQuests(
  db: Database,
  options?: { includeAbandoned?: boolean }
) {
  const includeAbandoned = options?.includeAbandoned ?? false;
  const stmt = db.prepare(
    `
    SELECT name, normalized_name, icon, set_id, set_title, points_awarded, status, matched_item_name, completion_method, created_at, completed_at
    FROM quests
    ${includeAbandoned ? "" : "WHERE status != 'abandoned'"}
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
    `
  );
  const quests: QuestRecord[] = [];
  while (stmt.step()) {
    quests.push(mapQuestRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return quests;
}

export function insertQuest(
  db: Database,
  params: {
    name: string;
    icon: string;
    status?: QuestStatus;
    setId?: string | null;
    setTitle?: string | null;
    pointsAwarded?: number;
  }
) {
  const normalizedName = normalizeQuestName(params.name);
  const stmt = db.prepare(`
    INSERT INTO quests (name, normalized_name, icon, set_id, set_title, points_awarded, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO NOTHING
  `);
  stmt.run([
    params.name.trim(),
    normalizedName,
    params.icon.trim(),
    params.setId ?? null,
    params.setTitle ?? null,
    params.pointsAwarded ?? QUEST_POINTS_PER_TARGET,
    params.status ?? "available",
  ]);
  stmt.free();
}

export function importLegacyQuests(
  db: Database,
  params: {
    quests: Array<{ name: string; icon: string }>;
    trackedNames?: string[];
    abandonedNames?: string[];
  }
) {
  const tracked = new Set(uniqueNormalized(params.trackedNames ?? []).map(normalizeQuestName));
  const abandoned = new Set(uniqueNormalized(params.abandonedNames ?? []).map(normalizeQuestName));

  for (const quest of params.quests) {
    const normalizedName = normalizeQuestName(quest.name);
    if (!normalizedName) continue;
    insertQuest(db, {
      name: quest.name,
      icon: quest.icon,
      status: abandoned.has(normalizedName)
        ? "abandoned"
        : tracked.has(normalizedName)
          ? "tracked"
          : "available",
    });
  }
}

export function updateQuestStatus(
  db: Database,
  params: { name: string; status: Extract<QuestStatus, "available" | "tracked" | "abandoned"> }
) {
  const stmt = db.prepare(`
    UPDATE quests
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE normalized_name = ? AND status != 'completed'
  `);
  stmt.run([params.status, normalizeQuestName(params.name)]);
  stmt.free();
}

function loadIncompleteQuests(
  db: Database,
  options?: { targetNames?: string[] }
) {
  const targetNames = uniqueNormalized(options?.targetNames ?? []);
  const normalizedTargets = targetNames.map(normalizeQuestName);
  const whereClauses = [`status IN ('available', 'tracked')`];
  if (normalizedTargets.length > 0) {
    whereClauses.push(`normalized_name IN (${normalizedTargets.map(() => "?").join(", ")})`);
  }
  const stmt = db.prepare(`
    SELECT name, normalized_name, icon, set_id, set_title, points_awarded, status, matched_item_name, completion_method, created_at, completed_at
    FROM quests
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
  `);
  if (normalizedTargets.length > 0) {
    stmt.bind(normalizedTargets);
  }
  const quests: QuestRecord[] = [];
  while (stmt.step()) {
    quests.push(mapQuestRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return quests;
}

function loadDiscoveredRows(
  db: Database,
  options?: { candidateNames?: string[] }
) {
  const candidateNames = uniqueNormalized(options?.candidateNames ?? []);
  const normalizedCandidates = candidateNames.map(normalizeQuestName);
  const whereClauses = ["1=1"];
  if (normalizedCandidates.length > 0) {
    whereClauses.push(`e.normalized_name IN (${normalizedCandidates.map(() => "?").join(", ")})`);
  }
  const stmt = db.prepare(`
    SELECT e.id, e.name, e.normalized_name
    FROM discoveries d
    JOIN elements e ON e.id = d.element_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY d.discovered_at ASC
  `);
  if (normalizedCandidates.length > 0) {
    stmt.bind(normalizedCandidates);
  }
  const rows: Array<{ id: number; name: string; normalizedName: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      id: Number(row.id),
      name: String(row.name ?? ""),
      normalizedName: String(row.normalized_name ?? ""),
    });
  }
  stmt.free();
  return rows;
}

export async function findGeneratedQuestTargetsTooCloseToDiscoveries(
  db: Database,
  targetNames: string[],
  threshold = QUEST_COMPLETION_SIMILARITY_THRESHOLD
) {
  const uniqueTargets = uniqueNormalized(targetNames);
  if (uniqueTargets.length === 0) {
    return new Set<string>();
  }

  const discoveredRows = loadDiscoveredRows(db);
  if (discoveredRows.length === 0) {
    return new Set<string>();
  }

  await ensureSearchIndexForElementIds(
    db,
    discoveredRows.map((row) => row.id)
  );

  const embeddingsById = loadEmbeddingsByElementId(
    db,
    discoveredRows.map((row) => row.id)
  );
  const queryEmbeddings = await getQuestQueryEmbeddings(
    db,
    uniqueTargets.map((name) => ({
      name,
      normalizedName: normalizeQuestName(name),
      icon: "🎯",
      setId: null,
      setTitle: null,
      pointsAwarded: QUEST_POINTS_PER_TARGET,
      status: "available" as const,
      matchedItemName: null,
      completionMethod: null,
      createdAt: null,
      completedAt: null,
    }))
  );

  const rejectedTargets = new Set<string>();
  for (const target of uniqueTargets) {
    const queryEmbedding = queryEmbeddings.get(normalizeQuestName(target));
    if (!queryEmbedding) {
      continue;
    }
    let bestSimilarity = 0;
    let bestMatchName: string | null = null;
    for (const row of discoveredRows) {
      const itemEmbedding = embeddingsById.get(row.id);
      if (!itemEmbedding) continue;
      const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatchName = row.name;
      }
    }

    if (bestSimilarity >= threshold) {
      console.log("[api][quests] generation rejected by discovery embedding", {
        target,
        bestMatchName,
        bestSimilarity: Number(bestSimilarity.toFixed(4)),
        threshold,
      });
      rejectedTargets.add(normalizeQuestName(target));
    }
  }

  return rejectedTargets;
}

async function getQuestQueryEmbeddings(db: Database, quests: QuestRecord[]) {
  const embeddings = new Map<string, number[]>();
  const missingQuests: QuestRecord[] = [];

  for (const quest of quests) {
    const queryText = buildEmbeddingSearchText(quest.name);
    const cached = loadQueryEmbedding(db, queryText);
    if (cached) {
      embeddings.set(quest.normalizedName, cached);
    } else {
      missingQuests.push(quest);
    }
  }

  if (missingQuests.length > 0) {
    const response = await generateEmbeddings(
      missingQuests.map((quest) => buildEmbeddingSearchText(quest.name))
    );
    response.embeddings.forEach((entry, index) => {
      const quest = missingQuests[index];
      embeddings.set(quest.normalizedName, entry.embedding);
      saveQueryEmbedding(
        db,
        buildEmbeddingSearchText(quest.name),
        response.model || DEFAULT_EMBEDDING_MODEL_NAME,
        entry.embedding
      );
    });
  }

  return embeddings;
}

function markQuestCompleted(
  db: Database,
  params: {
    normalizedName: string;
    matchedItemName: string | null;
    completionMethod: "exact" | "embedding" | "judge";
  }
) {
  const stmt = db.prepare(`
    UPDATE quests
    SET status = 'completed',
        matched_item_name = ?,
        completion_method = ?,
        completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE normalized_name = ? AND status IN ('available', 'tracked')
  `);
  stmt.run([params.matchedItemName, params.completionMethod, params.normalizedName]);
  stmt.free();
}

function ensurePlayerStatRow(db: Database, key: string) {
  const stmt = db.prepare(`
    INSERT INTO player_stats (key, value_integer, updated_at)
    VALUES (?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO NOTHING
  `);
  stmt.run([key]);
  stmt.free();
}

function incrementPlayerPoints(db: Database, points: number) {
  if (points <= 0) {
    return;
  }
  ensurePlayerStatRow(db, "quest_points_total");
  const stmt = db.prepare(`
    UPDATE player_stats
    SET value_integer = value_integer + ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = 'quest_points_total'
  `);
  stmt.run([points]);
  stmt.free();
}

export function getPlayerQuestStats(db: Database): PlayerQuestStats {
  const stmt = db.prepare("SELECT value_integer FROM player_stats WHERE key = 'quest_points_total'");
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  if (row.value_integer != null) {
    return {
      totalPoints: Number(row.value_integer ?? 0),
    };
  }

  const seedStmt = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(points_awarded) FROM quests WHERE status = 'completed'), 0) +
      COALESCE((SELECT SUM(bonus_points_awarded) FROM quest_sets WHERE completed_at IS NOT NULL), 0)
      AS total_points
  `);
  const seedRow = seedStmt.getAsObject() as Record<string, unknown>;
  seedStmt.free();
  const seededTotalPoints = Number(seedRow.total_points ?? 0);

  const insertStmt = db.prepare(`
    INSERT INTO player_stats (key, value_integer, updated_at)
    VALUES ('quest_points_total', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value_integer = excluded.value_integer, updated_at = CURRENT_TIMESTAMP
  `);
  insertStmt.run([seededTotalPoints]);
  insertStmt.free();

  return {
    totalPoints: seededTotalPoints,
  };
}

export function createQuestSet(
  db: Database,
  params: { id: string; title: string; topic: string; totalQuestCount: number }
) {
  const stmt = db.prepare(`
    INSERT INTO quest_sets (id, title, topic, total_quest_count, bonus_points_awarded, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  stmt.run([
    params.id,
    params.title,
    params.topic,
    params.totalQuestCount,
    QUEST_SET_COMPLETION_BONUS_POINTS,
  ]);
  stmt.free();
}

function completeQuestSetsForQuestIds(
  db: Database,
  questIds: string[]
): CompletedQuestSet[] {
  if (questIds.length === 0) {
    return [];
  }

  const placeholders = questIds.map(() => "?").join(", ");
  const candidateSetStmt = db.prepare(`
    SELECT DISTINCT set_id
    FROM quests
    WHERE normalized_name IN (${placeholders}) AND set_id IS NOT NULL
  `);
  candidateSetStmt.bind(questIds);
  const candidateSetIds: string[] = [];
  while (candidateSetStmt.step()) {
    const row = candidateSetStmt.getAsObject() as Record<string, unknown>;
    if (row.set_id != null) {
      candidateSetIds.push(String(row.set_id));
    }
  }
  candidateSetStmt.free();

  if (candidateSetIds.length === 0) {
    return [];
  }

  const setPlaceholders = candidateSetIds.map(() => "?").join(", ");
  const summaryStmt = db.prepare(`
    SELECT
      qs.id,
      qs.title,
      qs.topic,
      qs.total_quest_count,
      qs.completed_at,
      qs.bonus_points_awarded,
      SUM(CASE WHEN q.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
    FROM quest_sets qs
    JOIN quests q ON q.set_id = qs.id
    WHERE qs.id IN (${setPlaceholders})
    GROUP BY qs.id, qs.title, qs.topic, qs.total_quest_count, qs.completed_at, qs.bonus_points_awarded
  `);
  summaryStmt.bind(candidateSetIds);
  const completedSets: CompletedQuestSet[] = [];
  while (summaryStmt.step()) {
    const row = summaryStmt.getAsObject() as Record<string, unknown>;
    const totalQuestCount = Number(row.total_quest_count ?? 0);
    const completedCount = Number(row.completed_count ?? 0);
    if (row.completed_at != null || totalQuestCount <= 0 || completedCount < totalQuestCount) {
      continue;
    }

    const updateStmt = db.prepare(`
      UPDATE quest_sets
      SET completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND completed_at IS NULL
    `);
    updateStmt.run([String(row.id)]);
    updateStmt.free();

    completedSets.push({
      id: String(row.id),
      title: String(row.title ?? ""),
      topic: String(row.topic ?? ""),
      questCount: totalQuestCount,
      earnedPoints: Number(row.bonus_points_awarded ?? QUEST_SET_COMPLETION_BONUS_POINTS),
    });
  }
  summaryStmt.free();

  return completedSets;
}

export async function syncQuestCompletions(
  db: Database,
  options?: {
    candidateNames?: string[];
    targetNames?: string[];
    log?: boolean;
  }
) {
  const logEnabled = options?.log ?? true;
  const quests = loadIncompleteQuests(db, { targetNames: options?.targetNames });
  if (quests.length === 0) {
    return {
      newlyCompletedQuestNames: [] as string[],
      completedQuestSets: [] as CompletedQuestSet[],
      awardedPoints: 0,
      totalPoints: getPlayerQuestStats(db).totalPoints,
    };
  }

  const discoveredRows = loadDiscoveredRows(db, { candidateNames: options?.candidateNames });
  if (discoveredRows.length === 0) {
    if (logEnabled) {
      console.log("[api][quests] completion check", {
        targetCount: quests.length,
        discoveredCount: 0,
        candidateNameCount: options?.candidateNames?.length ?? 0,
        threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
        judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
      });
    }
    return {
      newlyCompletedQuestNames: [] as string[],
      completedQuestSets: [] as CompletedQuestSet[],
      awardedPoints: 0,
      totalPoints: getPlayerQuestStats(db).totalPoints,
    };
  }

  await ensureSearchIndexForElementIds(
    db,
    discoveredRows.map((row) => row.id)
  );

  const discoveredNames = new Set(discoveredRows.map((row) => row.normalizedName));
  const embeddingsById = loadEmbeddingsByElementId(
    db,
    discoveredRows.map((row) => row.id)
  );
  const queryEmbeddings = await getQuestQueryEmbeddings(db, quests);
  const borderlineChecksByCandidate = new Map<
    string,
    { quest: QuestRecord; candidate: string; similarity: number }
  >();
  const newlyCompletedQuestNames: string[] = [];
  const newlyCompletedQuestIds: string[] = [];

  for (const quest of quests) {
    if (discoveredNames.has(quest.normalizedName)) {
      if (logEnabled) {
        console.log("[api][quests] completion exact match", {
          target: quest.name,
          matchedItem: quest.name,
          completed: true,
        });
      }
      markQuestCompleted(db, {
        normalizedName: quest.normalizedName,
        matchedItemName: quest.name,
        completionMethod: "exact",
      });
      newlyCompletedQuestNames.push(quest.name);
      newlyCompletedQuestIds.push(quest.normalizedName);
      continue;
    }

    const queryEmbedding = queryEmbeddings.get(quest.normalizedName);
    if (!queryEmbedding) {
      if (logEnabled) {
        console.log("[api][quests] completion missing embedding", {
          target: quest.name,
          completed: false,
        });
      }
      continue;
    }

    let bestSimilarity = 0;
    let bestMatchName: string | null = null;
    for (const row of discoveredRows) {
      const itemEmbedding = embeddingsById.get(row.id);
      if (!itemEmbedding) continue;
      const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatchName = row.name;
      }
    }

    const completed = bestSimilarity >= QUEST_COMPLETION_SIMILARITY_THRESHOLD;
    if (logEnabled) {
      console.log("[api][quests] completion semantic check", {
        target: quest.name,
        bestMatchName,
        bestSimilarity: Number(bestSimilarity.toFixed(4)),
        threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
        completed,
      });
    }

    if (completed) {
      markQuestCompleted(db, {
        normalizedName: quest.normalizedName,
        matchedItemName: bestMatchName,
        completionMethod: "embedding",
      });
      newlyCompletedQuestNames.push(quest.name);
      newlyCompletedQuestIds.push(quest.normalizedName);
      continue;
    }

    if (
      options?.candidateNames &&
      bestMatchName &&
      bestSimilarity >= QUEST_COMPLETION_JUDGE_THRESHOLD
    ) {
      const candidateKey = normalizeQuestName(bestMatchName);
      const existing = borderlineChecksByCandidate.get(candidateKey);
      if (!existing || bestSimilarity > existing.similarity) {
        borderlineChecksByCandidate.set(candidateKey, {
          quest,
          candidate: bestMatchName,
          similarity: bestSimilarity,
        });
      }
    }
  }

  for (const borderline of borderlineChecksByCandidate.values()) {
    const cacheKey = `${borderline.quest.normalizedName}|${normalizeQuestName(borderline.candidate)}`;
    let judgeDecision = questJudgeDecisionCache.get(cacheKey);
    if (judgeDecision == null) {
      if (logEnabled) {
        console.log("[api][quests] completion judge trigger", {
          target: borderline.quest.name,
          candidate: borderline.candidate,
          similarity: Number(borderline.similarity.toFixed(4)),
          autoThreshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
          judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
        });
      }
      const judgeResult = await judgeQuestCompletionCandidate({
        target: borderline.quest.name,
        candidate: borderline.candidate,
      });
      judgeDecision = judgeResult.match;
      questJudgeDecisionCache.set(cacheKey, judgeDecision);
    } else if (logEnabled) {
      console.log("[api][quests] completion judge cache hit", {
        target: borderline.quest.name,
        candidate: borderline.candidate,
        similarity: Number(borderline.similarity.toFixed(4)),
        match: judgeDecision,
      });
    }

    if (judgeDecision) {
      markQuestCompleted(db, {
        normalizedName: borderline.quest.normalizedName,
        matchedItemName: borderline.candidate,
        completionMethod: "judge",
      });
      newlyCompletedQuestNames.push(borderline.quest.name);
      newlyCompletedQuestIds.push(borderline.quest.normalizedName);
    }

    if (logEnabled) {
      console.log("[api][quests] completion judge result", {
        target: borderline.quest.name,
        candidate: borderline.candidate,
        similarity: Number(borderline.similarity.toFixed(4)),
        match: judgeDecision,
      });
    }
  }

  const questPointAwards = quests
    .filter((quest) => newlyCompletedQuestIds.includes(quest.normalizedName))
    .reduce((sum, quest) => sum + (quest.pointsAwarded || QUEST_POINTS_PER_TARGET), 0);
  const completedQuestSets = completeQuestSetsForQuestIds(db, newlyCompletedQuestIds);
  const setBonusAwards = completedQuestSets.reduce((sum, set) => sum + set.earnedPoints, 0);
  const awardedPoints = questPointAwards + setBonusAwards;
  incrementPlayerPoints(db, awardedPoints);
  const playerStats = getPlayerQuestStats(db);

  if (logEnabled) {
    console.log("[api][quests] completion summary", {
      targetCount: quests.length,
      discoveredCount: discoveredRows.length,
      candidateNameCount: options?.candidateNames?.length ?? 0,
      completedCount: newlyCompletedQuestNames.length,
      completedSetCount: completedQuestSets.length,
      awardedPoints,
      totalPoints: playerStats.totalPoints,
      threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
      judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
    });
  }

  return {
    newlyCompletedQuestNames,
    completedQuestSets,
    awardedPoints,
    totalPoints: playerStats.totalPoints,
  };
}
