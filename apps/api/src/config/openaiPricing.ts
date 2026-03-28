export interface TextTokenPricingUsdPer1M {
  input: number;
  output: number;
  cachedInput?: number;
}

export const OPENAI_TEXT_TOKEN_PRICING_USD_PER_1M: Record<
  string,
  TextTokenPricingUsdPer1M
> = {
  // Source: https://platform.openai.com/docs/pricing
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 20.0 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
};

function resolvePricingModel(model: string): string | null {
  if (OPENAI_TEXT_TOKEN_PRICING_USD_PER_1M[model]) {
    return model;
  }

  if (model.startsWith("gpt-5-mini-")) {
    return "gpt-5-mini";
  }

  if (model.startsWith("gpt-5.4-")) {
    return "gpt-5.4";
  }

  if (model.startsWith("gpt-5-nano-")) {
    return "gpt-5-nano";
  }

  if (model.startsWith("gpt-4.1-mini-")) {
    return "gpt-4.1-mini";
  }

  if (model.startsWith("gpt-4.1-nano-")) {
    return "gpt-4.1-nano";
  }

  if (model.startsWith("gpt-4.1-")) {
    return "gpt-4.1";
  }

  return null;
}

export function estimateTextTokenCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
}) {
  const pricingModel = resolvePricingModel(params.model);
  if (!pricingModel) return null;

  const pricing = OPENAI_TEXT_TOKEN_PRICING_USD_PER_1M[pricingModel];
  const cachedPromptTokens = Math.max(0, params.cachedPromptTokens ?? 0);
  const uncachedPromptTokens = Math.max(
    0,
    params.promptTokens - cachedPromptTokens
  );

  const promptCostUsd =
    (uncachedPromptTokens * pricing.input +
      cachedPromptTokens * (pricing.cachedInput ?? pricing.input)) /
    1_000_000;
  const completionCostUsd =
    (params.completionTokens * pricing.output) / 1_000_000;
  const totalCostUsd = promptCostUsd + completionCostUsd;

  return {
    pricingModel,
    promptCostUsd,
    completionCostUsd,
    totalCostUsd,
    promptTokens: params.promptTokens,
    cachedPromptTokens,
    uncachedPromptTokens,
    completionTokens: params.completionTokens,
  };
}
