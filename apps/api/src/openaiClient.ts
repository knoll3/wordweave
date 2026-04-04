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
  QUEST_TARGETS_PROMPT,
  QUEST_TARGET_VARIANTS_PROMPT,
  CREATIVE_PROMPT,
  PONDERIFICATE_OVERLAY_INSTRUCTIONS,
  RECIPE_BATCH_PROMPT,
  RANKED_OPTIONS_OVERLAY_INSTRUCTIONS,
} from "./openaiPrompts";
import {
  questTargetsSchema,
  questTargetVariantsSchema,
  ponderificateLlmResultSchema,
  recipeBatchSchema,
  splitLlmResultSchema,
  craftLlmResultSchema,
} from "./validation";
import type {
  PonderificateLlmResult,
  QuestTargetVariants,
  SplitLlmResult,
} from "./validation";

export type OpenAiModel =
  | "gpt-5.4"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano";

const MODEL_NAMES: OpenAiModel[] = [
  "gpt-5.4",
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
  return "gpt-5-mini";
}

type OpenAiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

function getReasoningEffortForModel(model: OpenAiModel): OpenAiReasoningEffort | null {
  if (model === "gpt-5.4") {
    return "none";
  }
  if (model === "gpt-5-mini") {
    return "minimal";
  }
  return null;
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

function extractWebSearchCitations(response: { output?: unknown }) {
  const citations: Array<{ title: string; url: string }> = [];

  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type !== "output_text" || !Array.isArray(contentItem.annotations)) {
        continue;
      }

      for (const annotation of contentItem.annotations) {
        if (
          annotation?.type === "url_citation" &&
          typeof annotation.title === "string" &&
          typeof annotation.url === "string"
        ) {
          citations.push({
            title: annotation.title,
            url: annotation.url,
          });
        }
      }
    }
  }

  return citations.filter(
    (citation, index, array) =>
      array.findIndex((candidate) => candidate.url === citation.url) === index
  );
}

export function renderGenerateResultPrompt(
  inputs: string[],
  options?: {
    actionConstraint?: string;
    actionPromptFamily?: ActionPromptFamilyKey | null;
    categoryConstraint?: string;
    creative?: boolean;
    ponderificate?: boolean;
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

  const overlay =
    actionPromptFamily != null ? null : RANKED_OPTIONS_OVERLAY_INSTRUCTIONS;

  return {
    prompt: [prompt, overlay, options?.ponderificate ? PONDERIFICATE_OVERLAY_INSTRUCTIONS : null]
      .filter(Boolean)
      .join("\n\n"),
    actionPromptFamily,
  };
}

function normalizePonderificateResult(value: PonderificateLlmResult) {
  const dedupedOptions = value.options
    .map((entry) => ({
      name: entry.name.trim(),
      icon: entry.icon,
      score: entry.score,
    }))
    .filter(
      (
        entry: { name: string; icon: string; score: number },
        index: number,
        array: Array<{ name: string; icon: string; score: number }>
      ) =>
        entry.name.length > 0 &&
        array.findIndex(
          (candidate) => candidate.name.toLowerCase() === entry.name.toLowerCase()
        ) === index
    )
    .sort((left, right) => right.score - left.score);

  if (dedupedOptions.length < 2) {
    throw new Error("OpenAI Ponderificate response must include at least two distinct options");
  }

  const bestOptionNormalizedName = value.bestOption.name.trim().toLowerCase();
  const matchedBestOption =
    dedupedOptions.find((entry) => entry.name.toLowerCase() === bestOptionNormalizedName) ??
    dedupedOptions[0];

  return {
    options: dedupedOptions,
    bestOption: matchedBestOption,
  };
}

const RANKED_OPTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    options: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          icon: { type: "string", minLength: 1, maxLength: 8 },
          score: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["name", "icon", "score"],
      },
    },
    bestOption: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 64 },
        icon: { type: "string", minLength: 1, maxLength: 8 },
        score: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["name", "icon", "score"],
    },
  },
  required: ["options", "bestOption"],
} as const;

export function renderRecipeBatchPrompt(params: {
  pairs: Array<{ left: string; right: string }>;
}) {
  return RECIPE_BATCH_PROMPT.replace(
    "{{RECIPE_BATCH_PAIRS}}",
    JSON.stringify(params.pairs)
  );
}

export function renderQuestTargetsPrompt(params: {
  count: number;
  recentTargets: string[];
  completedTargets: string[];
  sessionExcludedTargets: string[];
  topic: string;
}) {
  return QUEST_TARGETS_PROMPT
    .replace(/{{TARGET_COUNT}}/g, String(params.count))
    .replace(/{{QUEST_TOPIC}}/g, params.topic)
    .replace(/{{RECENT_TARGETS_ARRAY}}/g, JSON.stringify(params.recentTargets))
    .replace(/{{COMPLETED_TARGETS_ARRAY}}/g, JSON.stringify(params.completedTargets))
    .replace(
      /{{SESSION_EXCLUDED_TARGETS_ARRAY}}/g,
      JSON.stringify(params.sessionExcludedTargets)
    );
}

export async function generateResult(
  inputs: string[],
  options?: {
    actionConstraint?: string;
    actionPromptFamily?: ActionPromptFamilyKey | null;
    categoryConstraint?: string;
    creative?: boolean;
    ponderificate?: boolean;
    model?: OpenAiModel;
  }
): Promise<
  | { name: string; icon: string }
  | { results: Array<{ name: string; icon: string }> }
  | {
      options: Array<{ name: string; icon: string; score: number }>;
      bestOption: { name: string; icon: string; score: number };
    }
> {
  const openai = getOpenAI();
  const model = options?.ponderificate ? "gpt-5-mini" : (options?.model ?? DEFAULT_MODEL_NAME);
  const reasoningEffort =
    options?.ponderificate ? "low" : getReasoningEffortForModel(model);
  const { prompt, actionPromptFamily } = renderGenerateResultPrompt(inputs, options);

  console.log("[openai] sending request", {
    model,
    reasoningEffort,
    inputs,
    actionConstraint: options?.actionConstraint ?? null,
    actionPromptFamily: actionPromptFamily?.key ?? null,
    categoryConstraint: options?.categoryConstraint ?? null,
    creative: options?.creative ?? false,
    ponderificate: options?.ponderificate ?? false,
    temperature: 1,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    ...(reasoningEffort ? ({ reasoning_effort: reasoningEffort } as const) : {}),
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  } as any);

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

  if (options?.ponderificate) {
    const ponderificateResult = ponderificateLlmResultSchema.safeParse(parsed);
    if (!ponderificateResult.success) {
      console.error("[openai] ponderificate response failed schema validation", parsed);
      throw new Error("OpenAI Ponderificate response failed validation");
    }

    const normalizedResult = normalizePonderificateResult(ponderificateResult.data);
    console.log("[openai] parsed ponderificate result", normalizedResult);
    return normalizedResult;
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
    const strictResult = craftResult.data;
    console.log("[openai] parsed result", strictResult);
    if ("failed" in strictResult) {
      throw new Error(strictResult.reason);
    }
    return normalizePonderificateResult(strictResult);
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

  const result = ponderificateLlmResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai] response failed schema validation", parsed);
    throw new Error("OpenAI response failed validation");
  }

  const normalizedResult = normalizePonderificateResult(result.data);
  console.log("[openai] parsed result", normalizedResult);
  return normalizedResult;
}

export async function generateResultWithWebSearch(
  inputs: string[],
  options?: {
    actionConstraint?: string;
    actionPromptFamily?: ActionPromptFamilyKey | null;
    categoryConstraint?: string;
    creative?: boolean;
    ponderificate?: boolean;
    model?: OpenAiModel;
  }
): Promise<{
  options: Array<{ name: string; icon: string; score: number }>;
  bestOption: { name: string; icon: string; score: number };
}> {
  const openai = getOpenAI();
  const model = options?.model ?? DEFAULT_MODEL_NAME;
  const { prompt, actionPromptFamily } = renderGenerateResultPrompt(inputs, options);

  console.log("[openai][web-search] sending request", {
    model,
    inputs,
    tool: "web_search",
    actionConstraint: options?.actionConstraint ?? null,
    actionPromptFamily: actionPromptFamily?.key ?? null,
    categoryConstraint: options?.categoryConstraint ?? null,
    creative: options?.creative ?? false,
    prompt,
  });

  const response = await openai.responses.create({
    model,
    input: prompt,
    tools: [{ type: "web_search" as const }],
    text: {
      format: {
        type: "json_schema",
        name: "web_search_result",
        strict: true,
        schema: RANKED_OPTIONS_JSON_SCHEMA,
      },
    },
  } as any);

  const usage = response as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };
  const promptTokens = usage.usage?.input_tokens ?? 0;
  const completionTokens = usage.usage?.output_tokens ?? 0;
  const cachedPromptTokens = usage.usage?.input_tokens_details?.cached_tokens ?? 0;
  logUsageAndCost({
    logPrefix: "[openai][web-search]",
    responseModel: model,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.output_text;
  console.log("[openai][web-search] response metadata", {
    id: response.id ?? null,
    status: (response as { status?: string }).status ?? null,
    outputCount: Array.isArray(response.output) ? response.output.length : 0,
    usage: (response as { usage?: unknown }).usage ?? null,
  });
  console.log(
    "[openai][web-search] response output",
    Array.isArray(response.output) ? response.output : []
  );
  console.log(
    "[openai][web-search] citations",
    extractWebSearchCitations(response)
  );
  if (!content) {
    console.error("[openai][web-search] empty response content", response);
    throw new Error("No content returned from OpenAI web search");
  }

  console.log("[openai][web-search] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[openai][web-search] failed to parse response as JSON", err);
    throw new Error("Failed to parse OpenAI web search JSON response");
  }

  const result = ponderificateLlmResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai][web-search] response failed schema validation", parsed);
    throw new Error("OpenAI web search response failed validation");
  }

  const normalizedResult = normalizePonderificateResult(result.data);
  console.log("[openai][web-search] parsed result", normalizedResult);
  return normalizedResult;
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
    reasoningEffort: getReasoningEffortForModel(model),
    pairCount: params.pairs.length,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    ...(getReasoningEffortForModel(model)
      ? ({ reasoning_effort: getReasoningEffortForModel(model) } as const)
      : {}),
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  } as any);

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

export async function generateQuestTargets(params: {
  count: number;
  recentTargets: string[];
  completedTargets: string[];
  sessionExcludedTargets: string[];
  topic: string;
}) {
  const openai = getOpenAI();
  const model: OpenAiModel = "gpt-5.4";
  const reasoningEffort = "low";
  const prompt = renderQuestTargetsPrompt(params);

  console.log("[openai][challenge-targets] sending request", {
    model,
    reasoningEffort,
    count: params.count,
    topic: params.topic,
    recentCount: params.recentTargets.length,
    completedCount: params.completedTargets.length,
    sessionExcludedCount: params.sessionExcludedTargets.length,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  } as any);

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

  const result = questTargetsSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai][quest-targets] response failed schema validation", parsed);
    throw new Error("OpenAI quest targets failed validation");
  }

  console.log("[openai][quest-targets] parsed result", result.data);
  return result.data;
}

export async function generateQuestTargetVariants(params: {
  targets: string[];
}): Promise<QuestTargetVariants> {
  const openai = getOpenAI();
  const model: OpenAiModel = "gpt-5-mini";
  const reasoningEffort = "medium";
  const prompt = QUEST_TARGET_VARIANTS_PROMPT.replace(
    "{{QUEST_TARGETS_ARRAY}}",
    JSON.stringify(params.targets)
  );

  console.log("[openai][quest-target-variants] sending request", {
    model,
    reasoningEffort,
    targetCount: params.targets.length,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  } as any);

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai][quest-target-variants]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai][quest-target-variants] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const result = questTargetVariantsSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai][quest-target-variants] response failed schema validation", parsed);
    throw new Error("OpenAI quest target variants failed validation");
  }

  console.log("[openai][quest-target-variants] parsed result", result.data);
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

This is NOT a semantic similarity task.
Only accept cases where the discovered word is clearly the exact same concept as the target, with only a minor surface-form variation.

Accept only for:
- tiny spelling differences or obvious typo-level variations
- spacing or hyphenation differences
- tense changes
- participles / gerunds
- singular / plural
- obvious inflectional variants of the same word

Do not accept:
- shortened forms or partial phrases
- one part of a compound term standing in for the full term
- terms that merely share a root or stem
- derivationally related but distinct concepts
- synonyms
- paraphrases
- adjacent meanings
- same-topic words
- broader or narrower category words

Examples:
- target "unlisted", discovered "unlist" => match true
- target "running", discovered "run" => match true
- target "zero-gravity", discovered "zero gravity" => match true
- target "color", discovered "colour" => match true
- target "dial-in", discovered "dial" => match false
- target "teacher", discovered "teach" => match false
- target "spoof", discovered "parody" => match false
- target "teacher", discovered "school" => match false
- target "hidden", discovered "secret" => match false
- target "ancient", discovered "old" => match false
- target "sad", discovered "unhappy" => match false

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
