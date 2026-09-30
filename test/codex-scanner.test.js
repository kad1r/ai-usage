const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { tempDb, tempDir, writeFile, jsonl } = require('./helpers');
const { scanAndStore, parseRollout, readQuota } = require('../providers/codex/scanner');

const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const tokenCount = (ts, total, last, rateLimits) => ({
  timestamp: ts, type: 'event_msg',
  payload: { type: 'token_count', info: total ? { total_token_usage: total, last_token_usage: last } : null, rate_limits: rateLimits }
});

const ROLLOUT = [
  { timestamp: '2026-09-01T10:00:00Z', type: 'session_meta', payload: { id: 'abc-123', cwd: '/home/me/code/shop-api' } },
  { timestamp: '2026-09-01T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: '/home/me/code/shop-api' } },
  tokenCount('2026-09-01T10:00:10Z', usage(1000, 200, 50), usage(1000, 200, 50)),
  // Repeated snapshot of the same total: not a new request
  tokenCount('2026-09-01T10:00:11Z', usage(1000, 200, 50), usage(1000, 200, 50)),
  { timestamp: '2026-09-01T10:05:00Z', type: 'turn_context', payload: { model: 'gpt-5.4' } },
  tokenCount('2026-09-01T10:05:10Z', usage(2500, 1200, 80), usage(1500, 1000, 30),
    { primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_900_000_000 }, secondary: { used_percent: 40, window_minutes: 10080, resets_in_seconds: 3600 } }),
  tokenCount('2026-09-01T10:05:11Z', null, null),
];

test('parseRollout turns running totals into per-request usage', () => {
  const r = parseRollout(jsonl(ROLLOUT), 'rollout.jsonl');
  assert.strictEqual(r.sessionId, 'abc-123');
  assert.strictEqual(r.cwd, '/home/me/code/shop-api');
  assert.deepStrictEqual(r.turns, [
    { ts: '2026-09-01T10:00:10Z', model: 'gpt-5-codex', input: 800, output: 50, cacheRead: 200 },
    { ts: '2026-09-01T10:05:10Z', model: 'gpt-5.4', input: 500, output: 30, cacheRead: 1000 },
  ]);
});

test('scanAndStore stores a codex session and drops pre-1.5 rows', () => {
  const { db } = tempDb();
  const codexDir = tempDir();
  db.prepare("INSERT INTO sessions (session_id, provider) VALUES ('codex:old', 'codex')").run();
  writeFile(path.join(codexDir, 'sessions', '2026', '09', '01', 'rollout-x-abc-123.jsonl'), jsonl(ROLLOUT), 1_800_000_000);

  scanAndStore(db, { codexDir });
  const rows = db.prepare("SELECT * FROM sessions WHERE provider = 'codex'").all();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].session_id, 'codex:abc-123');
  assert.strictEqual(rows[0].project_name, 'shop-api');
  assert.strictEqual(rows[0].turn_count, 2);
  assert.strictEqual(rows[0].total_input_tokens, 1300);
  assert.strictEqual(rows[0].total_cache_read, 1200);

  // Second scan of an unchanged file adds nothing
  scanAndStore(db, { codexDir });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM turns WHERE provider = 'codex'").get().n, 2);
});

test('readQuota maps the 5h and weekly windows from the newest rollout', () => {
  const codexDir = tempDir();
  writeFile(path.join(codexDir, 'sessions', '2026', '08', '30', 'rollout-old.jsonl'),
    jsonl([tokenCount('2026-08-30T10:00:00Z', usage(1, 0, 1), usage(1, 0, 1), { primary: { used_percent: 99, window_minutes: 300, resets_at: 1_900_000_000 } })]), 1_700_000_000);
  writeFile(path.join(codexDir, 'sessions', '2026', '09', '01', 'rollout-new.jsonl'), jsonl(ROLLOUT), 1_800_000_000);

  const now = Date.parse('2026-09-01T10:30:00Z');
  const q = readQuota({ codexDir, now });
  assert.deepStrictEqual(q.session, { utilization: 12.5, resetsAt: new Date(1_900_000_000 * 1000).toISOString() });
  assert.deepStrictEqual(q.weekly, { utilization: 40, resetsAt: '2026-09-01T11:05:10.000Z' });

  // After the weekly window has rolled over the old percentage no longer applies
  const later = readQuota({ codexDir, now: Date.parse('2026-09-01T12:00:00Z') });
  assert.deepStrictEqual(later.weekly, { utilization: 0, resetsAt: null });
});

test('readQuota returns null without rollouts', () => {
  assert.strictEqual(readQuota({ codexDir: tempDir() }), null);
});
