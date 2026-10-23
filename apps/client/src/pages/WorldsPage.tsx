import React, { useEffect, useState } from "react";
import { Archive, ArrowLeft, ArrowRight, Copy, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { createSession, fetchPlayers, fetchWorlds, lookupSessions, savePlayer, updateSession } from "../lib/api";
import { buildSessionPath, LAST_PLAYER_KEY, loadLocalSessions, rememberLocalSession, type PlayerRecord, type SessionRecord } from "../lib/session";

const AVATARS = ["🙂", "🦊", "🐱", "🐼", "🐸", "🐙", "🦄", "🐲", "🌻", "🌙", "🚀", "🎮"];
type Editor = { kind: "player"; id?: string; name: string; emoji: string } |
  { kind: "world"; world?: SessionRecord; name: string; playerId: string };
function initialPlayer() {
  const query = new URLSearchParams(window.location.search);
  if (query.has("choose")) return "";
  const fromUrl = query.get("player");
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem(LAST_PLAYER_KEY) ?? ""; } catch { return ""; }
}
function playedLabel(value: string | null) {
  if (!value) return "Ready for your first discovery";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? "Played recently" : `Last played ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
export default function WorldsPage() {
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [selectedId, setSelectedId] = useState(initialPlayer);
  const [worlds, setWorlds] = useState<SessionRecord[]>([]);
  const [recent, setRecent] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [worldsLoading, setWorldsLoading] = useState(false);
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const selected = players.find((player) => player.id === selectedId);
  const continuing = selected ? worlds.find((world) => !world.archivedAt && (world.lastPlayedAt || world.id === recent?.id)) : recent;

  async function loadPlayers() {
    const next = await fetchPlayers(); setPlayers(next); return next;
  }
  useEffect(() => {
    document.body.classList.add("page-scrollable");
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchPlayers();
        const ids = loadLocalSessions().slice(0, 30).map((entry) => entry.id);
        const visited = ids.length ? await lookupSessions(ids) : [];
        if (cancelled) return;
        setPlayers(next); setSelectedId((current) => next.some((player) => player.id === current) ? current : ""); setRecent(ids.map((id) => visited.find((world) => world.id === id && !world.archivedAt)).find(Boolean) ?? null);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load players"); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; document.body.classList.remove("page-scrollable"); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setWorlds([]);
    if (loading || !selectedId || !players.some((player) => player.id === selectedId)) { setWorldsLoading(false); return; }
    setWorldsLoading(true);
    void fetchWorlds(selectedId, archived).then((next) => { if (!cancelled) setWorlds(next); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load worlds"); })
      .finally(() => { if (!cancelled) setWorldsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, archived, loading]);
  useEffect(() => {
    if (!editor) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { setEditor(null); setError(null); }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector(".worlds-modal");
      const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [editor, busy]);

  function choosePlayer(id: string) {
    setSelectedId(id); setArchived(false); setError(null); setNotice("");
    window.history.replaceState(null, "", id ? `/?player=${encodeURIComponent(id)}` : "/");
    try { if (id) localStorage.setItem(LAST_PLAYER_KEY, id); else localStorage.removeItem(LAST_PLAYER_KEY); } catch {}
  }
  function play(world: SessionRecord) {
    rememberLocalSession(world.id);
    try { localStorage.setItem(LAST_PLAYER_KEY, world.playerId); } catch {}
    window.location.assign(buildSessionPath(world.id));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editor || busy) return;
    setBusy(true); setError(null);
    try {
      if (editor.kind === "player") {
        const result = await savePlayer({ name: editor.name.trim(), emoji: editor.emoji }, editor.id);
        const player = "player" in result ? result.player : result;
        await loadPlayers(); choosePlayer(player.id); setWorlds(await fetchWorlds(player.id));
      } else if (editor.world) {
        const updated = await updateSession(editor.world.id, { name: editor.name.trim(), playerId: editor.playerId });
        await loadPlayers(); setWorlds(await fetchWorlds(selectedId, archived));
        if (recent?.id === updated.id) setRecent(updated);
      } else {
        await createSession({ name: editor.name.trim(), playerId: editor.playerId });
        await loadPlayers(); setArchived(false); setWorlds(await fetchWorlds(editor.playerId));
      }
      setEditor(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save changes"); }
    finally { setBusy(false); }
  }
  async function toggleArchive(world: SessionRecord) {
    setBusy(true); setError(null);
    try {
      await updateSession(world.id, { archived: !world.archivedAt });
      await loadPlayers(); setWorlds(await fetchWorlds(selectedId, archived));
      if (recent?.id === world.id) setRecent(null);
      setNotice(world.archivedAt ? "World restored. Find it in your active worlds." : "World archived. You can restore it anytime.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update world"); }
    finally { setBusy(false); }
  }
  async function copyLink(world: SessionRecord) {
    try { await navigator.clipboard.writeText(new URL(buildSessionPath(world.id), window.location.origin).toString()); setNotice("World link copied. Open it on another device to play together."); }
    catch { setError("Could not copy the link. Open the world and copy its address instead."); }
  }
  return <main className="worlds-page">
    <header className="worlds-header"><a href="/" className="worlds-brand"><Sparkles size={23} /> Wordweave</a><span>Your next discovery is waiting</span></header>
    <div className="worlds-content">
      {selected ? <button className="worlds-back" onClick={() => choosePlayer("")} disabled={busy}><ArrowLeft size={16} /> All players</button> : null}
      <section className="worlds-heading"><p className="worlds-eyebrow">A little curiosity. A whole new world.</p>
        <h1>{selected ? <><span aria-hidden="true">{selected.emoji}</span> {selected.name}’s worlds</> : "Who’s playing?"}</h1>
        <p>{selected ? "Each world is a fresh start, with its own discoveries, quests, and board." : "Choose a player to continue a world, or start a new adventure."}</p>
      </section>
      {error && !editor ? <div className="worlds-error" role="alert">{error}<button onClick={() => window.location.reload()}>Retry</button></div> : null}
      {notice ? <p className="worlds-notice" role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading your players…</p> : <>
        {continuing && !archived && !worldsLoading ? <button className="worlds-continue" onClick={() => play(continuing)} disabled={busy}>
          <span><small>Continue last world</small><strong>{continuing.name}</strong><span>{continuing.playerEmoji} {continuing.playerName} · {continuing.discoveredCount} discoveries</span></span><ArrowRight size={24} />
        </button> : null}
        {!selected ? <>
          <div className="worlds-section-bar"><h2>Players</h2><span>{players.length} {players.length === 1 ? "profile" : "profiles"}</span></div>
          <div className="players-grid">{players.map((player) => <button className="player-card" key={player.id} onClick={() => choosePlayer(player.id)} disabled={busy}>
            <span className="player-avatar" aria-hidden="true">{player.emoji}</span><strong>{player.name}</strong><span>{player.worldCount} {player.worldCount === 1 ? "world" : "worlds"}</span><ArrowRight size={18} />
          </button>)}<button className="player-card player-add" onClick={() => { setError(null); setEditor({ kind: "player", name: "", emoji: "🦊" }); }}><Plus size={30} /><strong>Add player</strong><span>A name, an avatar, a fresh world</span></button></div>
          <p className="worlds-footnote">No accounts or passwords. Profiles keep progress separate; anyone using this app can choose a player.</p>
        </> : <>
          <div className="worlds-section-bar"><div className="worlds-tabs" aria-label="World status"><button aria-pressed={!archived} onClick={() => setArchived(false)} disabled={busy}>Worlds</button><button aria-pressed={archived} onClick={() => setArchived(true)} disabled={busy}>Archived</button></div>
            <div className="worlds-toolbar"><button className="worlds-secondary" onClick={() => { setError(null); setEditor({ kind: "player", id: selected.id, name: selected.name, emoji: selected.emoji }); }} disabled={busy}>Edit player</button><button className="worlds-primary" onClick={() => { setError(null); setEditor({ kind: "world", name: "", playerId: selected.id }); }} disabled={busy}><Plus size={16} /> New world</button></div>
          </div>
          {worldsLoading ? <p role="status">Loading worlds…</p> : worlds.length === 0 ? <div className="worlds-empty"><Sparkles size={30} /><h2>{archived ? "No archived worlds" : "A new world awaits"}</h2><p>{archived ? "Worlds you archive will appear here. Your progress stays saved." : "Create a world to start discovering with Fire, Water, Earth, and Air."}</p></div> : <div className="worlds-grid">{worlds.map((world) => <article key={world.id} className="world-card">
            <div className="world-card-top"><span className="world-icon" aria-hidden="true">✦</span><button className="worlds-icon-button" aria-label={`Manage ${world.name}`} onClick={() => { setError(null); setEditor({ kind: "world", world, name: world.name, playerId: world.playerId }); }} disabled={busy}><MoreHorizontal size={20} /></button></div>
            <h2>{world.name}</h2><p>{world.discoveredCount.toLocaleString()} discoveries</p><small>{playedLabel(world.lastPlayedAt)}</small>
            <button className="worlds-primary world-play" aria-label={`Play ${world.name}`} onClick={() => play(world)} disabled={busy}>{world.lastPlayedAt ? "Continue" : "Play world"}<ArrowRight size={17} /></button>
            <div className="world-card-actions"><button onClick={() => void copyLink(world)} disabled={busy}><Copy size={14} /> Copy link</button><button onClick={() => void toggleArchive(world)} disabled={busy}><Archive size={14} />{world.archivedAt ? "Restore" : "Archive"}</button></div>
          </article>)}</div>}
          <p className="worlds-footnote">Open the same world link on another device to share a board. Use New world for independent progress.</p>
        </>}
      </>}
    </div>
    {editor ? <div className="worlds-modal-backdrop"><section className="worlds-modal" role="dialog" aria-modal="true" aria-labelledby="world-editor-title">
      <form onSubmit={save}><h2 id="world-editor-title">{editor.kind === "player" ? editor.id ? "Edit player" : "Meet your next explorer" : editor.world ? "Manage world" : "Start a new world"}</h2>
        <p>{editor.kind === "player" && !editor.id ? "We’ll create your first world, ready to play." : editor.kind === "world" ? "A world keeps its own discoveries, quests, and board." : "Make this profile your own."}</p>
        <label>{editor.kind === "player" ? "Player name" : "World name"}<input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={editor.kind === "player" ? 40 : 80} placeholder={editor.kind === "player" ? "e.g. Alex" : "e.g. The curiosity corner"} required disabled={busy} /></label>
        {editor.kind === "player" ? <fieldset><legend>Choose an avatar</legend><div className="worlds-avatars">{AVATARS.map((emoji) => <button type="button" key={emoji} aria-label={`Avatar ${emoji}`} aria-pressed={editor.emoji === emoji} onClick={() => setEditor({ ...editor, emoji })} disabled={busy}>{emoji}</button>)}</div></fieldset> : editor.world ? <label>Player<select aria-label="Player" value={editor.playerId} onChange={(event) => setEditor({ ...editor, playerId: event.target.value })} disabled={busy}>{players.map((player) => <option key={player.id} value={player.id}>{player.emoji} {player.name}</option>)}</select><small>Moving a world keeps all of its progress and its shared link.</small></label> : null}
        {error ? <p className="worlds-error" role="alert">{error}</p> : null}
        <div className="worlds-modal-actions"><button className="worlds-secondary" type="button" onClick={() => { setEditor(null); setError(null); }} disabled={busy}>Cancel</button><button className="worlds-primary" type="submit" disabled={busy || !editor.name.trim()}>{busy ? "Saving…" : editor.kind === "player" && !editor.id ? "Create player" : editor.kind === "world" && !editor.world ? "Create world" : "Save changes"}</button></div>
      </form>
    </section></div> : null}
  </main>;
}
