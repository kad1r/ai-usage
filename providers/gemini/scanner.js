// providers/gemini/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_DIR  = path.join(os.homedir(), '.gemini');

// Bump when the parsing/token maths changes so already-processed files are re-read
const PARSER_VERSION = 2;
const processedKey = filePath => `gemini:v${PARSER_VERSION}:${filePath}`;

/**
 * Find all session chat files under ~/.gemini/tmp/<project>/chats/
 * (*.json — older CLI, *.jsonl — current CLI)
 * Returns [{ filePath, projectName }]
 */
function findChatFiles(geminiDir) {
  const chatsBase = path.join(geminiDir, 'tmp');
  if (!fs.existsSync(chatsBase)) return [];
  const results = [];

  let projects;
  try { projects = fs.readdirSync(chatsBase, { withFileTypes: true }); } catch { return []; }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const chatsDir = path.join(chatsBase, project.name, 'chats');
    if (!fs.existsSync(chatsDir)) continue;

    let files;
    try { files = fs.readdirSync(chatsDir, { withFileTypes: true }); } catch { continue; }

    for (const file of files) {
      if (file.isFile() && /\.jsonl?$/.test(file.name)) {
        results.push({ filePath: path.join(chatsDir, file.name), projectName: project.name });
      }
    }
  }

  return results;
}

/**
 * Parse a session file into { sessionId, startTime, messages }.
 *
 * .json  — one object with a `messages` array.
 * .jsonl — append-only log: a header line ({ sessionId, startTime, ... }), one
 *          line per message ({ id, type, ... }) and `{ $set: {...} }` patches.
 *          A message is re-appended whenever it is updated, so the same id can
 *          appear several times — keep the last version of each.
 */
function parseSession(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!filePath.endsWith('.jsonl')) return JSON.parse(text);

  let header = {};
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // tolerate a partially written last line
    if (obj.$set) {
      for (const m of obj.$set.messages || []) if (m?.id) byId.set(m.id, m);
    } else if (obj.id && obj.type) {
      byId.set(obj.id, obj);
    } else if (obj.sessionId) {
      header = obj;
    }
  }
  return { ...header, messages: [...byId.values()] };
}

/**
 * Gemini reports `input` including cached tokens, and bills `thoughts` as
 * output (total = input + output + thoughts + tool).
 */
function normalizeTokens(t) {
  const cached = t.cached || 0;
  return {
    input:  Math.max(0, (t.input || 0) - cached),
    output: (t.output || 0) + (t.thoughts || 0),
    cached
  };
}

function scanAndStore(db, { geminiDir = GEMINI_DIR } = {}) {
  const st = {
    processed: db.prepare('SELECT mtime FROM processed_files WHERE path = ?'),
    markProcessed: db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)'),
    deleteProcessed: db.prepare('DELETE FROM processed_files WHERE path = ?'),
    deleteTurns: db.prepare("DELETE FROM turns WHERE session_id = ? AND provider = 'gemini'"),
    insertTurn: db.prepare(`
      INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'gemini')
    `),
    upsertSession: db.prepare(`
      INSERT OR REPLACE INTO sessions
      (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
       total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'gemini')
    `)
  };
  let newSessions = 0, newTurns = 0;

  for (const { filePath, projectName } of findChatFiles(geminiDir)) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    const mtime = Math.floor(stat.mtimeMs);

    const key = processedKey(filePath);
    const existing = st.processed.get(key);
    if (existing && existing.mtime === mtime) continue;

    let session;
    try {
      session = parseSession(filePath);
    } catch (e) { console.warn('[gemini/scanner] parse error in', filePath, ':', e.message); continue; }

    if (!session || !Array.isArray(session.messages)) continue;

    const sessionId = 'gemini:' + (session.sessionId || path.basename(filePath, '.json'));
    // Messages without their own time fall back to the session start, then the
    // file's mtime — never "now", which would move them on every re-scan
    const fallbackTs = session.startTime || new Date(stat.mtimeMs).toISOString();

    db.transaction(() => {
      st.deleteTurns.run(sessionId);

      const agg = { model: null, turns: 0, inputT: 0, outputT: 0, cacheRead: 0, first: null, last: null };
      for (const msg of session.messages) {
        // Only gemini (assistant) messages carry token counts
        if (msg.type !== 'gemini' || !msg.tokens) continue;

        const model = msg.model || 'gemini-2.5-pro';
        const { input, output, cached } = normalizeTokens(msg.tokens);
        const ts = msg.timestamp || fallbackTs;

        st.insertTurn.run(sessionId, ts, model, input, output, cached);
        newTurns++;

        agg.turns++;
        agg.inputT    += input;
        agg.outputT   += output;
        agg.cacheRead += cached;
        agg.model      = model;
        if (!agg.first || ts < agg.first) agg.first = ts;
        if (!agg.last  || ts > agg.last)  agg.last  = ts;
      }

      if (agg.turns > 0) {
        st.upsertSession.run(sessionId, projectName, agg.first, agg.last, agg.model,
          agg.turns, agg.inputT, agg.outputT, agg.cacheRead);
        newSessions++;
      }

      st.markProcessed.run(key, mtime, session.messages.length);
      // Entry written by parser v1 (keyed by the bare path)
      st.deleteProcessed.run(filePath);
    })();
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, parseSession, normalizeTokens, GEMINI_DIR };
