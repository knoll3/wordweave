import type { Database } from "sql.js";
import { generateEmbeddings } from "./openaiClient";
import { mapElementRow } from "./models";

const EMBEDDING_BATCH_SIZE = 64;
const MAX_SEARCH_RESULTS = 10;
const MIN_TOTAL_RELEVANCE = 0.32;
const MIN_SEMANTIC_RELEVANCE = 0.66;

type IndexedElementRow = {
  id: number;
  name: string;
  normalized_name: string;
  icon: string | null;
  discovered_at: string;
};

function buildSearchText(name: string) {
  return `Item: ${name.trim()}`;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
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

function lexicalScore(query: string, candidateName: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidateName.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return 1;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 0.95;
  if (normalizedCandidate.includes(normalizedQuery)) return 0.8;

  const queryTokens = new Set(tokenize(normalizedQuery));
  const candidateTokens = new Set(tokenize(normalizedCandidate));
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }

  return overlap / queryTokens.size;
}

function scoreResult(params: {
  query: string;
  queryEmbedding: number[];
  candidateName: string;
  candidateEmbedding: number[];
}) {
  const lexical = lexicalScore(params.query, params.candidateName);
  const semantic = cosine(params.queryEmbedding, params.candidateEmbedding);

  const exactBoost =
    params.candidateName.trim().toLowerCase() === params.query.trim().toLowerCase()
      ? 0.3
      : 0;

  return {
    lexical,
    semantic,
    total: semantic * 0.65 + lexical * 0.35 + exactBoost,
  };
}

function loadDiscoveredElements(db: Database) {
  const stmt = db.prepare(
    `
    SELECT
      e.id,
      e.name,
      e.normalized_name,
      e.icon,
      d.discovered_at
    FROM discoveries d
    JOIN elements e ON e.id = d.element_id
    ORDER BY d.discovered_at ASC
    `
  );
  const rows: IndexedElementRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as IndexedElementRow);
  }
  stmt.free();
  return rows;
}

function loadEmbeddingsByElementId(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) return new Map<number, number[]>();

  const placeholders = elementIds.map(() => "?").join(", ");
  const stmt = db.prepare(
    `
    SELECT element_id, embedding_json
    FROM element_embeddings
    WHERE element_id IN (${placeholders})
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
  const stmt = db.prepare(
    `
    SELECT embedding_json
    FROM search_query_embeddings
    WHERE query_text = ?
    `
  );
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
  const stmt = db.prepare(
    `
    INSERT INTO search_query_embeddings (query_text, model, embedding_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(query_text) DO UPDATE SET
      model = excluded.model,
      embedding_json = excluded.embedding_json,
      updated_at = CURRENT_TIMESTAMP
    `
  );
  stmt.run([queryText, model, JSON.stringify(embedding)]);
  stmt.free();
}

async function upsertElementEmbeddings(
  db: Database,
  rows: Array<{ id: number; name: string }>
) {
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((row) => buildSearchText(row.name));
    const response = await generateEmbeddings(texts);
    const savepointName = `element_embedding_batch_${offset}`;

    db.run(`SAVEPOINT ${savepointName}`);
    try {
      const stmt = db.prepare(
        `
        INSERT INTO element_embeddings (element_id, model, search_text, embedding_json, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(element_id) DO UPDATE SET
          model = excluded.model,
          search_text = excluded.search_text,
          embedding_json = excluded.embedding_json,
          updated_at = CURRENT_TIMESTAMP
        `
      );

      response.embeddings.forEach((item, index) => {
        stmt.run([
          batch[index].id,
          response.model,
          item.text,
          JSON.stringify(item.embedding),
        ]);
      });
      stmt.free();
      db.run(`RELEASE SAVEPOINT ${savepointName}`);
    } catch (error) {
      db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      db.run(`RELEASE SAVEPOINT ${savepointName}`);
      throw error;
    }
  }
}

export async function ensureSearchIndexForElementIds(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) return;

  const placeholders = elementIds.map(() => "?").join(", ");
  const stmt = db.prepare(
    `
    SELECT id, name
    FROM elements
    WHERE id IN (${placeholders})
      AND id NOT IN (SELECT element_id FROM element_embeddings)
    `
  );
  stmt.bind(elementIds);
  const missingRows: Array<{ id: number; name: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    missingRows.push({
      id: Number(row.id),
      name: String(row.name),
    });
  }
  stmt.free();

  if (missingRows.length === 0) return;

  console.log("[api][search] backfilling embeddings", {
    count: missingRows.length,
    items: missingRows.map((row) => row.name),
  });
  await upsertElementEmbeddings(db, missingRows);
}

export async function searchDiscoveredElements(db: Database, query: string) {
  const discoveredRows = loadDiscoveredElements(db);
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return discoveredRows.map((row) => mapElementRow(row));
  }

  if (trimmedQuery.length < 2) {
    return discoveredRows
      .filter((row) =>
        String(row.name).toLowerCase().includes(trimmedQuery.toLowerCase())
      )
      .map((row) => mapElementRow(row));
  }

  await ensureSearchIndexForElementIds(
    db,
    discoveredRows.map((row) => Number(row.id))
  );

  const embeddingsById = loadEmbeddingsByElementId(
    db,
    discoveredRows.map((row) => Number(row.id))
  );

  const querySearchText = buildSearchText(trimmedQuery);
  let queryEmbedding = loadQueryEmbedding(db, querySearchText);
  if (!queryEmbedding) {
    const queryEmbeddingResponse = await generateEmbeddings([querySearchText]);
    queryEmbedding = queryEmbeddingResponse.embeddings[0]?.embedding ?? null;
    if (!queryEmbedding) {
      return discoveredRows.map((row) => mapElementRow(row));
    }
    saveQueryEmbedding(
      db,
      querySearchText,
      queryEmbeddingResponse.model,
      queryEmbedding
    );
  }

  const scored = discoveredRows
    .map((row) => {
      const candidateEmbedding = embeddingsById.get(Number(row.id)) ?? [];
      const score = scoreResult({
        query: trimmedQuery,
        queryEmbedding,
        candidateName: String(row.name),
        candidateEmbedding,
      });
      return {
        row,
        score,
      };
    })
    .filter(({ score }) => {
      if (score.lexical > 0) return true;
      if (score.semantic >= MIN_SEMANTIC_RELEVANCE) return true;
      return score.total >= MIN_TOTAL_RELEVANCE;
    })
    .sort((left, right) => {
      if (right.score.total !== left.score.total) {
        return right.score.total - left.score.total;
      }
      return String(left.row.discovered_at).localeCompare(String(right.row.discovered_at));
    });
  const limited = scored.slice(0, MAX_SEARCH_RESULTS);

  console.log("[api][search] semantic search", {
    query: trimmedQuery,
    discoveredCount: discoveredRows.length,
    matchedCount: scored.length,
    returnedCount: limited.length,
    thresholds: {
      minTotal: MIN_TOTAL_RELEVANCE,
      minSemantic: MIN_SEMANTIC_RELEVANCE,
      hardCap: MAX_SEARCH_RESULTS,
    },
    topMatches: limited.map((entry) => ({
      name: entry.row.name,
      total: Number(entry.score.total.toFixed(4)),
      lexical: Number(entry.score.lexical.toFixed(4)),
      semantic: Number(entry.score.semantic.toFixed(4)),
    })),
  });

  return limited.map(({ row }) => mapElementRow(row));
}
