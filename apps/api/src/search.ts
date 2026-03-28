import type { Database } from "./db";
import { generateEmbeddings } from "./openaiClient";
import {
  buildEmbeddingSearchText,
  cosineSimilarity,
  loadEmbeddingsByElementId,
  loadQueryEmbedding,
  saveQueryEmbedding,
} from "./embeddingStore";
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

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
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
  const semantic = cosineSimilarity(
    params.queryEmbedding,
    params.candidateEmbedding
  );

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

async function upsertElementEmbeddings(
  db: Database,
  rows: Array<{ id: number; name: string }>
) {
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((row) => buildEmbeddingSearchText(row.name));
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

  const querySearchText = buildEmbeddingSearchText(trimmedQuery);
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

  return limited.map(({ row }) => mapElementRow(row));
}
