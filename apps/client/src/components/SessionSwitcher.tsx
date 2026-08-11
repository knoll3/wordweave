import { Check, ChevronDown, Copy, Pencil, Plus } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  lookupSessions,
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
    const ids = loadLocalSessions().map((entry) => entry.id);
    if (ids.length === 0) {
      setRecentSessions([currentSession]);
      return;
    }
    try {
      const sessions = await lookupSessions(ids);
      setRecentSessions(sessions);
    } catch {
      setRecentSessions([currentSession]);
    }
  }

  async function handleCreateSession() {
    const session = await createSession();
    rememberLocalSession(session.id, { createdHere: true });
    window.location.assign(buildSessionPath(session.id));
  }

  async function handleRenameSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = draftName.trim();
    if (!nextName) return;
    const updated = await updateSession(currentSession.id, { name: nextName });
    onSessionUpdated(updated);
    setIsRenaming(false);
    await refreshRecentSessions();
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
        aria-label="Switch session"
      >
        <span className="session-trigger-label">{currentSession.name}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="session-menu" role="dialog" aria-label="Session switcher">
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
                <button type="submit" className="icon-button" aria-label="Save session name">
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
          <button type="button" className="session-new-button" onClick={handleCreateSession}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New session
          </button>
        </div>
      ) : null}
    </div>
  );
}
