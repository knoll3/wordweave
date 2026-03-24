import type { Database } from "sql.js";
import { generateEmbeddings } from "./openaiClient";
import { ensureSearchIndexForElementIds } from "./search";

export type UnlockKey =
  | "creative"
  | "random_tools"
  | "action";

type UnlockDefinition = {
  key: UnlockKey;
  title: string;
  summary: string;
  acceptedWords: string[];
  similarityThreshold: number;
};

type DiscoveredRow = {
  id: number;
  name: string;
  normalized_name: string;
};

const UNLOCK_DEFINITIONS: UnlockDefinition[] = [
  {
    key: "creative",
    title: "Creative Spark Unlocked",
    summary:
      "Creative Spark adds a catalyst item that pushes combinations toward sillier, wilder, more playful ideas. It can invent fitting names when that makes the result more fun.",
    acceptedWords: [
      "creative",
      "create",
      "creation",
      "creator",
      "idea",
      "ideas",
      "inspiration",
      "imagination",
      "imagine",
      "invent",
      "invention",
      "innovation",
      "design",
      "vision",
      "art",
      "artist",
      "genius",
      "spark",
      "brainstorm",
      "dream",
    ],
    similarityThreshold: 0.82,
  },
  {
    key: "random_tools",
    title: "Category Unlocked",
    summary:
      "Category adds a modifier token that attaches to an item and constrains future results to stay within that item's category.",
    acceptedWords: [
      "category",
      "type",
      "kind",
      "class",
      "group",
      "family",
      "similar",
      "same type",
      "same kind",
      "same category",
      "species",
      "genre",
      "taxonomy",
      "classification",
      "classify",
    ],
    similarityThreshold: 0.82,
  },
  {
    key: "action",
    title: "Action Unlocked",
    summary:
      "Action adds a modifier token that attaches to an item and makes that item act like the action being performed. Some action words also trigger specialized prompt families when they are used as the action anchor.",
    acceptedWords: [
      "action",
      "act",
      "verb",
      "activity",
      "perform",
      "performance",
      "doing",
      "deed",
      "behavior",
      "move",
      "operation",
      "execute",
      "execution",
      "gesture",
      "motion",
    ],
    similarityThreshold: 0.82,
  },
];

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

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function loadDiscoveredRows(db: Database) {
  const stmt = db.prepare(`
    SELECT e.id, e.name, e.normalized_name
    FROM discoveries d
    JOIN elements e ON e.id = d.element_id
    ORDER BY d.discovered_at ASC
  `);
  const rows: DiscoveredRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as DiscoveredRow);
  }
  stmt.free();
  return rows;
}

function loadEmbeddingsByElementId(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) return new Map<number, number[]>();

  const stmt = db.prepare(
    `
    SELECT element_id, embedding_json
    FROM element_embeddings
    WHERE element_id IN (${elementIds.map(() => "?").join(", ")})
    `
  );
  stmt.bind(elementIds);
  const embeddings = new Map<number, number[]>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    embeddings.set(
      Number(row.element_id),
      JSON.parse(String(row.embedding_json)) as number[]
    );
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

async function getOrCreateQueryEmbedding(db: Database, query: string) {
  const queryText = buildSearchText(query);
  const cached = loadQueryEmbedding(db, queryText);
  if (cached) return cached;
  const response = await generateEmbeddings([queryText]);
  const embedding = response.embeddings[0]?.embedding ?? null;
  if (!embedding) {
    throw new Error(`Failed to create embedding for unlock query: ${query}`);
  }
  saveQueryEmbedding(db, queryText, response.model, embedding);
  return embedding;
}

function isUnlocked(db: Database, key: UnlockKey) {
  const stmt = db.prepare("SELECT 1 FROM player_unlocks WHERE feature_key = ?");
  const row = stmt.getAsObject([key]) as Record<string, unknown>;
  stmt.free();
  return row["1"] != null || row.feature_key != null;
}

function insertUnlock(db: Database, key: UnlockKey) {
  throw new Error("insertUnlock requires source metadata");
}

function insertUnlockWithSource(
  db: Database,
  params: {
    key: UnlockKey;
    sourceItemName: string;
    sourceMatchedWord: string;
  }
) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO player_unlocks (
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    )
    VALUES (?, CURRENT_TIMESTAMP, NULL, ?, ?)
  `);
  stmt.run([params.key, params.sourceItemName, params.sourceMatchedWord]);
  stmt.free();
}

export async function syncFeatureUnlocks(db: Database) {
  const discoveredRows = loadDiscoveredRows(db);
  const discoveredNames = new Set(
    discoveredRows.map((row) => normalize(String(row.normalized_name)))
  );

  if (!discoveredRows.length) return;

  await ensureSearchIndexForElementIds(
    db,
    discoveredRows.map((row) => Number(row.id))
  );
  const embeddingsById = loadEmbeddingsByElementId(
    db,
    discoveredRows.map((row) => Number(row.id))
  );

  for (const definition of UNLOCK_DEFINITIONS) {
    if (isUnlocked(db, definition.key)) continue;

    const directMatch = definition.acceptedWords.find((word) =>
      discoveredNames.has(normalize(word))
    );
    if (directMatch) {
      insertUnlockWithSource(db, {
        key: definition.key,
        sourceItemName: directMatch,
        sourceMatchedWord: directMatch,
      });
      console.log("[api][unlock] unlocked by direct match", {
        key: definition.key,
        match: directMatch,
      });
      continue;
    }

    let matchedWord: string | null = null;
    let matchedItem: string | null = null;
    let matchedScore = 0;

    for (const acceptedWord of definition.acceptedWords) {
      const queryEmbedding = await getOrCreateQueryEmbedding(db, acceptedWord);
      for (const discoveredRow of discoveredRows) {
        const itemEmbedding = embeddingsById.get(Number(discoveredRow.id));
        if (!itemEmbedding) continue;
        const score = cosine(queryEmbedding, itemEmbedding);
        if (score >= definition.similarityThreshold && score > matchedScore) {
          matchedWord = acceptedWord;
          matchedItem = discoveredRow.name;
          matchedScore = score;
        }
      }
    }

    if (matchedWord && matchedItem) {
      insertUnlockWithSource(db, {
        key: definition.key,
        sourceItemName: matchedItem,
        sourceMatchedWord: matchedWord,
      });
      console.log("[api][unlock] unlocked by embedding similarity", {
        key: definition.key,
        acceptedWord: matchedWord,
        matchedItem,
        similarity: Number(matchedScore.toFixed(4)),
      });
    }
  }
}

export function getFeatureUnlockStatuses(db: Database) {
  const stmt = db.prepare(`
    SELECT feature_key, unlocked_at, intro_shown_at, source_item_name, source_matched_word
    FROM player_unlocks
  `);
  const rows = new Map<
    string,
    {
      unlockedAt: string;
      introShownAt: string | null;
      sourceItemName: string | null;
      sourceMatchedWord: string | null;
    }
  >();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.set(String(row.feature_key), {
      unlockedAt: String(row.unlocked_at),
      introShownAt:
        row.intro_shown_at == null ? null : String(row.intro_shown_at),
      sourceItemName:
        row.source_item_name == null ? null : String(row.source_item_name),
      sourceMatchedWord:
        row.source_matched_word == null ? null : String(row.source_matched_word),
    });
  }
  stmt.free();

  return UNLOCK_DEFINITIONS.map((definition) => {
    const row = rows.get(definition.key);
    const sourceMatchedWord = row?.sourceMatchedWord ?? null;
    const sourceMatchedWordCurrent =
      sourceMatchedWord == null
        ? false
        : definition.acceptedWords.some(
            (acceptedWord) =>
              acceptedWord.trim().toLowerCase() === sourceMatchedWord.trim().toLowerCase()
          );
    return {
      key: definition.key,
      title: definition.title,
      summary: definition.summary,
      exampleWords: definition.acceptedWords.slice(0, 4),
      unlocked: !!row,
      introPending: !!row && row.introShownAt == null,
      unlockedAt: row?.unlockedAt ?? null,
      sourceItemName: row?.sourceItemName ?? null,
      sourceMatchedWord,
      sourceMatchedWordCurrent,
    };
  });
}

export function markFeatureUnlockIntroSeen(db: Database, key: UnlockKey) {
  const stmt = db.prepare(`
    UPDATE player_unlocks
    SET intro_shown_at = COALESCE(intro_shown_at, CURRENT_TIMESTAMP)
    WHERE feature_key = ?
  `);
  stmt.run([key]);
  stmt.free();
}

export function clearFeatureUnlocks(db: Database) {
  db.run("DELETE FROM player_unlocks");
}

export function isKnownUnlockKey(value: string): value is UnlockKey {
  return UNLOCK_DEFINITIONS.some((definition) => definition.key === value);
}

export function getUnlockDefinitions() {
  return UNLOCK_DEFINITIONS;
}
