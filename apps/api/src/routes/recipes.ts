import express from "express";
import {
  normalizeActionTrigger,
  resolveActionPromptFamily,
} from "../actionPromptFamilies";
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
  type ElementDTO,
  getElementById,
  getElementByNormalizedName,
  normalizeInputs,
  toTitleCaseWords,
} from "../models";
import { syncQuestCompletions } from "../questState";

const router = express.Router();
const CACHE_BATCH_MODEL: OpenAiModel = "gpt-5-mini";
const CACHE_BATCH_SIZE = 25;
function buildRecipeInputKey(params: {
  inputKey: string;
  categoryConstraint: string | null;
  actionConstraint: string | null;
  creative: boolean;
}): string {
  const {
    inputKey,
    categoryConstraint,
    actionConstraint,
    creative,
  } = params;

  const normalizedCategoryConstraint = categoryConstraint?.trim().toLowerCase() ?? null;
  const normalizedActionConstraint = actionConstraint?.trim().toLowerCase() ?? null;

  return normalizedActionConstraint && normalizedCategoryConstraint
    ? `action:${normalizedActionConstraint}|category:${normalizedCategoryConstraint}|${inputKey}`
    : normalizedActionConstraint
    ? `action:${normalizedActionConstraint}|${inputKey}`
    : normalizedCategoryConstraint
    ? `category:${normalizedCategoryConstraint}|${inputKey}`
    : creative
    ? `creative|${inputKey}`
    : inputKey;
}

function buildStoredRecipeInputKey(baseInputKey: string, bypassCache: boolean): string {
  if (!bypassCache) {
    return baseInputKey;
  }

  return `${baseInputKey}::run:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildSecondaryStoredRecipeInputKey(baseStoredInputKey: string, outputIndex: number) {
  return `${baseStoredInputKey}::output:${outputIndex}`;
}

function isCatalystRecipeInputKey(inputKey: string): boolean {
  const modeKey = inputKey.split("|", 1)[0] ?? "";
  return (
    modeKey === "creative" ||
    modeKey.startsWith("action:") ||
    modeKey.startsWith("category:")
  );
}

function maybeAutoUnlockActionWords(
  db: Awaited<ReturnType<typeof getDb>>,
  discoveredItems: Array<{ name: string }>
): Array<{
  familyKey: string;
  familyTitle: string;
  triggerWord: string;
  element: ElementDTO;
}> {
  const unlocked: Array<{
    familyKey: string;
    familyTitle: string;
    triggerWord: string;
    element: ElementDTO;
  }> = [];
  const processedFamilies = new Set<string>();

  for (const discoveredItem of discoveredItems) {
    const normalizedTrigger = normalizeActionTrigger(discoveredItem.name);
    if (!normalizedTrigger) continue;
    const family = resolveActionPromptFamily(normalizedTrigger);
    if (!family || processedFamilies.has(family.key)) {
      continue;
    }
    processedFamilies.add(family.key);

    const normalizedCanonical = family.canonicalWord.trim().toLowerCase();
    const canonicalElementId = ensureElement(db, {
      name: family.title,
      normalizedName: normalizedCanonical,
      icon: null,
    });
    const wasNewDiscovery = discoverElement(db, canonicalElementId);
    if (!wasNewDiscovery) {
      continue;
    }

    const element = getElementById(db, canonicalElementId);
    if (!element) {
      continue;
    }

    unlocked.push({
      familyKey: family.key,
      familyTitle: family.title,
      triggerWord: discoveredItem.name,
      element,
    });
  }

  return unlocked;
}

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
  const categoryConstraint = parsedBody.data.categoryConstraint?.trim() || null;
  const actionConstraint = parsedBody.data.actionConstraint?.trim() || null;
  const model = parsedBody.data.model ?? DEFAULT_MODEL_NAME;
  const actionPromptFamily = resolveActionPromptFamily(actionConstraint);

  const { normalizedInputs, inputKey } = normalizeInputs(
    parsedBody.data.inputs
  );
  const orderedInputs = normalizeInputs(parsedBody.data.inputs, {
    preserveOrder: actionPromptFamily?.key === "compound",
  }).normalizedInputs;

  if (normalizedInputs.length === 0) {
    return res.status(400).json({ error: "No valid inputs provided" });
  }

  try {
    const db = await getDb();
    const effectiveCreative = creative;

    const recipeInputKey = buildRecipeInputKey({
      inputKey,
      categoryConstraint,
      actionConstraint,
      creative: effectiveCreative,
    });
    const bypassCache = isCatalystRecipeInputKey(recipeInputKey);

    console.log("[api][combine] resolved mode", {
      inputKey,
      recipeInputKey,
      bypassCache,
      creative: effectiveCreative,
      categoryConstraint,
      actionConstraint,
      actionPromptFamily: actionPromptFamily?.key ?? null,
    });

    let stmt;
    let recipeRow: any = null;

    if (!bypassCache) {
      // Look up existing recipe
      stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
      recipeRow = stmt.getAsObject([recipeInputKey]);
      stmt.free();
    }

    if (recipeRow && recipeRow.id !== undefined) {
      console.log("[api][combine] cache hit", {
        inputKey: recipeInputKey,
        creative,
        categoryConstraint,
        actionConstraint,
        actionPromptFamily: actionPromptFamily?.key ?? null,
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
      let autoUnlockedActionWords: Array<{
        familyKey: string;
        familyTitle: string;
        triggerWord: string;
        element: ElementDTO;
      }> = [];
      let newlyCompletedQuestNames: string[] = [];
      let completedQuestSets: Array<{
        id: string;
        title: string;
        topic: string;
        questCount: number;
        earnedPoints: number;
      }> = [];
      let awardedPoints = 0;
      let totalPoints: number | undefined;

      if (resultElement) {
        const wasNewResultDiscovery = discoverElement(db, Number(resultElement.id));
        autoUnlockedActionWords = maybeAutoUnlockActionWords(db, [resultElement]);
        await syncSearchIndex(db, [
          Number(resultElement.id),
          ...autoUnlockedActionWords.map((entry) => entry.element.id),
        ]);
        const candidateNames = [
          ...(wasNewResultDiscovery ? [resultElement.name] : []),
          ...autoUnlockedActionWords.map((entry) => entry.element.name),
        ];
        if (candidateNames.length > 0) {
          const completionResult = await syncQuestCompletions(db, {
            candidateNames,
          });
          newlyCompletedQuestNames = completionResult.newlyCompletedQuestNames;
          completedQuestSets = completionResult.completedQuestSets;
          awardedPoints = completionResult.awardedPoints;
          totalPoints = completionResult.totalPoints;
        }
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
            {
              creative: effectiveCreative,
              categoryConstraint: categoryConstraint ?? undefined,
              actionConstraint: actionConstraint ?? undefined,
              actionPromptFamily: actionPromptFamily?.key ?? null,
              model,
            }
          );
          console.log("[api][combine] backfill generated result", generated);
          const generatedPrimary = "results" in generated ? generated.results[0] : generated;
          if (!generatedPrimary) {
            throw new Error("Failed to backfill generated result");
          }

          const insertCandidateStmt = db.prepare(
            "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
          );
          const generatedName = toTitleCaseWords(generatedPrimary.name);
          insertCandidateStmt.run([
            Number(recipeRow.id),
            generatedName,
            generatedPrimary.icon,
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
          chosenIcon = generatedPrimary.icon;
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
        const wasNewResultDiscovery = discoverElement(db, elementId);

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
        autoUnlockedActionWords = resultElement
          ? maybeAutoUnlockActionWords(db, [resultElement])
          : [];
        await syncSearchIndex(db, [
          elementId,
          ...autoUnlockedActionWords.map((entry) => entry.element.id),
        ]);
        const candidateNames = [
          ...(wasNewResultDiscovery && resultElement ? [resultElement.name] : []),
          ...autoUnlockedActionWords.map((entry) => entry.element.name),
        ];
        if (candidateNames.length > 0) {
          const completionResult = await syncQuestCompletions(db, {
            candidateNames,
          });
          newlyCompletedQuestNames = completionResult.newlyCompletedQuestNames;
          completedQuestSets = completionResult.completedQuestSets;
          awardedPoints = completionResult.awardedPoints;
          totalPoints = completionResult.totalPoints;
        }
        persistDatabase(db);
      }

      return res.json(
        buildCombineResponse({
          recipeRow,
          candidates: candidatesRows,
          resultElement,
          autoUnlockedActionWords,
          newlyCompletedQuestNames,
          completedQuestSets,
          awardedPoints,
          totalPoints,
        })
      );
    }

    // Not found or bypassed: generate a single result via OpenAI
    const storedRecipeInputKey = buildStoredRecipeInputKey(recipeInputKey, bypassCache);
    console.log(
      bypassCache
        ? "[api][combine] catalyst mode bypassing cache; generating via OpenAI"
        : "[api][combine] cache miss; generating via OpenAI",
      {
        inputKey: recipeInputKey,
        storedRecipeInputKey,
        bypassCache,
        creative,
        categoryConstraint,
        actionConstraint,
        actionPromptFamily: actionPromptFamily?.key ?? null,
        inputs: orderedInputs.map((i) => i.name),
      }
    );
    let llmResult;
    try {
      llmResult = await generateResult(
        orderedInputs.map((i) => i.name),
        {
          creative: effectiveCreative,
          categoryConstraint: categoryConstraint ?? undefined,
          actionConstraint: actionConstraint ?? undefined,
          actionPromptFamily: actionPromptFamily?.key ?? null,
          model,
        }
      );
      console.log("[api][combine] OpenAI result", llmResult);
    } catch (err) {
      console.error("Error generating result", err);
      const message =
        err instanceof Error ? err.message : "Failed to generate result from model";
      return res.status(502).json({ error: message });
    }

    const displayInputs = actionConstraint && categoryConstraint
      ? [
          {
            name: actionConstraint,
            normalized: actionConstraint.trim().toLowerCase(),
          },
          {
            name: categoryConstraint,
            normalized: categoryConstraint.trim().toLowerCase(),
          },
          ...normalizedInputs,
        ]
      : actionConstraint
        ? [
          {
            name: actionConstraint,
            normalized: actionConstraint.trim().toLowerCase(),
          },
          ...orderedInputs,
        ]
      : categoryConstraint
      ? [
          {
            name: categoryConstraint,
            normalized: categoryConstraint.trim().toLowerCase(),
          },
          ...orderedInputs,
        ]
      : orderedInputs;
    const inputDisplayJson = JSON.stringify(displayInputs);
    const generatedResults = ("results" in llmResult ? llmResult.results : [llmResult]).map(
      (entry) => ({
        name: toTitleCaseWords(entry.name),
        icon: entry.icon,
      })
    );
    const primaryGeneratedResult = generatedResults[0];
    if (!primaryGeneratedResult) {
      return res.status(502).json({ error: "Model returned no split results" });
    }

    if (bypassCache) {
      const newlyDiscoveredQuestCandidateNames: string[] = [];
      const elementIds: number[] = [];

      for (const generatedResult of generatedResults) {
        const normalizedName = generatedResult.name.trim().toLowerCase();
        const elementId = ensureElement(db, {
          name: generatedResult.name,
          normalizedName,
          icon: generatedResult.icon,
        });
        elementIds.push(elementId);
        if (discoverElement(db, elementId)) {
          newlyDiscoveredQuestCandidateNames.push(generatedResult.name);
        }
      }

      const resultElements = elementIds
        .map((id) => getElementById(db, id))
        .filter((element): element is ElementDTO => element != null);
      const resultElement = resultElements[0];

      const autoUnlockedActionWords = maybeAutoUnlockActionWords(db, resultElements);
      await syncSearchIndex(db, [
        ...elementIds,
        ...autoUnlockedActionWords.map((entry) => entry.element.id),
      ]);

      newlyDiscoveredQuestCandidateNames.push(
        ...autoUnlockedActionWords.map((entry) => entry.element.name)
      );

      let newlyCompletedQuestNames: string[] = [];
      let completedQuestSets: Array<{
        id: string;
        title: string;
        topic: string;
        questCount: number;
        earnedPoints: number;
      }> = [];
      let awardedPoints = 0;
      let totalPoints: number | undefined;
      if (newlyDiscoveredQuestCandidateNames.length > 0) {
        const completionResult = await syncQuestCompletions(db, {
          candidateNames: newlyDiscoveredQuestCandidateNames,
        });
        newlyCompletedQuestNames = completionResult.newlyCompletedQuestNames;
        completedQuestSets = completionResult.completedQuestSets;
        awardedPoints = completionResult.awardedPoints;
        totalPoints = completionResult.totalPoints;
      }

      persistDatabase(db);

      return res.json({
        recipeId: -1,
        inputKey: recipeInputKey,
        inputs: displayInputs,
        candidates: generatedResults.map((entry, index) => ({
          id: -(index + 1),
          name: entry.name,
          icon: entry.icon,
          orderIndex: index,
        })),
        chosenCandidateId: null,
        resultElement,
        resultElements: resultElements.length > 0 ? resultElements : undefined,
        autoUnlockedActionWords:
          autoUnlockedActionWords.length > 0 ? autoUnlockedActionWords : undefined,
        newlyCompletedQuestNames:
          newlyCompletedQuestNames.length > 0 ? newlyCompletedQuestNames : undefined,
        completedQuestSets: completedQuestSets.length > 0 ? completedQuestSets : undefined,
        awardedPoints: awardedPoints > 0 ? awardedPoints : undefined,
        totalPoints,
      });
    }

    // Insert recipe, generated result candidate, and canonical selection
    db.run("BEGIN");
    let autoUnlockedActionWords: Array<{
      familyKey: string;
      familyTitle: string;
      triggerWord: string;
      element: ElementDTO;
    }> = [];
    const newlyDiscoveredQuestCandidateNames: string[] = [];
    try {
      const insertRecipeStmt = db.prepare(
        "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
      );
      insertRecipeStmt.run([storedRecipeInputKey, inputDisplayJson]);
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
        primaryGeneratedResult.name,
        primaryGeneratedResult.icon,
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

      const normalizedName = primaryGeneratedResult.name.trim().toLowerCase();
      const elementId = ensureElement(db, {
        name: primaryGeneratedResult.name,
        normalizedName,
        icon: primaryGeneratedResult.icon,
      });
      if (discoverElement(db, elementId)) {
        newlyDiscoveredQuestCandidateNames.push(primaryGeneratedResult.name);
      }
      const additionalElementIds: number[] = [];
      for (const [extraIndex, extraResult] of generatedResults.slice(1).entries()) {
        const extraElementId = ensureElement(db, {
          name: extraResult.name,
          normalizedName: extraResult.name.trim().toLowerCase(),
          icon: extraResult.icon,
        });
        if (discoverElement(db, extraElementId)) {
          newlyDiscoveredQuestCandidateNames.push(extraResult.name);
        }
        additionalElementIds.push(extraElementId);

        const secondaryInputKey = buildSecondaryStoredRecipeInputKey(
          storedRecipeInputKey,
          extraIndex + 1
        );

        const insertSecondaryRecipeStmt = db.prepare(
          "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
        );
        insertSecondaryRecipeStmt.run([secondaryInputKey, inputDisplayJson]);
        insertSecondaryRecipeStmt.free();

        const secondaryRecipeIdStmt = db.prepare(
          "SELECT last_insert_rowid() as id"
        );
        let secondaryRecipeId: number | null = null;
        if (secondaryRecipeIdStmt.step()) {
          const row = secondaryRecipeIdStmt.getAsObject() as any;
          secondaryRecipeId = Number(row.id);
        }
        secondaryRecipeIdStmt.free();
        if (!secondaryRecipeId || Number.isNaN(secondaryRecipeId)) {
          throw new Error("Failed to obtain secondary recipe id");
        }

        const insertSecondaryCandidateStmt = db.prepare(
          "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
        );
        insertSecondaryCandidateStmt.run([
          secondaryRecipeId,
          extraResult.name,
          extraResult.icon,
          0,
        ]);
        insertSecondaryCandidateStmt.free();

        const secondaryCandidateIdStmt = db.prepare(
          "SELECT last_insert_rowid() as id"
        );
        let secondaryCandidateId: number | null = null;
        if (secondaryCandidateIdStmt.step()) {
          const row = secondaryCandidateIdStmt.getAsObject() as any;
          secondaryCandidateId = Number(row.id);
        }
        secondaryCandidateIdStmt.free();
        if (!secondaryCandidateId || Number.isNaN(secondaryCandidateId)) {
          throw new Error("Failed to obtain secondary candidate id");
        }

        const updateSecondaryRecipeStmt = db.prepare(
          "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        updateSecondaryRecipeStmt.run([
          secondaryCandidateId,
          extraElementId,
          secondaryRecipeId,
        ]);
        updateSecondaryRecipeStmt.free();
      }
      const resultElementsForUnlocks = [getElementById(db, elementId), ...additionalElementIds.map((id) => getElementById(db, id))]
        .filter((element): element is ElementDTO => element != null);
      autoUnlockedActionWords = maybeAutoUnlockActionWords(db, resultElementsForUnlocks);
      await syncSearchIndex(db, [
        elementId,
        ...additionalElementIds,
        ...autoUnlockedActionWords.map((entry) => entry.element.id),
      ]);

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

    newlyDiscoveredQuestCandidateNames.push(
      ...autoUnlockedActionWords.map((entry) => entry.element.name)
    );
    let newlyCompletedQuestNames: string[] = [];
    let completedQuestSets: Array<{
      id: string;
      title: string;
      topic: string;
      questCount: number;
      earnedPoints: number;
    }> = [];
    let awardedPoints = 0;
    let totalPoints: number | undefined;
    if (newlyDiscoveredQuestCandidateNames.length > 0) {
      const completionResult = await syncQuestCompletions(db, {
        candidateNames: newlyDiscoveredQuestCandidateNames,
      });
      newlyCompletedQuestNames = completionResult.newlyCompletedQuestNames;
      completedQuestSets = completionResult.completedQuestSets;
      awardedPoints = completionResult.awardedPoints;
      totalPoints = completionResult.totalPoints;
      persistDatabase(db);
    }

    // Load back inserted data
    stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    recipeRow = stmt.getAsObject([storedRecipeInputKey]);
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
    const resultElements =
      generatedResults.length > 1
        ? generatedResults
            .map((generatedResult) =>
              getElementByNormalizedName(db, generatedResult.name.trim().toLowerCase())
            )
            .filter((element): element is NonNullable<typeof element> => element != null)
        : resultElement
          ? [resultElement]
          : [];

    return res.json(
      buildCombineResponse({
        recipeRow,
        candidates: candidatesRows,
        resultElement,
        resultElements,
        autoUnlockedActionWords,
        newlyCompletedQuestNames,
        completedQuestSets,
        awardedPoints,
        totalPoints,
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
      const wasNewResultDiscovery = discoverElement(db, elementId);
      const resultElement = getElementById(db, elementId);
      const autoUnlockedActionWords = resultElement
        ? maybeAutoUnlockActionWords(db, [resultElement])
        : [];
      await syncSearchIndex(db, [
        elementId,
        ...autoUnlockedActionWords.map((entry) => entry.element.id),
      ]);

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

      const candidateNames = [
        ...(wasNewResultDiscovery ? [candidateName] : []),
        ...autoUnlockedActionWords.map((entry) => entry.element.name),
      ];
      let newlyCompletedQuestNames: string[] = [];
      let completedQuestSets: Array<{
        id: string;
        title: string;
        topic: string;
        questCount: number;
        earnedPoints: number;
      }> = [];
      let awardedPoints = 0;
      let totalPoints: number | undefined;
      if (candidateNames.length > 0) {
        const completionResult = await syncQuestCompletions(db, {
          candidateNames,
        });
        newlyCompletedQuestNames = completionResult.newlyCompletedQuestNames;
        completedQuestSets = completionResult.completedQuestSets;
        awardedPoints = completionResult.awardedPoints;
        totalPoints = completionResult.totalPoints;
        persistDatabase(db);
      }

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
        autoUnlockedActionWords,
        newlyCompletedQuestNames:
          newlyCompletedQuestNames.length > 0 ? newlyCompletedQuestNames : undefined,
        completedQuestSets: completedQuestSets.length > 0 ? completedQuestSets : undefined,
        awardedPoints: awardedPoints > 0 ? awardedPoints : undefined,
        totalPoints,
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
