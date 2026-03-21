import type { Database } from "sql.js";

const WIKIPEDIA_API_BASE = "https://en.wikipedia.org";

export type ItemReferenceRecord = {
  id: number;
  provider: string;
  lookupName: string;
  status: "resolved" | "missing";
  title: string | null;
  summary: string | null;
  sourceUrl: string | null;
};

type WikipediaSummaryPayload = {
  title: string;
  summary: string;
  sourceUrl: string;
};

function mapReferenceRow(row: Record<string, unknown>): ItemReferenceRecord {
  return {
    id: Number(row.id),
    provider: String(row.provider),
    lookupName: String(row.lookup_name),
    status: String(row.status) === "missing" ? "missing" : "resolved",
    title: row.title == null ? null : String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
  };
}

function getElementReferenceRecord(db: Database, elementId: number) {
  const stmt = db.prepare(
    `
    SELECT ir.id, ir.provider, ir.lookup_name, ir.status, ir.title, ir.summary, ir.source_url
    FROM elements e
    JOIN item_references ir ON ir.id = e.reference_record_id
    WHERE e.id = ?
    `
  );
  const row = stmt.getAsObject([elementId]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapReferenceRow(row);
}

function getReferenceRecordByLookupName(db: Database, lookupName: string) {
  const stmt = db.prepare(
    `
    SELECT id, provider, lookup_name, status, title, summary, source_url
    FROM item_references
    WHERE provider = ? AND lower(lookup_name) = lower(?)
    ORDER BY id DESC
    LIMIT 1
    `
  );
  const row = stmt.getAsObject(["wikipedia", lookupName]) as Record<string, unknown>;
  stmt.free();
  if (row.id == null) {
    return null;
  }
  return mapReferenceRow(row);
}

function linkElementReference(db: Database, elementId: number, referenceId: number) {
  const stmt = db.prepare(
    "UPDATE elements SET reference_record_id = ? WHERE id = ?"
  );
  stmt.run([referenceId, elementId]);
  stmt.free();
}

function insertReferenceRecord(
  db: Database,
  params: {
    lookupName: string;
    status: "resolved" | "missing";
    title: string | null;
    summary: string | null;
    sourceUrl: string | null;
    elementId?: number | null;
  }
) {
  const stmt = db.prepare(
    `
    INSERT INTO item_references (provider, lookup_name, status, title, summary, source_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `
  );
  stmt.run([
    "wikipedia",
    params.lookupName,
    params.status,
    params.title,
    params.summary,
    params.sourceUrl,
  ]);
  stmt.free();

  const idStmt = db.prepare("SELECT last_insert_rowid() AS id");
  let referenceId: number | null = null;
  if (idStmt.step()) {
    const row = idStmt.getAsObject() as Record<string, unknown>;
    referenceId = Number(row.id);
  }
  idStmt.free();

  if (!referenceId || Number.isNaN(referenceId)) {
    throw new Error("Failed to create item reference");
  }

  if (params.elementId != null) {
    linkElementReference(db, params.elementId, referenceId);
  }
  return referenceId;
}

async function fetchWikipediaSummaryByTitle(
  title: string
): Promise<WikipediaSummaryPayload | null> {
  const url = `${WIKIPEDIA_API_BASE}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "WordweavePrototype/0.1 (local app reference lookup)",
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    title?: unknown;
    extract?: unknown;
    content_urls?: {
      desktop?: {
        page?: unknown;
      };
    };
    type?: unknown;
  };

  if (data.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found") {
    return null;
  }

  const summary =
    typeof data.extract === "string" && data.extract.trim()
      ? data.extract.trim()
      : null;
  if (!summary) {
    return null;
  }

  const resolvedTitle =
    typeof data.title === "string" && data.title.trim() ? data.title.trim() : title.trim();
  const sourceUrl =
    typeof data.content_urls?.desktop?.page === "string"
      ? data.content_urls.desktop.page
      : `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/\s+/g, "_"))}`;

  return {
    title: resolvedTitle,
    summary,
    sourceUrl,
  };
}

async function searchWikipediaTitle(query: string): Promise<string | null> {
  const url = new URL(`${WIKIPEDIA_API_BASE}/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "WordweavePrototype/0.1 (local app reference lookup)",
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    query?: {
      search?: Array<{
        title?: unknown;
      }>;
    };
  };

  const title = data.query?.search?.[0]?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

async function lookupWikipediaReference(
  lookupName: string
): Promise<WikipediaSummaryPayload | null> {
  const exact = await fetchWikipediaSummaryByTitle(lookupName);
  if (exact) {
    return exact;
  }

  const matchedTitle = await searchWikipediaTitle(lookupName);
  if (!matchedTitle) {
    return null;
  }

  return fetchWikipediaSummaryByTitle(matchedTitle);
}

export async function getOrCreateElementReference(db: Database, elementId: number) {
  const existing = getElementReferenceRecord(db, elementId);
  if (existing) {
    return existing;
  }

  const elementStmt = db.prepare(
    "SELECT name FROM elements WHERE id = ?"
  );
  const elementRow = elementStmt.getAsObject([elementId]) as Record<string, unknown>;
  elementStmt.free();

  if (elementRow.name == null) {
    return null;
  }

  const lookupName = String(elementRow.name).trim();
  const resolved = await lookupWikipediaReference(lookupName);

  const referenceId = insertReferenceRecord(db, {
    lookupName,
    status: resolved ? "resolved" : "missing",
    title: resolved?.title ?? null,
    summary: resolved?.summary ?? null,
    sourceUrl: resolved?.sourceUrl ?? null,
    elementId,
  });

  return getElementReferenceRecord(db, elementId) ?? {
    id: referenceId,
    provider: "wikipedia",
    lookupName,
    status: resolved ? "resolved" : "missing",
    title: resolved?.title ?? null,
    summary: resolved?.summary ?? null,
    sourceUrl: resolved?.sourceUrl ?? null,
  };
}

export async function getOrCreateReferenceByName(db: Database, rawLookupName: string) {
  const lookupName = rawLookupName.trim();
  if (!lookupName) {
    return null;
  }

  const existing = getReferenceRecordByLookupName(db, lookupName);
  if (existing) {
    return existing;
  }

  const resolved = await lookupWikipediaReference(lookupName);
  const referenceId = insertReferenceRecord(db, {
    lookupName,
    status: resolved ? "resolved" : "missing",
    title: resolved?.title ?? null,
    summary: resolved?.summary ?? null,
    sourceUrl: resolved?.sourceUrl ?? null,
  });

  return (
    getReferenceRecordByLookupName(db, lookupName) ?? {
      id: referenceId,
      provider: "wikipedia",
      lookupName,
      status: resolved ? "resolved" : "missing",
      title: resolved?.title ?? null,
      summary: resolved?.summary ?? null,
      sourceUrl: resolved?.sourceUrl ?? null,
    }
  );
}
