import OpenAI from "openai";
import { llmResultSchema } from "./validation";
import { estimateTextTokenCostUsd } from "./config/openaiPricing";

const MODEL_NAME = process.env.OPENAI_MODEL ?? "gpt-4.1";

const BASE_PROMPT = `
You are the crafting engine for a sandbox discovery game.

The player provides several nouns as input. Your job is to return the single most fundamental, widely recognized concept that those inputs point to together.

Choose the best simple result a human would most naturally expect in a word-association discovery game. Prefer the strongest shared association over a literal combination of the inputs.

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

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "your_openai_api_key_here") {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env at the repo root.");
  }
  return new OpenAI({ apiKey: key });
}

export async function generateResult(inputs: string[]) {
  const openai = getOpenAI();

  const prompt = BASE_PROMPT.replace(
    "{{INPUT_ELEMENTS_ARRAY}}",
    JSON.stringify(inputs)
  );

  console.log("[openai] sending request", {
    model: MODEL_NAME,
    inputs,
    prompt,
  });

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
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
  const responseModel = response.model ?? MODEL_NAME;
  const cost = estimateTextTokenCostUsd({
    model: responseModel,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  });

  if (cost) {
    console.log("[openai] usage and cost", {
      model: responseModel,
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
    console.warn("[openai] usage and cost unavailable for model pricing", {
      model: responseModel,
      promptTokens,
      cachedPromptTokens,
      completionTokens,
    });
  }

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

  const result = llmResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[openai] response failed schema validation", parsed);
    throw new Error("OpenAI response failed validation");
  }

  console.log("[openai] parsed result", result.data);

  return result.data;
}
