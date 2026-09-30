// scan-worker.js — runs the local scanners in an Electron utility process, so
// reading large transcripts never blocks the main process (tray, IPC).
// Receives { dbPath, providers: [id] } and replies { results }.
const { openDb } = require('./db');

const SCANNERS = {
  claude: () => require('./providers/claude/scanner'),
  codex:  () => require('./providers/codex/scanner'),
  gemini: () => require('./providers/gemini/scanner'),
  cursor: () => require('./providers/cursor/scanner')
};

process.parentPort.once('message', ({ data }) => {
  const results = {};
  let db;
  try {
    db = openDb(data.dbPath);
    for (const id of data.providers) {
      const load = SCANNERS[id];
      if (!load) continue;
      try {
        results[id] = load().scanAndStore(db);
      } catch (e) {
        results[id] = { error: e.message };
        console.error(`[scan] ${id} failed:`, e.message);
      }
    }
  } catch (e) {
    results.error = e.message;
    console.error('[scan]', e.message);
  } finally {
    db?.close();
  }
  // The parent stops this process once the reply arrives
  process.parentPort.postMessage({ results });
});
