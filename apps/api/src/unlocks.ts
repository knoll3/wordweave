import type { Database } from "./db";
import { generateEmbeddings } from "./openaiClient";
import {
  buildEmbeddingSearchText,
  cosineSimilarity,
  loadEmbeddingsByElementId,
  loadQueryEmbedding,
  saveQueryEmbedding,
} from "./embeddingStore";
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
      "creativity",
      "create",
      "creation",
      "creator",
      "idea",
      "inspiration",
      "imagination",
      "imagine",
      "invent",
      "invention",
      "inventor",
      "innovation",
      "design",
      "vision",
      "art",
      "artist",
      "artistry",
      "fantasy",
      "whimsy",
      "wonder",
      "genius",
      "spark",
      "brainstorm",
      "dream",
      "novelty",
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
      "species",
      "genus",
      "order",
      "rank",
      "sort",
      "variety",
      "genre",
      "taxonomy",
      "classification",
      "classify",
      "similarity",
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
      "process",
      "procedure",
      "function",
      "reaction",
      "task",
      "perform",
      "performance",
      "deed",
      "behavior",
      "move",
      "operation",
      "gesture",
      "motion",
      "movement",
    ],
    similarityThreshold: 0.82,
  },
];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function loadDiscoveredRows(db: Database, sessionId: string) {
  const stmt = db.prepare(`
    SELECT e.id, e.name, e.normalized_name
    FROM session_discoveries d
    JOIN elements e ON e.id = d.element_id
    WHERE d.session_id = ?
    ORDER BY d.discovered_at ASC
  `);
  stmt.bind([sessionId]);
  const rows: DiscoveredRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as DiscoveredRow);
  }
  stmt.free();
  return rows;
}

async function getOrCreateQueryEmbedding(db: Database, query: string) {
  const queryText = buildEmbeddingSearchText(query);
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

function isUnlocked(db: Database, sessionId: string, key: UnlockKey) {
  const stmt = db.prepare(
    "SELECT 1 FROM player_unlocks WHERE session_id = ? AND feature_key = ?"
  );
  const row = stmt.getAsObject([sessionId, key]) as Record<string, unknown>;
  stmt.free();
  return row["1"] != null || row.feature_key != null;
}

function insertUnlockWithSource(
  db: Database,
  params: {
    key: UnlockKey;
    sessionId: string;
    sourceItemName: string;
    sourceMatchedWord: string;
  }
) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO player_unlocks (
      session_id,
      feature_key,
      unlocked_at,
      intro_shown_at,
      source_item_name,
      source_matched_word
    )
    VALUES (?, ?, CURRENT_TIMESTAMP, NULL, ?, ?)
  `);
  stmt.run([params.sessionId, params.key, params.sourceItemName, params.sourceMatchedWord]);
  stmt.free();
}

export async function syncFeatureUnlocks(db: Database, sessionId: string) {
  const discoveredRows = loadDiscoveredRows(db, sessionId);
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
    if (isUnlocked(db, sessionId, definition.key)) continue;

    const directMatch = definition.acceptedWords.find((word) =>
      discoveredNames.has(normalize(word))
    );
    if (directMatch) {
      insertUnlockWithSource(db, {
        key: definition.key,
        sessionId,
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
        const score = cosineSimilarity(queryEmbedding, itemEmbedding);
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
        sessionId,
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

export function getFeatureUnlockStatuses(db: Database, sessionId: string) {
  const stmt = db.prepare(`
    SELECT feature_key, unlocked_at, intro_shown_at, source_item_name, source_matched_word
    FROM player_unlocks
    WHERE session_id = ?
  `);
  stmt.bind([sessionId]);
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

export function markFeatureUnlockIntroSeen(db: Database, sessionId: string, key: UnlockKey) {
  const stmt = db.prepare(`
    UPDATE player_unlocks
    SET intro_shown_at = COALESCE(intro_shown_at, CURRENT_TIMESTAMP)
    WHERE session_id = ? AND feature_key = ?
  `);
  stmt.run([sessionId, key]);
  stmt.free();
}

export function clearFeatureUnlocks(db: Database, sessionId?: string) {
  if (!sessionId) {
    db.run("DELETE FROM player_unlocks");
    return;
  }
  const stmt = db.prepare("DELETE FROM player_unlocks WHERE session_id = ?");
  stmt.run([sessionId]);
  stmt.free();
}

export function isKnownUnlockKey(value: string): value is UnlockKey {
  return UNLOCK_DEFINITIONS.some((definition) => definition.key === value);
}

export function getUnlockDefinitions() {
  return UNLOCK_DEFINITIONS;
}
