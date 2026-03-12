import express from "express";
import { Database } from "sql.js";
import {
  BASE_ELEMENTS,
  ensureElement,
  getDb,
  persistDatabase,
} from "../db";
import {
  chooseQuestInputs,
  generateQuestChain,
  generateResult,
  OpenAiModel,
} from "../openaiClient";
import { normalizeInputs, toTitleCaseWords } from "../models";
import { generateQuestRequestSchema } from "../validation";

type CacheItem = {
  name: string;
  normalizedName: string;
};

type QuestStep = {
  target: string;
  normalizedTarget: string;
  inputs: string[];
  normalizedInputs: string[];
  recipeId: number;
};

const router = express.Router();

const QUEST_STEP_COUNT = 3;
const STEP_RETRY_LIMIT = 40;
const QUEST_MODEL: OpenAiModel = "gpt-5-nano";
const QUEST_INPUT_SAMPLE_SIZE = 100;

function randomFrom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function sampleItems<T>(items: T[], sampleSize: number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(sampleSize, copy.length));
}

function loadCacheItems(db: Database) {
  const stmt = db.prepare(`
    SELECT DISTINCT
      e.name,
      e.normalized_name
    FROM recipes r
    JOIN elements e ON e.id = r.result_element_id
    WHERE r.result_element_id IS NOT NULL
  `);

  const items: CacheItem[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    items.push({
      name: String(row.name),
      normalizedName: String(row.normalized_name),
    });
  }
  stmt.free();

  return items;
}

function loadCachedResultNames(db: Database) {
  return new Set(loadCacheItems(db).map((item) => item.normalizedName));
}

function getBaseQuestItems(): CacheItem[] {
  return BASE_ELEMENTS.map((element) => ({
    name: element.name,
    normalizedName: element.name.trim().toLowerCase(),
  }));
}

function mergeUniqueItems(...groups: CacheItem[][]) {
  const byName = new Map<string, CacheItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!byName.has(item.normalizedName)) {
        byName.set(item.normalizedName, item);
      }
    }
  }
  return [...byName.values()];
}

function findItemByName(items: CacheItem[], rawName: string) {
  const normalized = rawName.trim().toLowerCase();
  return items.find((item) => item.normalizedName === normalized) ?? null;
}

function loadUsedInputNames(db: Database) {
  const stmt = db.prepare("SELECT input_display_json FROM recipes");
  const used = new Set<string>();

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const inputs = JSON.parse(String(row.input_display_json)) as Array<{
      normalized: string;
    }>;
    inputs.forEach((input) => used.add(input.normalized));
  }
  stmt.free();

  return used;
}

function getRecipeIdByInputKey(db: Database, inputKey: string) {
  const stmt = db.prepare("SELECT id FROM recipes WHERE input_key = ?");
  const row = stmt.getAsObject([inputKey]);
  stmt.free();
  return row?.id !== undefined ? Number(row.id) : null;
}

function insertHiddenRecipe(params: {
  db: Database;
  inputKey: string;
  inputDisplayJson: string;
  resultName: string;
  resultIcon: string;
}) {
  let recipeId = getRecipeIdByInputKey(params.db, params.inputKey);

  if (recipeId) {
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
    throw new Error("Failed to create hidden quest recipe");
  }

  const insertCandidateStmt = params.db.prepare(
    "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
  );
  insertCandidateStmt.run([
    recipeId,
    params.resultName,
    params.resultIcon,
    0,
  ]);
  insertCandidateStmt.free();

  const candidateIdStmt = params.db.prepare(
    "SELECT last_insert_rowid() AS id"
  );
  let candidateId: number | null = null;
  if (candidateIdStmt.step()) {
    const row = candidateIdStmt.getAsObject() as Record<string, unknown>;
    candidateId = Number(row.id);
  }
  candidateIdStmt.free();

  if (!candidateId || Number.isNaN(candidateId)) {
    throw new Error("Failed to create hidden quest candidate");
  }

  const updateRecipeStmt = params.db.prepare(
    "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const elementId = ensureElement(params.db, {
    name: params.resultName,
    normalizedName: params.resultName.trim().toLowerCase(),
    icon: params.resultIcon,
  });
  updateRecipeStmt.run([candidateId, elementId, recipeId]);
  updateRecipeStmt.free();

  return recipeId;
}

async function generateHiddenQuestStep(params: {
  left: CacheItem;
  right: CacheItem;
  model: OpenAiModel;
}) {
  const { normalizedInputs, inputKey } = normalizeInputs([
    params.left.name,
    params.right.name,
  ]);

  const llmResult = await generateResult(
    normalizedInputs.map((input) => input.name),
    { model: params.model }
  );
  const resultName = toTitleCaseWords(llmResult.name);
  const normalizedResultName = resultName.trim().toLowerCase();

  return {
    inputKey,
    inputDisplayJson: JSON.stringify(normalizedInputs),
    resultIcon: llmResult.icon,
    nextItem: {
      name: resultName,
      normalizedName: normalizedResultName,
    },
    step: {
      target: resultName,
      normalizedTarget: normalizedResultName,
      inputs: normalizedInputs.map((input) => input.name),
      normalizedInputs: normalizedInputs.map((input) => input.normalized),
      recipeId: 0,
    } satisfies QuestStep,
  };
}

function isRejectedIntermediateResult(params: {
  step: QuestStep;
  generatedOutputs: Set<string>;
}) {
  return (
    params.step.normalizedInputs.includes(params.step.normalizedTarget) ||
    params.generatedOutputs.has(params.step.normalizedTarget)
  );
}

function isRejectedFinalResult(params: {
  step: QuestStep;
  generatedOutputs: Set<string>;
  discoveredItems: Set<string>;
  cachedResultNames: Set<string>;
  baseItems: Set<string>;
}) {
  return (
    isRejectedIntermediateResult({
      step: params.step,
      generatedOutputs: params.generatedOutputs,
    }) ||
    params.baseItems.has(params.step.normalizedTarget) ||
    params.discoveredItems.has(params.step.normalizedTarget) ||
    params.cachedResultNames.has(params.step.normalizedTarget)
  );
}

async function pickQuestInputs(params: {
  leafItems: CacheItem[];
  currentItem: CacheItem | null;
  curatedItems: CacheItem[];
}) {
  if (params.currentItem) {
    const candidatePool = params.curatedItems.length
      ? params.curatedItems
      : params.leafItems;
    const right = randomFrom(candidatePool);

    return {
      left: params.currentItem,
      right,
    };
  }

  return {
    left: randomFrom(params.leafItems),
    right: randomFrom(
      params.curatedItems.length ? params.curatedItems : params.leafItems
    ),
  };
}

router.post("/generate", async (req, res) => {
  const parsedBody = generateQuestRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const db = await getDb();
    const cacheItems = loadCacheItems(db);
    const cachedResultNames = loadCachedResultNames(db);
    const usedInputNames = loadUsedInputNames(db);
    const discoveredItems = new Set(
      parsedBody.data.discoveredItems.map((item) => item.trim().toLowerCase())
    );
    const baseItems = new Set(["fire", "water", "earth", "air"]);
    const baseQuestItems = getBaseQuestItems();
    const leafItems = cacheItems.filter(
      (item) => !usedInputNames.has(item.normalizedName)
    );
    const questSourceItems = mergeUniqueItems(cacheItems, baseQuestItems);

    if (questSourceItems.length === 0) {
      console.error("[api][quest] no source items available", {
        cacheItemCount: cacheItems.length,
        leafItemCount: leafItems.length,
      });
      return res.status(400).json({
        error: "Not enough items to generate a quest",
      });
    }

    const sampledQuestItems = sampleItems(questSourceItems, QUEST_INPUT_SAMPLE_SIZE);
    const startPool = leafItems.length > 0 ? leafItems : baseQuestItems;
    const startItem = randomFrom(startPool);

    console.log("[api][quest] generation inputs", {
      startPool: leafItems.length > 0 ? "cache-leaves" : "base-elements",
      startItem: startItem.name,
      cacheItemCount: cacheItems.length,
      leafItemCount: leafItems.length,
      candidateCount: sampledQuestItems.length,
    });

    const chainPlan = await generateQuestChain({
      model: QUEST_MODEL,
      startItem: startItem.name,
      candidateItems: sampledQuestItems.map((item) => item.name),
    });

    const questSteps: QuestStep[] = [];
    const generatedOutputs = new Set<string>();
    let currentItem: CacheItem = startItem;

    for (let index = 0; index < chainPlan.steps.length; index += 1) {
      const plannedStep = chainPlan.steps[index];
      const right = findItemByName(baseQuestItems, plannedStep.right);
      const rightItem =
        findItemByName(sampledQuestItems, plannedStep.right) ??
        findItemByName(questSourceItems, plannedStep.right) ??
        right;

      if (!rightItem) {
        return res.status(500).json({
          error: `Quest chain referenced unknown partner item: ${plannedStep.right}`,
        });
      }

      const { normalizedInputs, inputKey } = normalizeInputs([
        currentItem.name,
        rightItem.name,
      ]);

      const step: QuestStep = {
        target: toTitleCaseWords(plannedStep.result),
        normalizedTarget: plannedStep.result.trim().toLowerCase(),
        inputs: normalizedInputs.map((input) => input.name),
        normalizedInputs: normalizedInputs.map((input) => input.normalized),
        recipeId: 0,
      };

      const rejected =
        index === QUEST_STEP_COUNT - 1
          ? isRejectedFinalResult({
              step,
              generatedOutputs,
              discoveredItems,
              cachedResultNames,
              baseItems,
            })
          : isRejectedIntermediateResult({
              step,
              generatedOutputs,
            });

      if (rejected) {
        return res.status(500).json({
          error: `Quest chain produced rejected result: ${step.target}`,
        });
      }

      const recipeId = insertHiddenRecipe({
        db,
        inputKey,
        inputDisplayJson: JSON.stringify(normalizedInputs),
        resultName: step.target,
        resultIcon: plannedStep.icon,
      });
      step.recipeId = recipeId;

      console.log(
        `[api][quest] step=${index + 1} planned formula="${step.inputs.join(
          " + "
        )} -> ${step.target}" recipeKey="${inputKey}" recipeId=${recipeId}`
      );

      questSteps.push(step);
      generatedOutputs.add(step.normalizedTarget);
      currentItem = {
        name: step.target,
        normalizedName: step.normalizedTarget,
      };
    }

    persistDatabase(db);

    const compactPath = questSteps
      .map((step) => `${step.inputs.join(" + ")} -> ${step.target}`)
      .join(" | ");

    console.log(
      `[api][quest] generated hidden quest target="${currentItem?.name ?? ""}" steps=${questSteps.length} path="${compactPath}"`
    );

    return res.json({
      name: currentItem.name,
      normalizedName: currentItem.normalizedName,
      steps: questSteps,
    });
  } catch (err) {
    console.error("[api][quest] failed to generate quest", err);
    return res.status(500).json({ error: "Failed to generate quest" });
  }
});

export default router;
