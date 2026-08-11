import fs from "fs";
import path from "path";
import BetterSqlite3 from "better-sqlite3";
import { ensureDefaultRoom } from "./boardState";

type RowObject = Record<string, unknown>;

export class Statement {
  private boundParams: unknown[] = [];
  private rows: RowObject[] | null = null;
  private rowIndex = -1;

  constructor(
    private readonly db: Database,
    private readonly statement: BetterSqlite3.Statement
  ) {}

  bind(params: unknown[] = []) {
    this.boundParams = params;
    this.rows = null;
    this.rowIndex = -1;
  }

  step() {
    if (this.rows == null) {
      this.rows = this.statement.all(...this.boundParams) as RowObject[];
      this.rowIndex = -1;
    }
    if (this.rowIndex + 1 >= this.rows.length) {
      return false;
    }
    this.rowIndex += 1;
    return true;
  }

  getAsObject(params?: unknown[]) {
    if (params) {
      return (this.statement.get(...params) as RowObject | undefined) ?? {};
    }
    if (this.rows == null || this.rowIndex < 0 || this.rowIndex >= this.rows.length) {
      return {};
    }
    return this.rows[this.rowIndex];
  }

  run(params: unknown[] = []) {
    const result = this.statement.run(...params);
    this.db.setLastChanges(result.changes);
  }

  free() {
    this.rows = null;
    this.rowIndex = -1;
    this.boundParams = [];
  }
}

export class Database {
  private lastChanges = 0;

  constructor(private readonly raw: BetterSqlite3.Database) {}

  prepare(sql: string) {
    return new Statement(this, this.raw.prepare(sql));
  }

  run(sql: string) {
    this.raw.exec(sql);
    this.lastChanges = 0;
  }

  pragma(value: string) {
    this.raw.pragma(value);
  }

  getRowsModified() {
    return this.lastChanges;
  }

  setLastChanges(changes: number) {
    this.lastChanges = changes;
  }
}

const DB_FILE_PATH = path.join(__dirname, "..", "data", "craft.db");
export const BASE_ELEMENTS: { name: string; icon: string }[] = [
  { name: "Fire", icon: "🔥" },
  { name: "Water", icon: "💧" },
  { name: "Earth", icon: "🌍" },
  { name: "Air", icon: "💨" },
];
export const BASE_ELEMENT_NORMALIZED_NAMES = BASE_ELEMENTS.map((el) =>
  normalizeName(el.name)
);

let dbPromise: Promise<Database> | null = null;

async function initDatabase(): Promise<Database> {
  fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
  const rawDb = new BetterSqlite3(DB_FILE_PATH);
  const db = new Database(rawDb);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  createSchema(db);
  seedBaseElements(db);
  ensureDefaultRoom(db);

  return db;
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = initDatabase();
  }
  return dbPromise;
}

export function persistDatabase(_db: Database): void {
  // Native SQLite writes changes directly to disk. No snapshot export is needed.
}

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS elements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      reference_record_id INTEGER NULL,
      icon TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      lookup_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'resolved',
      title TEXT NULL,
      summary TEXT NULL,
      image_url TEXT NULL,
      source_url TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_key TEXT NOT NULL UNIQUE,
      input_display_json TEXT NOT NULL,
      result_element_id INTEGER NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS combination_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NULL,
      result_element_id INTEGER NOT NULL,
      input_key TEXT NOT NULL,
      input_display_json TEXT NOT NULL,
      chosen_name TEXT NOT NULL,
      chosen_icon TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL,
      FOREIGN KEY (result_element_id) REFERENCES elements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discoveries (
      element_id INTEGER PRIMARY KEY,
      discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (element_id) REFERENCES elements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Untitled session',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_discoveries (
      session_id TEXT NOT NULL,
      element_id INTEGER NOT NULL,
      discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, element_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (element_id) REFERENCES elements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value_text TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      invite_code TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS room_board_items (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      is_new_discovery INTEGER NOT NULL DEFAULT 0,
      arrival_highlight_mode TEXT NULL CHECK(arrival_highlight_mode IN ('library', 'combine')),
      category_constraint_name TEXT NULL,
      category_constraint_normalized_name TEXT NULL,
      action_constraint_name TEXT NULL,
      action_constraint_normalized_name TEXT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS element_embeddings (
      element_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      search_text TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (element_id) REFERENCES elements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_query_embeddings (
      query_text TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS player_unlocks (
      session_id TEXT NOT NULL DEFAULT 'default-room',
      feature_key TEXT NOT NULL,
      unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      intro_shown_at DATETIME NULL,
      source_item_name TEXT NULL,
      source_matched_word TEXT NULL,
      PRIMARY KEY (session_id, feature_key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL DEFAULT 'default-room',
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      icon TEXT NOT NULL,
      set_id TEXT NULL,
      set_title TEXT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'tracked', 'completed', 'abandoned')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      matched_item_name TEXT NULL,
      completion_method TEXT NULL,
      UNIQUE(session_id, normalized_name),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quest_sets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT 'default-room',
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      total_quest_count INTEGER NOT NULL,
      completed_at DATETIME NULL,
      bonus_points_awarded INTEGER NOT NULL DEFAULT 50,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quest_target_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_normalized_name TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      variant_normalized_name TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(quest_normalized_name, variant_normalized_name),
      FOREIGN KEY (quest_normalized_name) REFERENCES quests(normalized_name) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      session_id TEXT NOT NULL DEFAULT 'default-room',
      key TEXT NOT NULL,
      value_integer INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, "player_unlocks", "session_id", "TEXT NOT NULL DEFAULT 'default-room'");
  ensureColumn(db, "quests", "session_id", "TEXT NOT NULL DEFAULT 'default-room'");
  ensureColumn(db, "quest_sets", "session_id", "TEXT NOT NULL DEFAULT 'default-room'");
  ensureColumn(db, "player_stats", "session_id", "TEXT NOT NULL DEFAULT 'default-room'");
  ensureColumn(db, "elements", "reference_record_id", "INTEGER NULL");
  ensureColumn(db, "item_references", "image_url", "TEXT NULL");
  ensureColumn(db, "player_unlocks", "source_item_name", "TEXT NULL");
  ensureColumn(db, "player_unlocks", "source_matched_word", "TEXT NULL");
  ensureColumn(db, "quests", "matched_item_name", "TEXT NULL");
  ensureColumn(db, "quests", "completion_method", "TEXT NULL");
  ensureColumn(db, "quests", "completed_at", "DATETIME NULL");
  ensureColumn(db, "quests", "updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  ensureColumn(db, "quests", "set_id", "TEXT NULL");
  ensureColumn(db, "quests", "set_title", "TEXT NULL");
  ensureColumn(db, "quests", "points_awarded", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn(db, "room_board_items", "is_new_discovery", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(
    db,
    "room_board_items",
    "arrival_highlight_mode",
    "TEXT NULL CHECK(arrival_highlight_mode IN ('library', 'combine'))"
  );
  ensureColumn(db, "room_board_items", "category_constraint_name", "TEXT NULL");
  ensureColumn(db, "room_board_items", "category_constraint_normalized_name", "TEXT NULL");
  ensureColumn(db, "room_board_items", "action_constraint_name", "TEXT NULL");
  ensureColumn(db, "room_board_items", "action_constraint_normalized_name", "TEXT NULL");
  ensureColumn(db, "room_board_items", "revision", "INTEGER NOT NULL DEFAULT 1");

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_combination_runs_result_element ON combination_runs (result_element_id, id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_combination_runs_recipe ON combination_runs (recipe_id, id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_room_board_items_room ON room_board_items (room_id, created_at, id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_session_discoveries_session ON session_discoveries (session_id, discovered_at, element_id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_quests_session_status ON quests (session_id, status, created_at)"
  );

  db.run(`
    INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at)
    VALUES ('default-room', 'Default session', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  db.run(`
    INSERT OR IGNORE INTO session_discoveries (session_id, element_id, discovered_at)
    SELECT 'default-room', element_id, discovered_at
    FROM discoveries
  `);

  removeUnusedSchema(db);
}

function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
  let exists = false;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (String(row.name) === columnName) {
      exists = true;
      break;
    }
  }
  stmt.free();

  if (!exists) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function hasColumn(db: Database, tableName: string, columnName: string) {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
  let exists = false;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (String(row.name) === columnName) {
      exists = true;
      break;
    }
  }
  stmt.free();
  return exists;
}

function getTableSql(db: Database, tableName: string) {
  const stmt = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?");
  const row = stmt.getAsObject([tableName]) as Record<string, unknown>;
  stmt.free();
  return row.sql == null ? "" : String(row.sql);
}

function rebuildRecipesWithoutCandidates(db: Database) {
  if (!hasColumn(db, "recipes", "chosen_candidate_id")) {
    return;
  }

  db.run(`
    CREATE TABLE recipes_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_key TEXT NOT NULL UNIQUE,
      input_display_json TEXT NOT NULL,
      result_element_id INTEGER NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO recipes_new (
      id,
      input_key,
      input_display_json,
      result_element_id,
      created_at,
      updated_at
    )
    SELECT
      id,
      input_key,
      input_display_json,
      result_element_id,
      created_at,
      updated_at
    FROM recipes;

    DROP TABLE recipes;
    ALTER TABLE recipes_new RENAME TO recipes;
  `);
}

function rebuildCombinationRunsWithoutCandidates(db: Database) {
  if (!hasColumn(db, "combination_runs", "chosen_candidate_id")) {
    return;
  }

  db.run(`
    CREATE TABLE combination_runs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NULL,
      result_element_id INTEGER NOT NULL,
      input_key TEXT NOT NULL,
      input_display_json TEXT NOT NULL,
      chosen_name TEXT NOT NULL,
      chosen_icon TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL,
      FOREIGN KEY (result_element_id) REFERENCES elements(id) ON DELETE CASCADE
    );

    INSERT INTO combination_runs_new (
      id,
      recipe_id,
      result_element_id,
      input_key,
      input_display_json,
      chosen_name,
      chosen_icon,
      created_at,
      updated_at
    )
    SELECT
      id,
      recipe_id,
      result_element_id,
      input_key,
      input_display_json,
      chosen_name,
      chosen_icon,
      created_at,
      updated_at
    FROM combination_runs;

    DROP TABLE combination_runs;
    ALTER TABLE combination_runs_new RENAME TO combination_runs;
  `);
}

function removeUnusedSchema(db: Database) {
  db.pragma("foreign_keys = OFF");
  db.run("BEGIN");
  try {
    rebuildPlayerUnlocksForSessions(db);
    rebuildPlayerStatsForSessions(db);
    rebuildQuestsForSessions(db);
    rebuildQuestTargetVariantsWithoutForeignKey(db);
    rebuildQuestSetsForSessions(db);
    rebuildCombinationRunsWithoutCandidates(db);
    rebuildRecipesWithoutCandidates(db);
    db.run(`
      DROP TABLE IF EXISTS recipe_candidates;
      DROP TABLE IF EXISTS recipe_feedback;
      DROP TABLE IF EXISTS recipe_generation_traces;
      DROP TABLE IF EXISTS combination_run_feedback;
      DROP TABLE IF EXISTS combination_run_traces;
      DROP TABLE IF EXISTS completed_quests;
      DROP TABLE IF EXISTS quest_generation_turns;
      DROP TABLE IF EXISTS quest_generation_sessions;
      DROP TABLE IF EXISTS target_quest_history;
      DROP TABLE IF EXISTS semantic_category_memberships;
      DROP TABLE IF EXISTS semantic_categories;
      DROP TABLE IF EXISTS semantic_group_memberships;
      DROP TABLE IF EXISTS semantic_groups;
      DROP TABLE IF EXISTS bible_verses;
    `);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_combination_runs_result_element ON combination_runs (result_element_id, id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_combination_runs_recipe ON combination_runs (recipe_id, id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_session_discoveries_session ON session_discoveries (session_id, discovered_at, element_id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_quests_session_status ON quests (session_id, status, created_at)"
  );
}

function rebuildPlayerUnlocksForSessions(db: Database) {
  const sql = getTableSql(db, "player_unlocks");
  if (sql.includes("PRIMARY KEY (session_id, feature_key)")) {
    return;
  }

  db.run(`
    CREATE TABLE player_unlocks_new (
      session_id TEXT NOT NULL DEFAULT 'default-room',
      feature_key TEXT NOT NULL,
      unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      intro_shown_at DATETIME NULL,
      source_item_name TEXT NULL,
      source_matched_word TEXT NULL,
      PRIMARY KEY (session_id, feature_key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO player_unlocks_new (
      session_id,
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    )
    SELECT
      COALESCE(session_id, 'default-room'),
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    FROM player_unlocks;

    DROP TABLE player_unlocks;
    ALTER TABLE player_unlocks_new RENAME TO player_unlocks;
  `);
}

function rebuildPlayerStatsForSessions(db: Database) {
  const sql = getTableSql(db, "player_stats");
  if (sql.includes("PRIMARY KEY (session_id, key)")) {
    return;
  }

  db.run(`
    CREATE TABLE player_stats_new (
      session_id TEXT NOT NULL DEFAULT 'default-room',
      key TEXT NOT NULL,
      value_integer INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO player_stats_new (session_id, key, value_integer, updated_at)
    SELECT COALESCE(session_id, 'default-room'), key, value_integer, updated_at
    FROM player_stats;

    DROP TABLE player_stats;
    ALTER TABLE player_stats_new RENAME TO player_stats;
  `);
}

function rebuildQuestsForSessions(db: Database) {
  const sql = getTableSql(db, "quests");
  if (sql.includes("UNIQUE(session_id, normalized_name)")) {
    return;
  }

  db.run(`
    CREATE TABLE quests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL DEFAULT 'default-room',
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      icon TEXT NOT NULL,
      set_id TEXT NULL,
      set_title TEXT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'tracked', 'completed', 'abandoned')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      matched_item_name TEXT NULL,
      completion_method TEXT NULL,
      UNIQUE(session_id, normalized_name),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO quests_new (
      id,
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
    SELECT
      id,
      COALESCE(session_id, 'default-room'),
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
    FROM quests;

    DROP TABLE quests;
    ALTER TABLE quests_new RENAME TO quests;
  `);
}

function rebuildQuestSetsForSessions(db: Database) {
  const sql = getTableSql(db, "quest_sets");
  if (sql.includes("session_id TEXT")) {
    return;
  }

  db.run(`
    CREATE TABLE quest_sets_new (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT 'default-room',
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      total_quest_count INTEGER NOT NULL,
      completed_at DATETIME NULL,
      bonus_points_awarded INTEGER NOT NULL DEFAULT 50,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO quest_sets_new (
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
    SELECT
      id,
      COALESCE(session_id, 'default-room'),
      title,
      topic,
      total_quest_count,
      completed_at,
      bonus_points_awarded,
      created_at,
      updated_at
    FROM quest_sets;

    DROP TABLE quest_sets;
    ALTER TABLE quest_sets_new RENAME TO quest_sets;
  `);
}

function rebuildQuestTargetVariantsWithoutForeignKey(db: Database) {
  const sql = getTableSql(db, "quest_target_variants");
  if (!sql.includes("REFERENCES quests")) {
    return;
  }

  db.run(`
    CREATE TABLE quest_target_variants_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_normalized_name TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      variant_normalized_name TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(quest_normalized_name, variant_normalized_name)
    );

    INSERT OR IGNORE INTO quest_target_variants_new (
      id,
      quest_normalized_name,
      variant_name,
      variant_normalized_name,
      created_at
    )
    SELECT
      id,
      quest_normalized_name,
      variant_name,
      variant_normalized_name,
      created_at
    FROM quest_target_variants;

    DROP TABLE quest_target_variants;
    ALTER TABLE quest_target_variants_new RENAME TO quest_target_variants;
  `);
}

function seedBaseElements(db: Database): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO elements (name, normalized_name, icon) VALUES (?, ?, ?);"
  );

  for (const element of BASE_ELEMENTS) {
    stmt.run([element.name, normalizeName(element.name), element.icon]);
  }

  stmt.free();

  const discoverStmt = db.prepare(
    `
    INSERT OR IGNORE INTO discoveries (element_id)
    SELECT id FROM elements WHERE normalized_name = ?
    `
  );

  for (const element of BASE_ELEMENTS) {
    discoverStmt.run([normalizeName(element.name)]);
  }

  discoverStmt.free();
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function ensureElement(
  db: Database,
  params: { name: string; normalizedName: string; icon: string | null }
): number {
  let stmt = db.prepare("SELECT id FROM elements WHERE normalized_name = ?");
  let row = stmt.getAsObject([params.normalizedName]);
  stmt.free();

  if (row && row.id !== undefined) {
    return Number(row.id);
  }

  const insertStmt = db.prepare(
    "INSERT INTO elements (name, normalized_name, icon) VALUES (?, ?, ?)"
  );
  insertStmt.run([params.name, params.normalizedName, params.icon]);
  insertStmt.free();

  const lastIdStmt = db.prepare("SELECT last_insert_rowid() as id");
  let elementId: number | null = null;
  if (lastIdStmt.step()) {
    const lastIdRow = lastIdStmt.getAsObject() as Record<string, unknown>;
    elementId = Number(lastIdRow.id);
  }
  lastIdStmt.free();

  if (!elementId || Number.isNaN(elementId)) {
    throw new Error("Failed to obtain element id");
  }

  return elementId;
}

export function discoverElement(
  db: Database,
  elementId: number,
  sessionId?: string | null
): boolean {
  const stmt = sessionId
    ? db.prepare(
        "INSERT OR IGNORE INTO session_discoveries (session_id, element_id) VALUES (?, ?)"
      )
    : db.prepare("INSERT OR IGNORE INTO discoveries (element_id) VALUES (?)");
  stmt.run(sessionId ? [sessionId, elementId] : [elementId]);
  stmt.free();
  return db.getRowsModified() > 0;
}
