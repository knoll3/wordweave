import { z } from "zod";

const SERPAPI_BASE_URL = "https://serpapi.com/search.json";
const DEFAULT_RESULT_LIMIT = 3;
const MAX_RESULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10_000;

export type WebSearchResult = {
  position: number;
  title: string;
  url: string;
  snippet: string | null;
  displayedUrl: string | null;
  source: string | null;
};

export type WebSearchAvailability = {
  available: boolean;
  reason: string | null;
};

const organicResultSchema = z.object({
  position: z.number().int().positive().optional(),
  title: z.string().min(1),
  link: z.string().url(),
  snippet: z.string().min(1).optional(),
  displayed_link: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
});

const serpApiResponseSchema = z.object({
  error: z.string().optional(),
  organic_results: z.array(z.unknown()).optional(),
});

function getSerpApiKey() {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY is not set. Add it to .env at the repo root.");
  }
  return apiKey;
}

export function getGoogleLikeWebSearchAvailability(): WebSearchAvailability {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      available: false,
      reason: "Web search is unavailable because SERPAPI_API_KEY is not configured on the server.",
    };
  }

  return {
    available: true,
    reason: null,
  };
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_RESULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(limit as number)));
}

export async function searchGoogleLikeWeb(
  query: string,
  options?: {
    limit?: number;
  }
): Promise<WebSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const apiKey = getSerpApiKey();
  const limit = clampLimit(options?.limit);
  const url = new URL(SERPAPI_BASE_URL);
  url.searchParams.set("engine", "google");
  url.searchParams.set("google_domain", "google.com");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("num", String(limit));
  url.searchParams.set("api_key", apiKey);

  console.log("[web-search] searching google-like web results", {
    query: trimmedQuery,
    limit,
    engine: "google",
    googleDomain: "google.com",
    hl: "en",
    gl: "us",
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`);
  }

  const parsedPayload = serpApiResponseSchema.safeParse(await response.json());
  if (!parsedPayload.success) {
    throw new Error("Web search response failed validation");
  }

  const payload = parsedPayload.data;
  if (payload.error) {
    throw new Error(payload.error);
  }

  const results = (payload.organic_results ?? [])
    .slice(0, limit)
    .flatMap((rawResult, index) => {
      const parsedResult = organicResultSchema.safeParse(rawResult);
      if (!parsedResult.success) {
        return [];
      }

      const result = parsedResult.data;
      return [
        {
          position: result.position ?? index + 1,
          title: result.title.trim(),
          url: result.link,
          snippet: result.snippet?.trim() ?? null,
          displayedUrl: result.displayed_link?.trim() ?? null,
          source: result.source?.trim() ?? null,
        },
      ];
    });

  console.log("[web-search] received google-like web results", {
    query: trimmedQuery,
    resultCount: results.length,
    topResults: results.map((result) => ({
      position: result.position,
      title: result.title,
      url: result.url,
    })),
  });

  return results;
}
