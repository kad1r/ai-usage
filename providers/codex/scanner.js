// providers/codex/scanner.js
//
// Codex CLI writes one rollout file per session:
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl
// Each line is { timestamp, type, payload }. The ones used here:
//   session_meta  payload: { id, cwd, ... }
//   turn_context  payload: { model, cwd, ... }
//   event_msg     payload: { type: 'token_count', info: { total_token_usage, last_token_usage }, rate_limits }
// Token counts follow the OpenAI API: input_tokens includes cached_input_tokens,
// output_tokens includes reasoning tokens.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const SESSION_DIRS = ['sessions', 'archived_sessions'];
const DEFAULT_MODEL = 'gpt-5';

function findRolloutFiles(codexDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(full);
    }
  }
  for (const d of SESSION_DIRS) walk(path.join(codexDir, d));
  return results;
}

const FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens'];

// Usage of one request. token_count events repeat the running total, sometimes
// several times per request, so the difference from the previous total is used.
function usageDelta(info, prevTotal) {
  const total = info?.total_token_usage;
  if (total && prevTotal) {
    const d = Object.fromEntries(FIELDS.map(f => [f, (total[f] || 0) - (prevTotal[f] || 0)]));
    if (FIELDS.every(f => d[f] >= 0)) return d;
  }
  return info?.last_token_usage || (total && !prevTotal ? total : null);
}

/** Parses a rollout file into { sessionId, cwd, turns: [{ ts, model, input, output, cacheRead }] } */
function parseRollout(text, filePath) {
  let sessionId = null, cwd = null, model = null, prevTotal = null;
  const turns = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // a line still being written
    const p = rec?.payload;
    if (!p) continue;

    if (rec.type === 'session_meta') {
      sessionId = sessionId || p.id || null;
      cwd = cwd || p.cwd || null;
      model = model || p.model || null;
    } else if (rec.type === 'turn_context') {
      if (p.model) model = p.model;
      cwd = cwd || p.cwd || null;
    } else if (rec.type === 'event_msg' && p.type === 'token_count' && p.info) {
      const u = usageDelta(p.info, prevTotal);
      if (p.info.total_token_usage) prevTotal = p.info.total_token_usage;
      if (!u || !rec.timestamp) continue;
      const cached = u.cached_input_tokens || 0;
      const input = Math.max(0, (u.input_tokens || 0) - cached);
      const output = u.output_tokens || 0;
      if (!input && !cached && !output) continue;
      turns.push({ ts: rec.timestamp, model: model || DEFAULT_MODEL, input, output, cacheRead: cached });
    }
  }

  return { sessionId: sessionId || path.basename(filePath, '.jsonl'), cwd, turns };
}

function projectNameFromCwd(cwd) {
  return cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'codex' : 'codex';
}

// Rows from the pre-1.5 parser, which looked for a `usage` field that Codex
// doesn't write, are dropped once and every rollout is read again.
const PARSER_VERSION = 2;
const processedKey = filePath => `codex:v${PARSER_VERSION}:${filePath}`;

function dropLegacyRows(db) {
  const key = `codex_parser_v${PARSER_VERSION}`;
  if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(key)) return;
  db.transaction(() => {
    db.prepare("DELETE FROM turns WHERE provider = 'codex'").run();
    db.prepare("DELETE FROM sessions WHERE provider = 'codex'").run();
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
  })();
}

function scanAndStore(db, { codexDir = CODEX_DIR } = {}) {
  dropLegacyRows(db);
  const st = {
    processed: db.prepare('SELECT mtime FROM processed_files WHERE path = ?'),
    markProcessed: db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)'),
    deleteTurns: db.prepare("DELETE FROM turns WHERE session_id = ? AND provider = 'codex'"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE session_id = ? AND provider = 'codex'"),
    insertTurn: db.prepare(`
      INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'codex')
    `),
    upsertSession: db.prepare(`
      INSERT OR REPLACE INTO sessions
      (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
       total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'codex')
    `)
  };
  let newSessions = 0, newTurns = 0;

  for (const filePath of findRolloutFiles(codexDir)) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    const mtime = Math.floor(stat.mtimeMs);
    const key = processedKey(filePath);
    const existing = st.processed.get(key);
    if (existing && existing.mtime === mtime) continue;

    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const { sessionId: rawId, cwd, turns } = parseRollout(text, filePath);
    const sessionId = 'codex:' + rawId;

    db.transaction(() => {
      st.deleteTurns.run(sessionId);
      st.deleteSession.run(sessionId);

      const agg = { input: 0, output: 0, cacheRead: 0, first: null, last: null, model: null };
      for (const t of turns) {
        st.insertTurn.run(sessionId, t.ts, t.model, t.input, t.output, t.cacheRead);
        agg.input += t.input;
        agg.output += t.output;
        agg.cacheRead += t.cacheRead;
        agg.model = t.model;
        if (!agg.first || t.ts < agg.first) agg.first = t.ts;
        if (!agg.last  || t.ts > agg.last)  agg.last  = t.ts;
      }
      newTurns += turns.length;

      if (turns.length) {
        st.upsertSession.run(sessionId, projectNameFromCwd(cwd), agg.first, agg.last, agg.model,
          turns.length, agg.input, agg.output, agg.cacheRead);
        newSessions++;
      }
      st.markProcessed.run(key, mtime, turns.length);
    })();
  }

  return { newSessions, newTurns };
}

// ─── Quota ────────────────────────────────────────────────────────────────────
// Every token_count event carries the account's rate-limit windows, so the
// newest rollout file holds the current quota.

function newestRolloutFiles(codexDir, limit) {
  const sessions = path.join(codexDir, 'sessions');
  const out = [];
  // Walk YYYY/MM/DD folders newest first and stop once enough files are found
  function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (depth === 3) {
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'))
        .map(e => path.join(dir, e.name))
        .map(f => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.m - a.m);
      out.push(...files.map(x => x.f));
      return;
    }
    for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      walk(path.join(dir, e.name), depth + 1);
      if (out.length >= limit) return;
    }
  }
  walk(sessions, 0);
  return out.slice(0, limit);
}

// Last rate_limits snapshot in the final 256 KB of a file
function tailRateLimits(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const rec = JSON.parse(lines[i]);
        if (rec?.payload?.rate_limits) return { timestamp: rec.timestamp, limits: rec.payload.rate_limits };
      } catch {}
    }
  } catch {} finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

function toWindow(w, snapshotTime, now) {
  if (!w || w.used_percent == null) return null;
  let resetsAt = null;
  if (w.resets_at != null) resetsAt = new Date(w.resets_at * 1000);
  else if (w.resets_in_seconds != null && snapshotTime) resetsAt = new Date(new Date(snapshotTime).getTime() + w.resets_in_seconds * 1000);
  // The window has rolled over since the snapshot was written
  if (resetsAt && resetsAt.getTime() <= now) return { utilization: 0, resetsAt: null };
  return { utilization: w.used_percent, resetsAt: resetsAt ? resetsAt.toISOString() : null };
}

/** { session, weekly } from the newest rate-limit snapshot, or null */
function readQuota({ codexDir = CODEX_DIR, now = Date.now() } = {}) {
  for (const f of newestRolloutFiles(codexDir, 5)) {
    const snap = tailRateLimits(f);
    if (!snap) continue;
    const windows = [snap.limits.primary, snap.limits.secondary].filter(Boolean);
    const short = windows.find(w => (w.window_minutes || 0) <= 24 * 60);
    const long = windows.find(w => (w.window_minutes || 0) > 24 * 60);
    return { session: toWindow(short, snap.timestamp, now), weekly: toWindow(long, snap.timestamp, now) };
  }
  return null;
}

module.exports = { scanAndStore, parseRollout, readQuota, CODEX_DIR };
