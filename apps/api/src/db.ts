import fs from "fs";
import path from "path";
import initSqlJs, { Database } from "sql.js";

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

const sqlJsPromise = initSqlJs({
  locateFile: (file: string) =>
    path.join(__dirname, "..", "..", "..", "node_modules", "sql.js", "dist", file),
});

async function initDatabase(): Promise<Database> {
  const SQL = await sqlJsPromise;
  let db: Database;

  if (fs.existsSync(DB_FILE_PATH)) {
    const fileBuffer = fs.readFileSync(DB_FILE_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  createSchema(db);
  seedBaseElements(db);
  persistDatabase(db);

  return db;
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = initDatabase();
  }
  return dbPromise;
}

export function persistDatabase(db: Database): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
  fs.writeFileSync(DB_FILE_PATH, buffer);
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

  `);

  ensureColumn(db, "elements", "reference_record_id", "INTEGER NULL");
  ensureColumn(db, "item_references", "image_url", "TEXT NULL");
  ensureColumn(db, "player_unlocks", "source_item_name", "TEXT NULL");
  ensureColumn(db, "player_unlocks", "source_matched_word", "TEXT NULL");
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
    const row = stmt.getAsObject() as Record<string, unknown>;
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
  let stmt = db.prepare(
    "SELECT id FROM elements WHERE normalized_name = ?"
  );
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
    const lastIdRow = lastIdStmt.getAsObject() as any;
    elementId = Number(lastIdRow.id);
  }
  lastIdStmt.free();

  if (!elementId || Number.isNaN(elementId)) {
    throw new Error("Failed to obtain element id");
  }

  return elementId;
}

export function discoverElement(db: Database, elementId: number): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO discoveries (element_id) VALUES (?)"
  );
  stmt.run([elementId]);
  stmt.free();
}
