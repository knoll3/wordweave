import type { Database } from "./db";
import {
  getCombinationRunFeedbackForSession,
  getFirstCombinationRunForElement,
} from "./feedback";

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
  combinationRunId: number | null;
  recipeId: number | null;
  summaryLine: string | null;
  catalyst: LatestRecipeCatalyst | null;
  inputs: LatestRecipeInput[];
  feedback: {
    sentiment: "up" | "down";
    expectedResultText: string | null;
    commentText: string | null;
    updatedAt: string;
  } | null;
};

type ElementRow = {
  id: number;
  name: string;
  normalized_name: string;
  icon: string | null;
};

const CATALYST_BY_MODE_KEY: Record<string, LatestRecipeCatalyst> = {
  ponderificate: {
    name: "Ponderificate",
    normalizedName: "ponderificate",
    icon: "🫧",
  },
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
    name: "Web Search",
    normalizedName: "web search",
    icon: "🔎",
  },
  evolve: {
    name: "Evolve",
    normalizedName: "evolve",
    icon: "🧬",
  },
  craft: {
    name: "Synonym",
    normalizedName: "synonym",
    icon: "🟰",
  },
  compound: {
    name: "Compound",
    normalizedName: "compound",
    icon: "🔗",
  },
};

function getCatalystFromInputKey(inputKey: string): LatestRecipeCatalyst | null {
  if (inputKey.startsWith("ponderificate|")) {
    return CATALYST_BY_MODE_KEY.ponderificate;
  }
  if (inputKey.startsWith("action:") && inputKey.includes("|category:")) {
    return {
      name: "Action",
      normalizedName: "action",
      icon: "⚡",
    };
  }
  const modeKey = inputKey.split("|", 1)[0] ?? "";
  if (modeKey.startsWith("category:")) {
    return {
      name: "Category",
      normalizedName: "category",
      icon: "🏷️",
    };
  }
  if (modeKey.startsWith("action:")) {
    return {
      name: "Action",
      normalizedName: "action",
      icon: "⚡",
    };
  }
  return CATALYST_BY_MODE_KEY[modeKey] ?? null;
}

function loadElementsByNormalizedName(db: Database) {
  const stmt = db.prepare("SELECT id, name, normalized_name, icon FROM elements");
  const byNormalizedName = new Map<string, ElementRow>();

  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ElementRow;
    byNormalizedName.set(String(row.normalized_name), row);
  }
  stmt.free();

  return byNormalizedName;
}

export function getLatestRecipeContext(
  db: Database,
  elementId: number,
  clientSessionId?: string | null
): LatestRecipeContext | null {
  const elementStmt = db.prepare("SELECT id, name FROM elements WHERE id = ?");
  const elementRow = elementStmt.getAsObject([elementId]) as Record<string, unknown>;
  elementStmt.free();

  if (elementRow.id == null) {
    return null;
  }

  const firstRun = getFirstCombinationRunForElement(db, elementId);
  if (!firstRun) {
    return {
      combinationRunId: null,
      recipeId: null,
      summaryLine: null,
      catalyst: null,
      inputs: [],
      feedback: null,
    };
  }

  const elementsByNormalizedName = loadElementsByNormalizedName(db);
  const parsedInputs = JSON.parse(firstRun.inputDisplayJson) as Array<{
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

  const catalyst = getCatalystFromInputKey(firstRun.inputKey);
  const feedback =
    clientSessionId && clientSessionId.trim().length > 0
      ? getCombinationRunFeedbackForSession(db, firstRun.id, clientSessionId.trim())
      : null;
  const summaryParts = catalyst
    ? [catalyst.name, ...inputs.map((input) => input.name)]
    : inputs.map((input) => input.name);

  return {
    combinationRunId: firstRun.id,
    recipeId: firstRun.recipeId,
    summaryLine:
      summaryParts.length > 0
        ? `${summaryParts.join(" + ")} -> ${String(elementRow.name)}`
        : null,
    catalyst,
    inputs,
    feedback: feedback
      ? {
          sentiment: feedback.sentiment,
          expectedResultText: feedback.expectedResultText,
          commentText: feedback.commentText,
          updatedAt: feedback.updatedAt,
        }
      : null,
  };
}
