import type { Database } from "./db";

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
  completionMethod: "exact" | "normalized" | null;
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

export interface CompletedQuestMatch {
  questName: string;
  matchedItemName: string;
}

export interface AvailableQuestTargetMatch {
  questName: string;
  matchedItemName: string;
}

export interface PlayerQuestStats {
  totalPoints: number;
}

type QuestMatchRecord = QuestRecord & {
  alternateSpellings: string[];
};

export const QUEST_POINTS_PER_TARGET = 10;

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
  sessionId = "default-room",
  options?: { includeAbandoned?: boolean }
) {
  const includeAbandoned = options?.includeAbandoned ?? false;
  const stmt = db.prepare(
    `
    SELECT name, normalized_name, icon, set_id, set_title, points_awarded, status, matched_item_name, completion_method, created_at, completed_at
    FROM quests
    WHERE session_id = ?
    ${includeAbandoned ? "" : "AND status != 'abandoned'"}
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
    `
  );
  stmt.bind([sessionId]);
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
    sessionId?: string;
  }
) {
  const normalizedName = normalizeQuestName(params.name);
  const stmt = db.prepare(`
    INSERT INTO quests (session_id, name, normalized_name, icon, set_id, set_title, points_awarded, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, normalized_name) DO NOTHING
  `);
  stmt.run([
    params.sessionId ?? "default-room",
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
    sessionId?: string;
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
      sessionId: params.sessionId,
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
  params: {
    sessionId?: string;
    name: string;
    status: Extract<QuestStatus, "available" | "tracked" | "abandoned">;
  }
) {
  const stmt = db.prepare(`
    UPDATE quests
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ? AND normalized_name = ? AND status != 'completed'
  `);
  stmt.run([params.status, params.sessionId ?? "default-room", normalizeQuestName(params.name)]);
  stmt.free();
}

function normalizeQuestLexicalBase(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[&]/g, " and ")
    .replace(/[_/+-]+/g, " ")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuestLexicalBase(value: string) {
  return normalizeQuestLexicalBase(value)
    .split(" ")
    .map((token) => token.replace(/^'+|'+$/g, "").replace(/'/g, ""))
    .filter(Boolean);
}

function maybeRestoreSilentE(stem: string, original: string, suffix: string) {
  if ((suffix === "ing" || suffix === "ed") && !stem.endsWith("e") && /[bcdfghjklmnpqrstvwxyz]$/.test(stem)) {
    if (/[aeiou][bcdfghjklmnpqrstvwxyz](ing|ed)$/.test(original)) {
      return `${stem}e`;
    }
  }
  return stem;
}

function normalizeQuestLexicalToken(token: string) {
  let current = token;
  if (!current) return "";

  if (current.endsWith("ies") && current.length > 4) {
    current = `${current.slice(0, -3)}y`;
  } else if (current.endsWith("ing") && current.length > 5) {
    current = current.slice(0, -3);
    if (/(.)\1$/.test(current)) {
      current = current.slice(0, -1);
    }
    current = maybeRestoreSilentE(current, token, "ing");
  } else if (current.endsWith("ied") && current.length > 4) {
    current = `${current.slice(0, -3)}y`;
  } else if (current.endsWith("ed") && current.length > 4) {
    current = current.slice(0, -2);
    if (/(.)\1$/.test(current)) {
      current = current.slice(0, -1);
    }
    current = maybeRestoreSilentE(current, token, "ed");
  } else if (current.endsWith("est") && current.length > 5) {
    current = current.slice(0, -3);
    if (/(.)\1$/.test(current)) {
      current = current.slice(0, -1);
    }
  } else if (current.endsWith("er") && current.length > 4) {
    current = current.slice(0, -2);
    if (/(.)\1$/.test(current)) {
      current = current.slice(0, -1);
    }
  } else if (current.endsWith("es") && current.length > 4) {
    current = current.slice(0, -2);
  } else if (current.endsWith("s") && current.length > 3) {
    current = current.slice(0, -1);
  }

  return current;
}

function buildQuestLexicalForms(value: string) {
  const baseTokens = tokenizeQuestLexicalBase(value);
  const normalizedTokens = baseTokens.map(normalizeQuestLexicalToken);
  return {
    baseTokens,
    normalizedTokens,
    canonicalKey: baseTokens.join(""),
    normalizedKey: normalizedTokens.join(""),
  };
}

function containsQuestTokenSequence(candidateTokens: string[], questTokens: string[]) {
  if (candidateTokens.length === 0 || questTokens.length === 0) {
    return false;
  }

  if (questTokens.length === 1) {
    return candidateTokens.includes(questTokens[0]);
  }

  for (let startIndex = 0; startIndex <= candidateTokens.length - questTokens.length; startIndex += 1) {
    let matches = true;
    for (let offset = 0; offset < questTokens.length; offset += 1) {
      if (candidateTokens[startIndex + offset] !== questTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}

function findProgrammaticQuestMatch(
  quest: QuestMatchRecord,
  discoveredRows: Array<{ id: number; name: string; normalizedName: string }>
) {
  const questForms = [quest.name, ...quest.alternateSpellings].map((name) =>
    buildQuestLexicalForms(name)
  );
  for (const row of discoveredRows) {
    const candidateForms = buildQuestLexicalForms(row.name);
    for (const questForm of questForms) {
      if (candidateForms.canonicalKey === questForm.canonicalKey) {
        return {
          matchedItemName: row.name,
          completionMethod: "normalized" as const,
        };
      }
      if (
        candidateForms.normalizedKey &&
        candidateForms.normalizedKey === questForm.normalizedKey
      ) {
        return {
          matchedItemName: row.name,
          completionMethod: "normalized" as const,
        };
      }
      if (
        containsQuestTokenSequence(candidateForms.baseTokens, questForm.baseTokens) ||
        containsQuestTokenSequence(
          candidateForms.normalizedTokens,
          questForm.normalizedTokens
        )
      ) {
        return {
          matchedItemName: row.name,
          completionMethod: "normalized" as const,
        };
      }
    }
  }
  return null;
}

function findProgrammaticQuestNameOverlap(
  targetName: string,
  candidateNames: string[]
) {
  const targetForms = buildQuestLexicalForms(targetName);
  for (const candidateName of candidateNames) {
    const candidateForms = buildQuestLexicalForms(candidateName);
    if (candidateForms.canonicalKey === targetForms.canonicalKey) {
      return candidateName;
    }
    if (
      candidateForms.normalizedKey &&
      candidateForms.normalizedKey === targetForms.normalizedKey
    ) {
      return candidateName;
    }
    if (
      containsQuestTokenSequence(candidateForms.baseTokens, targetForms.baseTokens) ||
      containsQuestTokenSequence(candidateForms.normalizedTokens, targetForms.normalizedTokens)
    ) {
      return candidateName;
    }
  }
  return null;
}

export function findAvailableQuestTargetMatch(
  db: Database,
  sessionId: string,
  candidateNames: string[]
): AvailableQuestTargetMatch | null {
  const uniqueCandidateNames = uniqueNormalized(candidateNames);
  if (uniqueCandidateNames.length === 0) {
    return null;
  }

  const quests = loadIncompleteQuests(db, sessionId);
  if (quests.length === 0) {
    return null;
  }

  for (const candidateName of uniqueCandidateNames) {
    const normalizedCandidateName = normalizeQuestName(candidateName);
    const exactQuest = quests.find((quest) => quest.normalizedName === normalizedCandidateName);
    if (exactQuest) {
      return {
        questName: exactQuest.name,
        matchedItemName: candidateName,
      };
    }

    for (const quest of quests) {
      const overlapName = findProgrammaticQuestNameOverlap(candidateName, [
        quest.name,
        ...quest.alternateSpellings,
      ]);
      if (overlapName) {
        return {
          questName: quest.name,
          matchedItemName: candidateName,
        };
      }
    }
  }

  return null;
}

function loadIncompleteQuests(
  db: Database,
  sessionId: string,
  options?: { targetNames?: string[] }
) {
  const targetNames = uniqueNormalized(options?.targetNames ?? []);
  const normalizedTargets = targetNames.map(normalizeQuestName);
  const whereClauses = [`session_id = ?`, `status IN ('available', 'tracked')`];
  if (normalizedTargets.length > 0) {
    whereClauses.push(`normalized_name IN (${normalizedTargets.map(() => "?").join(", ")})`);
  }
  const stmt = db.prepare(`
    SELECT name, normalized_name, icon, set_id, set_title, points_awarded, status, matched_item_name, completion_method, created_at, completed_at
    FROM quests
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
  `);
  const params = [sessionId, ...normalizedTargets];
  if (normalizedTargets.length > 0) {
    stmt.bind(params);
  } else {
    stmt.bind([sessionId]);
  }
  const quests: QuestRecord[] = [];
  while (stmt.step()) {
    quests.push(mapQuestRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  if (quests.length === 0) {
    return [] as QuestMatchRecord[];
  }

  const variantStmt = db.prepare(`
    SELECT quest_normalized_name, variant_name
    FROM quest_target_variants
    WHERE quest_normalized_name IN (${quests.map(() => "?").join(", ")})
    ORDER BY id ASC
  `);
  variantStmt.bind(quests.map((quest) => quest.normalizedName));
  const variantMap = new Map<string, string[]>();
  while (variantStmt.step()) {
    const row = variantStmt.getAsObject() as Record<string, unknown>;
    const normalizedName = String(row.quest_normalized_name ?? "");
    const variantName = String(row.variant_name ?? "").trim();
    if (!normalizedName || !variantName) continue;
    const current = variantMap.get(normalizedName);
    if (current) {
      current.push(variantName);
    } else {
      variantMap.set(normalizedName, [variantName]);
    }
  }
  variantStmt.free();

  return quests.map((quest) => ({
    ...quest,
    alternateSpellings: variantMap.get(quest.normalizedName) ?? [],
  }));
}

function loadDiscoveredRows(
  db: Database,
  sessionId: string,
  options?: { candidateNames?: string[] }
) {
  const candidateNames = uniqueNormalized(options?.candidateNames ?? []);
  const normalizedCandidates = candidateNames.map(normalizeQuestName);
  const whereClauses = ["d.session_id = ?"];
  if (normalizedCandidates.length > 0) {
    whereClauses.push(`e.normalized_name IN (${normalizedCandidates.map(() => "?").join(", ")})`);
  }
  const stmt = db.prepare(`
    SELECT e.id, e.name, e.normalized_name
    FROM session_discoveries d
    JOIN elements e ON e.id = d.element_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY d.discovered_at ASC
  `);
  const params = [sessionId, ...normalizedCandidates];
  if (normalizedCandidates.length > 0) {
    stmt.bind(params);
  } else {
    stmt.bind([sessionId]);
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
  sessionId: string,
  targetNames: string[]
) {
  const uniqueTargets = uniqueNormalized(targetNames);
  if (uniqueTargets.length === 0) {
    return new Set<string>();
  }

  const discoveredRows = loadDiscoveredRows(db, sessionId);
  if (discoveredRows.length === 0) {
    return new Set<string>();
  }

  const discoveredNames = discoveredRows.map((row) => row.name);

  const rejectedTargets = new Set<string>();
  for (const target of uniqueTargets) {
    const overlapName = findProgrammaticQuestNameOverlap(target, discoveredNames);
    if (overlapName) {
      console.log("[api][quests] generation rejected by discovery lexical match", {
        target,
        matchedItemName: overlapName,
      });
      rejectedTargets.add(normalizeQuestName(target));
    }
  }

  return rejectedTargets;
}

export function replaceQuestTargetVariants(
  db: Database,
  params: { questName: string; variants: string[] }
) {
  const questNormalizedName = normalizeQuestName(params.questName);

  const deleteStmt = db.prepare(
    "DELETE FROM quest_target_variants WHERE quest_normalized_name = ?"
  );
  deleteStmt.run([questNormalizedName]);
  deleteStmt.free();

  const insertStmt = db.prepare(`
    INSERT INTO quest_target_variants (
      quest_normalized_name,
      variant_name,
      variant_normalized_name
    ) VALUES (?, ?, ?)
    ON CONFLICT(quest_normalized_name, variant_normalized_name) DO NOTHING
  `);
  const seen = new Set<string>();
  for (const variant of params.variants) {
    const trimmed = variant.trim();
    const normalizedVariant = normalizeQuestName(trimmed);
    if (!normalizedVariant) continue;
    if (normalizedVariant === questNormalizedName) continue;
    if (seen.has(normalizedVariant)) continue;
    seen.add(normalizedVariant);
    insertStmt.run([questNormalizedName, trimmed, normalizedVariant]);
  }
  insertStmt.free();
}

function markQuestCompleted(
  db: Database,
  params: {
    sessionId: string;
    normalizedName: string;
    matchedItemName: string | null;
    completionMethod: "exact" | "normalized";
  }
) {
  const stmt = db.prepare(`
    UPDATE quests
    SET status = 'completed',
        matched_item_name = ?,
        completion_method = ?,
        completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ? AND normalized_name = ? AND status IN ('available', 'tracked')
  `);
  stmt.run([
    params.matchedItemName,
    params.completionMethod,
    params.sessionId,
    params.normalizedName,
  ]);
  stmt.free();
  console.log("[api][quests] quest marked completed", {
    normalizedName: params.normalizedName,
    matchedItemName: params.matchedItemName,
    completionMethod: params.completionMethod,
  });
}

function ensurePlayerStatRow(db: Database, sessionId: string, key: string) {
  const stmt = db.prepare(`
    INSERT INTO player_stats (session_id, key, value_integer, updated_at)
    VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, key) DO NOTHING
  `);
  stmt.run([sessionId, key]);
  stmt.free();
}

function calculateQuestPointsSeedTotal(db: Database, sessionId: string) {
  const stmt = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(points_awarded) FROM quests WHERE session_id = ? AND status = 'completed'), 0)
      AS total_points
  `);
  stmt.bind([sessionId]);
  const row = stmt.step()
    ? (stmt.getAsObject() as Record<string, unknown>)
    : { total_points: 0 };
  stmt.free();
  return Number(row.total_points ?? 0);
}

function seedPlayerQuestPoints(db: Database, sessionId: string) {
  const totalPoints = calculateQuestPointsSeedTotal(db, sessionId);
  const stmt = db.prepare(`
    INSERT INTO player_stats (session_id, key, value_integer, updated_at)
    VALUES (?, 'quest_points_total', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, key) DO UPDATE SET value_integer = excluded.value_integer, updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run([sessionId, totalPoints]);
  stmt.free();
  console.log("[api][quests] seeded player quest points", {
    totalPoints,
  });
  return totalPoints;
}

function repairPlayerQuestPointsIfNeeded(
  db: Database,
  sessionId: string,
  currentTotalPoints: number
) {
  const seededTotalPoints = calculateQuestPointsSeedTotal(db, sessionId);
  if (currentTotalPoints >= seededTotalPoints) {
    return currentTotalPoints;
  }
  const stmt = db.prepare(`
    UPDATE player_stats
    SET value_integer = ?, updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ? AND key = 'quest_points_total'
  `);
  stmt.run([seededTotalPoints, sessionId]);
  stmt.free();
  console.log("[api][quests] repaired player quest points", {
    previousTotalPoints: currentTotalPoints,
    repairedTotalPoints: seededTotalPoints,
  });
  return seededTotalPoints;
}

function incrementPlayerPoints(db: Database, sessionId: string, points: number) {
  const currentTotalPoints = getPlayerQuestStats(db, sessionId).totalPoints;
  const repairedTotalPoints = repairPlayerQuestPointsIfNeeded(db, sessionId, currentTotalPoints);
  if (points <= 0) {
    console.log("[api][quests] increment skipped", {
      currentTotalPoints: repairedTotalPoints,
      addedPoints: points,
    });
    return;
  }
  ensurePlayerStatRow(db, sessionId, "quest_points_total");
  const stmt = db.prepare(`
    UPDATE player_stats
    SET value_integer = value_integer + ?, updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ? AND key = 'quest_points_total'
  `);
  stmt.run([points, sessionId]);
  stmt.free();
  const nextTotalPoints = getPlayerQuestStats(db, sessionId).totalPoints;
  console.log("[api][quests] incremented player quest points", {
    previousTotalPoints: repairedTotalPoints,
    addedPoints: points,
    nextTotalPoints,
  });
}

export function getPlayerQuestStats(db: Database, sessionId = "default-room"): PlayerQuestStats {
  const stmt = db.prepare(
    "SELECT value_integer FROM player_stats WHERE session_id = ? AND key = 'quest_points_total'"
  );
  stmt.bind([sessionId]);
  const row = stmt.step()
    ? (stmt.getAsObject() as Record<string, unknown>)
    : {};
  stmt.free();
  if (row.value_integer != null) {
    const totalPoints = repairPlayerQuestPointsIfNeeded(
      db,
      sessionId,
      Number(row.value_integer ?? 0)
    );
    console.log("[api][quests] loaded player quest points", {
      totalPoints,
    });
    return {
      totalPoints,
    };
  }

  return {
    totalPoints: seedPlayerQuestPoints(db, sessionId),
  };
}

export function createQuestSet(
  db: Database,
  params: {
    id: string;
    sessionId?: string;
    title: string;
    topic: string;
    totalQuestCount: number;
  }
) {
  const stmt = db.prepare(`
    INSERT INTO quest_sets (id, session_id, title, topic, total_quest_count, bonus_points_awarded, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  stmt.run([
    params.id,
    params.sessionId ?? "default-room",
    params.title,
    params.topic,
    params.totalQuestCount,
    0,
  ]);
  stmt.free();
}

export async function syncQuestCompletions(
  db: Database,
  sessionId = "default-room",
  options?: {
    candidateNames?: string[];
    targetNames?: string[];
    log?: boolean;
  }
) {
  const logEnabled = options?.log ?? true;
  const quests = loadIncompleteQuests(db, sessionId, { targetNames: options?.targetNames });
  if (quests.length === 0) {
    return {
      newlyCompletedQuestNames: [] as string[],
      completedQuestMatches: [] as CompletedQuestMatch[],
      completedQuestSets: [] as CompletedQuestSet[],
      awardedPoints: 0,
      totalPoints: getPlayerQuestStats(db, sessionId).totalPoints,
    };
  }

  const discoveredRows = loadDiscoveredRows(db, sessionId, {
    candidateNames: options?.candidateNames,
  });
  if (discoveredRows.length === 0) {
    if (logEnabled) {
      console.log("[api][quests] completion check", {
        targetCount: quests.length,
        discoveredCount: 0,
        candidateNameCount: options?.candidateNames?.length ?? 0,
      });
    }
    return {
      newlyCompletedQuestNames: [] as string[],
      completedQuestMatches: [] as CompletedQuestMatch[],
      completedQuestSets: [] as CompletedQuestSet[],
      awardedPoints: 0,
      totalPoints: getPlayerQuestStats(db, sessionId).totalPoints,
    };
  }

  const discoveredNames = new Set(discoveredRows.map((row) => row.normalizedName));
  const newlyCompletedQuestNames: string[] = [];
  const newlyCompletedQuestIds: string[] = [];
  const completedQuestMatches: CompletedQuestMatch[] = [];

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
        sessionId,
        normalizedName: quest.normalizedName,
        matchedItemName: quest.name,
        completionMethod: "exact",
      });
      newlyCompletedQuestNames.push(quest.name);
      newlyCompletedQuestIds.push(quest.normalizedName);
      completedQuestMatches.push({
        questName: quest.name,
        matchedItemName: quest.name,
      });
      continue;
    }

    const programmaticMatch = findProgrammaticQuestMatch(quest, discoveredRows);
    if (logEnabled) {
      console.log("[api][quests] completion programmatic check", {
        target: quest.name,
        matchedItemName: programmaticMatch?.matchedItemName ?? null,
        completed: programmaticMatch != null,
      });
    }

    if (programmaticMatch) {
      markQuestCompleted(db, {
        sessionId,
        normalizedName: quest.normalizedName,
        matchedItemName: programmaticMatch.matchedItemName,
        completionMethod: programmaticMatch.completionMethod,
      });
      newlyCompletedQuestNames.push(quest.name);
      newlyCompletedQuestIds.push(quest.normalizedName);
      completedQuestMatches.push({
        questName: quest.name,
        matchedItemName: programmaticMatch.matchedItemName,
      });
    }
  }

  const questPointAwards = quests
    .filter((quest) => newlyCompletedQuestIds.includes(quest.normalizedName))
    .reduce((sum, quest) => sum + (quest.pointsAwarded || QUEST_POINTS_PER_TARGET), 0);
  const completedQuestSets: CompletedQuestSet[] = [];
  const awardedPoints = questPointAwards;
  incrementPlayerPoints(db, sessionId, awardedPoints);
  const totalPoints = getPlayerQuestStats(db, sessionId).totalPoints;

  if (logEnabled) {
    console.log("[api][quests] completion summary", {
      completedQuestNames: newlyCompletedQuestNames,
      targetCount: quests.length,
      discoveredCount: discoveredRows.length,
      candidateNameCount: options?.candidateNames?.length ?? 0,
      completedCount: newlyCompletedQuestNames.length,
      completedSetCount: completedQuestSets.length,
      awardedPoints,
      totalPoints,
    });
  }

  return {
    newlyCompletedQuestNames,
    completedQuestMatches,
    completedQuestSets,
    awardedPoints,
    totalPoints,
  };
}
