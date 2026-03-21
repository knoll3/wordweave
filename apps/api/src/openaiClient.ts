import OpenAI from "openai";
import {
  craftLlmResultSchema,
  llmResultSchema,
  recipeBatchSchema,
  splitLlmResultSchema,
  targetQuestSelectionSchema,
} from "./validation";
import { estimateTextTokenCostUsd } from "./config/openaiPricing";
import type { SplitLlmResult, TargetQuestSelection } from "./validation";

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
const BASE_PROMPT = `
You are the crafting engine for a sandbox discovery game.

The player provides several nouns as input. Your job is to return the single most fundamental, widely recognized concept that those inputs point to together.

Think carefully about the most expected result of combing nouns together through association or literal combination.
Do not shy away from pop culture references or cultural nuances where it makes sense.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, sentences.
- Favor the most common, obvious, culturally or logically dominant concept linked to the inputs.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const CREATIVE_PROMPT = `
You are the imaginative crafting engine for a sandbox discovery game.

The player provides several nouns as input. Your job is to return the single most vivid, surprising, and inspired concept that those inputs could unlock together.

Think beyond the most literal answer. A bold and memorable answer is better than a plain one.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, sentences.
- The result should still feel plausibly craftable from the inputs, just notably more imaginative than the default path.
- The result should be something that is real and would show up in a google search or on wikipedia.
- Do not make stuff up. Ask yourself first: "Would this show up on a wikipedia page?"

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const SUBTRACTIVE_PROMPT = `
You are the split engine for a sandbox discovery game.

The player provides several nouns as input. Your job is to answer the question: what is the single most plausible result if this were split apart?

Think in terms of separating, breaking, dividing, or splitting something into one meaningful resulting part. The split can be physical, structural, conceptual in a concrete way, or linguistic if the input naturally behaves like something that can be split into a real recognized part.

It can also refer to one of the core components, constituent parts, or underlying building blocks that make up the item.

If the input naturally breaks into two dominant outputs, return both. This includes not only compound terms or merged concepts, but also real things that decompose, divide, separate, or split into two primary constituent results.

Focus on the result of the split itself, not on abstract opposites or loose semantic subtraction.

Prefer a real, recognizable component, ingredient, part, constituent element, or resulting concept that would plausibly appear when the input is split.

Rules:
- Return exactly one result.
- If the split naturally produces two equally meaningful primary outputs, you may return two results instead of one.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, sentences.
- Favor a concrete concept that people would recognize in the real world.
- Favor the most meaningful single result of the split over a vague fragment or residue.
- The result should be something real, not an invented term.

Return ONLY valid JSON in one of these formats:

{
  "name": "result name",
  "icon": "emoji"
}

or

{
  "results": [
    { "name": "first result", "icon": "emoji" },
    { "name": "second result", "icon": "emoji" }
  ]
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const OPPOSITE_PROMPT = `
You are the opposite engine for a sandbox discovery game.

The player provides one or more nouns as input. Your job is to return the single most direct and widely recognized opposite concept suggested by those inputs together.

Think carefully about the dominant meaning of the input, then return the clearest opposite concept people would expect.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, sentences.
- Favor a direct opposite over a clever or poetic answer.
- The result should be something real and recognizable.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const RANDOMIZE_PROMPT = `
You are the randomize engine for a sandbox discovery game.

The player provides one or more nouns as input. Your job is to return a different but closely related real-world item of the same general type.

Think of this as changing the input into another nearby variation, category member, or sibling concept, while keeping it recognizable and grounded in reality.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, sentences.
- Stay close to the input concept instead of drifting to something unrelated.
- The result should be a real and recognizable thing, not an invented term.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const CRAFT_PROMPT = `
You are the physical crafting engine for a sandbox discovery game.

The player provides several nouns as input. Your job is to return the single most plausible result if the physical inputs were physically combined, transformed, assembled, forged, built, manufactured, or otherwise caused to produce a real material result together.

Focus on tangible, physical outputs only.
Ignore any input that is abstract, conceptual, emotional, symbolic, fictional in a non-physical sense, or otherwise not something that could participate in a real physical process.
Ignore any input that does not help produce a believable physical object, substance, material, compound, element-derived result, device, or structure.

Rules:
- Be strict, but allow plausible physical outcomes even if they come from transformation, reaction, synthesis, refinement, or material combination rather than hand-assembly alone.
- Do not invent a result just because the words feel loosely compatible.
- Do not use metaphorical, thematic, symbolic, or associative reasoning.
- Prefer a concrete physical result such as an object, tool, material, substance, compound, device, structure, or manufactured output.
- If some inputs are not physically usable, ignore them and reassess using only the remaining physical inputs.
- If fewer than two usable physical inputs remain, fail.
- If the usable inputs would not plausibly produce a real physical result together, fail.
- When you fail, return only a failure object.
- When you succeed, return exactly one concrete result.
- Do not return explanations, descriptions, or sentences outside the JSON fields.

Return ONLY valid JSON in this format:

Either:

{
  "failed": true,
  "reason": "brief reason"
}

or:

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const EVOLVE_PROMPT = `
You are the evolution engine for a sandbox discovery game.

The player provides one or more nouns as input. Your job is to return the single most plausible next improved, more advanced, more developed, or more mature form suggested by those inputs together.

Think in terms of progression, development, refinement, or moving to a stronger next stage.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, or sentences.
- Favor a recognizable next-stage concept over a sideways variation.
- The result should feel like a clear advancement, upgrade, growth, or evolution of the input concept.
- The result should be real and recognizable, not invented.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const POP_CULTURE_PROMPT = `
You are the pop culture engine for a sandbox discovery game.

The player provides one or more nouns as input. Your job is to return one specific and widely recognizable pop culture reference that those inputs point to together.

Think in terms of recognizable references from film, television, music, celebrities, famous characters, franchises, scenes, or iconic entertainment culture.

Rules:
- Return exactly one result.
- Keep the result short and noun-like.
- Do not return explanations, descriptions, or sentences.
- Favor a specific, recognizable reference over a broad genre or category.
- The result should be something real and well known, not invented.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const WORD_COMBINE_PROMPT = `
You are the compound word engine for a sandbox discovery game.

The player provides one or more nouns as input. Your job is to return the single real word or common dictionary-style compound phrase that those inputs form together.

Be extremely strict.

Rules:
- Only return a real and recognizable word or common compound phrase that would appear in a dictionary, encyclopedia, or widely used reference.
- If the inputs do not form a real established term, fail instead of guessing.
- Do not invent blends, slang, portmanteaus, or made-up words.
- Do not return explanations, descriptions, or sentences outside the JSON fields.
- When you fail, return only a failure object.
- When you succeed, return exactly one result.

Return ONLY valid JSON in this format:

Either:

{
  "failed": true,
  "reason": "brief reason"
}

or:

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const TARGET_QUEST_PROMPT = `
You are generating target-word quests for a sandbox discovery game.

Your job is to suggest a small list of fun target terms for the player to try to discover.

Important:
- The targets should feel fun, varied, and motivating.
- Favor things that would plausibly have their own Wikipedia article or major reference entry.
- Use this breadth guidance:
{{TARGET_QUEST_TARGET_DOMAINS}}

Hard rules:
{{TARGET_QUEST_HARD_RULES}}

Use this difficulty for the whole batch:
{{TARGET_QUEST_ACTIVE_DIFFICULTY}}

Return ONLY valid JSON in this format:

{
  "quests": [
    {
      "target": "target word",
      "difficulty": "hard",
      "flavor": "short category label",
      "teaser": "short motivating line"
    }
  ]
}

Requested quest count:
{{TARGET_QUEST_COUNT}}

Difficulty guidance:
{{TARGET_QUEST_DIFFICULTY_GUIDANCE}}

Extra variation themes to keep the list fresh:
{{VARIATION_THEMES}}
`.trim();

const RECIPE_BATCH_PROMPT = `
You are the crafting engine for a sandbox discovery game.

You are given multiple unique input pairs. For each pair, return the single most fundamental, widely recognized concept that those inputs point to together.

Think carefully about the most expected result of combining nouns together through association or literal combination.
Do not shy away from pop culture references or cultural nuances where it makes sense.

Rules:
- Return one result for every provided pair.
- Keep each result short and noun-like.
- Do not return explanations, descriptions, or sentences.
- Favor the most common, obvious, culturally or logically dominant concept linked to each pair.
- Use the exact left/right inputs provided for each pair.
- Do not skip pairs.
- Return only valid JSON.

Return ONLY valid JSON in this format:

{
  "recipes": [
    { "left": "input one", "right": "input two", "result": "result name", "icon": "emoji" }
  ]
}

Pairs:
{{RECIPE_BATCH_PAIRS}}
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

function buildUsageCostSummary(params: {
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

  if (!cost) {
    return null;
  }

  return {
    pricingModel: cost.pricingModel,
    promptTokens: cost.promptTokens,
    cachedPromptTokens: cost.cachedPromptTokens,
    uncachedPromptTokens: cost.uncachedPromptTokens,
    completionTokens: cost.completionTokens,
    promptCostUsd: Number(cost.promptCostUsd.toFixed(8)),
    completionCostUsd: Number(cost.completionCostUsd.toFixed(8)),
    totalCostUsd: Number(cost.totalCostUsd.toFixed(8)),
  };
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
    creative?: boolean;
    subtractive?: boolean;
    opposite?: boolean;
    popCulture?: boolean;
    randomize?: boolean;
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
    : options?.opposite
      ? OPPOSITE_PROMPT
      : options?.popCulture
        ? POP_CULTURE_PROMPT
      : options?.evolve
        ? EVOLVE_PROMPT
      : options?.randomize
        ? RANDOMIZE_PROMPT
      : options?.crafting
        ? CRAFT_PROMPT
      : options?.wordCombine
        ? WORD_COMBINE_PROMPT
        : options?.creative
          ? CREATIVE_PROMPT
          : BASE_PROMPT;
  const prompt = promptTemplate.replace(
    "{{INPUT_ELEMENTS_ARRAY}}",
    JSON.stringify(inputs)
  );

  console.log("[openai] sending request", {
    model,
    inputs,
    creative: options?.creative ?? false,
    subtractive: options?.subtractive ?? false,
    opposite: options?.opposite ?? false,
    popCulture: options?.popCulture ?? false,
    evolve: options?.evolve ?? false,
    randomize: options?.randomize ?? false,
    crafting: options?.crafting ?? false,
    wordCombine: options?.wordCombine ?? false,
    temperature: 1,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cachedPromptTokens =
    response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
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

export async function generateTargetQuests(params: {
  model?: OpenAiModel;
  count: number;
  variationThemes: string[];
  activeDifficulty: {
    difficulty: "easy" | "medium" | "hard";
    guidance: string;
    recentTargetsToAvoid: string[];
    avoid?: string[];
  };
  difficultyGuidance: string;
  promptConfig: {
    targetDomainsText: string;
    hardRulesText: string;
  };
}): Promise<{
  selection: TargetQuestSelection;
  usage: ReturnType<typeof buildUsageCostSummary>;
  responseModel: string;
}> {
  const openai = getOpenAI();
  const model = params.model ?? DEFAULT_MODEL_NAME;
  const prompt = TARGET_QUEST_PROMPT
    .replace("{{TARGET_QUEST_COUNT}}", String(params.count))
    .replace(
      "{{TARGET_QUEST_TARGET_DOMAINS}}",
      params.promptConfig.targetDomainsText
    )
    .replace(
      "{{TARGET_QUEST_HARD_RULES}}",
      params.promptConfig.hardRulesText
    )
    .replace(
      "{{TARGET_QUEST_ACTIVE_DIFFICULTY}}",
      [
        `- difficulty: ${params.activeDifficulty.difficulty}`,
        `- guidance: ${params.activeDifficulty.guidance}`,
        `- recent targets to avoid: ${
          params.activeDifficulty.recentTargetsToAvoid.length > 0
            ? params.activeDifficulty.recentTargetsToAvoid.join(", ")
            : "none"
        }`,
        ...(params.activeDifficulty.avoid && params.activeDifficulty.avoid.length > 0
          ? [
              `- also avoid: ${params.activeDifficulty.avoid.join(", ")}`,
            ]
          : []),
      ].join("\n")
    )
    .replace(
      "{{TARGET_QUEST_DIFFICULTY_GUIDANCE}}",
      params.difficultyGuidance
    )
    .replace("{{VARIATION_THEMES}}", JSON.stringify(params.variationThemes));

  console.log("[openai][target-quests] sending request", {
    model,
    requestedCount: params.count,
    recentTargetCount: params.activeDifficulty.recentTargetsToAvoid.length,
    variationThemes: params.variationThemes,
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
  const cachedPromptTokens =
    response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const responseModel = response.model ?? model;
  logUsageAndCost({
    logPrefix: "[openai][target-quests]",
    responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  console.log("[openai][target-quests] raw response content", content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const result = targetQuestSelectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("OpenAI target quest response failed validation");
  }

  console.log("[openai][target-quests] parsed result", result.data);

  return {
    selection: result.data,
    usage: buildUsageCostSummary({
      responseModel,
      promptTokens,
      completionTokens,
      cachedPromptTokens,
    }),
    responseModel,
  };
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
  const cachedPromptTokens =
    response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
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
