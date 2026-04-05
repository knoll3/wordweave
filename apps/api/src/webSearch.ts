import type { WebSearchResult } from "./webSearchTypes";

const DEFAULT_SEARXNG_BASE_URL = "http://127.0.0.1:8081";

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getSearxngBaseUrl() {
  return (process.env.SEARXNG_BASE_URL || DEFAULT_SEARXNG_BASE_URL).replace(/\/$/, "");
}

export async function searchGoogleLikeWeb(
  query: string,
  options?: {
    limit?: number;
  }
): Promise<WebSearchResult[]> {
  const normalizedQuery = normalizeSearchQuery(query);
  const limit = Math.max(1, Math.min(5, Math.floor(options?.limit ?? 3)));
  const baseUrl = getSearxngBaseUrl();
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("safesearch", "0");

  console.log("[search][searxng] sending request", {
    query: normalizedQuery,
    limit,
    url: url.toString(),
  });

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[search][searxng] request failed", {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error(`SearXNG search failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      title?: unknown;
      url?: unknown;
      content?: unknown;
      engine?: unknown;
    }>;
  };

  const normalizedResults = (Array.isArray(payload.results) ? payload.results : [])
    .map((entry, index) => ({
      position: index + 1,
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      url: typeof entry.url === "string" ? entry.url.trim() : "",
      snippet: typeof entry.content === "string" ? entry.content.trim() : null,
      source: typeof entry.engine === "string" ? entry.engine.trim() : null,
    }))
    .filter((entry) => entry.title && entry.url)
    .slice(0, limit);

  console.log("[search][searxng] top results", {
    query: normalizedQuery,
    results: normalizedResults,
  });

  if (normalizedResults.length === 0) {
    throw new Error("No web search results returned from SearXNG");
  }

  return normalizedResults;
}
