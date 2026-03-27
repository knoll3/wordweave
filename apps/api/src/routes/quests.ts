import express from "express";
import { getDb, persistDatabase } from "../db";
import { generateChallengeTargets, type OpenAiModel } from "../openaiClient";
import { getOrCreateReferenceByName } from "../referenceLookup";
import { z } from "zod";

const router = express.Router();

const generateTargetsRequestSchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
  difficulty: z.enum(["easy", "hard"]).optional(),
  recentTargets: z.array(z.string().min(1).max(128)).optional(),
  completedTargets: z.array(z.string().min(1).max(128)).max(50).optional(),
  model: z.enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"]).optional(),
});

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
