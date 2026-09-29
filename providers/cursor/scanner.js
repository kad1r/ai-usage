// providers/cursor/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// Cursor stores usage data in Electron userData (Windows)
const CURSOR_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Cursor', 'User', 'globalStorage'
);

// Token pricing per million tokens (USD) — Cursor uses various models
const PRICING = {
  'claude-3.5-sonnet':  { input: 3,    output: 15,   cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-3-opus':      { input: 15,   output: 75,   cacheRead: 1.5,  cacheWrite: 18.75 },
  'gpt-4o':             { input: 2.5,  output: 10,   cacheRead: 1.25, cacheWrite: 0 },
  'gpt-4o-mini':        { input: 0.15, output: 0.6,  cacheRead: 0.075, cacheWrite: 0 },
  'cursor-small':       { input: 0,    output: 0,    cacheRead: 0,    cacheWrite: 0 },
};


function findUsageFiles() {
  if (!fs.existsSync(CURSOR_DATA_DIR)) return [];
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json') && (
        entry.name.includes('usage') ||
        entry.name.includes('conversation') ||
        entry.name.includes('history')
      )) {
        results.push(full);
      }
    }
  }
  walk(CURSOR_DATA_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findUsageFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const existing = db.prepare('SELECT mtime FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === Math.floor(stat.mtimeMs)) continue;

    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { console.warn('[cursor/scanner] JSON parse error in', filePath, ':', e.message); continue; }
    if (!data || typeof data !== 'object') continue;

    // Cursor usage data can be an array or an object with a usage/conversations array
    const usageEntries = Array.isArray(data) ? data : (data.usage || data.conversations || data.items || []);
    if (!Array.isArray(usageEntries) || usageEntries.length === 0) continue;

    const sessionId = 'cursor:' + path.basename(filePath, '.json');

    // Delete stale turns before re-processing
    db.prepare('DELETE FROM turns WHERE session_id = ? AND provider = ?').run(sessionId, 'cursor');

    let sessionData = { model: 'gpt-4o', turns: 0, inputT: 0, outputT: 0, first: null, last: null };

    for (const entry of usageEntries) {
      if (!entry || typeof entry !== 'object') continue;

      const inputTokens  = entry.inputTokens  || entry.promptTokens    || entry.input_tokens  || 0;
      const outputTokens = entry.outputTokens || entry.responseTokens  || entry.output_tokens || 0;
      const model = entry.model || 'gpt-4o';
      const ts = entry.timestamp || entry.createdAt || entry.created_at || new Date().toISOString();

      if (!inputTokens && !outputTokens) continue;

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'cursor')
      `).run(sessionId, ts, model, inputTokens, outputTokens);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'cursor')
      `).run(sessionId, 'cursor', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, Math.floor(stat.mtimeMs), usageEntries.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, CURSOR_DATA_DIR };
