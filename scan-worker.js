// scan-worker.js — runs the local scanners in an Electron utility process, so
// reading large transcripts never blocks the main process (tray, IPC).
// Long-lived: main starts it once and sends { dbPath, providers: [id] } for
// each scan; every request gets one { results } reply.
const { openDb } = require('./db');

const SCANNERS = {
  claude: () => require('./providers/claude/scanner'),
  codex:  () => require('./providers/codex/scanner'),
  gemini: () => require('./providers/gemini/scanner'),
  cursor: () => require('./providers/cursor/scanner')
};

function scan({ dbPath, providers }) {
  const results = {};
  let db;
  try {
    db = openDb(dbPath);
    for (const id of providers) {
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
  return results;
}

process.parentPort.on('message', ({ data }) => {
  process.parentPort.postMessage({ results: scan(data) });
});
