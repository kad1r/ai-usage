const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDb, tempDir, writeFile, appendFile, jsonl } = require('./helpers');
const { scanAndStore } = require('../providers/claude/scanner');

const SESSION = '11111111-2222-3333-4444-555555555555';

const assistant = (ts, model, input, output, extra = {}) => ({
  type: 'assistant', timestamp: ts,
  message: { model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } },
  ...extra
});

function setup() {
  const { db } = tempDb();
  const projectsDir = tempDir();
  const file = path.join(projectsDir, 'D--Work-My-App', `${SESSION}.jsonl`);
  return { db, projectsDir, file };
}

const session = db => db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(SESSION);
const turnCount = db => db.prepare('SELECT COUNT(*) n FROM turns WHERE session_id = ?').get(SESSION).n;

test('scans a transcript into a session with totals', () => {
  const { db, projectsDir, file } = setup();
  writeFile(file, jsonl([
    { type: 'user', cwd: 'D:\\Work\\My-App', timestamp: '2026-09-01T10:00:00Z' },
    assistant('2026-09-01T10:00:05Z', 'claude-opus-5-5', 100, 20),
    assistant('2026-09-01T10:01:00Z', 'claude-sonnet-5-5', 50, 10),
  ]), 1_800_000_000);

  scanAndStore(db, { projectsDir });
  const s = session(db);
  assert.strictEqual(s.project_name, 'My-App');
  assert.strictEqual(s.turn_count, 2);
  assert.strictEqual(s.total_input_tokens, 150);
  assert.strictEqual(s.total_output_tokens, 30);
  assert.strictEqual(s.total_cache_read, 20);
  assert.strictEqual(s.total_cache_creation, 10);
  assert.strictEqual(s.model, 'claude-sonnet-5-5');
  assert.strictEqual(s.first_timestamp, '2026-09-01T10:00:05Z');
  assert.strictEqual(s.last_timestamp, '2026-09-01T10:01:00Z');
});

test('reads only appended bytes and waits for a partial last line', () => {
  const { db, projectsDir, file } = setup();
  writeFile(file, jsonl([assistant('2026-09-01T10:00:00Z', 'claude-opus-5-5', 100, 20)]), 1_800_000_000);
  scanAndStore(db, { projectsDir });

  // A complete line plus half of the next one
  const next = JSON.stringify(assistant('2026-09-01T10:02:00Z', 'claude-opus-5-5', 7, 3));
  appendFile(file, jsonl([assistant('2026-09-01T10:01:00Z', 'claude-opus-5-5', 1, 1)]) + next.slice(0, 20), 1_800_000_100);
  scanAndStore(db, { projectsDir });
  assert.strictEqual(turnCount(db), 2);
  assert.strictEqual(session(db).total_input_tokens, 101);

  appendFile(file, next.slice(20) + '\n', 1_800_000_200);
  scanAndStore(db, { projectsDir });
  assert.strictEqual(turnCount(db), 3);
  assert.strictEqual(session(db).total_input_tokens, 108);
  assert.strictEqual(session(db).last_timestamp, '2026-09-01T10:02:00Z');

  const row = db.prepare('SELECT offset FROM processed_files WHERE path = ?').get(file);
  assert.strictEqual(row.offset, fs.statSync(file).size);
});

test('an unchanged file is skipped, a shrunk file is read again in full', () => {
  const { db, projectsDir, file } = setup();
  writeFile(file, jsonl([
    assistant('2026-09-01T10:00:00Z', 'claude-opus-5-5', 100, 20),
    assistant('2026-09-01T10:01:00Z', 'claude-opus-5-5', 100, 20),
  ]), 1_800_000_000);
  scanAndStore(db, { projectsDir });
  scanAndStore(db, { projectsDir });
  assert.strictEqual(turnCount(db), 2);

  writeFile(file, jsonl([assistant('2026-09-01T11:00:00Z', 'claude-opus-5-5', 1, 1)]), 1_800_000_500);
  scanAndStore(db, { projectsDir });
  assert.strictEqual(turnCount(db), 1);
  assert.strictEqual(session(db).total_input_tokens, 1);
});

test('rows written before offsets existed are rebuilt once', () => {
  const { db, projectsDir, file } = setup();
  writeFile(file, jsonl([assistant('2026-09-01T10:00:00Z', 'claude-opus-5-5', 100, 20)]), 1_800_000_000);
  // What 1.4 left behind: turns plus a processed_files row without offset
  db.prepare("INSERT INTO turns (session_id, timestamp, input_tokens) VALUES (?, '2026-09-01T10:00:00Z', 100)").run(SESSION);
  db.prepare('INSERT INTO processed_files (path, mtime, lines) VALUES (?, 1, 1)').run(file);

  scanAndStore(db, { projectsDir });
  assert.strictEqual(turnCount(db), 1);
});

test('falls back to the folder name without a cwd', () => {
  const { db, projectsDir, file } = setup();
  writeFile(file, jsonl([assistant('2026-09-01T10:00:00Z', 'claude-opus-5-5', 1, 1)]), 1_800_000_000);
  scanAndStore(db, { projectsDir });
  assert.strictEqual(session(db).project_name, 'App');
});
