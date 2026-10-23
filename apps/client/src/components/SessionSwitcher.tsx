import { Check, ChevronDown, Copy, Pencil } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchWorlds,
  updateSession,
} from "../lib/api";
import {
  buildSessionPath,
  loadLocalSessions,
  rememberLocalSession,
  type SessionRecord,
} from "../lib/session";

type Props = {
  currentSession: SessionRecord;
  onSessionUpdated: (session: SessionRecord) => void;
};

export default function SessionSwitcher({ currentSession, onSessionUpdated }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [recentSessions, setRecentSessions] = useState<SessionRecord[]>([]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(currentSession.name);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const sortedRecentSessions = useMemo(() => {
    const localSessions = loadLocalSessions();
    const order = new Map(localSessions.map((entry, index) => [entry.id, index]));
    return [...recentSessions].sort(
      (left, right) => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999)
    );
  }, [recentSessions]);

  useEffect(() => {
    setDraftName(currentSession.name);
  }, [currentSession.name]);

  useEffect(() => {
    rememberLocalSession(currentSession.id);
    void refreshRecentSessions();
  }, [currentSession.id]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        setIsOpen(false);
        setIsRenaming(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen]);

  async function refreshRecentSessions() {
    try {
      const sessions = await fetchWorlds(currentSession.playerId);
      setRecentSessions(sessions);
    } catch {
      setRecentSessions([currentSession]);
    }
  }

  async function handleRenameSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = draftName.trim();
    if (!nextName) return;
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const updated = await updateSession(currentSession.id, { name: nextName });
      onSessionUpdated(updated); setIsRenaming(false); await refreshRecentSessions();
    } catch { setError("Could not rename world. Try again."); }
    finally { setSaving(false); }
  }

  async function handleCopyLink() {
    const url = new URL(buildSessionPath(currentSession.id), window.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function openSession(sessionId: string) {
    rememberLocalSession(sessionId);
    window.location.assign(buildSessionPath(sessionId));
  }

  return (
    <div className="session-switcher" ref={rootRef}>
      <button
        type="button"
        className="session-trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Switch world"
      >
        <span className="session-trigger-label"><span className="session-player-label">{currentSession.playerEmoji} {currentSession.playerName}</span>{currentSession.name}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="session-menu" role="dialog" aria-label="World switcher">
          <div className="session-menu-current">
            {isRenaming ? (
              <form className="session-rename-form" onSubmit={handleRenameSubmit}>
                <input
                  className="session-rename-input"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  maxLength={80}
                  autoFocus
                />
                <button type="submit" className="icon-button" aria-label="Save world name" disabled={saving}>
                  <Check size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </form>
            ) : (
              <>
                <div className="session-menu-title">{currentSession.name}</div>
                <div className="session-menu-meta">
                  {currentSession.discoveredCount.toLocaleString()} items
                </div>
              </>
            )}
            <div className="session-menu-actions">
              <button
                type="button"
                className="session-menu-action"
                onClick={() => setIsRenaming(true)}
              >
                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                Rename
              </button>
              <button type="button" className="session-menu-action" onClick={handleCopyLink}>
                <Copy size={14} strokeWidth={2} aria-hidden="true" />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="session-list">
            {sortedRecentSessions
              .filter((session) => session.id !== currentSession.id)
              .slice(0, 8)
              .map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="session-list-item"
                  onClick={() => openSession(session.id)}
                >
                  <span className="session-list-name">{session.name}</span>
                  <span className="session-list-meta">
                    {session.discoveredCount.toLocaleString()} items
                  </span>
                </button>
              ))}
          </div>
          <a className="session-home-link" href={`/?player=${currentSession.playerId}`}>All worlds & settings</a>
          <a className="session-home-link" href="/?choose=1">Switch player</a>
        </div>
      ) : null}
    </div>
  );
}
