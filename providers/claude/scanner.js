const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const DB_PATH = path.join(os.homedir(), '.claude', 'usage.db');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const geminiScanner = require('../gemini/scanner');

// Token pricing per million tokens (USD), Anthropic first-party API.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-09-30)
// cacheWrite is the 5-minute write (1.25x input); cacheRead is 0.1x input except
// Opus 5.5 (0.05x) and Fable 5.1 (0.025x).
const PRICING = {
  'claude-fable-5-1':   { input: 10,  output: 50, cacheRead: 0.25, cacheWrite: 12.5  },
  'claude-fable-5':     { input: 10,  output: 50, cacheRead: 1,    cacheWrite: 12.5  },
  'claude-opus-5-5':    { input: 4,   output: 20, cacheRead: 0.2,  cacheWrite: 5     },
  'claude-opus-5':      { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-8':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-7':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-6':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-5':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-1':    { input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4':      { input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-5-5':  { input: 2,   output: 10, cacheRead: 0.2,  cacheWrite: 2.5   },
  'claude-sonnet-5':    { input: 2,   output: 10, cacheRead: 0.2,  cacheWrite: 2.5   },
  'claude-sonnet-4-6':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-sonnet-4-5':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-sonnet-4':    { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-haiku-4-5':   { input: 1,   output: 5,  cacheRead: 0.1,  cacheWrite: 1.25  },
};
const DEFAULT_PRICING = PRICING['claude-sonnet-5-5'];
const ZERO_PRICING = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function pricingFor(model) {
  if (!model || model.startsWith('<')) return ZERO_PRICING; // e.g. Claude Code's "<synthetic>"
  if (model.startsWith('gemini')) return geminiScanner.getPricing(model);
  // Dated ids such as "claude-haiku-4-5-20251001" share the alias's price
  return PRICING[model] || PRICING[model.replace(/-\d{8}$/, '')] || DEFAULT_PRICING;
}

function calcCost(model, inputTokens, outputTokens, cacheRead, cacheWrite) {
  const p = pricingFor(model);
  return (
    (inputTokens  / 1e6) * p.input +
    (outputTokens / 1e6) * p.output +
    (cacheRead    / 1e6) * p.cacheRead +
    (cacheWrite   / 1e6) * p.cacheWrite
  );
}

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_name TEXT,
      first_timestamp TEXT,
      last_timestamp TEXT,
      model TEXT,
      turn_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read INTEGER DEFAULT 0,
      total_cache_creation INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_timestamp);
    CREATE TABLE IF NOT EXISTS processed_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER,
      lines INTEGER
    );
  `);

  // Migration: add provider column if not exists
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
  if (!sessionCols.includes('provider')) {
    db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'");
  }
  const turnCols = db.prepare("PRAGMA table_info(turns)").all().map(c => c.name);
  if (!turnCols.includes('provider')) {
    db.exec("ALTER TABLE turns ADD COLUMN provider TEXT DEFAULT 'claude'");
  }

  // Provider settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id          TEXT PRIMARY KEY,
      enabled     INTEGER DEFAULT 1,
      api_key     TEXT,
      last_synced TEXT,
      settings    TEXT
    );
  `);

  return db;
}

function projectNameFromPath(filePath) {
  const parts = filePath.split(path.sep);
  const projectDir = parts[parts.length - 2] || 'unknown';
  return projectDir.replace(/^-/, '').replace(/-/g, '/').split('/').pop() || projectDir;
}

function sessionIdFromPath(filePath) {
  return path.basename(filePath, '.jsonl');
}

function scanFile(db, filePath) {
  const doScan = db.transaction(() => {
    const stat = fs.statSync(filePath);
    const mtime = Math.floor(stat.mtimeMs);

    const existing = db.prepare('SELECT mtime, lines FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === mtime) return;

    // Delete existing turns for this session before re-inserting (handles file growth)
    db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionIdFromPath(filePath));

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    const sessionId = sessionIdFromPath(filePath);
    const projectName = projectNameFromPath(filePath);

    let firstTimestamp = null;
    let lastTimestamp = null;
    let model = null;
    let turnCount = 0;
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;

    const insertTurn = db.prepare(`
      INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'claude')
    `);

    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch (e) { console.warn('[claude/scanner] JSON parse error in', filePath, ':', e.message); continue; }

      if (record.type !== 'assistant') continue;
      const usage = record.message?.usage;
      if (!usage) continue;

      const ts = record.timestamp || record.message?.timestamp || null;
      const m  = record.message?.model || null;
      const input     = usage.input_tokens || 0;
      const output    = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheWrite= usage.cache_creation_input_tokens || 0;

      if (ts) {
        if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
        if (!lastTimestamp  || ts > lastTimestamp)  lastTimestamp  = ts;
      }
      if (m) model = m;

      totalInput     += input;
      totalOutput    += output;
      totalCacheRead += cacheRead;
      totalCacheWrite+= cacheWrite;
      turnCount++;

      if (ts) {
        insertTurn.run(sessionId, ts, m, input, output, cacheRead, cacheWrite);
      }
    }

    if (turnCount === 0) {
      db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)').run(filePath, mtime, lines.length);
      return;
    }

    db.prepare(`
      INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude')
    `).run(sessionId, projectName, firstTimestamp, lastTimestamp, model, turnCount,
           totalInput, totalOutput, totalCacheRead, totalCacheWrite);

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)').run(filePath, mtime, lines.length);
  });
  doScan();
}

function getAllJsonlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

function scan() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return { scanned: 0, error: null };

  const db = openDb();
  let scanned = 0;

  try {
    const files = getAllJsonlFiles(CLAUDE_PROJECTS_DIR);
    for (const file of files) {
      try {
        scanFile(db, file);
        scanned++;
      } catch (e) {
        // Skip unreadable files
      }
    }
  } finally {
    db.close();
  }

  return { scanned, error: null };
}

function queryStats(filters = {}) {
  const db = openDb();
  try {
    const { model, days, provider } = filters;
    let whereSession = '1=1';
    const params = [];

    if (days && days > 0) {
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      whereSession += ' AND first_timestamp >= ?';
      params.push(cutoff);
    }
    if (model && model !== 'all') {
      whereSession += ' AND model LIKE ?';
      params.push(`%${model}%`);
    }
    if (provider && provider !== 'all') {
      whereSession += ' AND provider = ?';
      params.push(provider);
    }

    const summary = db.prepare(`
      SELECT COUNT(*) as sessionCount,
             SUM(turn_count) as totalTurns,
             SUM(total_input_tokens) as totalInput,
             SUM(total_output_tokens) as totalOutput,
             SUM(total_cache_read) as totalCacheRead,
             SUM(total_cache_creation) as totalCacheWrite
      FROM sessions WHERE ${whereSession}
    `).get(...params);

    const sessions = db.prepare(`SELECT * FROM sessions WHERE ${whereSession}`).all(...params);
    let totalCost = 0;
    const projectCost = new Map();
    for (const s of sessions) {
      const cost = calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation);
      totalCost += cost;
      projectCost.set(s.project_name, (projectCost.get(s.project_name) || 0) + cost);
    }

    const dailyRows = db.prepare(`
      SELECT DATE(first_timestamp, 'localtime') as day,
             SUM(total_input_tokens) as input,
             SUM(total_output_tokens) as output,
             SUM(total_cache_read) as cacheRead,
             SUM(total_cache_creation) as cacheWrite
      FROM sessions WHERE ${whereSession}
      GROUP BY day ORDER BY day ASC
    `).all(...params);

    const projectRows = db.prepare(`
      SELECT project_name,
             SUM(total_input_tokens + total_output_tokens) as totalTokens,
             COUNT(*) as sessionCount
      FROM sessions WHERE ${whereSession}
      GROUP BY project_name ORDER BY totalTokens DESC LIMIT 10
    `).all(...params).map(r => ({ ...r, cost: projectCost.get(r.project_name) || 0 }));

    const modelRows = db.prepare(`
      SELECT model,
             COUNT(*) as sessionCount,
             SUM(turn_count) as turns,
             SUM(total_input_tokens) as input,
             SUM(total_output_tokens) as output,
             SUM(total_cache_read) as cacheRead,
             SUM(total_cache_creation) as cacheWrite
      FROM sessions WHERE ${whereSession}
      GROUP BY model ORDER BY input DESC
    `).all(...params);

    const modelRowsWithCost = modelRows.map(r => ({
      ...r,
      cost: calcCost(r.model, r.input, r.output, r.cacheRead, r.cacheWrite)
    }));

    const recentSessions = db.prepare(`
      SELECT session_id, project_name, first_timestamp, last_timestamp, model,
             turn_count, total_input_tokens, total_output_tokens,
             total_cache_read, total_cache_creation
      FROM sessions WHERE ${whereSession}
      ORDER BY last_timestamp DESC LIMIT 50
    `).all(...params).map(s => ({
      ...s,
      cost: calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation),
      durationMinutes: s.first_timestamp && s.last_timestamp
        ? Math.round((new Date(s.last_timestamp) - new Date(s.first_timestamp)) / 60000)
        : 0
    }));

    return { summary: { ...summary, totalCost }, dailyRows, projectRows, modelRows: modelRowsWithCost, recentSessions };
  } finally {
    db.close();
  }
}

function getAvailableModels() {
  const db = openDb();
  try {
    return db.prepare('SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL ORDER BY model').all().map(r => r.model);
  } finally {
    db.close();
  }
}

// scanAndStore is an alias for scan (used by ClaudeProvider.scanLocal)
function scanAndStore(db) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return { scanned: 0, error: null };

  let scanned = 0;
  const files = getAllJsonlFiles(CLAUDE_PROJECTS_DIR);
  for (const file of files) {
    try {
      scanFile(db, file);
      scanned++;
    } catch (e) {
      // Skip unreadable files
    }
  }
  return { scanned, error: null };
}

module.exports = { scan, scanAndStore, queryStats, openDb, getAvailableModels, PRICING, calcCost, pricingFor };
