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
  type GenerationTracePayload,
  OpenAiModel,
} from "../openaiClient";
import { ensureSearchIndexForElementIds } from "../search";
import type { WebSearchResult } from "../webSearchTypes";
import { searchGoogleLikeWeb } from "../webSearch";
import {
  deleteCombinationRunFeedbackForSession,
  getCombinationRunById,
  getLatestTraceForCombinationRun,
  insertCombinationRun,
  insertCombinationRunTrace,
  listRecentCombinationFeedback,
  upsertCombinationRunFeedback,
} from "../feedback";
import {
  combineRequestSchema,
  recipeFeedbackDeleteRequestSchema,
  recipeFeedbackRequestSchema,
} from "../validation";
import {
  buildCombineResponse,
  type ElementDTO,
  getElementById,
  getElementByNormalizedName,
  normalizeInputs,
  toTitleCaseWords,
} from "../models";
import { findAvailableQuestTargetMatch, syncQuestCompletions } from "../questState";

const router = express.Router();
const CACHE_BATCH_MODEL: OpenAiModel = "gpt-5-mini";
const CACHE_BATCH_SIZE = 25;
function buildRecipeInputKey(params: {
  inputKey: string;
  categoryConstraint: string | null;
  actionConstraint: string | null;
  creative: boolean;
  ponderificate: boolean;
}): string {
  const {
    inputKey,
    categoryConstraint,
    actionConstraint,
    creative,
    ponderificate,
  } = params;

  const normalizedCategoryConstraint = categoryConstraint?.trim().toLowerCase() ?? null;
  const normalizedActionConstraint = actionConstraint?.trim().toLowerCase() ?? null;

  const baseKey = normalizedActionConstraint && normalizedCategoryConstraint
    ? `action:${normalizedActionConstraint}|category:${normalizedCategoryConstraint}|${inputKey}`
    : normalizedActionConstraint
    ? `action:${normalizedActionConstraint}|${inputKey}`
    : normalizedCategoryConstraint
    ? `category:${normalizedCategoryConstraint}|${inputKey}`
    : creative
    ? `creative|${inputKey}`
    : inputKey;

  return ponderificate ? `ponderificate|${baseKey}` : baseKey;
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
    modeKey === "ponderificate" ||
    modeKey === "creative" ||
    modeKey.startsWith("action:") ||
    modeKey.startsWith("category:")
  );
}

type GeneratedResultOption = {
  name: string;
  icon: string;
  score?: number;
};

function normalizeGeneratedResultOptions(
  llmResult:
    | { name: string; icon: string }
    | { results: Array<{ name: string; icon: string }> }
    | {
        options: Array<{ name: string; icon: string; score: number }>;
        bestOption: { name: string; icon: string; score: number };
      },
  db: Awaited<ReturnType<typeof getDb>>,
  ponderificate: boolean
) {
  if ("options" in llmResult) {
    const options = llmResult.options.map((entry) => ({
      name: toTitleCaseWords(entry.name),
      icon: entry.icon,
      score: entry.score,
    }));
    const questMatch = findAvailableQuestTargetMatch(
      db,
      options.map((entry) => entry.name)
    );
    const selectedOption =
      (questMatch
        ? options.find(
            (entry) => entry.name.trim().toLowerCase() === questMatch.matchedItemName.trim().toLowerCase()
          )
        : null) ??
      options.find(
        (entry) =>
          entry.name.trim().toLowerCase() === llmResult.bestOption.name.trim().toLowerCase()
      ) ??
      options[0];

    if (!selectedOption) {
      throw new Error("Model returned no valid Ponderificate options");
    }

    return {
      responseKind: "options" as const,
      candidateOptions: options,
      selectedResult: selectedOption,
    };
  }

  const candidateOptions = ("results" in llmResult ? llmResult.results : [llmResult]).map(
    (entry) => ({
      name: toTitleCaseWords(entry.name),
      icon: entry.icon,
    })
  );
  const selectedResult = candidateOptions[0];
  if (!selectedResult) {
    throw new Error(
      ponderificate ? "Model returned no Ponderificate options" : "Model returned no split results"
    );
  }

  return {
    responseKind: "split" as const,
    candidateOptions,
    selectedResult,
  };
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
      "UPDATE recipes SET input_display_json = ?, result_element_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    updateRecipeStmt.run([params.inputDisplayJson, recipeId]);
    updateRecipeStmt.free();
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

  const elementId = ensureElement(params.db, {
    name: params.resultName,
    normalizedName: params.resultName.trim().toLowerCase(),
    icon: params.resultIcon,
  });

  const updateRecipeStmt = params.db.prepare(
    "UPDATE recipes SET result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  updateRecipeStmt.run([elementId, recipeId]);
  updateRecipeStmt.free();

  return { recipeId, elementId };
}

function recordCombinationRun(params: {
  db: Awaited<ReturnType<typeof getDb>>;
  recipeId?: number | null;
  resultElementId: number;
  inputKey: string;
  inputDisplayJson: string;
  inputTerms: string[];
  chosenName: string;
  chosenIcon: string | null;
  trace?: GenerationTracePayload | null;
  traceActionPromptFamily?: string | null;
  actionConstraint?: string | null;
  categoryConstraint?: string | null;
  creative?: boolean;
  ponderificate?: boolean;
  parsedResponseJsonOverride?: unknown;
}) {
  const runId = insertCombinationRun(params.db, {
    recipeId: params.recipeId ?? null,
    resultElementId: params.resultElementId,
    inputKey: params.inputKey,
    inputDisplayJson: params.inputDisplayJson,
    chosenName: params.chosenName,
    chosenIcon: params.chosenIcon,
  });

  if (params.trace) {
    insertCombinationRunTrace(params.db, {
      combinationRunId: runId,
      providerType: params.trace.providerType,
      model: params.trace.model,
      actionPromptFamily: params.traceActionPromptFamily ?? null,
      actionConstraint: params.actionConstraint ?? null,
      categoryConstraint: params.categoryConstraint ?? null,
      creative: params.creative ?? false,
      ponderificate: params.ponderificate ?? false,
      inputTerms: params.inputTerms,
      searchQuery: params.trace.searchQuery,
      searchResults: params.trace.searchResults,
      promptText: params.trace.prompt,
      rawResponseText: params.trace.rawResponseText,
      parsedResponseJson: params.parsedResponseJsonOverride ?? params.trace.parsedResponseJson,
    });
  }

  return runId;
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

    const batchTraceRef: {
      current: {
        model: string;
        prompt: string;
        rawResponseText: string;
        parsedResponseJson: unknown;
      } | null;
    } = { current: null };
    const batch = await generateRecipeBatch({
      model: CACHE_BATCH_MODEL,
      pairs: pairs.map((pair) => ({
        left: pair.left.name,
        right: pair.right.name,
      })),
      onTrace: (trace) => {
        batchTraceRef.current = trace;
      },
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

        recordCombinationRun({
          db,
          recipeId: upserted.recipeId,
          resultElementId: upserted.elementId,
          inputKey,
          inputDisplayJson: JSON.stringify(normalizedInputs),
          inputTerms: normalizedInputs.map((input) => input.name),
          chosenName: resultName,
          chosenIcon: generated.icon,
          trace: batchTraceRef.current
            ? {
                providerType: "openai_only",
                model: batchTraceRef.current.model,
                prompt: batchTraceRef.current.prompt,
                rawResponseText: batchTraceRef.current.rawResponseText,
                parsedResponseJson: batchTraceRef.current.parsedResponseJson,
                searchQuery: null,
                searchResults: null,
              }
            : null,
          parsedResponseJsonOverride: batchTraceRef.current
            ? {
                batch: batchTraceRef.current.parsedResponseJson,
                selectedRecipe: generated,
              }
            : undefined,
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
  const ponderificate = parsedBody.data.ponderificate ?? false;
  const categoryConstraint = parsedBody.data.categoryConstraint?.trim() || null;
  const actionConstraint = parsedBody.data.actionConstraint?.trim() || null;
  const model = parsedBody.data.model ?? DEFAULT_MODEL_NAME;
  const actionPromptFamily = resolveActionPromptFamily(actionConstraint);
  const usePopCultureSearch = actionPromptFamily?.key === "pop_culture";

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
      ponderificate,
    });
    const bypassCache =
      usePopCultureSearch || ponderificate || isCatalystRecipeInputKey(recipeInputKey);

    console.log("[api][combine] resolved mode", {
      inputKey,
      recipeInputKey,
      bypassCache,
      creative: effectiveCreative,
      ponderificate,
      usePopCultureSearch,
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
        ponderificate,
        usePopCultureSearch,
        categoryConstraint,
        actionConstraint,
        actionPromptFamily: actionPromptFamily?.key ?? null,
        recipeId: recipeRow.id,
        resultElementId: recipeRow.result_element_id ?? null,
      });
      // Load candidates
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
      let completedQuestMatches: Array<{ questName: string; matchedItemName: string }> = [];
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
          completedQuestMatches = completionResult.completedQuestMatches;
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
        });

        const backfillTraceRef: { current: GenerationTracePayload | null } = { current: null };
        const generated = await generateResult(
          normalizedInputs.map((i) => i.name),
          {
            creative: effectiveCreative,
            ponderificate,
            categoryConstraint: categoryConstraint ?? undefined,
            actionConstraint: actionConstraint ?? undefined,
            actionPromptFamily: actionPromptFamily?.key ?? null,
            model,
            onTrace: (trace) => {
              backfillTraceRef.current = trace;
            },
          }
        );
        console.log("[api][combine] backfill generated result", generated);
        const { selectedResult: generatedPrimary } = normalizeGeneratedResultOptions(
          generated,
          db,
          ponderificate
        );
        const chosenName = toTitleCaseWords(generatedPrimary.name);
        const chosenIcon = generatedPrimary.icon;

        const normalizedName = chosenName.trim().toLowerCase();
        const elementId = ensureElement(db, {
          name: chosenName,
          normalizedName,
          icon: chosenIcon,
        });
        const wasNewResultDiscovery = discoverElement(db, elementId);

        const updateRecipeStmt = db.prepare(
          "UPDATE recipes SET result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        updateRecipeStmt.run([
          elementId,
          Number(recipeRow.id),
        ]);
        updateRecipeStmt.free();

        recordCombinationRun({
          db,
          recipeId: Number(recipeRow.id),
          resultElementId: elementId,
          inputKey: String(recipeRow.input_key),
          inputDisplayJson: String(recipeRow.input_display_json),
          inputTerms: normalizedInputs.map((input) => input.name),
          chosenName,
          chosenIcon,
          trace: backfillTraceRef.current,
          traceActionPromptFamily: actionPromptFamily?.key ?? null,
          actionConstraint: actionConstraint ?? null,
          categoryConstraint: categoryConstraint ?? null,
          creative: effectiveCreative,
          ponderificate,
        });

        persistDatabase(db);

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
          completedQuestMatches = completionResult.completedQuestMatches;
          completedQuestSets = completionResult.completedQuestSets;
          awardedPoints = completionResult.awardedPoints;
          totalPoints = completionResult.totalPoints;
        }
        persistDatabase(db);
      }

      return res.json(
        buildCombineResponse({
          recipeRow,
          resultElement,
          autoUnlockedActionWords,
          newlyCompletedQuestNames,
          completedQuestMatches,
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
        ponderificate,
        usePopCultureSearch,
        categoryConstraint,
        actionConstraint,
        actionPromptFamily: actionPromptFamily?.key ?? null,
        inputs: orderedInputs.map((i) => i.name),
      }
    );
    let popCultureSearchResults: WebSearchResult[] | undefined;
    const generationTraceRef: { current: GenerationTracePayload | null } = { current: null };
    let llmResult;
    try {
      if (usePopCultureSearch) {
        popCultureSearchResults = await searchGoogleLikeWeb(
          orderedInputs.map((input) => input.name).join(" "),
          { limit: 3 }
        );

        console.log("[api][combine][pop-culture] using searxng search context", {
          inputs: orderedInputs.map((i) => i.name),
          requestedModel: model,
          searchResultCount: popCultureSearchResults.length,
        });
      }

      llmResult = await generateResult(orderedInputs.map((i) => i.name), {
        creative: effectiveCreative,
        ponderificate,
        categoryConstraint: categoryConstraint ?? undefined,
        actionConstraint: actionConstraint ?? undefined,
        actionPromptFamily: actionPromptFamily?.key ?? null,
        model,
        webSearchResults: popCultureSearchResults,
        onTrace: (trace) => {
          generationTraceRef.current = trace;
        },
      });
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
    const {
      responseKind,
      candidateOptions: generatedResults,
      selectedResult: primaryGeneratedResult,
    } = normalizeGeneratedResultOptions(llmResult, db, ponderificate);

    if (bypassCache) {
      const newlyDiscoveredQuestCandidateNames: string[] = [];
      const elementIds: number[] = [];

      if (responseKind === "options") {
        const normalizedName = primaryGeneratedResult.name.trim().toLowerCase();
        const elementId = ensureElement(db, {
          name: primaryGeneratedResult.name,
          normalizedName,
          icon: primaryGeneratedResult.icon,
        });
        elementIds.push(elementId);
        if (discoverElement(db, elementId)) {
          newlyDiscoveredQuestCandidateNames.push(primaryGeneratedResult.name);
        }
      } else {
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
      let completedQuestMatches: Array<{ questName: string; matchedItemName: string }> = [];
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
        completedQuestMatches = completionResult.completedQuestMatches;
        completedQuestSets = completionResult.completedQuestSets;
        awardedPoints = completionResult.awardedPoints;
        totalPoints = completionResult.totalPoints;
      }

      generatedResults.forEach((generatedResult, index) => {
        const resultElementId = elementIds[index];
        if (!resultElementId) {
          return;
        }
        recordCombinationRun({
          db,
          resultElementId,
          inputKey:
            responseKind === "split" && index > 0
              ? buildSecondaryStoredRecipeInputKey(recipeInputKey, index)
              : recipeInputKey,
          inputDisplayJson,
          inputTerms: orderedInputs.map((input) => input.name),
          chosenName: generatedResult.name,
          chosenIcon: generatedResult.icon,
          trace: generationTraceRef.current,
          traceActionPromptFamily: actionPromptFamily?.key ?? null,
          actionConstraint: actionConstraint ?? null,
          categoryConstraint: categoryConstraint ?? null,
          creative: effectiveCreative,
          ponderificate,
          parsedResponseJsonOverride:
            index === 0
              ? undefined
              : {
                  fullResponse: generationTraceRef.current?.parsedResponseJson ?? null,
                  selectedResult: generatedResult,
                },
        });
      });

      persistDatabase(db);

      return res.json({
        recipeId: -1,
        inputKey: recipeInputKey,
        inputs: displayInputs,
        resultElement,
        resultElements:
          responseKind === "split" && resultElements.length > 0 ? resultElements : undefined,
        autoUnlockedActionWords:
          autoUnlockedActionWords.length > 0 ? autoUnlockedActionWords : undefined,
        newlyCompletedQuestNames:
          newlyCompletedQuestNames.length > 0 ? newlyCompletedQuestNames : undefined,
        completedQuestMatches:
          completedQuestMatches.length > 0 ? completedQuestMatches : undefined,
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
      const additionalResults =
        responseKind === "split" ? generatedResults.slice(1) : [];
      for (const [extraIndex, extraResult] of additionalResults.entries()) {
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

        const updateSecondaryRecipeStmt = db.prepare(
          "UPDATE recipes SET result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        updateSecondaryRecipeStmt.run([
          extraElementId,
          secondaryRecipeId,
        ]);
        updateSecondaryRecipeStmt.free();

        recordCombinationRun({
          db,
          recipeId: secondaryRecipeId,
          resultElementId: extraElementId,
          inputKey: secondaryInputKey,
          inputDisplayJson,
          inputTerms: orderedInputs.map((input) => input.name),
          chosenName: extraResult.name,
          chosenIcon: extraResult.icon,
          trace: generationTraceRef.current,
          traceActionPromptFamily: actionPromptFamily?.key ?? null,
          actionConstraint: actionConstraint ?? null,
          categoryConstraint: categoryConstraint ?? null,
          creative: effectiveCreative,
          ponderificate,
          parsedResponseJsonOverride: {
            fullResponse: generationTraceRef.current?.parsedResponseJson ?? null,
            selectedResult: extraResult,
          },
        });
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
        "UPDATE recipes SET result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateRecipeStmt.run([elementId, recipeId]);
      updateRecipeStmt.free();

      recordCombinationRun({
        db,
        recipeId,
        resultElementId: elementId,
        inputKey: storedRecipeInputKey,
        inputDisplayJson,
        inputTerms: orderedInputs.map((input) => input.name),
        chosenName: primaryGeneratedResult.name,
        chosenIcon: primaryGeneratedResult.icon,
        trace: generationTraceRef.current,
        traceActionPromptFamily: actionPromptFamily?.key ?? null,
        actionConstraint: actionConstraint ?? null,
        categoryConstraint: categoryConstraint ?? null,
        creative: effectiveCreative,
        ponderificate,
      });

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
    let completedQuestMatches: Array<{ questName: string; matchedItemName: string }> = [];
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
      completedQuestMatches = completionResult.completedQuestMatches;
      completedQuestSets = completionResult.completedQuestSets;
      awardedPoints = completionResult.awardedPoints;
      totalPoints = completionResult.totalPoints;
      persistDatabase(db);
    }

    // Load back inserted data
    stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    recipeRow = stmt.getAsObject([storedRecipeInputKey]);
    stmt.free();

    const resultElement =
      recipeRow.result_element_id != null
        ? getElementById(db, Number(recipeRow.result_element_id))
        : undefined;
    const resultElements =
      responseKind === "split" && generatedResults.length > 1
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
        resultElement,
        resultElements,
        autoUnlockedActionWords,
        newlyCompletedQuestNames,
        completedQuestMatches,
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

router.post("/:id/feedback", async (req, res) => {
  const combinationRunId = Number(req.params.id);
  if (!Number.isInteger(combinationRunId) || combinationRunId <= 0) {
    return res.status(400).json({ error: "Invalid combination run id" });
  }

  const parsed = recipeFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feedback payload" });
  }

  try {
    const db = await getDb();
    const run = getCombinationRunById(db, combinationRunId);
    if (!run) {
      return res.status(404).json({ error: "Combination run not found" });
    }

    const latestTrace = getLatestTraceForCombinationRun(db, combinationRunId);
    console.log("[api][feedback] saving feedback", {
      combinationRunId,
      recipeId: run.recipeId,
      traceId: latestTrace?.id ?? null,
      clientSessionId: parsed.data.clientSessionId.trim(),
      sentiment: parsed.data.sentiment,
      hasExpectedResultText:
        typeof parsed.data.expectedResultText === "string" &&
        parsed.data.expectedResultText.trim().length > 0,
      hasCommentText:
        typeof parsed.data.commentText === "string" && parsed.data.commentText.trim().length > 0,
    });
    const feedback = upsertCombinationRunFeedback(db, {
      combinationRunId,
      traceId: latestTrace?.id ?? null,
      clientSessionId: parsed.data.clientSessionId.trim(),
      sentiment: parsed.data.sentiment,
      expectedResultText: parsed.data.expectedResultText ?? null,
      commentText: parsed.data.commentText ?? null,
    });
    persistDatabase(db);

    console.log("[api][feedback] saved feedback", {
      combinationRunId,
      recipeId: run.recipeId,
      feedbackId: feedback.id,
      traceId: feedback.traceId,
      operation: feedback.operation,
      sentiment: feedback.sentiment,
    });

    return res.json({
      ok: true,
      feedback: {
        sentiment: feedback.sentiment,
        expectedResultText: feedback.expectedResultText,
        commentText: feedback.commentText,
        updatedAt: feedback.updatedAt,
      },
    });
  } catch (err) {
    console.error("[api][recipes] failed to save feedback", err);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
});

router.delete("/:id/feedback", async (req, res) => {
  const combinationRunId = Number(req.params.id);
  if (!Number.isInteger(combinationRunId) || combinationRunId <= 0) {
    return res.status(400).json({ error: "Invalid combination run id" });
  }

  const parsed = recipeFeedbackDeleteRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feedback delete payload" });
  }

  try {
    const db = await getDb();
    const run = getCombinationRunById(db, combinationRunId);
    if (!run) {
      return res.status(404).json({ error: "Combination run not found" });
    }
    console.log("[api][feedback] clearing feedback", {
      combinationRunId,
      recipeId: run.recipeId,
      clientSessionId: parsed.data.clientSessionId.trim(),
    });
    const result = deleteCombinationRunFeedbackForSession(
      db,
      combinationRunId,
      parsed.data.clientSessionId.trim()
    );
    persistDatabase(db);
    console.log("[api][feedback] cleared feedback", {
      combinationRunId,
      recipeId: run.recipeId,
      clientSessionId: parsed.data.clientSessionId.trim(),
      deleted: result.deleted,
    });
    return res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    console.error("[api][feedback] failed to clear feedback", err);
    return res.status(500).json({ error: "Failed to clear feedback" });
  }
});

router.get("/feedback/list", async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 100;

  try {
    const db = await getDb();
    const feedback = listRecentCombinationFeedback(db, limit);
    console.log("[api][feedback] listing feedback", {
      limit,
      count: feedback.length,
    });
    return res.json({
      feedback,
    });
  } catch (err) {
    console.error("[api][recipes] failed to list feedback", err);
    return res.status(500).json({ error: "Failed to load feedback" });
  }
});

export default router;
