// providers/codex/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_DIR = path.join(os.homedir(), '.codex');

// Token pricing per million tokens (USD) — OpenAI models
const PRICING = {
  'gpt-4o':           { input: 2.5,  output: 10,   cacheRead: 1.25, cacheWrite: 0 },
  'gpt-4o-mini':      { input: 0.15, output: 0.6,  cacheRead: 0.075, cacheWrite: 0 },
  'o1':               { input: 15,   output: 60,   cacheRead: 7.5,  cacheWrite: 0 },
  'o3-mini':          { input: 1.1,  output: 4.4,  cacheRead: 0.55, cacheWrite: 0 },
};
const DEFAULT_PRICING = { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 };

function calcCost(model, inputTokens, outputTokens, cacheRead) {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output + (cacheRead / 1e6) * p.cacheRead;
}

function findJsonlFiles() {
  if (!fs.existsSync(CODEX_DIR)) return [];
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) results.push(full);
    }
  }
  walk(CODEX_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findJsonlFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const existing = db.prepare('SELECT mtime, lines FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === Math.floor(stat.mtimeMs)) continue;

    let lines;
    try { lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean); } catch { continue; }

    const sessionId = 'codex:' + path.basename(filePath, '.jsonl');
    // Delete stale turns so re-processing doesn't accumulate duplicates
    db.prepare('DELETE FROM turns WHERE session_id = ? AND provider = ?').run(sessionId, 'codex');
    let sessionData = { model: 'gpt-4o', turns: 0, inputT: 0, outputT: 0, cacheRead: 0, first: null, last: null };

    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch (e) { console.warn('[codex/scanner] JSON parse error in', filePath, ':', e.message); continue; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;

      const usage = msg.usage || msg.response?.usage;
      if (!usage) continue;

      const model = msg.model || 'gpt-4o';
      const inputTokens  = usage.input_tokens  || usage.prompt_tokens     || 0;
      const outputTokens = usage.output_tokens || usage.completion_tokens  || 0;
      const cacheRead    = usage.cache_read_input_tokens || 0;
      const ts = msg.created_at || msg.timestamp || new Date().toISOString();

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'codex')
      `).run(sessionId, ts, model, inputTokens, outputTokens, cacheRead);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.cacheRead += cacheRead;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count, total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'codex')
      `).run(sessionId, 'codex', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT, sessionData.cacheRead);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, Math.floor(stat.mtimeMs), lines.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, CODEX_DIR };
