const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { tempDb, tempDir, writeFile, jsonl } = require('./helpers');
const { scanAndStore } = require('../providers/gemini/scanner');

test('scans a .jsonl chat, keeping the last version of each message', () => {
  const { db } = tempDb();
  const geminiDir = tempDir();
  const file = path.join(geminiDir, 'tmp', 'my-project', 'chats', 'session-1.jsonl');
  writeFile(file, jsonl([
    { sessionId: 's1', startTime: '2026-09-01T09:00:00Z' },
    { id: 'm1', type: 'gemini', model: 'gemini-2.5-pro', timestamp: '2026-09-01T09:00:05Z', tokens: { input: 100, output: 10, cached: 40, thoughts: 5 } },
    { id: 'm1', type: 'gemini', model: 'gemini-2.5-pro', timestamp: '2026-09-01T09:00:05Z', tokens: { input: 120, output: 12, cached: 40, thoughts: 5 } },
    // No timestamp of its own: uses the session start, not the scan time
    { id: 'm2', type: 'gemini', model: 'gemini-2.5-flash', tokens: { input: 10, output: 1 } },
  ]), 1_800_000_000);

  scanAndStore(db, { geminiDir });
  const s = db.prepare("SELECT * FROM sessions WHERE session_id = 'gemini:s1'").get();
  assert.strictEqual(s.project_name, 'my-project');
  assert.strictEqual(s.turn_count, 2);
  assert.strictEqual(s.total_input_tokens, 90);   // (120 - 40) + 10
  assert.strictEqual(s.total_output_tokens, 18);  // 12 + 5 thoughts + 1
  assert.strictEqual(s.total_cache_read, 40);
  assert.strictEqual(s.first_timestamp, '2026-09-01T09:00:00Z');

  scanAndStore(db, { geminiDir });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM turns WHERE provider = 'gemini'").get().n, 2);
});
