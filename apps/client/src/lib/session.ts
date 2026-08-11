export const SESSION_ID_HEADER = "x-wordweave-session-id";
export const SESSION_PATH_PREFIX = "/play";
export const LOCAL_SESSIONS_STORAGE_KEY = "wordweave.sessions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  discoveredCount: number;
};

export type LocalSessionEntry = {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdHere: boolean;
  pinned: boolean;
};

export function isSessionPath(pathname = window.location.pathname) {
  return pathname === SESSION_PATH_PREFIX || pathname.startsWith(`${SESSION_PATH_PREFIX}/`);
}

export function getSessionIdFromPath(pathname = window.location.pathname) {
  if (!isSessionPath(pathname)) {
    return null;
  }
  const [, , sessionId] = pathname.split("/");
  return sessionId && UUID_PATTERN.test(sessionId) ? sessionId : null;
}

export function buildSessionPath(sessionId: string) {
  return `${SESSION_PATH_PREFIX}/${sessionId}`;
}

export function getCurrentSessionId() {
  return getSessionIdFromPath();
}

export function getSessionHeaders(): Record<string, string> {
  const sessionId = getCurrentSessionId();
  return sessionId ? { [SESSION_ID_HEADER]: sessionId } : {};
}

export function loadLocalSessions(): LocalSessionEntry[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is LocalSessionEntry => {
        return (
          entry &&
          typeof entry.id === "string" &&
          UUID_PATTERN.test(entry.id) &&
          typeof entry.firstSeenAt === "string" &&
          typeof entry.lastSeenAt === "string"
        );
      })
      .map((entry) => ({
        id: entry.id,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        createdHere: Boolean(entry.createdHere),
        pinned: Boolean(entry.pinned),
      }));
  } catch {
    return [];
  }
}

export function saveLocalSessions(entries: LocalSessionEntry[]) {
  window.localStorage.setItem(
    LOCAL_SESSIONS_STORAGE_KEY,
    JSON.stringify(entries.slice(0, 30))
  );
}

export function rememberLocalSession(sessionId: string, options?: { createdHere?: boolean }) {
  const now = new Date().toISOString();
  const current = loadLocalSessions();
  const existing = current.find((entry) => entry.id === sessionId);
  const nextEntry: LocalSessionEntry = existing
    ? {
        ...existing,
        lastSeenAt: now,
        createdHere: existing.createdHere || Boolean(options?.createdHere),
      }
    : {
        id: sessionId,
        firstSeenAt: now,
        lastSeenAt: now,
        createdHere: Boolean(options?.createdHere),
        pinned: false,
      };

  saveLocalSessions([
    nextEntry,
    ...current.filter((entry) => entry.id !== sessionId),
  ]);
}
