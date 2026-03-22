import OpenAI from "openai";
import { estimateTextTokenCostUsd } from "./config/openaiPricing";
import {
  BASE_PROMPT,
  CATEGORY_PROMPT,
  CRAFT_PROMPT,
  CREATIVE_PROMPT,
  EVOLVE_PROMPT,
  OPPOSITE_PROMPT,
  POP_CULTURE_PROMPT,
  RECIPE_BATCH_PROMPT,
  SUBTRACTIVE_PROMPT,
  WORD_COMBINE_PROMPT,
} from "./openaiPrompts";
import {
  craftLlmResultSchema,
  llmResultSchema,
  recipeBatchSchema,
  splitLlmResultSchema,
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

export async function generateResult(
  inputs: string[],
  options?: {
    categoryConstraint?: string;
    creative?: boolean;
    subtractive?: boolean;
    opposite?: boolean;
    popCulture?: boolean;
    crafting?: boolean;
    wordCombine?: boolean;
    evolve?: boolean;
    model?: OpenAiModel;
  }
): Promise<{ name: string; icon: string } | { results: Array<{ name: string; icon: string }> }> {
  const openai = getOpenAI();
  const model = options?.model ?? DEFAULT_MODEL_NAME;

  const promptTemplate = options?.subtractive
    ? SUBTRACTIVE_PROMPT
    : options?.categoryConstraint
      ? CATEGORY_PROMPT.replace(/{{CATEGORY_CONSTRAINT}}/g, options.categoryConstraint)
      : options?.opposite
        ? OPPOSITE_PROMPT
        : options?.popCulture
          ? POP_CULTURE_PROMPT
          : options?.evolve
            ? EVOLVE_PROMPT
            : options?.crafting
              ? CRAFT_PROMPT
              : options?.wordCombine
                ? WORD_COMBINE_PROMPT
                : options?.creative
                  ? CREATIVE_PROMPT
                  : BASE_PROMPT;
  const prompt = promptTemplate.replace("{{INPUT_ELEMENTS_ARRAY}}", JSON.stringify(inputs));

  console.log("[openai] sending request", {
    model,
    inputs,
    categoryConstraint: options?.categoryConstraint ?? null,
    creative: options?.creative ?? false,
    subtractive: options?.subtractive ?? false,
    opposite: options?.opposite ?? false,
    popCulture: options?.popCulture ?? false,
    evolve: options?.evolve ?? false,
    crafting: options?.crafting ?? false,
    wordCombine: options?.wordCombine ?? false,
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

  if (options?.crafting || options?.wordCombine) {
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

  if (options?.subtractive) {
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
  if ("results" in value) {
    const normalizedResults = value.results
      .map((entry) => ({
        name: entry.name.trim(),
        icon: entry.icon,
      }))
      .filter((entry, index, array) => {
        const normalizedName = entry.name.toLowerCase();
        return (
          normalizedName.length > 0 &&
          array.findIndex((candidate) => candidate.name.toLowerCase() === normalizedName) ===
            index
        );
      })
      .slice(0, 2);

    if (normalizedResults.length === 1) {
      return normalizedResults[0];
    }

    return { results: normalizedResults };
  }

  return value;
}

export async function generateRecipeBatch(params: {
  model?: OpenAiModel;
  pairs: Array<{ left: string; right: string }>;
}) {
  const openai = getOpenAI();
  const model = params.model ?? DEFAULT_MODEL_NAME;
  const prompt = RECIPE_BATCH_PROMPT.replace(
    "{{RECIPE_BATCH_PAIRS}}",
    JSON.stringify(params.pairs)
  );

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
