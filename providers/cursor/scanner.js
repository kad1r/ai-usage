// providers/cursor/scanner.js
//
// Cursor keeps its chats in SQLite key-value stores (VS Code's state.vscdb):
//   User/globalStorage/state.vscdb, table cursorDiskKV
//     composerData:<composerId>             { createdAt, lastUpdatedAt, modelConfig, conversation? }
//     bubbleId:<composerId>:<bubbleId>      { type, createdAt, tokenCount: { inputTokens, outputTokens }, modelInfo }
//   User/workspaceStorage/<hash>/workspace.json      { folder: "file:///..." }
//   User/workspaceStorage/<hash>/state.vscdb, table ItemTable
//     composer.composerData                 { allComposers: [{ composerId }] }
// The layout is undocumented and changes between Cursor versions, so every
// field is optional and anything unreadable is skipped. Many Cursor versions
// leave tokenCount at zero; those chats produce no turns.
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const CURSOR_USER_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Cursor', 'User'
);
const globalDbPath = userDir => path.join(userDir, 'globalStorage', 'state.vscdb');

function openReadonly(file) {
  return new Database(file, { readonly: true, fileMustExist: true });
}

function parseJson(value) {
  if (value == null) return null;
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value); } catch { return null; }
}

// Keys starting with `prefix`, as a range so the key index is used
function rowsWithPrefix(db, prefix) {
  const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  return db.prepare('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?').all(prefix, end);
}

function toIso(v) {
  if (v == null) return null;
  const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
  return isNaN(d) ? null : d.toISOString();
}

// composerId -> project folder name, from each workspace's own state.vscdb
function readWorkspaceProjects(userDir) {
  const map = new Map();
  const base = path.join(userDir, 'workspaceStorage');
  let dirs;
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return map; }

  for (const d of dirs) {
    const dir = path.join(base, d.name);
    let name;
    try {
      const folder = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')).folder;
      name = decodeURIComponent(String(folder).replace(/^file:\/\/\/?/, '')).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    } catch { continue; }
    if (!name || !fs.existsSync(path.join(dir, 'state.vscdb'))) continue;

    let db;
    try {
      db = openReadonly(path.join(dir, 'state.vscdb'));
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get();
      for (const c of parseJson(row?.value)?.allComposers || []) if (c?.composerId) map.set(c.composerId, name);
    } catch {} finally {
      db?.close();
    }
  }
  return map;
}

/** Turns of one composer (chat): [{ ts, model, input, output }] */
function composerTurns(db, composerId, composer) {
  const bubbles = Array.isArray(composer.conversation) && composer.conversation.length
    ? composer.conversation                                  // older versions inline the bubbles
    : rowsWithPrefix(db, `bubbleId:${composerId}:`).map(r => parseJson(r.value)).filter(Boolean);

  const fallbackTs = toIso(composer.createdAt) || toIso(composer.lastUpdatedAt);
  const turns = [];
  for (const b of bubbles) {
    const input = Number(b?.tokenCount?.inputTokens) || 0;
    const output = Number(b?.tokenCount?.outputTokens) || 0;
    if (!input && !output) continue;
    const ts = toIso(b.createdAt) || toIso(b.timingInfo?.clientStartTime) || fallbackTs;
    if (!ts) continue;
    const model = b.modelInfo?.modelName || composer.modelConfig?.modelName || 'cursor';
    turns.push({ ts, model, input, output });
  }
  return turns;
}

// Rows from the pre-1.5 scanner, which read JSON files Cursor doesn't write
function dropLegacyRows(db) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'cursor_parser_v2'").get()) return;
  db.transaction(() => {
    db.prepare("DELETE FROM turns WHERE provider = 'cursor'").run();
    db.prepare("DELETE FROM sessions WHERE provider = 'cursor'").run();
    db.prepare("INSERT INTO meta (key, value) VALUES ('cursor_parser_v2', ?)").run(new Date().toISOString());
  })();
}

function scanAndStore(db, { userDir = CURSOR_USER_DIR } = {}) {
  const file = globalDbPath(userDir);
  if (!fs.existsSync(file)) return { newSessions: 0, newTurns: 0 };
  dropLegacyRows(db);

  const st = {
    processed: db.prepare('SELECT mtime FROM processed_files WHERE path = ?'),
    markProcessed: db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)'),
    deleteTurns: db.prepare("DELETE FROM turns WHERE session_id = ? AND provider = 'cursor'"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE session_id = ? AND provider = 'cursor'"),
    insertTurn: db.prepare(`
      INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
      VALUES (?, ?, ?, ?, ?, 0, 0, 'cursor')
    `),
    upsertSession: db.prepare(`
      INSERT OR REPLACE INTO sessions
      (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
       total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'cursor')
    `)
  };

  let cursorDb;
  try {
    cursorDb = openReadonly(file);
  } catch (e) {
    console.warn('[cursor/scanner] cannot open', file, ':', e.message);
    return { newSessions: 0, newTurns: 0 };
  }

  let newSessions = 0, newTurns = 0;
  let projects = null; // read lazily: only needed when a chat changed
  try {
    const hasKv = cursorDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'").get();
    if (!hasKv) return { newSessions, newTurns };

    for (const row of rowsWithPrefix(cursorDb, 'composerData:')) {
      const composer = parseJson(row.value);
      if (!composer) continue;
      const composerId = composer.composerId || row.key.slice('composerData:'.length);
      const updated = Number(composer.lastUpdatedAt || composer.createdAt) || 0;

      const key = `cursor:v2:composer:${composerId}`;
      const existing = st.processed.get(key);
      if (existing && existing.mtime === updated) continue;

      let turns;
      try { turns = composerTurns(cursorDb, composerId, composer); } catch (e) {
        console.warn('[cursor/scanner] skipped chat', composerId, ':', e.message);
        continue;
      }
      if (turns.length && !projects) projects = readWorkspaceProjects(userDir);

      const sessionId = 'cursor:' + composerId;
      db.transaction(() => {
        st.deleteTurns.run(sessionId);
        st.deleteSession.run(sessionId);
        const agg = { input: 0, output: 0, first: null, last: null, model: null };
        for (const t of turns) {
          st.insertTurn.run(sessionId, t.ts, t.model, t.input, t.output);
          agg.input += t.input;
          agg.output += t.output;
          agg.model = t.model;
          if (!agg.first || t.ts < agg.first) agg.first = t.ts;
          if (!agg.last  || t.ts > agg.last)  agg.last  = t.ts;
        }
        if (turns.length) {
          st.upsertSession.run(sessionId, projects.get(composerId) || 'cursor', agg.first, agg.last,
            agg.model, turns.length, agg.input, agg.output);
          newSessions++;
        }
        newTurns += turns.length;
        st.markProcessed.run(key, updated, turns.length);
      })();
    }
  } finally {
    cursorDb.close();
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, CURSOR_USER_DIR, globalDbPath };
