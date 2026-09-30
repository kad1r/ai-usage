const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../db');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-test-'));
}

function tempDb() {
  const dir = tempDir();
  return { db: openDb(path.join(dir, 'usage.db')), dir };
}

function writeFile(file, content, mtimeSec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
}

function appendFile(file, content, mtimeSec) {
  fs.appendFileSync(file, content);
  fs.utimesSync(file, mtimeSec, mtimeSec);
}

const jsonl = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';

module.exports = { tempDir, tempDb, writeFile, appendFile, jsonl };
