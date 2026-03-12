import express from "express";
import { BASE_ELEMENT_NORMALIZED_NAMES, getDb } from "../db";
import { toTitleCaseWords } from "../models";

type RecipeRecord = {
  recipeId: number;
  resultName: string;
  normalizedResultName: string;
  inputs: { name: string; normalized: string }[];
};

type QuestTreeNode = {
  itemName: string;
  normalizedItemName: string;
  recipeId: number | null;
  inputs: QuestTreeNode[];
};

type QuestStep = {
  target: string;
  normalizedTarget: string;
  inputs: string[];
  normalizedInputs: string[];
  recipeId: number;
};

const MAX_DEPTH = 12;
const MAX_EXPANSIONS = 1500;
const MIN_STEP_COUNT = 2;
const MAX_TARGET_ATTEMPTS = 40;

const router = express.Router();

function shuffleInPlace<T>(values: T[]) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function linearizeQuestTree(root: QuestTreeNode) {
  const steps: QuestStep[] = [];
  const emitted = new Set<string>();

  function visit(node: QuestTreeNode) {
    if (node.recipeId == null) return;
    node.inputs.forEach(visit);
    if (emitted.has(node.normalizedItemName)) return;
    emitted.add(node.normalizedItemName);
    steps.push({
      target: node.itemName,
      normalizedTarget: node.normalizedItemName,
      inputs: node.inputs.map((input) => input.itemName),
      normalizedInputs: node.inputs.map((input) => input.normalizedItemName),
      recipeId: node.recipeId,
    });
  }

  visit(root);
  return steps;
}

function buildQuestTree(params: {
  target: string;
  recipesByResult: Map<string, RecipeRecord[]>;
  baseItems: Set<string>;
}) {
  let expansions = 0;

  function expand(
    normalizedTarget: string,
    path: Set<string>,
    depth: number
  ): QuestTreeNode | null {
    if (params.baseItems.has(normalizedTarget)) {
      return {
        itemName: toTitleCaseWords(normalizedTarget),
        normalizedItemName: normalizedTarget,
        recipeId: null,
        inputs: [],
      };
    }

    if (path.has(normalizedTarget)) {
      return null;
    }

    if (depth > MAX_DEPTH || expansions >= MAX_EXPANSIONS) {
      return null;
    }

    const recipes = params.recipesByResult.get(normalizedTarget);
    if (!recipes?.length) {
      return null;
    }

    expansions += 1;

    const sortedRecipes = [...recipes].sort((a, b) => {
      if (a.inputs.length !== b.inputs.length) {
        return a.inputs.length - b.inputs.length;
      }
      const aKey = a.inputs.map((input) => input.normalized).join("|");
      const bKey = b.inputs.map((input) => input.normalized).join("|");
      if (aKey !== bKey) {
        return aKey.localeCompare(bKey, "en");
      }
      return a.recipeId - b.recipeId;
    });

    for (const recipe of sortedRecipes) {
      const nextPath = new Set(path);
      nextPath.add(normalizedTarget);
      const inputNodes: QuestTreeNode[] = [];
      let valid = true;

      for (const input of recipe.inputs) {
        const child = expand(input.normalized, nextPath, depth + 1);
        if (!child) {
          valid = false;
          break;
        }
        inputNodes.push(child);
      }

      if (!valid) continue;

      return {
        itemName: recipe.resultName,
        normalizedItemName: recipe.normalizedResultName,
        recipeId: recipe.recipeId,
        inputs: inputNodes,
      };
    }

    return null;
  }

  return expand(params.target, new Set(), 0);
}

router.post("/generate", async (_req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT
        r.id AS recipe_id,
        r.input_display_json,
        e.name AS result_name,
        e.normalized_name AS result_normalized_name
      FROM recipes r
      JOIN elements e ON e.id = r.result_element_id
      WHERE r.result_element_id IS NOT NULL
    `);

    const recipeRows: RecipeRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const inputs = JSON.parse(String(row.input_display_json)) as {
        name: string;
        normalized: string;
      }[];
      recipeRows.push({
        recipeId: Number(row.recipe_id),
        resultName: String(row.result_name),
        normalizedResultName: String(row.result_normalized_name),
        inputs,
      });
    }
    stmt.free();

    const recipesByResult = new Map<string, RecipeRecord[]>();
    for (const recipe of recipeRows) {
      const existing = recipesByResult.get(recipe.normalizedResultName) ?? [];
      existing.push(recipe);
      recipesByResult.set(recipe.normalizedResultName, existing);
    }

    const candidateTargets = shuffleInPlace(
      Array.from(recipesByResult.keys()).filter(
        (name) => !BASE_ELEMENT_NORMALIZED_NAMES.includes(name)
      )
    );

    const baseItems = new Set(BASE_ELEMENT_NORMALIZED_NAMES);
    let chosenTree: QuestTreeNode | null = null;

    for (const target of candidateTargets.slice(0, MAX_TARGET_ATTEMPTS)) {
      const tree = buildQuestTree({
        target,
        recipesByResult,
        baseItems,
      });
      if (!tree) continue;
      const steps = linearizeQuestTree(tree);
      if (steps.length < MIN_STEP_COUNT) continue;
      chosenTree = tree;
      break;
    }

    if (!chosenTree) {
      return res.status(404).json({ error: "No valid quest line could be generated" });
    }

    const steps = linearizeQuestTree(chosenTree);

    const compactPath = steps
      .map((step) => `${step.inputs.join(" + ")} -> ${step.target}`)
      .join(" | ");

    console.log(
      `[api][quest] generated quest target="${chosenTree.itemName}" steps=${steps.length} path="${compactPath}"`
    );

    return res.json({
      name: chosenTree.itemName,
      normalizedName: chosenTree.normalizedItemName,
      steps,
    });
  } catch (err) {
    console.error("[api][quest] failed to generate quest", err);
    return res.status(500).json({ error: "Failed to generate quest" });
  }
});

export default router;
