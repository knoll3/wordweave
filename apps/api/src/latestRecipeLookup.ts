import type { Database } from "sql.js";

export type LatestRecipeInput = {
  id: number | null;
  name: string;
  normalizedName: string;
  icon: string | null;
};

export type LatestRecipeContext = {
  recipeId: number | null;
  summaryLine: string | null;
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
  input_display_json: string;
};

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
    SELECT id, input_display_json
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

  return {
    recipeId: recipe.id,
    summaryLine:
      inputs.length > 0
        ? `${inputs.map((input) => input.name).join(" + ")} -> ${String(elementRow.name)}`
        : null,
    inputs,
  };
}
