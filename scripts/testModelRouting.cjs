const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

// Exercise each AI entry point without credentials or network requests.
const apiRoot = path.resolve(__dirname, "../apps/api");
const sdkPath = require.resolve("openai", { paths: [apiRoot] });
const requests = [];
let responseBody;
class MockOpenAI {
  chat = { completions: { create: async (request) => {
    requests.push(request);
    return { model: request.model, choices: [{ message: { content: JSON.stringify(responseBody) } }] };
  } } };
  embeddings = { create: async (request) => {
    requests.push(request);
    return { model: request.model, data: [{ embedding: [0.1, 0.2] }] };
  } };
}
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: MockOpenAI };
process.env.OPENAI_API_KEY = "test-only-no-network";
process.env.OPENAI_MODEL = "gpt-5.4";
const ai = require(path.join(apiRoot, "dist/openaiClient"));
const { estimateTextTokenCostUsd } = require(path.join(apiRoot, "dist/config/openaiPricing"));

test("all generation paths use Luna except quest targets; legacy choices cannot override routing", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    responseBody = {
      options: [{ name: "Steam", icon: "💨", score: 90 }, { name: "Mist", icon: "🌫️", score: 80 }],
      bestOption: { name: "Steam", icon: "💨", score: 90 },
    };
    await ai.generateResult(["Fire", "Water"], { model: "gpt-5.4" });
    await ai.generateResult(["Fire", "Water"], { ponderificate: true });
    await ai.generateResult(["Fire", "Water"], { creative: true });
    await ai.generateResult(["Moon"], { actionConstraint: "Web Search", webSearchResults: [] });
    responseBody = { recipes: [] };
    await ai.generateRecipeBatch({ pairs: [], model: "gpt-5.4" });
    responseBody = { targets: [{ name: "Moon", icon: "🌕" }] };
    await ai.generateQuestTargets({ count: 1, topic: "Space", recentTargets: [], completedTargets: [], sessionExcludedTargets: [] });
    responseBody = { targets: [{ name: "Moon", alternateSpellings: ["moon"] }] };
    await ai.generateQuestTargetVariants({ targets: ["Moon"] });
    responseBody = { match: false };
    await ai.judgeQuestCompletionCandidate({ target: "Moon", candidate: "Sun", model: "gpt-5.4" });
    await ai.generateEmbeddings(["Moon"]);

    assert.deepEqual(requests.map((r) => r.model), [
      "gpt-6-luna", "gpt-6-luna", "gpt-6-luna", "gpt-6-luna", "gpt-6-luna",
      "gpt-6.1-sol", "gpt-6-luna", "gpt-6-luna", "text-embedding-3-small",
    ]);
    assert.deepEqual(requests.slice(0, -1).map((r) => r.reasoning_effort), [
      "none", "low", "none", "none", "none", "low", "none", "none",
    ]);
    assert.ok(requests.every((r) => !("temperature" in r)));
  } finally {
    console.log = originalLog;
  }
});

test("cost estimates recognize new model snapshots and cached input", () => {
  const cost = (model, cachedPromptTokens = 0) => estimateTextTokenCostUsd({
    model, promptTokens: 483, completionTokens: 127, cachedPromptTokens,
  }).totalCostUsd;
  assert.ok(Math.abs(cost("gpt-6-luna") - 0.0001118) < 1e-12);
  assert.ok(Math.abs(cost("gpt-6.1-sol") - 0.002236) < 1e-12);
  assert.ok(Math.abs(cost("gpt-6-luna-2026-10-01", 483) - 0.00006833) < 1e-12);
});
