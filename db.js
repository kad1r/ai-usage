// db.js — the local usage database shared by the scanners and the stats queries
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(dbPath, options = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, options);
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
      total_cache_creation INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'claude'
    );
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'claude'
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_timestamp);
    CREATE TABLE IF NOT EXISTS processed_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER,
      lines INTEGER,
      offset INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  // Columns added after the first release
  addColumn(db, 'sessions', 'provider', "TEXT DEFAULT 'claude'");
  addColumn(db, 'turns', 'provider', "TEXT DEFAULT 'claude'");
  addColumn(db, 'processed_files', 'offset', 'INTEGER');

  // Held per-provider API keys that nothing used (removed in 1.5.0)
  db.exec('DROP TABLE IF EXISTS providers');

  return db;
}

function addColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

// Up to 1.4.x the database lived in ~/.claude/usage.db, inside Claude Code's own
// folder. Copy it into the app's data folder once; the database also keeps
// sessions whose transcripts Claude Code has since deleted, so it can't just be
// rebuilt. The old file is left in place, minus the stored API keys.
function migrateLegacyDb(legacyPath, dbPath) {
  if (fs.existsSync(dbPath) || !fs.existsSync(legacyPath)) return false;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const legacy = new Database(legacyPath);
  try {
    legacy.exec('DROP TABLE IF EXISTS providers');
    legacy.prepare('VACUUM INTO ?').run(dbPath);
  } finally {
    legacy.close();
  }
  return true;
}

module.exports = { openDb, migrateLegacyDb };
