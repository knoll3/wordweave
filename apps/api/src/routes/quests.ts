import express from "express";
import { getDb, persistDatabase } from "../db";
import {
  DEFAULT_EMBEDDING_MODEL_NAME,
  generateChallengeTargets,
  generateEmbeddings,
  judgeQuestCompletionCandidate,
  type OpenAiModel,
} from "../openaiClient";
import { getOrCreateReferenceByName } from "../referenceLookup";
import { ensureSearchIndexForElementIds } from "../search";
import { z } from "zod";

const router = express.Router();

const generateTargetsRequestSchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
  difficulty: z.enum(["easy", "hard"]).optional(),
  recentTargets: z.array(z.string().min(1).max(128)).optional(),
  completedTargets: z.array(z.string().min(1).max(128)).max(50).optional(),
  model: z.enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"]).optional(),
});

const completeTargetsRequestSchema = z.object({
  targets: z.array(z.string().min(1).max(128)).max(200),
  candidateNames: z.array(z.string().min(1).max(128)).max(200).optional(),
});

const QUEST_COMPLETION_SIMILARITY_THRESHOLD = 0.865;
const QUEST_COMPLETION_JUDGE_THRESHOLD = 0.6;
const questJudgeDecisionCache = new Map<string, boolean>();

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function uniqueNormalized(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalize(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

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

function loadDiscoveredRows(db: Awaited<ReturnType<typeof getDb>>) {
  const stmt = db.prepare(`
    SELECT e.id, e.name, e.normalized_name
    FROM discoveries d
    JOIN elements e ON e.id = d.element_id
    ORDER BY d.discovered_at ASC
  `);
  const rows: Array<{ id: number; name: string; normalized_name: string }> = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as { id: number; name: string; normalized_name: string });
  }
  stmt.free();
  return rows;
}

function loadEmbeddingsByElementId(
  db: Awaited<ReturnType<typeof getDb>>,
  elementIds: number[]
) {
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

function loadQueryEmbedding(db: Awaited<ReturnType<typeof getDb>>, queryText: string) {
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
  db: Awaited<ReturnType<typeof getDb>>,
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

async function getQuestQueryEmbeddings(
  db: Awaited<ReturnType<typeof getDb>>,
  targets: string[]
) {
  const embeddings = new Map<string, number[]>();
  const missingTargets: string[] = [];

  for (const target of targets) {
    const queryText = buildSearchText(target);
    const cached = loadQueryEmbedding(db, queryText);
    if (cached) {
      embeddings.set(target, cached);
    } else {
      missingTargets.push(target);
    }
  }

  if (missingTargets.length > 0) {
    const response = await generateEmbeddings(missingTargets.map((target) => buildSearchText(target)));
    response.embeddings.forEach((entry, index) => {
      const target = missingTargets[index];
      embeddings.set(target, entry.embedding);
      saveQueryEmbedding(
        db,
        buildSearchText(target),
        response.model || DEFAULT_EMBEDDING_MODEL_NAME,
        entry.embedding
      );
    });
  }

  return embeddings;
}

router.post("/generate", async (req, res) => {
  const parsed = generateTargetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid challenge target request" });
  }

  const count = parsed.data.count ?? 10;
  const requestCount = Math.min(count + 6, 20);
  const difficulty = parsed.data.difficulty ?? "hard";
  const recentTargets = uniqueNormalized(parsed.data.recentTargets ?? []);
  const completedTargets = uniqueNormalized(parsed.data.completedTargets ?? []).slice(-50);
  const model: OpenAiModel | undefined = parsed.data.model;

  try {
    const db = await getDb();
    const recentSet = new Set(recentTargets.map((name) => normalize(name)));
    const completedSet = new Set(completedTargets.map((name) => normalize(name)));
    const acceptedTargets: Array<{ name: string; icon: string }> = [];
    const seen = new Set<string>();
    const discoveredSet = new Set<string>();
    const discoveredStmt = db.prepare("SELECT name FROM elements");
    while (discoveredStmt.step()) {
      const row = discoveredStmt.getAsObject() as Record<string, unknown>;
      discoveredSet.add(normalize(String(row.name ?? "")));
    }
    discoveredStmt.free();

    for (let attempt = 0; attempt < 2 && acceptedTargets.length < count; attempt += 1) {
      const generated = await generateChallengeTargets({
        count: requestCount,
        difficulty,
        recentTargets: [...recentTargets, ...acceptedTargets.map((target) => target.name)],
        completedTargets,
        model,
      });

      for (const target of generated.targets) {
        const normalized = normalize(target.name);
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        if (discoveredSet.has(normalized)) continue;
        if (recentSet.has(normalized)) continue;
        if (completedSet.has(normalized)) continue;
        seen.add(normalized);
        acceptedTargets.push(target);
        if (acceptedTargets.length >= count) break;
      }
    }

    return res.json({
      targets: acceptedTargets.slice(0, count),
    });
  } catch (err) {
    console.error("[api][quests] failed to generate challenge targets", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate challenge targets",
    });
  }
});

router.post("/complete", async (req, res) => {
  const parsed = completeTargetsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid quest completion request" });
  }

  const targets = uniqueNormalized(parsed.data.targets ?? []);
  const candidateNames = uniqueNormalized(parsed.data.candidateNames ?? []);
  if (targets.length === 0) {
    return res.json({ completedNames: [] });
  }

  try {
    const db = await getDb();
    const allDiscoveredRows = loadDiscoveredRows(db);
    const candidateNameSet =
      candidateNames.length > 0
        ? new Set(candidateNames.map((name) => normalize(name)))
        : null;
    const discoveredRows =
      candidateNameSet == null
        ? allDiscoveredRows
        : allDiscoveredRows.filter((row) =>
            candidateNameSet.has(normalize(String(row.name)))
          );
    if (discoveredRows.length === 0) {
      console.log("[api][quests] completion check", {
        targetCount: targets.length,
        discoveredCount: 0,
        completedCount: 0,
        threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
        scopedToCandidates: candidateNameSet != null,
      });
      return res.json({ completedNames: [] });
    }

    await ensureSearchIndexForElementIds(
      db,
      discoveredRows.map((row) => Number(row.id))
    );

    const discoveredNames = new Set(
      discoveredRows.map((row) => normalize(String(row.name)))
    );
    const embeddingsById = loadEmbeddingsByElementId(
      db,
      discoveredRows.map((row) => Number(row.id))
    );
    const queryEmbeddings = await getQuestQueryEmbeddings(db, targets);

    const completedNames = new Set<string>();
    const borderlineChecksByCandidate = new Map<
      string,
      { target: string; candidate: string; similarity: number }
    >();

    targets.forEach((target) => {
      const normalizedTarget = normalize(target);
      if (discoveredNames.has(normalizedTarget)) {
        console.log("[api][quests] completion exact match", {
          target,
          matchedItem: target,
          completed: true,
        });
        completedNames.add(target);
        return;
      }

      const queryEmbedding = queryEmbeddings.get(target);
      if (!queryEmbedding) {
        console.log("[api][quests] completion missing embedding", {
          target,
          completed: false,
        });
        return;
      }

      let bestSimilarity = 0;
      let bestMatchName: string | null = null;
      for (const row of discoveredRows) {
        const itemEmbedding = embeddingsById.get(Number(row.id));
        if (!itemEmbedding) continue;
        const similarity = cosine(queryEmbedding, itemEmbedding);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatchName = String(row.name);
        }
      }

      const completed = bestSimilarity >= QUEST_COMPLETION_SIMILARITY_THRESHOLD;
      console.log("[api][quests] completion semantic check", {
        target,
        bestMatchName,
        bestSimilarity: Number(bestSimilarity.toFixed(4)),
        threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
        completed,
      });

      if (completed) {
        completedNames.add(target);
        return;
      }

      if (
        candidateNameSet != null &&
        bestMatchName &&
        bestSimilarity >= QUEST_COMPLETION_JUDGE_THRESHOLD
      ) {
        const candidateKey = normalize(bestMatchName);
        const existing = borderlineChecksByCandidate.get(candidateKey);
        if (!existing || bestSimilarity > existing.similarity) {
          borderlineChecksByCandidate.set(candidateKey, {
            target,
            candidate: bestMatchName,
            similarity: bestSimilarity,
          });
        }
      }
    });

    for (const borderline of borderlineChecksByCandidate.values()) {
      if (completedNames.has(borderline.target)) {
        continue;
      }

      const cacheKey = `${normalize(borderline.target)}|${normalize(borderline.candidate)}`;
      let judgeDecision = questJudgeDecisionCache.get(cacheKey);
      if (judgeDecision == null) {
        console.log("[api][quests] completion judge trigger", {
          target: borderline.target,
          candidate: borderline.candidate,
          similarity: Number(borderline.similarity.toFixed(4)),
          autoThreshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
          judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
        });
        const judgeResult = await judgeQuestCompletionCandidate({
          target: borderline.target,
          candidate: borderline.candidate,
        });
        judgeDecision = judgeResult.match;
        questJudgeDecisionCache.set(cacheKey, judgeDecision);
      } else {
        console.log("[api][quests] completion judge cache hit", {
          target: borderline.target,
          candidate: borderline.candidate,
          similarity: Number(borderline.similarity.toFixed(4)),
          match: judgeDecision,
        });
      }

      if (judgeDecision) {
        completedNames.add(borderline.target);
      }

      console.log("[api][quests] completion judge result", {
        target: borderline.target,
        candidate: borderline.candidate,
        similarity: Number(borderline.similarity.toFixed(4)),
        match: judgeDecision,
      });
    }

    const completedNamesList = [...completedNames];
    console.log("[api][quests] completion summary", {
      targetCount: targets.length,
      discoveredCount: discoveredRows.length,
      candidateNameCount: candidateNames.length,
      completedCount: completedNamesList.length,
      threshold: QUEST_COMPLETION_SIMILARITY_THRESHOLD,
      judgeThreshold: QUEST_COMPLETION_JUDGE_THRESHOLD,
    });

    persistDatabase(db);
    return res.json({ completedNames: completedNamesList });
  } catch (err) {
    console.error("[api][quests] failed to evaluate completions", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to evaluate quest completions",
    });
  }
});

router.get("/reference", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.status(400).json({ error: "Missing quest target query" });
  }

  try {
    const db = await getDb();
    const reference = await getOrCreateReferenceByName(db, q);
    persistDatabase(db);
    if (!reference) {
      return res.status(404).json({ error: "Reference not found" });
    }
    return res.json(reference);
  } catch (err) {
    console.error("[api][target-reference] failed to load target reference", err);
    return res.status(500).json({ error: "Failed to load target reference" });
  }
});

export default router;
