import type { Database } from "sql.js";
import { DEFAULT_EMBEDDING_MODEL_NAME, generateEmbeddings, judgeQuestCompletionCandidate } from "./openaiClient";
import { ensureSearchIndexForElementIds } from "./search";

export type QuestStatus = "available" | "tracked" | "completed" | "abandoned";

export interface QuestRecord {
  name: string;
  normalizedName: string;
  icon: string;
  status: QuestStatus;
  matchedItemName: string | null;
  completionMethod: "exact" | "embedding" | "judge" | null;
  createdAt: string | null;
  completedAt: string | null;
}

export const QUEST_COMPLETION_SIMILARITY_THRESHOLD = 0.865;
export const QUEST_COMPLETION_JUDGE_THRESHOLD = 0.7;

const questJudgeDecisionCache = new Map<string, boolean>();

export function normalizeQuestName(value: string) {
  return value.trim().toLowerCase();
}

export function uniqueNormalized(values: string[]) {
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
    SELECT name, normalized_name, icon, status, matched_item_name, completion_method, created_at, completed_at
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
  params: { name: string; icon: string; status?: QuestStatus }
) {
  const normalizedName = normalizeQuestName(params.name);
  const stmt = db.prepare(`
    INSERT INTO quests (name, normalized_name, icon, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO NOTHING
  `);
  stmt.run([params.name.trim(), normalizedName, params.icon.trim(), params.status ?? "available"]);
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

function buildSearchText(name: string) {
  return `Item: ${name.trim()}`;
}

function cosine(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
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
    SELECT name, normalized_name, icon, status, matched_item_name, completion_method, created_at, completed_at
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

function loadEmbeddingsByElementId(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) return new Map<number, number[]>();
  const stmt = db.prepare(`
    SELECT element_id, embedding_json
    FROM element_embeddings
    WHERE element_id IN (${elementIds.map(() => "?").join(", ")})
  `);
  stmt.bind(elementIds);
  const embeddings = new Map<number, number[]>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    embeddings.set(Number(row.element_id), JSON.parse(String(row.embedding_json)) as number[]);
  }
  stmt.free();
  return embeddings;
}

function loadQueryEmbedding(db: Database, queryText: string) {
  const stmt = db.prepare(`
    SELECT embedding_json
    FROM search_query_embeddings
    WHERE query_text = ?
  `);
  const row = stmt.getAsObject([queryText]) as Record<string, unknown>;
  stmt.free();
  if (row.embedding_json == null) return null;
  return JSON.parse(String(row.embedding_json)) as number[];
}

function saveQueryEmbedding(
  db: Database,
  queryText: string,
  model: string,
  embedding: number[]
) {
  const stmt = db.prepare(`
    INSERT INTO search_query_embeddings (query_text, model, embedding_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(query_text) DO UPDATE SET
      model = excluded.model,
      embedding_json = excluded.embedding_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run([queryText, model, JSON.stringify(embedding)]);
  stmt.free();
}

async function getQuestQueryEmbeddings(db: Database, quests: QuestRecord[]) {
  const embeddings = new Map<string, number[]>();
  const missingQuests: QuestRecord[] = [];

  for (const quest of quests) {
    const queryText = buildSearchText(quest.name);
    const cached = loadQueryEmbedding(db, queryText);
    if (cached) {
      embeddings.set(quest.normalizedName, cached);
    } else {
      missingQuests.push(quest);
    }
  }

  if (missingQuests.length > 0) {
    const response = await generateEmbeddings(
      missingQuests.map((quest) => buildSearchText(quest.name))
    );
    response.embeddings.forEach((entry, index) => {
      const quest = missingQuests[index];
      embeddings.set(quest.normalizedName, entry.embedding);
      saveQueryEmbedding(
        db,
        buildSearchText(quest.name),
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
    return { newlyCompletedQuestNames: [] as string[] };
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
    return { newlyCompletedQuestNames: [] as string[] };
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
      const similarity = cosine(queryEmbedding, itemEmbedding);
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

  if (logEnabled) {
    console.log("[api][quests] completion summary", {
      targetCount: quests.length,
      discoveredCount: discoveredRows.length,
      candidateNameCount: options?.candidateNames?.length ?? 0,
      completedCount: newlyCompletedQuestNames.length,
      threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
      judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
    });
  }

  return { newlyCompletedQuestNames };
}
