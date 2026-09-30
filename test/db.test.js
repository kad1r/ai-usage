const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Database = require('better-sqlite3');
const { tempDir, tempDb } = require('./helpers');
const { openDb, migrateLegacyDb } = require('../db');
const { queryStats } = require('../stats');

test('legacy database is copied without the API key table', () => {
  const dir = tempDir();
  const legacy = path.join(dir, 'legacy.db');
  // A 1.4 database: 1.4 schema without the offset column, plus the key table
  const old = openDb(legacy);
  old.exec(`
    ALTER TABLE processed_files DROP COLUMN offset;
    CREATE TABLE providers (id TEXT PRIMARY KEY, enabled INTEGER, api_key TEXT);
    INSERT INTO sessions (session_id, project_name, model) VALUES ('s1', 'p', 'claude-opus-5-5');
    INSERT INTO providers VALUES ('codex', 1, 'secret');
  `);
  old.close();

  const target = path.join(dir, 'new', 'usage.db');
  assert.strictEqual(migrateLegacyDb(legacy, target), true);
  assert.strictEqual(migrateLegacyDb(legacy, target), false); // only once

  const db = openDb(target);
  assert.strictEqual(db.prepare('SELECT project_name FROM sessions').get().project_name, 'p');
  const cols = db.prepare('PRAGMA table_info(processed_files)').all().map(c => c.name);
  assert.ok(cols.includes('offset')); // column added
  assert.strictEqual(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'providers'").get(), undefined);
  db.close();

  const left = new Database(legacy);
  assert.strictEqual(left.prepare("SELECT 1 FROM sqlite_master WHERE name = 'providers'").get(), undefined);
  left.close();
});

test('stats price each provider with its own table', () => {
  const { db } = tempDb();
  const add = db.prepare(`INSERT INTO sessions (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
    total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider) VALUES (?, 'p', ?, ?, ?, 1, ?, ?, 0, 0, ?)`);
  const now = new Date().toISOString();
  add.run('codex:1', now, now, 'gpt-4o', 1e6, 0, 'codex');           // $2.50
  add.run('c1', now, now, 'claude-sonnet-5-5', 1e6, 0, 'claude');    // $2.00

  const all = queryStats(db, { days: 30 });
  assert.strictEqual(all.summary.totalCost, 4.5);
  const codex = queryStats(db, { days: 30, provider: 'codex' });
  assert.strictEqual(codex.summary.totalCost, 2.5);
  // Garbage filter values are ignored instead of throwing
  assert.strictEqual(queryStats(db, { days: 'abc' }).summary.sessionCount, 2);
});
