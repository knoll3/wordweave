import OpenAI from "openai";
import {
  getActionPromptFamilyByKey,
  renderActionPromptFamily,
  resolveActionPromptFamily,
  type ActionPromptFamilyKey,
} from "./actionPromptFamilies";
import { estimateTextTokenCostUsd } from "./config/openaiPricing";
import {
  ACTION_PROMPT,
  ACTION_CATEGORY_PROMPT,
  BASE_PROMPT,
  CATEGORY_PROMPT,
  CHALLENGE_TARGETS_PROMPT,
  CREATIVE_PROMPT,
  RECIPE_BATCH_PROMPT,
} from "./openaiPrompts";
import {
  challengeTargetsSchema,
  llmResultSchema,
  recipeBatchSchema,
  splitLlmResultSchema,
  craftLlmResultSchema,
} from "./validation";
import type { SplitLlmResult } from "./validation";

export type OpenAiModel =
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano";

const MODEL_NAMES: OpenAiModel[] = [
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
];

function resolveDefaultModelName(): OpenAiModel {
  const configuredModel = process.env.OPENAI_MODEL;
  if (configuredModel && MODEL_NAMES.includes(configuredModel as OpenAiModel)) {
    return configuredModel as OpenAiModel;
  }
  return "gpt-4.1-nano";
}

export const DEFAULT_MODEL_NAME: OpenAiModel = resolveDefaultModelName();
export const DEFAULT_EMBEDDING_MODEL_NAME = "text-embedding-3-small";

const CREATIVE_OVERLAY_INSTRUCTIONS = `

Additional style guidance:
- Lean more playful, vivid, surprising, and memorable than the default path.
- A silly or delightfully weird answer is usually better than a dry one if it still clearly fits.
- Made-up words are allowed if they are easy to understand and clearly fit the inputs.
`.trim();

function logUsageAndCost(params: {
  logPrefix: string;
  responseModel: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
}) {
  const cost = estimateTextTokenCostUsd({
    model: params.responseModel,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    cachedPromptTokens: params.cachedPromptTokens,
  });

  if (cost) {
    console.log(`${params.logPrefix} usage and cost`, {
      model: params.responseModel,
      pricingModel: cost.pricingModel,
      promptTokens: cost.promptTokens,
      cachedPromptTokens: cost.cachedPromptTokens,
      uncachedPromptTokens: cost.uncachedPromptTokens,
      completionTokens: cost.completionTokens,
      promptCostUsd: Number(cost.promptCostUsd.toFixed(8)),
      completionCostUsd: Number(cost.completionCostUsd.toFixed(8)),
      totalCostUsd: Number(cost.totalCostUsd.toFixed(8)),
    });
  } else {
    console.warn(`${params.logPrefix} usage and cost unavailable for model pricing`, {
      model: params.responseModel,
      promptTokens: params.promptTokens,
      cachedPromptTokens: params.cachedPromptTokens,
      completionTokens: params.completionTokens,
    });
  }
}

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "your_openai_api_key_here") {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env at the repo root.");
  }
  return new OpenAI({ apiKey: key });
}

export function renderGenerateResultPrompt(
  inputs: string[],
  options?: {
    actionConstraint?: string;
    actionPromptFamily?: ActionPromptFamilyKey | null;
    categoryConstraint?: string;
    creative?: boolean;
  }
) {
  const actionPromptFamily =
    options?.actionPromptFamily != null
      ? getActionPromptFamilyByKey(options.actionPromptFamily)
      : resolveActionPromptFamily(options?.actionConstraint);

  const basePrompt = actionPromptFamily && options?.actionConstraint
    ? renderActionPromptFamily({
        family: actionPromptFamily,
        actionConstraint: options.actionConstraint,
        categoryConstraint: options.categoryConstraint,
        inputs,
      })
    : options?.actionConstraint
      ? options?.categoryConstraint
        ? ACTION_CATEGORY_PROMPT
            .replace(/{{ACTION_CONSTRAINT}}/g, options.actionConstraint)
            .replace(/{{CATEGORY_CONSTRAINT}}/g, options.categoryConstraint)
            .replace(/{{INPUT_ELEMENTS_ARRAY}}/g, JSON.stringify(inputs))
        : ACTION_PROMPT
            .replace(/{{ACTION_CONSTRAINT}}/g, options.actionConstraint)
            .replace(/{{INPUT_ELEMENTS_ARRAY}}/g, JSON.stringify(inputs))
      : options?.categoryConstraint
        ? CATEGORY_PROMPT
            .replace(/{{CATEGORY_CONSTRAINT}}/g, options.categoryConstraint)
            .replace(/{{INPUT_ELEMENTS_ARRAY}}/g, JSON.stringify(inputs))
        : (options?.creative ? CREATIVE_PROMPT : BASE_PROMPT).replace(
            /{{INPUT_ELEMENTS_ARRAY}}/g,
            JSON.stringify(inputs)
          );
  const prompt =
    options?.creative && (options?.actionConstraint || options?.categoryConstraint)
      ? `${basePrompt}\n\n${CREATIVE_OVERLAY_INSTRUCTIONS}`
      : basePrompt;

  return {
    prompt,
    actionPromptFamily,
  };
}

export function renderRecipeBatchPrompt(params: {
  pairs: Array<{ left: string; right: string }>;
}) {
  return RECIPE_BATCH_PROMPT.replace(
    "{{RECIPE_BATCH_PAIRS}}",
    JSON.stringify(params.pairs)
  );
}

export function renderChallengeTargetsPrompt(params: {
  count: number;
  recentTargets: string[];
  completedTargets: string[];
  difficulty: "easy" | "hard";
}) {
  const difficultyGuidance =
    params.difficulty === "easy"
      ? "Easy quests should still be interesting, but they should be more reachable, more concrete, more common, and less semantically slippery than hard quests. Avoid trivial everyday objects, but prefer recognizable concepts the player has a fair chance of reaching."
      : "Hard quests should be genuinely difficult to reach in this game: indirect, slippery, referential, abstract, or deceptively hard to path into, without relying on awkward adjective+noun phrasing or dry academic obscurity.";

  return CHALLENGE_TARGETS_PROMPT
    .replace(/{{TARGET_COUNT}}/g, String(params.count))
    .replace(/{{QUEST_DIFFICULTY_GUIDANCE}}/g, difficultyGuidance)
    .replace(/{{RECENT_TARGETS_ARRAY}}/g, JSON.stringify(params.recentTargets))
    .replace(/{{COMPLETED_TARGETS_ARRAY}}/g, JSON.stringify(params.completedTargets));
}

export async function generateResult(
  inputs: string[],
  options?: {
    actionConstraint?: string;
    actionPromptFamily?: ActionPromptFamilyKey | null;
    categoryConstraint?: string;
    creative?: boolean;
    model?: OpenAiModel;
  }
): Promise<{ name: string; icon: string } | { results: Array<{ name: string; icon: string }> }> {
  const openai = getOpenAI();
  const model = options?.model ?? DEFAULT_MODEL_NAME;
  const { prompt, actionPromptFamily } = renderGenerateResultPrompt(inputs, options);

  console.log("[openai] sending request", {
    model,
    inputs,
    actionConstraint: options?.actionConstraint ?? null,
    actionPromptFamily: actionPromptFamily?.key ?? null,
    categoryConstraint: options?.categoryConstraint ?? null,
    creative: options?.creative ?? false,
    temperature: 1,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.error("[openai] empty response content", response);
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[openai] failed to parse response as JSON", err);
    throw new Error("Failed to parse OpenAI JSON response");
  }

  if (
    actionPromptFamily?.key === "synonym" ||
    actionPromptFamily?.key === "compound" ||
    actionPromptFamily?.key === "translate" ||
    actionPromptFamily?.key === "abbreviate" ||
    actionPromptFamily?.key === "expand"
  ) {
    const craftResult = craftLlmResultSchema.safeParse(parsed);
    if (!craftResult.success) {
      console.error("[openai] strict-mode response failed schema validation", parsed);
      throw new Error("OpenAI strict response failed validation");
    }
    console.log("[openai] parsed result", craftResult.data);
    if (craftResult.data.failed) {
      throw new Error(craftResult.data.reason);
    }
    return craftResult.data;
  }

  if (actionPromptFamily?.key === "split") {
    const splitResult = splitLlmResultSchema.safeParse(parsed);
    if (!splitResult.success) {
      console.error("[openai] split response failed schema validation", parsed);
      throw new Error("OpenAI split response failed validation");
    }
    console.log("[openai] parsed split result", splitResult.data);
    return normalizeSplitResult(splitResult.data);
  }

  const result = llmResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai] response failed schema validation", parsed);
    throw new Error("OpenAI response failed validation");
  }

  console.log("[openai] parsed result", result.data);
  return result.data;
}

function normalizeSplitResult(
  value: SplitLlmResult
): { name: string; icon: string } | { results: Array<{ name: string; icon: string }> } {
  const normalizedResults = value.results
    .map((entry: { name: string; icon: string }) => ({
      name: entry.name.trim(),
      icon: entry.icon,
    }))
    .filter(
      (
        entry: { name: string; icon: string },
        index: number,
        array: Array<{ name: string; icon: string }>
      ) => {
        const normalizedName = entry.name.toLowerCase();
        return (
          normalizedName.length > 0 &&
          array.findIndex((candidate) => candidate.name.toLowerCase() === normalizedName) ===
            index
        );
      }
    );

  return { results: normalizedResults };
}

export async function generateRecipeBatch(params: {
  model?: OpenAiModel;
  pairs: Array<{ left: string; right: string }>;
}) {
  const openai = getOpenAI();
  const model = params.model ?? DEFAULT_MODEL_NAME;
  const prompt = renderRecipeBatchPrompt({ pairs: params.pairs });

  console.log("[openai][recipe-batch] sending request", {
    model,
    pairCount: params.pairs.length,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai][recipe-batch]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai][recipe-batch] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const result = recipeBatchSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("OpenAI recipe batch failed validation");
  }

  console.log("[openai][recipe-batch] parsed result", result.data);
  return result.data;
}

export async function generateChallengeTargets(params: {
  count: number;
  recentTargets: string[];
  completedTargets: string[];
  difficulty: "easy" | "hard";
  model?: OpenAiModel;
}) {
  const openai = getOpenAI();
  const model = params.model ?? DEFAULT_MODEL_NAME;
  const prompt = renderChallengeTargetsPrompt(params);

  console.log("[openai][challenge-targets] sending request", {
    model,
    count: params.count,
    difficulty: params.difficulty,
    recentCount: params.recentTargets.length,
    completedCount: params.completedTargets.length,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai][challenge-targets]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai][challenge-targets] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const result = challengeTargetsSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai][challenge-targets] response failed schema validation", parsed);
    throw new Error("OpenAI challenge targets failed validation");
  }

  console.log("[openai][challenge-targets] parsed result", result.data);
  return result.data;
}

export async function judgeQuestCompletionCandidate(params: {
  target: string;
  candidate: string;
  model?: OpenAiModel;
}) {
  const openai = getOpenAI();
  const model = params.model ?? "gpt-5-nano";
  const prompt = `
You are judging whether a discovered word should satisfy a quest target in a word-combination discovery game.

Be generous for very close lexical variants and inflections of the same core word, such as:
- tense changes
- participles / gerunds
- singular / plural
- closely related derivational forms when they would reasonably count in play

Do not accept words that are only loosely related, adjacent in meaning, or merely in the same topic.

Target quest word: ${JSON.stringify(params.target)}
Discovered word: ${JSON.stringify(params.candidate)}

Return ONLY valid JSON:
{"match":true}
`.trim();

  console.log("[openai][quest-judge] sending request", {
    model,
    target: params.target,
    candidate: params.candidate,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai][quest-judge]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai][quest-judge] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  if (typeof parsed !== "object" || parsed == null || typeof (parsed as { match?: unknown }).match !== "boolean") {
    throw new Error("OpenAI quest judge failed validation");
  }

  return {
    match: (parsed as { match: boolean }).match,
  };
}

export async function generateEmbeddings(texts: string[]) {
  const openai = getOpenAI();
  const cleanTexts = texts.map((text) => text.trim()).filter(Boolean);

  if (cleanTexts.length === 0) {
    return {
      model: DEFAULT_EMBEDDING_MODEL_NAME,
      embeddings: [] as Array<{ text: string; embedding: number[] }>,
    };
  }

  console.log("[openai][embeddings] sending request", {
    model: DEFAULT_EMBEDDING_MODEL_NAME,
    count: cleanTexts.length,
    texts: cleanTexts,
  });

  const response = await openai.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL_NAME,
    input: cleanTexts,
  });

  console.log("[openai][embeddings] usage", {
    model: response.model,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  });

  return {
    model: response.model,
    embeddings: response.data.map((item, index) => ({
      text: cleanTexts[index],
      embedding: item.embedding,
    })),
  };
}
