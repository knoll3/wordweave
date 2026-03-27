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

function normalizeLexicalJudgeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function collectLexicalRoots(value: string) {
  const normalized = normalizeLexicalJudgeText(value);
  const queue = [normalized];
  const roots = new Set<string>(normalized ? [normalized] : []);
  const suffixes = ["ing", "ed", "es", "s", "er", "est", "ly", "ness", "ment", "tion", "ions"];

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const suffix of suffixes) {
      if (current.length <= suffix.length + 2 || !current.endsWith(suffix)) {
        continue;
      }
      const next = current.slice(0, -suffix.length);
      if (next.length < 3 || roots.has(next)) {
        continue;
      }
      roots.add(next);
      queue.push(next);
    }
    if (current.endsWith("ies") && current.length > 5) {
      const next = `${current.slice(0, -3)}y`;
      if (!roots.has(next)) {
        roots.add(next);
        queue.push(next);
      }
    }
  }

  return roots;
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function isLexicallyCloseForQuestJudge(target: string, candidate: string) {
  const normalizedTarget = normalizeLexicalJudgeText(target);
  const normalizedCandidate = normalizeLexicalJudgeText(candidate);
  if (!normalizedTarget || !normalizedCandidate) {
    return false;
  }
  if (normalizedTarget === normalizedCandidate) {
    return true;
  }

  const targetRoots = collectLexicalRoots(target);
  const candidateRoots = collectLexicalRoots(candidate);
  for (const root of targetRoots) {
    if (candidateRoots.has(root)) {
      return true;
    }
  }

  const shorterLength = Math.min(normalizedTarget.length, normalizedCandidate.length);
  const longerLength = Math.max(normalizedTarget.length, normalizedCandidate.length);
  if (
    longerLength - shorterLength <= 4 &&
    (normalizedTarget.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedTarget))
  ) {
    return true;
  }

  const prefixLength = commonPrefixLength(normalizedTarget, normalizedCandidate);
  const distance = levenshteinDistance(normalizedTarget, normalizedCandidate);
  const maxDistance =
    longerLength <= 5 ? 1 : longerLength <= 10 ? 2 : 3;

  return prefixLength >= Math.max(3, Math.floor(shorterLength / 2)) && distance <= maxDistance;
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
      continue;
    }

    if (
      options?.candidateNames &&
      bestMatchName &&
      bestSimilarity >= QUEST_COMPLETION_JUDGE_THRESHOLD
    ) {
      const lexicalGatePassed = isLexicallyCloseForQuestJudge(quest.name, bestMatchName);
      if (lexicalGatePassed) {
        const candidateKey = normalizeQuestName(bestMatchName);
        const existing = borderlineChecksByCandidate.get(candidateKey);
        if (!existing || bestSimilarity > existing.similarity) {
          borderlineChecksByCandidate.set(candidateKey, {
            quest,
            candidate: bestMatchName,
            similarity: bestSimilarity,
          });
        }
      } else if (logEnabled) {
        console.log("[api][quests] completion judge skipped by lexical gate", {
          target: quest.name,
          candidate: bestMatchName,
          similarity: Number(bestSimilarity.toFixed(4)),
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
