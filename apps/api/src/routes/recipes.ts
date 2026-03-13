import express from "express";
import {
  BASE_ELEMENTS,
  discoverElement,
  ensureElement,
  getDb,
  persistDatabase,
} from "../db";
import {
  DEFAULT_MODEL_NAME,
  generateRecipeBatch,
  generateResult,
  OpenAiModel,
} from "../openaiClient";
import { ensureSearchIndexForElementIds } from "../search";
import {
  combineRequestSchema,
  selectRequestSchema,
} from "../validation";
import {
  buildCombineResponse,
  getElementById,
  normalizeInputs,
  toTitleCaseWords,
} from "../models";

const router = express.Router();
const CACHE_BATCH_MODEL: OpenAiModel = "gpt-5-mini";
const CACHE_BATCH_SIZE = 25;

async function syncSearchIndex(
  db: Awaited<ReturnType<typeof getDb>>,
  elementIds: number[]
) {
  if (elementIds.length === 0) return;
  try {
    await ensureSearchIndexForElementIds(db, elementIds);
  } catch (error) {
    console.warn("[api][search] failed to sync search index", {
      elementIds,
      error,
    });
  }
}

type KnownItem = {
  name: string;
  normalizedName: string;
};

function loadKnownCacheItems(db: Awaited<ReturnType<typeof getDb>>) {
  const items = new Map<string, KnownItem>();

  for (const element of BASE_ELEMENTS) {
    items.set(element.name.trim().toLowerCase(), {
      name: element.name,
      normalizedName: element.name.trim().toLowerCase(),
    });
  }

  const stmt = db.prepare(`
    SELECT DISTINCT e.name, e.normalized_name
    FROM recipes r
    JOIN elements e ON e.id = r.result_element_id
    WHERE r.result_element_id IS NOT NULL
  `);

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const normalizedName = String(row.normalized_name);
    if (!items.has(normalizedName)) {
      items.set(normalizedName, {
        name: String(row.name),
        normalizedName,
      });
    }
  }
  stmt.free();

  return [...items.values()];
}

function loadExistingRecipeKeys(db: Awaited<ReturnType<typeof getDb>>) {
  const stmt = db.prepare("SELECT input_key FROM recipes");
  const keys = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    keys.add(String(row.input_key));
  }
  stmt.free();
  return keys;
}

function sampleMissingRecipePairs(
  items: KnownItem[],
  existingRecipeKeys: Set<string>,
  maxPairs: number
) {
  const candidates: Array<{ left: KnownItem; right: KnownItem; inputKey: string }> = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i; j < items.length; j += 1) {
      const { inputKey } = normalizeInputs([items[i].name, items[j].name]);
      if (existingRecipeKeys.has(inputKey)) continue;
      candidates.push({
        left: items[i],
        right: items[j],
        inputKey,
      });
    }
  }

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, Math.min(maxPairs, candidates.length));
}

function upsertCanonicalRecipe(params: {
  db: Awaited<ReturnType<typeof getDb>>;
  inputKey: string;
  inputDisplayJson: string;
  resultName: string;
  resultIcon: string;
}) {
  let recipeId: number | null = null;
  const existingStmt = params.db.prepare("SELECT id FROM recipes WHERE input_key = ?");
  const existingRow = existingStmt.getAsObject([params.inputKey]) as Record<string, unknown>;
  existingStmt.free();

  if (existingRow.id !== undefined) {
    recipeId = Number(existingRow.id);
    const updateRecipeStmt = params.db.prepare(
      "UPDATE recipes SET input_display_json = ?, chosen_candidate_id = NULL, result_element_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    updateRecipeStmt.run([params.inputDisplayJson, recipeId]);
    updateRecipeStmt.free();

    const deleteCandidatesStmt = params.db.prepare(
      "DELETE FROM recipe_candidates WHERE recipe_id = ?"
    );
    deleteCandidatesStmt.run([recipeId]);
    deleteCandidatesStmt.free();
  } else {
    const insertRecipeStmt = params.db.prepare(
      "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
    );
    insertRecipeStmt.run([params.inputKey, params.inputDisplayJson]);
    insertRecipeStmt.free();

    const recipeIdStmt = params.db.prepare("SELECT last_insert_rowid() AS id");
    if (recipeIdStmt.step()) {
      const row = recipeIdStmt.getAsObject() as Record<string, unknown>;
      recipeId = Number(row.id);
    }
    recipeIdStmt.free();
  }

  if (!recipeId || Number.isNaN(recipeId)) {
    throw new Error("Failed to upsert recipe");
  }

  const insertCandidateStmt = params.db.prepare(
    "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
  );
  insertCandidateStmt.run([recipeId, params.resultName, params.resultIcon, 0]);
  insertCandidateStmt.free();

  const candidateIdStmt = params.db.prepare("SELECT last_insert_rowid() AS id");
  let candidateId: number | null = null;
  if (candidateIdStmt.step()) {
    const row = candidateIdStmt.getAsObject() as Record<string, unknown>;
    candidateId = Number(row.id);
  }
  candidateIdStmt.free();

  if (!candidateId || Number.isNaN(candidateId)) {
    throw new Error("Failed to create recipe candidate");
  }

  const elementId = ensureElement(params.db, {
    name: params.resultName,
    normalizedName: params.resultName.trim().toLowerCase(),
    icon: params.resultIcon,
  });

  const updateRecipeStmt = params.db.prepare(
    "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  updateRecipeStmt.run([candidateId, elementId, recipeId]);
  updateRecipeStmt.free();

  return { recipeId, candidateId, elementId };
}

router.post("/generate-cache", async (_req, res) => {
  try {
    const db = await getDb();
    const knownItems = loadKnownCacheItems(db);
    const existingRecipeKeys = loadExistingRecipeKeys(db);
    const pairs = sampleMissingRecipePairs(
      knownItems,
      existingRecipeKeys,
      CACHE_BATCH_SIZE
    );

    if (pairs.length === 0) {
      console.log("[api][recipe-batch] no missing recipe pairs available");
      return res.json({
        requestedCount: 0,
        generatedCount: 0,
        recipes: [],
      });
    }

    console.log("[api][recipe-batch] selected pairs", {
      model: CACHE_BATCH_MODEL,
      knownItemCount: knownItems.length,
      pairCount: pairs.length,
      pairs: pairs.map((pair) => `${pair.left.name} + ${pair.right.name}`),
    });

    const batch = await generateRecipeBatch({
      model: CACHE_BATCH_MODEL,
      pairs: pairs.map((pair) => ({
        left: pair.left.name,
        right: pair.right.name,
      })),
    });

    const pairByKey = new Map(
      pairs.map((pair) => [pair.inputKey, pair] as const)
    );
    const inserted: Array<{
      recipeId: number;
      inputKey: string;
      inputs: string[];
      resultName: string;
      resultIcon: string;
    }> = [];

    db.run("BEGIN");
    try {
      for (const generated of batch.recipes) {
        const { normalizedInputs, inputKey } = normalizeInputs([
          generated.left,
          generated.right,
        ]);
        const selectedPair = pairByKey.get(inputKey);
        if (!selectedPair) {
          console.warn("[api][recipe-batch] skipping unexpected pair", generated);
          continue;
        }

        if (existingRecipeKeys.has(inputKey)) {
          console.warn("[api][recipe-batch] skipping existing recipe key", {
            inputKey,
          });
          continue;
        }

        const resultName = toTitleCaseWords(generated.result);
        const upserted = upsertCanonicalRecipe({
          db,
          inputKey,
          inputDisplayJson: JSON.stringify(normalizedInputs),
          resultName,
          resultIcon: generated.icon,
        });

        inserted.push({
          recipeId: upserted.recipeId,
          inputKey,
          inputs: normalizedInputs.map((input) => input.name),
          resultName,
          resultIcon: generated.icon,
        });
        existingRecipeKeys.add(inputKey);
      }
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }

    persistDatabase(db);

    console.log(
      `[api][recipe-batch] generated count=${inserted.length} path="${inserted
        .map((recipe) => `${recipe.inputs.join(" + ")} -> ${recipe.resultName}`)
        .join(" | ")}"`
    );

    return res.json({
      requestedCount: pairs.length,
      generatedCount: inserted.length,
      recipes: inserted,
    });
  } catch (err) {
    console.error("[api][recipe-batch] failed", err);
    return res.status(500).json({ error: "Failed to generate recipe batch" });
  }
});

router.post("/combine", async (req, res) => {
  console.log("[api][combine] request body", req.body);
  const parsedBody = combineRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const creative = parsedBody.data.creative ?? false;
  const subtractive = parsedBody.data.subtractive ?? false;
  const opposite = parsedBody.data.opposite ?? false;
  const randomize = parsedBody.data.randomize ?? false;
  const model = parsedBody.data.model ?? DEFAULT_MODEL_NAME;

  const activeModeCount = [creative, subtractive, opposite, randomize].filter(Boolean)
    .length;
  if (activeModeCount > 1) {
    return res.status(400).json({
      error: "Only one catalyst mode can be used at a time",
    });
  }

  const { normalizedInputs, inputKey } = normalizeInputs(
    parsedBody.data.inputs
  );
  const recipeInputKey = creative
    ? `creative|${inputKey}`
    : subtractive
      ? `subtract|${inputKey}`
      : opposite
        ? `opposite|${inputKey}`
        : randomize
          ? `randomize|${inputKey}`
      : inputKey;

  if (normalizedInputs.length === 0) {
    return res.status(400).json({ error: "No valid inputs provided" });
  }

  if (randomize && normalizedInputs.length !== 1) {
    return res.status(400).json({
      error: "Randomize requires exactly one regular input item",
    });
  }

  try {
    const db = await getDb();

    if (creative) {
      console.log("[api][combine] creative mode bypassing cache", {
        inputs: normalizedInputs.map((i) => i.name),
      });

      let llmResult;
      try {
        llmResult = await generateResult(
          normalizedInputs.map((i) => i.name),
          { creative: true, model }
        );
        console.log("[api][combine] creative OpenAI result", llmResult);
      } catch (err) {
        console.error("Error generating creative result", err);
        const message =
          err instanceof Error ? err.message : "Failed to generate creative result from model";
        return res.status(502).json({ error: message });
      }

      const createdResultName = toTitleCaseWords(llmResult.name);
      const normalizedName = createdResultName.trim().toLowerCase();

      const elementId = ensureElement(db, {
        name: createdResultName,
        normalizedName,
        icon: llmResult.icon,
      });
      discoverElement(db, elementId);
      await syncSearchIndex(db, [elementId]);
      persistDatabase(db);

      let elementStmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE id = ?"
      );
      const elementRow = elementStmt.getAsObject([elementId]);
      elementStmt.free();

      return res.json({
        recipeId: 0,
        inputKey: recipeInputKey,
        inputs: normalizedInputs,
        candidates: [
          {
            id: 0,
            name: createdResultName,
            icon: llmResult.icon,
            orderIndex: 0,
          },
        ],
        chosenCandidateId: null,
        resultElement: {
          id: Number(elementRow.id),
          name: String(elementRow.name),
          normalizedName: String(elementRow.normalized_name),
          icon: elementRow.icon ? String(elementRow.icon) : null,
        },
      });
    }

    // Look up existing recipe
    let stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    let recipeRow = stmt.getAsObject([recipeInputKey]);
    stmt.free();

    if (recipeRow && recipeRow.id !== undefined) {
      console.log("[api][combine] cache hit", {
        inputKey: recipeInputKey,
        creative,
        subtractive,
        opposite,
        randomize,
        recipeId: recipeRow.id,
        resultElementId: recipeRow.result_element_id ?? null,
      });
      // Load candidates
      const candidatesStmt = db.prepare(
        "SELECT * FROM recipe_candidates WHERE recipe_id = ? ORDER BY order_index ASC"
      );
      const candidatesRows: any[] = [];
      while (candidatesStmt.step()) {
        candidatesRows.push(candidatesStmt.getAsObject());
      }
      candidatesStmt.free();

      if (
        candidatesRows.length === 0 &&
        recipeRow.chosen_candidate_id != null
      ) {
        const chosenCandidateStmt = db.prepare(
          "SELECT * FROM recipe_candidates WHERE id = ?"
        );
        const chosenCandidateRow = chosenCandidateStmt.getAsObject([
          Number(recipeRow.chosen_candidate_id),
        ]);
        chosenCandidateStmt.free();
        if (chosenCandidateRow && chosenCandidateRow.id !== undefined) {
          candidatesRows.push(chosenCandidateRow);
        }
      }

      let resultElement =
        recipeRow.result_element_id != null
          ? getElementById(db, Number(recipeRow.result_element_id))
          : undefined;

      if (resultElement) {
        discoverElement(db, Number(resultElement.id));
        await syncSearchIndex(db, [Number(resultElement.id)]);
        persistDatabase(db);
      }

      // Backfill legacy recipes that were cached without a canonical result.
      if (!resultElement) {
        console.warn("[api][combine] cache hit with null result; backfilling", {
          inputKey,
          recipeId: recipeRow.id,
          candidateCount: candidatesRows.length,
        });

        let chosenCandidateId: number | null = null;
        let chosenName: string;
        let chosenIcon: string;

        if (candidatesRows.length > 0) {
          const first = candidatesRows[0] as any;
          chosenCandidateId = Number(first.id);
          chosenName = toTitleCaseWords(String(first.name));
          chosenIcon = String(first.icon ?? "✨");
        } else {
          // If no candidates exist, regenerate one now.
          const generated = await generateResult(
            normalizedInputs.map((i) => i.name),
            { creative, subtractive, opposite, randomize, model }
          );
          console.log("[api][combine] backfill generated result", generated);

          const insertCandidateStmt = db.prepare(
            "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
          );
          const generatedName = toTitleCaseWords(generated.name);
          insertCandidateStmt.run([
            Number(recipeRow.id),
            generatedName,
            generated.icon,
            0,
          ]);
          insertCandidateStmt.free();

          const lastCandidateStmt = db.prepare(
            "SELECT last_insert_rowid() as id"
          );
          if (lastCandidateStmt.step()) {
            const row = lastCandidateStmt.getAsObject() as any;
            chosenCandidateId = Number(row.id);
          }
          lastCandidateStmt.free();

          chosenName = generatedName;
          chosenIcon = generated.icon;
          candidatesRows.push({
            id: chosenCandidateId,
            recipe_id: Number(recipeRow.id),
            name: chosenName,
            icon: chosenIcon,
            order_index: 0,
          });
        }

        const normalizedName = chosenName.trim().toLowerCase();
        const elementId = ensureElement(db, {
          name: chosenName,
          normalizedName,
          icon: chosenIcon,
        });
        discoverElement(db, elementId);
        await syncSearchIndex(db, [elementId]);

        const updateRecipeStmt = db.prepare(
          "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        updateRecipeStmt.run([
          chosenCandidateId,
          elementId,
          Number(recipeRow.id),
        ]);
        updateRecipeStmt.free();

        persistDatabase(db);

        recipeRow.chosen_candidate_id = chosenCandidateId;
        recipeRow.result_element_id = elementId;
        resultElement = getElementById(db, elementId);
      }

      return res.json(
        buildCombineResponse({
          recipeRow,
          candidates: candidatesRows,
          resultElement,
        })
      );
    }

    // Not found: generate a single result via OpenAI
    console.log("[api][combine] cache miss; generating via OpenAI", {
      inputKey: recipeInputKey,
      creative,
      subtractive,
      opposite,
      randomize,
      inputs: normalizedInputs.map((i) => i.name),
    });
    let llmResult;
    try {
      llmResult = await generateResult(
        normalizedInputs.map((i) => i.name),
        { creative, subtractive, opposite, randomize, model }
      );
      console.log("[api][combine] OpenAI result", llmResult);
    } catch (err) {
      console.error("Error generating result", err);
      const message =
        err instanceof Error ? err.message : "Failed to generate result from model";
      return res.status(502).json({ error: message });
    }

    const inputDisplayJson = JSON.stringify(normalizedInputs);
    const createdResultName = toTitleCaseWords(llmResult.name);

    // Insert recipe, generated result candidate, and canonical selection
    db.run("BEGIN");
    try {
      const insertRecipeStmt = db.prepare(
        "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
      );
      insertRecipeStmt.run([recipeInputKey, inputDisplayJson]);
      insertRecipeStmt.free();

      const lastIdStmt = db.prepare(
        "SELECT last_insert_rowid() as id"
      );
      let recipeId: number | null = null;
      if (lastIdStmt.step()) {
        const lastIdRow = lastIdStmt.getAsObject() as any;
        recipeId = Number(lastIdRow.id);
      }
      lastIdStmt.free();
      if (!recipeId || Number.isNaN(recipeId)) {
        throw new Error("Failed to obtain recipe id");
      }

      const insertCandidateStmt = db.prepare(
        "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
      );
      insertCandidateStmt.run([
        recipeId,
        createdResultName,
        llmResult.icon,
        0,
      ]);
      insertCandidateStmt.free();

      const lastCandidateStmt = db.prepare(
        "SELECT last_insert_rowid() as id"
      );
      let chosenCandidateId: number | null = null;
      if (lastCandidateStmt.step()) {
        const lastCandidateRow = lastCandidateStmt.getAsObject() as any;
        chosenCandidateId = Number(lastCandidateRow.id);
      }
      lastCandidateStmt.free();
      if (!chosenCandidateId || Number.isNaN(chosenCandidateId)) {
        throw new Error("Failed to obtain candidate id");
      }

      const normalizedName = createdResultName.trim().toLowerCase();
      const elementId = ensureElement(db, {
        name: createdResultName,
        normalizedName,
        icon: llmResult.icon,
      });
      discoverElement(db, elementId);
      await syncSearchIndex(db, [elementId]);

      const updateRecipeStmt = db.prepare(
        "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateRecipeStmt.run([chosenCandidateId, elementId, recipeId]);
      updateRecipeStmt.free();

      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      console.error("Error inserting recipe", err);
      return res
        .status(500)
        .json({ error: "Failed to save generated result" });
    }

    persistDatabase(db);

    // Load back inserted data
    stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    recipeRow = stmt.getAsObject([recipeInputKey]);
    stmt.free();

    const candidatesStmt = db.prepare(
      "SELECT * FROM recipe_candidates WHERE recipe_id = ? ORDER BY order_index ASC"
    );
    const candidatesRows: any[] = [];
    while (candidatesStmt.step()) {
      candidatesRows.push(candidatesStmt.getAsObject());
    }
    candidatesStmt.free();

    const resultElement =
      recipeRow.result_element_id != null
        ? getElementById(db, Number(recipeRow.result_element_id))
        : undefined;

    return res.json(
      buildCombineResponse({
        recipeRow,
        candidates: candidatesRows,
        resultElement,
      })
    );
  } catch (err) {
    console.error("Unexpected error in /recipes/combine", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/select", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: "Invalid recipe id" });
  }

  const parsedBody = selectRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { candidateId } = parsedBody.data;

  try {
    const db = await getDb();

    // Ensure recipe exists
    let stmt = db.prepare("SELECT * FROM recipes WHERE id = ?");
    const recipeRow = stmt.getAsObject([recipeId]);
    stmt.free();
    if (!recipeRow || recipeRow.id === undefined) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Ensure candidate belongs to recipe
    stmt = db.prepare(
      "SELECT * FROM recipe_candidates WHERE id = ? AND recipe_id = ?"
    );
    const candidateRow = stmt.getAsObject([candidateId, recipeId]);
    stmt.free();
    if (!candidateRow || candidateRow.id === undefined) {
      return res
        .status(404)
        .json({ error: "Candidate not found for this recipe" });
    }

    const candidateName = toTitleCaseWords(String(candidateRow.name));
    const candidateIcon = String(candidateRow.icon ?? "✨");
    const normalizedName = candidateName.trim().toLowerCase();

    db.run("BEGIN");
    try {
      // Upsert element
      const elementId = ensureElement(db, {
        name: candidateName,
        normalizedName,
        icon: candidateIcon,
      });
      discoverElement(db, elementId);
      await syncSearchIndex(db, [elementId]);

      const updateRecipeStmt = db.prepare(
        "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateRecipeStmt.run([candidateId, elementId, recipeId]);
      updateRecipeStmt.free();

      db.run("COMMIT");

      // Fetch the resulting element for response
      const elementStmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE id = ?"
      );
      const elementRow = elementStmt.getAsObject([elementId]);
      elementStmt.free();

      persistDatabase(db);

      return res.json({
        recipeId,
        chosenCandidateId: candidateId,
        resultElement: elementRow
          ? {
              id: elementRow.id,
              name: elementRow.name,
              normalizedName: elementRow.normalized_name,
              icon: elementRow.icon ?? null,
            }
          : null,
      });
    } catch (err) {
      db.run("ROLLBACK");
      console.error("Error selecting candidate", err);
      return res
        .status(500)
        .json({ error: "Failed to select candidate" });
    }
  } catch (err) {
    console.error("Unexpected error in /recipes/:id/select", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
