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
      icon TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
