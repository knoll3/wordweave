const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');

test('profiles, isolated worlds, archiving, transfers, and repeatable legacy migration', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wordweave-players-'));
  const file = path.join(dir, 'craft.db');
  let server;
  let base;
  async function start() {
    server = spawn(process.execPath, ['apps/api/dist/index.js'], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0', API_PORT: '0', NODE_ENV: 'production', DATABASE_PATH: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    // PORT=0 lets the OS choose a free port; the server log must report it.
    server.stdout.on('data', (data) => { output += data; });
    server.stderr.on('data', (data) => { output += data; });
    for (let i = 0; i < 100; i++) {
      const match = output.match(/API server listening on http:\/\/[^:]+:(\d+)/);
      if (match && Number(match[1]) > 0) { base = `http://127.0.0.1:${match[1]}`; return; }
      if (server.exitCode != null) throw Error(output);
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error('Server did not become ready: ' + output);
  }
  async function stop() { if (server && server.exitCode == null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
  async function request(route, method = 'GET', data, sessionId, expected = 200) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'x-wordweave-session-id': sessionId } : {}) }, body: data == null ? undefined : JSON.stringify(data) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  try {
    await start();
    assert.deepEqual((await request('/api/players')).players, []);
    await request('/api/players', 'POST', { name: '   ', emoji: '🦊' }, null, 400);
    const alice = await request('/api/players', 'POST', { name: 'Alice', emoji: '🦊' }, null, 201);
    const bob = await request('/api/players', 'POST', { name: 'Bob', emoji: '🐸' }, null, 201);
    assert.equal(alice.world.discoveredCount, 4);
    assert.equal((await request(`/api/sessions?playerId=${alice.player.id}`)).worlds.length, 1);
    const second = await request('/api/sessions', 'POST', { name: 'Another world', playerId: alice.player.id });
    const item = await request('/api/board/items', 'POST', { itemId: 1, position: { x: 42, y: 51 } }, alice.world.id);
    assert.equal((await request('/api/board', 'GET', null, bob.world.id)).boardItems.length, 0);
    assert.equal((await request('/api/board', 'GET', null, second.id)).boardItems.length, 0);
    assert.equal((await request('/api/board', 'GET', null, alice.world.id)).boardItems[0].nodeId, item.nodeId);
    const raw = new Database(file);
    const element = raw.prepare("INSERT INTO elements (name, normalized_name, icon) VALUES ('Private discovery', 'private discovery', '✨')").run().lastInsertRowid;
    raw.prepare('INSERT INTO session_discoveries (session_id, element_id) VALUES (?, ?)').run(alice.world.id, element);
    raw.prepare("INSERT INTO quests (session_id, name, normalized_name, icon) VALUES (?, 'Moon quest', 'moon quest', '🌕')").run(alice.world.id);
    raw.prepare("INSERT INTO player_stats (session_id, key, value_integer) VALUES (?, 'total_points', 20)").run(alice.world.id);
    raw.close();
    assert.equal((await request('/api/quests', 'GET', null, alice.world.id)).quests.length, 1);
    assert.equal((await request('/api/quests', 'GET', null, bob.world.id)).quests.length, 0);
    assert.equal((await request('/api/elements', 'GET', null, alice.world.id)).length, 5);
    assert.equal((await request('/api/elements', 'GET', null, bob.world.id)).length, 4);
    await request(`/api/sessions/${alice.world.id}/visit`, 'POST');
    assert.ok((await request(`/api/sessions/${alice.world.id}`)).lastPlayedAt);
    await request(`/api/sessions/${second.id}`, 'PATCH', { archived: true });
    assert.equal((await request(`/api/sessions?playerId=${alice.player.id}`)).worlds.length, 1);
    assert.equal((await request(`/api/sessions?playerId=${alice.player.id}&archived=true`)).worlds[0].id, second.id);
    await request(`/api/sessions/${second.id}`, 'PATCH', { archived: false, name: 'Moved world', playerId: bob.player.id });
    assert.equal((await request(`/api/sessions?playerId=${bob.player.id}`)).worlds.length, 2);
    await request(`/api/players/${bob.player.id}`, 'PATCH', { name: 'Bobby', emoji: '🐙' });
    assert.equal((await request(`/api/sessions/${second.id}`)).playerName, 'Bobby');
    const missing = randomUUID();
    await request(`/api/sessions/${missing}`, 'GET', null, null, 404);
    assert.deepEqual((await request('/api/sessions/lookup', 'POST', { ids: [missing] })).sessions, []);
    await request('/api/sessions', 'POST', { name: 'Bad owner', playerId: missing }, null, 404);
    await stop();
    // Reproduce a pre-profile database while keeping real discoveries and board state.
    const legacy = new Database(file);
    legacy.exec('DROP INDEX idx_sessions_player; ALTER TABLE sessions DROP COLUMN player_id; ALTER TABLE sessions DROP COLUMN archived_at; ALTER TABLE sessions DROP COLUMN last_played_at; DROP TABLE players;');
    const count = legacy.prepare('SELECT count(*) n FROM sessions').get().n; legacy.close();
    await start();
    const migrated = await request(`/api/sessions/${alice.world.id}`);
    assert.equal(migrated.playerName, 'Existing games');
    assert.equal(migrated.discoveredCount, 5);
    assert.equal((await request('/api/quests', 'GET', null, alice.world.id)).quests[0].name, 'Moon quest');
    assert.equal((await request('/api/board', 'GET', null, alice.world.id)).boardItems[0].nodeId, item.nodeId);
    const backups = readdirSync(path.join(dir, 'backups')).filter((name) => name.endsWith('.db'));
    assert.equal(backups.length, 1);
    const backup = new Database(path.join(dir, 'backups', backups[0]), { readonly: true });
    assert.equal(backup.prepare('SELECT count(*) n FROM sessions').get().n, count);
    assert.equal(backup.prepare('SELECT count(*) n FROM room_board_items').get().n, 1); backup.close();
    await stop(); await start();
    assert.equal(readdirSync(path.join(dir, 'backups')).filter((name) => name.endsWith('.db')).length, 1);
    assert.equal((await request('/api/players')).players.length, 1);
    assert.equal((await request(`/api/sessions/${alice.world.id}`)).discoveredCount, 5);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
