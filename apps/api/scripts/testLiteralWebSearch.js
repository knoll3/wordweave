const path = require("path");
const dotenv = require("dotenv");
const OpenAI = require("openai").default;

dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env"),
});

const QUERY = process.argv.slice(2).join(" ").trim() || "Charles Talking Cat Tiktok";
const LIMIT = 3;
const MODEL = "gpt-4.1-mini";
const PARALLEL_RUN_COUNT = 3;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "your_openai_api_key_here") {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  return new OpenAI({ apiKey });
}

function normalizeSearchQuery(value) {
  return value.trim().replace(/\s+/g, " ");
}

function extractLiteralSearchQueries(response) {
  const queries = [];

  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (item?.type !== "web_search_call") continue;

    const action = item.action;
    if (typeof action?.query === "string" && action.query.trim()) {
      queries.push(action.query.trim());
    }
    if (Array.isArray(action?.queries)) {
      for (const query of action.queries) {
        if (typeof query === "string" && query.trim()) {
          queries.push(query.trim());
        }
      }
    }
  }

  return Array.from(new Set(queries.map(normalizeSearchQuery)));
}

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          position: { type: "integer", minimum: 1, maximum: 20 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          url: { type: "string", minLength: 1, maxLength: 500 },
          snippet: { type: ["string", "null"], maxLength: 500 },
          source: { type: ["string", "null"], maxLength: 200 },
        },
        required: ["position", "title", "url", "snippet", "source"],
      },
    },
  },
  required: ["results"],
};

function buildPrompt(query, limit) {
  return `
Search the web using this exact query string once:
"${query}"

Do not change the wording.
Do not change the order.
Do not add terms.
Do not remove terms.
Do not run additional searches.

Return ONLY valid JSON in this format:

{
  "results": [
    {
      "position": 1,
      "title": "result title",
      "url": "https://example.com",
      "snippet": "short snippet or null",
      "source": "site name or null"
    }
  ]
}

Return the first ${limit} web results from that exact search and nothing else.
`.trim();
}

async function runResponsesModel(client, model, query, limit) {
  const prompt = buildPrompt(query, limit);
  const startedAt = Date.now();

  try {
    const response = await client.responses.create({
      model,
      input: prompt,
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "literal_web_search_results",
          strict: true,
          schema: RESULT_SCHEMA,
        },
      },
    });

    const elapsedMs = Date.now() - startedAt;
    const observedQueries = extractLiteralSearchQueries(response);
    const content = response.output_text;
    let parsed = null;
    try {
      parsed = content ? JSON.parse(content) : null;
    } catch (error) {
      return {
        model,
        ok: false,
        elapsedMs,
        observedQueries,
        error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        rawContent: content,
      };
    }

    return {
      model,
      ok: true,
      elapsedMs,
      observedQueries,
      usage: response.usage ?? null,
      results: Array.isArray(parsed?.results) ? parsed.results : [],
      rawContent: content,
    };
  } catch (error) {
    return {
      model,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      observedQueries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const client = getClient();
  const query = normalizeSearchQuery(QUERY);

  console.log(
    JSON.stringify(
      {
        query,
        limit: LIMIT,
        model: MODEL,
        parallelRunCount: PARALLEL_RUN_COUNT,
      },
      null,
      2
    )
  );

  const results = await Promise.all(
    Array.from({ length: PARALLEL_RUN_COUNT }, async (_value, index) => {
      const result = await runResponsesModel(client, MODEL, query, LIMIT);
      return {
        run: index + 1,
        ...result,
      };
    })
  );

  for (const result of results) {
    console.log(`\n=== run ${result.run} ===`);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log("\n=== summary ===");
  console.log(
    JSON.stringify(
      results.map((result) => ({
        run: result.run,
        model: result.model,
        ok: result.ok,
        elapsedMs: result.elapsedMs,
        observedQueries: result.observedQueries,
        topTitles: Array.isArray(result.results)
          ? result.results.slice(0, LIMIT).map((entry) => entry.title)
          : [],
        error: result.error ?? null,
      })),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
