import express from "express";
import { Database } from "sql.js";
import { getDb, persistDatabase } from "../db";
import {
  chooseQuestInputs,
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
const QUEST_INPUT_SAMPLE_SIZE = 50;

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

function recipeExists(db: Database, inputKey: string) {
  const stmt = db.prepare("SELECT id FROM recipes WHERE input_key = ?");
  const row = stmt.getAsObject([inputKey]);
  stmt.free();
  return row?.id !== undefined;
}

function insertHiddenRecipe(params: {
  db: Database;
  inputKey: string;
  inputDisplayJson: string;
  resultName: string;
  resultIcon: string;
}) {
  const insertRecipeStmt = params.db.prepare(
    "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
  );
  insertRecipeStmt.run([params.inputKey, params.inputDisplayJson]);
  insertRecipeStmt.free();

  const recipeIdStmt = params.db.prepare("SELECT last_insert_rowid() AS id");
  let recipeId: number | null = null;
  if (recipeIdStmt.step()) {
    const row = recipeIdStmt.getAsObject() as Record<string, unknown>;
    recipeId = Number(row.id);
  }
  recipeIdStmt.free();

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
    const leafItems = cacheItems.filter(
      (item) => !usedInputNames.has(item.normalizedName)
    );
    const discoveredItems = new Set(
      parsedBody.data.discoveredItems.map((item) => item.trim().toLowerCase())
    );
    const baseItems = new Set(["fire", "water", "earth", "air"]);

    if (cacheItems.length < 2 || leafItems.length === 0) {
      return res.status(400).json({
        error: "Not enough cached items to generate a quest",
      });
    }

    const sampledQuestItems = sampleItems(cacheItems, QUEST_INPUT_SAMPLE_SIZE);
    const curatedItemChoice = await chooseQuestInputs({
      model: QUEST_MODEL,
      candidateItems: sampledQuestItems.map((item) => item.name),
    });
    const curatedItems = curatedItemChoice.items
      .map((name) => findItemByName(sampledQuestItems, name))
      .filter((item): item is CacheItem => !!item);

    console.log(
      `[api][quest] curated quest items="${curatedItems
        .map((item) => item.name)
        .join(", ")}"`
    );

    const questSteps: QuestStep[] = [];
    let currentItem: CacheItem | null = null;
    const generatedOutputs = new Set<string>();

    for (let index = 0; index < QUEST_STEP_COUNT; index += 1) {
      let generated = null;

      for (let attempt = 0; attempt < STEP_RETRY_LIMIT; attempt += 1) {
        const { left, right } = await pickQuestInputs({
          leafItems,
          currentItem,
          curatedItems,
        });

        console.log(
          `[api][quest] step=${index + 1} attempt=${attempt + 1} inputs="${left.name}" + "${right.name}"`
        );

        const { inputKey } = normalizeInputs([left.name, right.name]);
        if (recipeExists(db, inputKey)) {
          console.log(
            `[api][quest] step=${index + 1} skipped existing recipe key="${inputKey}"`
          );
          continue;
        }

        generated = await generateHiddenQuestStep({
          left,
          right,
          model: QUEST_MODEL,
        });

        const rejected =
          index === QUEST_STEP_COUNT - 1
            ? isRejectedFinalResult({
                step: generated.step,
                generatedOutputs,
                discoveredItems,
                cachedResultNames,
                baseItems,
              })
            : isRejectedIntermediateResult({
                step: generated.step,
                generatedOutputs,
              });

        if (rejected) {
          console.log(
            `[api][quest] step=${index + 1} rejected result="${generated.step.target}" final=${
              index === QUEST_STEP_COUNT - 1
            }`
          );
          generated = null;
          continue;
        }

        const recipeId = insertHiddenRecipe({
          db,
          inputKey: generated.inputKey,
          inputDisplayJson: generated.inputDisplayJson,
          resultName: generated.step.target,
          resultIcon: generated.resultIcon,
        });
        generated.step.recipeId = recipeId;

        console.log(
          `[api][quest] step=${index + 1} result="${generated.step.target}" formula="${generated.step.inputs.join(
            " + "
          )} -> ${generated.step.target}"`
        );
        break;
      }

      if (!generated) {
        return res.status(500).json({
          error: "Failed to generate a unique quest step from cache items",
        });
      }

      questSteps.push(generated.step);
      currentItem = generated.nextItem;
      generatedOutputs.add(generated.step.normalizedTarget);
    }

    persistDatabase(db);

    const compactPath = questSteps
      .map((step) => `${step.inputs.join(" + ")} -> ${step.target}`)
      .join(" | ");

    console.log(
      `[api][quest] generated hidden quest target="${currentItem?.name ?? ""}" steps=${questSteps.length} path="${compactPath}"`
    );

    return res.json({
      name: currentItem?.name ?? "",
      normalizedName: currentItem?.normalizedName ?? "",
      steps: questSteps,
    });
  } catch (err) {
    console.error("[api][quest] failed to generate quest", err);
    return res.status(500).json({ error: "Failed to generate quest" });
  }
});

export default router;
