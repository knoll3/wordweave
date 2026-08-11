import { randomUUID } from "crypto";
import type { Request } from "express";
import type { Database } from "./db";
import { BASE_ELEMENT_NORMALIZED_NAMES } from "./db";
import { DEFAULT_ROOM_ID } from "./boardState";

export const SESSION_ID_HEADER = "x-wordweave-session-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  discoveredCount: number;
};

export function isValidSessionId(value: string) {
  return UUID_PATTERN.test(value);
}

export function getRequestSessionId(req: Request) {
  const headerValue = req.header(SESSION_ID_HEADER);
  const queryValue = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const candidate = (headerValue || queryValue || "").trim();
  return isValidSessionId(candidate) ? candidate : null;
}

function mapSessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? "Untitled session"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    discoveredCount: Number(row.discovered_count ?? 0),
  };
}

export function ensureSession(db: Database, sessionId: string, name?: string) {
  if (!isValidSessionId(sessionId)) {
    throw new Error("Invalid session id");
  }

  const insertSessionStmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  insertSessionStmt.run([sessionId, name?.trim() || "Untitled session"]);
  insertSessionStmt.free();

  const insertRoomStmt = db.prepare(`
    INSERT OR IGNORE INTO rooms (id, created_at, updated_at)
    VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  insertRoomStmt.run([sessionId]);
  insertRoomStmt.free();

  seedSessionBaseDiscoveries(db, sessionId);
}

export function createSession(db: Database, name?: string) {
  const sessionId = randomUUID();
  ensureSession(db, sessionId, name);
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error("Failed to create session");
  }
  return session;
}

export function getSession(db: Database, sessionId: string) {
  ensureSession(db, sessionId);
  const stmt = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.created_at,
      s.updated_at,
      COUNT(sd.element_id) AS discovered_count
    FROM sessions s
    LEFT JOIN session_discoveries sd ON sd.session_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
  `);
  const row = stmt.getAsObject([sessionId]) as Record<string, unknown>;
  stmt.free();
  return row.id == null ? null : mapSessionRow(row);
}

export function listSessionsById(db: Database, sessionIds: string[]) {
  const uniqueSessionIds = Array.from(
    new Set(sessionIds.map((id) => id.trim()).filter(isValidSessionId))
  );
  if (uniqueSessionIds.length === 0) {
    return [];
  }

  uniqueSessionIds.forEach((sessionId) => ensureSession(db, sessionId));
  const stmt = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.created_at,
      s.updated_at,
      COUNT(sd.element_id) AS discovered_count
    FROM sessions s
    LEFT JOIN session_discoveries sd ON sd.session_id = s.id
    WHERE s.id IN (${uniqueSessionIds.map(() => "?").join(", ")})
    GROUP BY s.id
  `);
  stmt.bind(uniqueSessionIds);
  const rows: SessionRecord[] = [];
  while (stmt.step()) {
    rows.push(mapSessionRow(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

export function updateSessionName(db: Database, sessionId: string, name: string) {
  ensureSession(db, sessionId);
  const nextName = name.trim() || "Untitled session";
  const stmt = db.prepare(`
    UPDATE sessions
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run([nextName, sessionId]);
  stmt.free();
  return getSession(db, sessionId);
}

export function seedSessionBaseDiscoveries(db: Database, sessionId: string) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_discoveries (session_id, element_id)
    SELECT ?, id FROM elements WHERE normalized_name = ?
  `);
  for (const normalizedName of BASE_ELEMENT_NORMALIZED_NAMES) {
    stmt.run([sessionId, normalizedName]);
  }
  stmt.free();
}

export function discoverElementForSession(
  db: Database,
  sessionId: string,
  elementId: number
) {
  ensureSession(db, sessionId);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_discoveries (session_id, element_id)
    VALUES (?, ?)
  `);
  stmt.run([sessionId, elementId]);
  stmt.free();
  return db.getRowsModified() > 0;
}

function getAppMetaValue(db: Database, key: string) {
  const stmt = db.prepare("SELECT value_text FROM app_meta WHERE key = ?");
  const row = stmt.getAsObject([key]) as Record<string, unknown>;
  stmt.free();
  return row.value_text == null ? null : String(row.value_text);
}

function setAppMetaValue(db: Database, key: string, value: string) {
  const stmt = db.prepare(`
    INSERT INTO app_meta (key, value_text, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text, updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run([key, value]);
  stmt.free();
}

function hasLegacySessionState(db: Database, sessionId: string) {
  const countQueries = [
    "SELECT COUNT(*) AS total FROM session_discoveries WHERE session_id = ?",
    "SELECT COUNT(*) AS total FROM room_board_items WHERE room_id = ?",
    "SELECT COUNT(*) AS total FROM quests WHERE session_id = ?",
    "SELECT COUNT(*) AS total FROM player_unlocks WHERE session_id = ?",
    "SELECT COUNT(*) AS total FROM player_stats WHERE session_id = ?",
  ];

  const discoveriesStmt = db.prepare(countQueries[0]);
  const discoveriesRow = discoveriesStmt.getAsObject([sessionId]) as Record<string, unknown>;
  discoveriesStmt.free();
  const discoveredCount = Number(discoveriesRow.total ?? 0);
  if (discoveredCount > BASE_ELEMENT_NORMALIZED_NAMES.length) {
    return true;
  }

  for (const query of countQueries.slice(1)) {
    const stmt = db.prepare(query);
    const row = stmt.getAsObject([sessionId]) as Record<string, unknown>;
    stmt.free();
    if (Number(row.total ?? 0) > 0) {
      return true;
    }
  }

  return false;
}

function copySessionDiscoveries(db: Database, sourceSessionId: string, targetSessionId: string) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_discoveries (session_id, element_id, discovered_at)
    SELECT ?, element_id, discovered_at
    FROM session_discoveries
    WHERE session_id = ?
  `);
  stmt.run([targetSessionId, sourceSessionId]);
  stmt.free();
}

function copySessionBoardItems(db: Database, sourceSessionId: string, targetSessionId: string) {
  const stmt = db.prepare(`
    SELECT
      id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision,
      created_at,
      updated_at
    FROM room_board_items
    WHERE room_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  stmt.bind([sourceSessionId]);

  const insertStmt = db.prepare(`
    INSERT INTO room_board_items (
      id,
      room_id,
      item_id,
      position_x,
      position_y,
      is_new_discovery,
      arrival_highlight_mode,
      category_constraint_name,
      category_constraint_normalized_name,
      action_constraint_name,
      action_constraint_normalized_name,
      revision,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    insertStmt.run([
      randomUUID(),
      targetSessionId,
      Number(row.item_id),
      Number(row.position_x),
      Number(row.position_y),
      Number(row.is_new_discovery ?? 0),
      row.arrival_highlight_mode == null ? null : String(row.arrival_highlight_mode),
      row.category_constraint_name == null ? null : String(row.category_constraint_name),
      row.category_constraint_normalized_name == null
        ? null
        : String(row.category_constraint_normalized_name),
      row.action_constraint_name == null ? null : String(row.action_constraint_name),
      row.action_constraint_normalized_name == null
        ? null
        : String(row.action_constraint_normalized_name),
      Number(row.revision ?? 1),
      String(row.created_at),
      String(row.updated_at),
    ]);
  }

  insertStmt.free();
  stmt.free();
}

function copyQuestSetsAndQuests(db: Database, sourceSessionId: string, targetSessionId: string) {
  const setIdMap = new Map<string, string>();
  const setStmt = db.prepare(`
    SELECT id, title, topic, total_quest_count, completed_at, bonus_points_awarded, created_at, updated_at
    FROM quest_sets
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  setStmt.bind([sourceSessionId]);

  const insertSetStmt = db.prepare(`
    INSERT INTO quest_sets (
      id,
      session_id,
      title,
      topic,
      total_quest_count,
      completed_at,
      bonus_points_awarded,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  while (setStmt.step()) {
    const row = setStmt.getAsObject() as Record<string, unknown>;
    const sourceSetId = String(row.id);
    const targetSetId = randomUUID();
    setIdMap.set(sourceSetId, targetSetId);
    insertSetStmt.run([
      targetSetId,
      targetSessionId,
      String(row.title),
      String(row.topic),
      Number(row.total_quest_count),
      row.completed_at == null ? null : String(row.completed_at),
      Number(row.bonus_points_awarded ?? 0),
      String(row.created_at),
      String(row.updated_at),
    ]);
  }

  insertSetStmt.free();
  setStmt.free();

  const questStmt = db.prepare(`
    SELECT
      name,
      normalized_name,
      icon,
      set_id,
      set_title,
      points_awarded,
      status,
      created_at,
      updated_at,
      completed_at,
      matched_item_name,
      completion_method
    FROM quests
    WHERE session_id = ?
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
  `);
  questStmt.bind([sourceSessionId]);

  const insertQuestStmt = db.prepare(`
    INSERT INTO quests (
      session_id,
      name,
      normalized_name,
      icon,
      set_id,
      set_title,
      points_awarded,
      status,
      created_at,
      updated_at,
      completed_at,
      matched_item_name,
      completion_method
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  while (questStmt.step()) {
    const row = questStmt.getAsObject() as Record<string, unknown>;
    const sourceSetId = row.set_id == null ? null : String(row.set_id);
    insertQuestStmt.run([
      targetSessionId,
      String(row.name),
      String(row.normalized_name),
      String(row.icon),
      sourceSetId == null ? null : (setIdMap.get(sourceSetId) ?? null),
      row.set_title == null ? null : String(row.set_title),
      Number(row.points_awarded ?? 10),
      String(row.status ?? "available"),
      String(row.created_at),
      String(row.updated_at),
      row.completed_at == null ? null : String(row.completed_at),
      row.matched_item_name == null ? null : String(row.matched_item_name),
      row.completion_method == null ? null : String(row.completion_method),
    ]);
  }

  insertQuestStmt.free();
  questStmt.free();
}

function copySessionUnlocksAndStats(db: Database, sourceSessionId: string, targetSessionId: string) {
  const unlockStmt = db.prepare(`
    INSERT OR IGNORE INTO player_unlocks (
      session_id,
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    )
    SELECT
      ?,
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    FROM player_unlocks
    WHERE session_id = ?
  `);
  unlockStmt.run([targetSessionId, sourceSessionId]);
  unlockStmt.free();

  const statsStmt = db.prepare(`
    INSERT OR REPLACE INTO player_stats (session_id, key, value_integer, updated_at)
    SELECT ?, key, value_integer, updated_at
    FROM player_stats
    WHERE session_id = ?
  `);
  statsStmt.run([targetSessionId, sourceSessionId]);
  statsStmt.free();
}

export function getMigratedDefaultRoomSessionId(db: Database) {
  return (
    getAppMetaValue(db, "legacy_primary_session_id") ??
    getAppMetaValue(db, "migrated_default_room_session_id")
  );
}

export function getMigratedDefaultRoomSession(db: Database) {
  const sessionId = getMigratedDefaultRoomSessionId(db);
  if (!sessionId) {
    return null;
  }
  return getSession(db, sessionId);
}

export function ensureMigratedDefaultRoomSession(db: Database) {
  const existingSessionId = getMigratedDefaultRoomSessionId(db);
  if (existingSessionId) {
    setAppMetaValue(db, "migrated_default_room_session_id", existingSessionId);
    return getSession(db, existingSessionId);
  }

  if (!hasLegacySessionState(db, DEFAULT_ROOM_ID)) {
    return null;
  }

  const targetSessionId = randomUUID();
  ensureSession(db, targetSessionId, "Imported Legacy Session");

  db.run("BEGIN");
  try {
    copySessionDiscoveries(db, DEFAULT_ROOM_ID, targetSessionId);
    copySessionBoardItems(db, DEFAULT_ROOM_ID, targetSessionId);
    copyQuestSetsAndQuests(db, DEFAULT_ROOM_ID, targetSessionId);
    copySessionUnlocksAndStats(db, DEFAULT_ROOM_ID, targetSessionId);
    setAppMetaValue(db, "migrated_default_room_session_id", targetSessionId);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return getSession(db, targetSessionId);
}
