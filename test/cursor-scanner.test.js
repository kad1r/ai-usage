const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { tempDb, tempDir } = require('./helpers');
const { scanAndStore } = require('../providers/cursor/scanner');

function kvDb(file, table, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`);
  const put = db.prepare(`INSERT INTO ${table} (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(rows)) put.run(k, Buffer.from(JSON.stringify(v)));
  db.close();
}

function setup(lastUpdatedAt = 1_788_000_000_000) {
  const userDir = tempDir();
  kvDb(path.join(userDir, 'globalStorage', 'state.vscdb'), 'cursorDiskKV', {
    'composerData:c1': { composerId: 'c1', createdAt: 1_788_000_000_000, lastUpdatedAt, modelConfig: { modelName: 'claude-4-sonnet' } },
    'bubbleId:c1:b1': { type: 1, text: 'hi', tokenCount: { inputTokens: 0, outputTokens: 0 } },
    'bubbleId:c1:b2': { type: 2, createdAt: '2026-09-01T10:00:00.000Z', tokenCount: { inputTokens: 300, outputTokens: 40 } },
    'bubbleId:c1:b3': { type: 2, createdAt: '2026-09-01T10:02:00.000Z', tokenCount: { inputTokens: 100, outputTokens: 10 }, modelInfo: { modelName: 'gpt-5' } },
    // Another chat's bubble whose key shares the prefix up to the id
    'bubbleId:c10:b1': { type: 2, tokenCount: { inputTokens: 999, outputTokens: 999 } },
    'composerData:c2': { composerId: 'c2', createdAt: 1_788_000_000_000, conversation: [] },
  });
  const ws = path.join(userDir, 'workspaceStorage', 'abc');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ folder: 'file:///d%3A/Work/cursor-site' }));
  kvDb(path.join(ws, 'state.vscdb'), 'ItemTable', { 'composer.composerData': { allComposers: [{ composerId: 'c1' }] } });
  return userDir;
}

test('reads chats from state.vscdb with their workspace', () => {
  const { db } = tempDb();
  const userDir = setup();
  scanAndStore(db, { userDir });

  const s = db.prepare("SELECT * FROM sessions WHERE session_id = 'cursor:c1'").get();
  assert.strictEqual(s.project_name, 'cursor-site');
  assert.strictEqual(s.turn_count, 2);
  assert.strictEqual(s.total_input_tokens, 400);
  assert.strictEqual(s.total_output_tokens, 50);
  assert.strictEqual(s.model, 'gpt-5');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM sessions WHERE provider = 'cursor'").get().n, 1);
  const models = db.prepare("SELECT model FROM turns WHERE session_id = 'cursor:c1' ORDER BY timestamp").all().map(r => r.model);
  assert.deepStrictEqual(models, ['claude-4-sonnet', 'gpt-5']);
});

test('unchanged chats are skipped', () => {
  const { db } = tempDb();
  const userDir = setup();
  scanAndStore(db, { userDir });
  scanAndStore(db, { userDir });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM turns WHERE provider = 'cursor'").get().n, 2);
});

test('no Cursor install: nothing happens', () => {
  const { db } = tempDb();
  assert.deepStrictEqual(scanAndStore(db, { userDir: tempDir() }), { newSessions: 0, newTurns: 0 });
});
