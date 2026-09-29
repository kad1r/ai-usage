// providers/gemini/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_DIR  = path.join(os.homedir(), '.gemini');
const CHATS_BASE  = path.join(GEMINI_DIR, 'tmp');

// Token pricing per million tokens (USD) — Google Gemini models
const PRICING = {
  'gemini-2.5-pro':         { input: 1.25,  output: 10,   cacheRead: 0.31,    cacheWrite: 0 },
  'gemini-2.5-flash':       { input: 0.15,  output: 0.6,  cacheRead: 0.0375,  cacheWrite: 0 },
  'gemini-3-flash-preview': { input: 0.15,  output: 0.6,  cacheRead: 0.0375,  cacheWrite: 0 },
  'gemini-2.0-flash':       { input: 0.1,   output: 0.4,  cacheRead: 0.025,   cacheWrite: 0 },
  'gemini-2.0-flash-lite':  { input: 0.075, output: 0.3,  cacheRead: 0.01875, cacheWrite: 0 },
  'gemini-1.5-pro':         { input: 1.25,  output: 5,    cacheRead: 0.31,    cacheWrite: 0 },
  'gemini-1.5-flash':       { input: 0.075, output: 0.3,  cacheRead: 0.01875, cacheWrite: 0 },
};

// Fallback pricing for unknown model names — match by substring
function getPricing(model) {
  if (!model) return PRICING['gemini-2.0-flash'];
  const key = Object.keys(PRICING).find(k => model.startsWith(k) || model.includes(k));
  return key ? PRICING[key] : PRICING['gemini-2.0-flash'];
}

/**
 * Find all session chat files under ~/.gemini/tmp/<project>/chats/*.json
 * Returns [{ filePath, projectName }]
 */
function findChatFiles() {
  if (!fs.existsSync(CHATS_BASE)) return [];
  const results = [];

  let projects;
  try { projects = fs.readdirSync(CHATS_BASE, { withFileTypes: true }); } catch { return []; }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const chatsDir = path.join(CHATS_BASE, project.name, 'chats');
    if (!fs.existsSync(chatsDir)) continue;

    let files;
    try { files = fs.readdirSync(chatsDir, { withFileTypes: true }); } catch { continue; }

    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.json')) {
        results.push({ filePath: path.join(chatsDir, file.name), projectName: project.name });
      }
    }
  }

  return results;
}

function scanAndStore(db) {
  const chatFiles = findChatFiles();
  let newSessions = 0, newTurns = 0;

  for (const { filePath, projectName } of chatFiles) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const existing = db.prepare('SELECT mtime FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === Math.floor(stat.mtimeMs)) continue;

    let session;
    try {
      session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { console.warn('[gemini/scanner] JSON parse error in', filePath, ':', e.message); continue; }

    if (!session || !Array.isArray(session.messages)) continue;

    const sessionId = 'gemini:' + (session.sessionId || path.basename(filePath, '.json'));

    // Delete stale turns before re-processing
    db.prepare('DELETE FROM turns WHERE session_id = ? AND provider = ?').run(sessionId, 'gemini');

    let agg = { model: 'gemini-2.5-pro', turns: 0, inputT: 0, outputT: 0, cacheRead: 0, first: null, last: null };

    for (const msg of session.messages) {
      // Only gemini (assistant) messages carry token counts
      if (msg.type !== 'gemini' || !msg.tokens) continue;

      const model        = msg.model || 'gemini-2.5-pro';
      const inputTokens  = msg.tokens.input  || 0;
      const outputTokens = msg.tokens.output || 0;
      const cacheTokens  = msg.tokens.cached || 0;
      const ts           = msg.timestamp || session.startTime || new Date().toISOString();

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'gemini')
      `).run(sessionId, ts, model, inputTokens, outputTokens, cacheTokens);
      newTurns++;

      agg.turns++;
      agg.inputT    += inputTokens;
      agg.outputT   += outputTokens;
      agg.cacheRead += cacheTokens;
      agg.model      = model;
      if (!agg.first || ts < agg.first) agg.first = ts;
      if (!agg.last  || ts > agg.last)  agg.last  = ts;
    }

    if (agg.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'gemini')
      `).run(sessionId, projectName, agg.first, agg.last, agg.model,
             agg.turns, agg.inputT, agg.outputT, agg.cacheRead);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, Math.floor(stat.mtimeMs), session.messages.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, getPricing, GEMINI_DIR };
