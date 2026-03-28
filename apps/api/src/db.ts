import fs from "fs";
import path from "path";
import BetterSqlite3 from "better-sqlite3";

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
      chosen_candidate_id INTEGER NULL,
      result_element_id INTEGER NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipe_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discoveries (
      element_id INTEGER PRIMARY KEY,
      discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (element_id) REFERENCES elements(id) ON DELETE CASCADE
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
      feature_key TEXT PRIMARY KEY,
      unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      intro_shown_at DATETIME NULL,
      source_item_name TEXT NULL,
      source_matched_word TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL,
      set_id TEXT NULL,
      set_title TEXT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'tracked', 'completed', 'abandoned')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      matched_item_name TEXT NULL,
      completion_method TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS quest_sets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      total_quest_count INTEGER NOT NULL,
      completed_at DATETIME NULL,
      bonus_points_awarded INTEGER NOT NULL DEFAULT 50,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      key TEXT PRIMARY KEY,
      value_integer INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

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

export function discoverElement(db: Database, elementId: number): boolean {
  const stmt = db.prepare("INSERT OR IGNORE INTO discoveries (element_id) VALUES (?)");
  stmt.run([elementId]);
  stmt.free();
  return db.getRowsModified() > 0;
}
