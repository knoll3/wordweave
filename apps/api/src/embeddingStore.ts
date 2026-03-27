import type { Database } from "sql.js";

export function buildEmbeddingSearchText(name: string) {
  return `Item: ${name.trim()}`;
}

export function cosineSimilarity(left: number[], right: number[]) {
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

export function loadEmbeddingsByElementId(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) {
    return new Map<number, number[]>();
  }

  const stmt = db.prepare(`
    SELECT element_id, embedding_json
    FROM element_embeddings
    WHERE element_id IN (${elementIds.map(() => "?").join(", ")})
  `);
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

export function loadQueryEmbedding(db: Database, queryText: string) {
  const stmt = db.prepare(`
    SELECT embedding_json
    FROM search_query_embeddings
    WHERE query_text = ?
  `);
  const row = stmt.getAsObject([queryText]) as Record<string, unknown>;
  stmt.free();
  if (row.embedding_json == null) {
    return null;
  }
  return JSON.parse(String(row.embedding_json)) as number[];
}

export function saveQueryEmbedding(
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
