import type { Database } from "sql.js";

export type LatestRecipeInput = {
  id: number | null;
  name: string;
  normalizedName: string;
  icon: string | null;
};

export type LatestRecipeCatalyst = {
  name: string;
  normalizedName: string;
  icon: string | null;
};

export type LatestRecipeContext = {
  recipeId: number | null;
  summaryLine: string | null;
  catalyst: LatestRecipeCatalyst | null;
  inputs: LatestRecipeInput[];
};

type ElementRow = {
  id: number;
  name: string;
  normalized_name: string;
  icon: string | null;
};

type RecipeRow = {
  id: number;
  input_key: string;
  input_display_json: string;
};

const CATALYST_BY_MODE_KEY: Record<string, LatestRecipeCatalyst> = {
  creative: {
    name: "Creative Spark",
    normalizedName: "creative spark",
    icon: "✨",
  },
  subtract: {
    name: "Split",
    normalizedName: "split",
    icon: "✂️",
  },
  opposite: {
    name: "Opposite",
    normalizedName: "opposite",
    icon: "↔️",
  },
  pop: {
    name: "Pop Culture",
    normalizedName: "pop culture",
    icon: "🎬",
  },
  evolve: {
    name: "Evolve",
    normalizedName: "evolve",
    icon: "🧬",
  },
  randomize: {
    name: "Randomize",
    normalizedName: "randomize",
    icon: "🔀",
  },
  craft: {
    name: "Craft",
    normalizedName: "craft",
    icon: "🔨",
  },
  compound: {
    name: "Compound",
    normalizedName: "compound",
    icon: "🔗",
  },
};

function getCatalystFromInputKey(inputKey: string): LatestRecipeCatalyst | null {
  const modeKey = inputKey.split("|", 1)[0] ?? "";
  return CATALYST_BY_MODE_KEY[modeKey] ?? null;
}

function loadElementsByNormalizedName(db: Database) {
  const stmt = db.prepare(
    "SELECT id, name, normalized_name, icon FROM elements"
  );
  const byNormalizedName = new Map<string, ElementRow>();

  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ElementRow;
    byNormalizedName.set(String(row.normalized_name), row);
  }
  stmt.free();

  return byNormalizedName;
}

function loadLatestRecipeForElement(db: Database, elementId: number): RecipeRow | null {
  const stmt = db.prepare(
    `
    SELECT id, input_key, input_display_json
    FROM recipes
    WHERE result_element_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `
  );
  const row = stmt.getAsObject([elementId]) as Record<string, unknown>;
  stmt.free();

  if (row.id == null) {
    return null;
  }

  return {
    id: Number(row.id),
    input_key: String(row.input_key),
    input_display_json: String(row.input_display_json),
  };
}

export function getLatestRecipeContext(
  db: Database,
  elementId: number
): LatestRecipeContext | null {
  const elementStmt = db.prepare(
    "SELECT id, name FROM elements WHERE id = ?"
  );
  const elementRow = elementStmt.getAsObject([elementId]) as Record<string, unknown>;
  elementStmt.free();

  if (elementRow.id == null) {
    return null;
  }

  const recipe = loadLatestRecipeForElement(db, elementId);
  if (!recipe) {
    return {
      recipeId: null,
      summaryLine: null,
      catalyst: null,
      inputs: [],
    };
  }

  const elementsByNormalizedName = loadElementsByNormalizedName(db);
  const parsedInputs = JSON.parse(recipe.input_display_json) as Array<{
    name: string;
    normalized: string;
  }>;

  const inputs = parsedInputs.map((input) => {
    const matched = elementsByNormalizedName.get(input.normalized);
    return {
      id: matched ? Number(matched.id) : null,
      name: matched ? String(matched.name) : input.name,
      normalizedName: input.normalized,
      icon: matched?.icon ?? null,
    };
  });

  const catalyst = getCatalystFromInputKey(recipe.input_key);
  const summaryParts = catalyst
    ? [catalyst.name, ...inputs.map((input) => input.name)]
    : inputs.map((input) => input.name);

  return {
    recipeId: recipe.id,
    summaryLine:
      summaryParts.length > 0
        ? `${summaryParts.join(" + ")} -> ${String(elementRow.name)}`
        : null,
    catalyst,
    inputs,
  };
}
