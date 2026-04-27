import type { Database } from "./db";

export type CombinationRunRecord = {
  id: number;
  recipeId: number | null;
  resultElementId: number;
  inputKey: string;
  inputDisplayJson: string;
  chosenName: string;
  chosenIcon: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRunRow(row: Record<string, unknown>): CombinationRunRecord {
  return {
    id: Number(row.id),
    recipeId: row.recipe_id == null ? null : Number(row.recipe_id),
    resultElementId: Number(row.result_element_id),
    inputKey: String(row.input_key),
    inputDisplayJson: String(row.input_display_json),
    chosenName: String(row.chosen_name),
    chosenIcon: typeof row.chosen_icon === "string" ? String(row.chosen_icon) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function insertCombinationRun(
  db: Database,
  params: {
    recipeId?: number | null;
    resultElementId: number;
    inputKey: string;
    inputDisplayJson: string;
    chosenName: string;
    chosenIcon?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }
): number {
  const stmt = db.prepare(`
    INSERT INTO combination_runs (
      recipe_id,
      result_element_id,
      input_key,
      input_display_json,
      chosen_name,
      chosen_icon,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
  `);
  stmt.run([
    params.recipeId ?? null,
    params.resultElementId,
    params.inputKey,
    params.inputDisplayJson,
    params.chosenName,
    params.chosenIcon ?? null,
    params.createdAt ?? null,
    params.updatedAt ?? null,
  ]);
  stmt.free();

  const lastIdStmt = db.prepare("SELECT last_insert_rowid() AS id");
  const row = lastIdStmt.getAsObject([]) as Record<string, unknown>;
  lastIdStmt.free();
  const runId = Number(row.id ?? 0);
  if (!runId || Number.isNaN(runId)) {
    throw new Error("Failed to create combination run");
  }
  return runId;
}

export function getFirstCombinationRunForElement(
  db: Database,
  elementId: number
): CombinationRunRecord | null {
  const stmt = db.prepare(`
    SELECT *
    FROM combination_runs
    WHERE result_element_id = ?
    ORDER BY id ASC
    LIMIT 1
  `);
  const row = stmt.getAsObject([elementId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapRunRow(row);
}
