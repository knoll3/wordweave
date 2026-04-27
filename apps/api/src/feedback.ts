import type { Database } from "./db";
import type { WebSearchResult } from "./webSearchTypes";

export type RecipeFeedbackSentiment = "up" | "down";

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

export type CombinationRunTraceRecord = {
  id: number;
  combinationRunId: number;
  providerType: string;
  model: string;
  actionPromptFamily: string | null;
  actionConstraint: string | null;
  categoryConstraint: string | null;
  creative: boolean;
  ponderificate: boolean;
  inputTerms: string[];
  searchQuery: string | null;
  searchResults: WebSearchResult[] | null;
  promptText: string;
  rawResponseText: string;
  parsedResponseJson: unknown;
  createdAt: string;
};

export type CombinationRunFeedbackRecord = {
  id: number;
  combinationRunId: number;
  traceId: number | null;
  clientSessionId: string;
  sentiment: RecipeFeedbackSentiment;
  expectedResultText: string | null;
  commentText: string | null;
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

function mapTraceRow(row: Record<string, unknown>): CombinationRunTraceRecord {
  return {
    id: Number(row.id),
    combinationRunId: Number(row.combination_run_id),
    providerType: String(row.provider_type),
    model: String(row.model),
    actionPromptFamily:
      typeof row.action_prompt_family === "string" ? String(row.action_prompt_family) : null,
    actionConstraint:
      typeof row.action_constraint === "string" ? String(row.action_constraint) : null,
    categoryConstraint:
      typeof row.category_constraint === "string" ? String(row.category_constraint) : null,
    creative: Number(row.creative ?? 0) === 1,
    ponderificate: Number(row.ponderificate ?? 0) === 1,
    inputTerms: JSON.parse(String(row.input_terms_json)) as string[],
    searchQuery: typeof row.search_query === "string" ? String(row.search_query) : null,
    searchResults:
      typeof row.search_results_json === "string"
        ? (JSON.parse(String(row.search_results_json)) as WebSearchResult[])
        : null,
    promptText: String(row.prompt_text),
    rawResponseText: String(row.raw_response_text),
    parsedResponseJson: JSON.parse(String(row.parsed_response_json)),
    createdAt: String(row.created_at),
  };
}

function mapFeedbackRow(row: Record<string, unknown>): CombinationRunFeedbackRecord {
  return {
    id: Number(row.id),
    combinationRunId: Number(row.combination_run_id),
    traceId: row.trace_id == null ? null : Number(row.trace_id),
    clientSessionId: String(row.client_session_id),
    sentiment: String(row.sentiment) as RecipeFeedbackSentiment,
    expectedResultText:
      typeof row.expected_result_text === "string" ? String(row.expected_result_text) : null,
    commentText: typeof row.comment_text === "string" ? String(row.comment_text) : null,
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

export function getCombinationRunById(
  db: Database,
  runId: number
): CombinationRunRecord | null {
  const stmt = db.prepare(`
    SELECT *
    FROM combination_runs
    WHERE id = ?
    LIMIT 1
  `);
  const row = stmt.getAsObject([runId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapRunRow(row);
}

export function insertCombinationRunTrace(
  db: Database,
  params: {
    combinationRunId: number;
    providerType: string;
    model: string;
    actionPromptFamily?: string | null;
    actionConstraint?: string | null;
    categoryConstraint?: string | null;
    creative?: boolean;
    ponderificate?: boolean;
    inputTerms: string[];
    searchQuery?: string | null;
    searchResults?: WebSearchResult[] | null;
    promptText: string;
    rawResponseText: string;
    parsedResponseJson: unknown;
    legacyRecipeTraceId?: number | null;
    createdAt?: string | null;
  }
): number {
  const stmt = db.prepare(`
    INSERT INTO combination_run_traces (
      combination_run_id,
      provider_type,
      model,
      action_prompt_family,
      action_constraint,
      category_constraint,
      creative,
      ponderificate,
      input_terms_json,
      search_query,
      search_results_json,
      prompt_text,
      raw_response_text,
      parsed_response_json,
      legacy_recipe_trace_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `);
  stmt.run([
    params.combinationRunId,
    params.providerType,
    params.model,
    params.actionPromptFamily ?? null,
    params.actionConstraint ?? null,
    params.categoryConstraint ?? null,
    params.creative ? 1 : 0,
    params.ponderificate ? 1 : 0,
    JSON.stringify(params.inputTerms),
    params.searchQuery ?? null,
    params.searchResults ? JSON.stringify(params.searchResults) : null,
    params.promptText,
    params.rawResponseText,
    JSON.stringify(params.parsedResponseJson),
    params.legacyRecipeTraceId ?? null,
    params.createdAt ?? null,
  ]);
  stmt.free();

  const lastIdStmt = db.prepare("SELECT last_insert_rowid() AS id");
  const row = lastIdStmt.getAsObject([]) as Record<string, unknown>;
  lastIdStmt.free();
  const traceId = Number(row.id ?? 0);
  if (!traceId || Number.isNaN(traceId)) {
    throw new Error("Failed to create combination run trace");
  }
  return traceId;
}

export function getLatestTraceForCombinationRun(
  db: Database,
  runId: number
): CombinationRunTraceRecord | null {
  const stmt = db.prepare(`
    SELECT *
    FROM combination_run_traces
    WHERE combination_run_id = ?
    ORDER BY id DESC
    LIMIT 1
  `);
  const row = stmt.getAsObject([runId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapTraceRow(row);
}

export function getCombinationRunTraceById(
  db: Database,
  traceId: number
): CombinationRunTraceRecord | null {
  const stmt = db.prepare(`
    SELECT *
    FROM combination_run_traces
    WHERE id = ?
    LIMIT 1
  `);
  const row = stmt.getAsObject([traceId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapTraceRow(row);
}

export function getCombinationRunFeedbackForSession(
  db: Database,
  runId: number,
  clientSessionId: string
): CombinationRunFeedbackRecord | null {
  const stmt = db.prepare(`
    SELECT *
    FROM combination_run_feedback
    WHERE combination_run_id = ? AND client_session_id = ?
    LIMIT 1
  `);
  const row = stmt.getAsObject([runId, clientSessionId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapFeedbackRow(row);
}

export function upsertCombinationRunFeedback(
  db: Database,
  params: {
    combinationRunId: number;
    traceId?: number | null;
    clientSessionId: string;
    sentiment: RecipeFeedbackSentiment;
    expectedResultText?: string | null;
    commentText?: string | null;
  }
): CombinationRunFeedbackRecord & { operation: "insert" | "update" } {
  const existing = getCombinationRunFeedbackForSession(
    db,
    params.combinationRunId,
    params.clientSessionId
  );
  const normalizedExpected =
    typeof params.expectedResultText === "string" && params.expectedResultText.trim().length > 0
      ? params.expectedResultText.trim()
      : null;
  const normalizedComment =
    typeof params.commentText === "string" && params.commentText.trim().length > 0
      ? params.commentText.trim()
      : null;

  if (existing) {
    const stmt = db.prepare(`
      UPDATE combination_run_feedback
      SET
        trace_id = ?,
        sentiment = ?,
        expected_result_text = ?,
        comment_text = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run([
      params.traceId ?? existing.traceId,
      params.sentiment,
      normalizedExpected,
      normalizedComment,
      existing.id,
    ]);
    stmt.free();
  } else {
    const stmt = db.prepare(`
      INSERT INTO combination_run_feedback (
        combination_run_id,
        trace_id,
        client_session_id,
        sentiment,
        expected_result_text,
        comment_text
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      params.combinationRunId,
      params.traceId ?? null,
      params.clientSessionId,
      params.sentiment,
      normalizedExpected,
      normalizedComment,
    ]);
    stmt.free();
  }

  const saved = getCombinationRunFeedbackForSession(
    db,
    params.combinationRunId,
    params.clientSessionId
  );
  if (!saved) {
    throw new Error("Failed to save combination run feedback");
  }
  return {
    ...saved,
    operation: existing ? "update" : "insert",
  };
}

export function deleteCombinationRunFeedbackForSession(
  db: Database,
  runId: number,
  clientSessionId: string
): { deleted: boolean } {
  const stmt = db.prepare(`
    DELETE FROM combination_run_feedback
    WHERE combination_run_id = ? AND client_session_id = ?
  `);
  stmt.run([runId, clientSessionId]);
  const deleted = db.getRowsModified() > 0;
  stmt.free();
  return { deleted };
}

export function listRecentCombinationFeedback(
  db: Database,
  limit: number
): Array<{
  feedback: CombinationRunFeedbackRecord;
  runInputKey: string;
  runSummaryLine: string | null;
  resultElementName: string | null;
  trace: CombinationRunTraceRecord | null;
}> {
  const stmt = db.prepare(`
    SELECT
      crf.*,
      cr.input_key,
      cr.input_display_json,
      e.name AS result_element_name
    FROM combination_run_feedback crf
    JOIN combination_runs cr ON cr.id = crf.combination_run_id
    LEFT JOIN elements e ON e.id = cr.result_element_id
    ORDER BY crf.updated_at DESC, crf.id DESC
    LIMIT ?
  `);
  stmt.bind([limit]);
  const rows: Array<{
    feedback: CombinationRunFeedbackRecord;
    runInputKey: string;
    runSummaryLine: string | null;
    resultElementName: string | null;
    trace: CombinationRunTraceRecord | null;
  }> = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const parsedInputs = JSON.parse(String(row.input_display_json)) as Array<{ name: string }>;
    const resultElementName =
      typeof row.result_element_name === "string" ? String(row.result_element_name) : null;
    const summary =
      parsedInputs.length > 0 && resultElementName
        ? `${parsedInputs.map((input) => input.name).join(" + ")} -> ${resultElementName}`
        : null;
    rows.push({
      feedback: mapFeedbackRow(row),
      runInputKey: String(row.input_key),
      runSummaryLine: summary,
      resultElementName,
      trace:
        row.trace_id == null
          ? getLatestTraceForCombinationRun(db, Number(row.combination_run_id))
          : null,
    });
  }
  stmt.free();

  return rows.map((entry) => ({
    ...entry,
    trace:
      entry.feedback.traceId != null
        ? getCombinationRunTraceById(db, entry.feedback.traceId) ?? entry.trace
        : entry.trace,
  }));
}
