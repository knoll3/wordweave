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
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
};

function resolvePricingModel(model: string): string | null {
  if (OPENAI_TEXT_TOKEN_PRICING_USD_PER_1M[model]) {
    return model;
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
