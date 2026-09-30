const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Fallback when a transcript has no `cwd`: the encoded folder directly under
// ~/.claude/projects (subagent transcripts live deeper, in <session>/subagents/).
// The encoding turns every separator into "-", so hyphenated names can't be
// recovered exactly — prefer projectNameFromCwd.
function projectNameFromPath(filePath, projectsDir = CLAUDE_PROJECTS_DIR) {
  const rel = path.relative(projectsDir, filePath).split(path.sep);
  const projectDir = rel.length > 1 ? rel[0] : 'unknown';
  const parts = projectDir.split('-').filter(Boolean);
  if (!parts.length) return projectDir;
  const last = parts[parts.length - 1];
  // A bare version suffix ("HabasLiman-2", "Site-v2") belongs to the name
  return /^v?\d+$/i.test(last) && parts.length > 1 ? `${parts[parts.length - 2]}-${last}` : last;
}

// "D:\Development\Cts Ai Devs" -> "Cts Ai Devs"
function projectNameFromCwd(cwd) {
  return cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null : null;
}

// First `cwd` in a transcript, reading only its beginning
function readCwd(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.toString('utf8', 0, n).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// One-time fix for rows stored before project names came from `cwd`
// (subagent transcripts were filed under a "subagents" project and
// hyphenated names were truncated). Updates names without re-scanning.
function migrateProjectNames(db, projectsDir = CLAUDE_PROJECTS_DIR) {
  if (db.prepare("SELECT value FROM meta WHERE key = 'project_names_v2'").get()) return;

  const update = db.prepare("UPDATE sessions SET project_name = ? WHERE session_id = ? AND provider = 'claude'");
  const files = db.prepare('SELECT path FROM processed_files').all()
    .map(r => r.path)
    .filter(p => p.startsWith(projectsDir) && p.endsWith('.jsonl'));

  // Claude Code deletes old transcripts, so many processed files are gone.
  // Learn each encoded project folder's real name from files that still exist.
  const topDir = f => path.relative(projectsDir, f).split(path.sep)[0];
  const cwdName = new Map(files.map(f => [f, projectNameFromCwd(readCwd(f))]));
  const dirName = new Map();
  for (const [f, name] of cwdName) if (name && !dirName.has(topDir(f))) dirName.set(topDir(f), name);

  db.transaction(() => {
    for (const file of files) {
      const name = cwdName.get(file) || dirName.get(topDir(file)) || projectNameFromPath(file, projectsDir);
      update.run(name, sessionIdFromPath(file));
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('project_names_v2', ?)").run(new Date().toISOString());
  })();
}

function sessionIdFromPath(filePath) {
  return path.basename(filePath, '.jsonl');
}

// Bytes [start, end) of a file, cut after the last complete line. A line that
// Claude Code is still writing is left for the next scan.
function readCompleteLines(filePath, start, end) {
  if (end <= start) return { lines: [], consumed: 0 };
  const buf = Buffer.alloc(end - start);
  const fd = fs.openSync(filePath, 'r');
  let n;
  try {
    n = fs.readSync(fd, buf, 0, buf.length, start);
  } finally {
    fs.closeSync(fd);
  }
  const lastNl = buf.lastIndexOf(0x0a, n - 1);
  if (lastNl < 0) return { lines: [], consumed: 0 };
  const lines = buf.toString('utf8', 0, lastNl).split('\n').filter(l => l.trim());
  return { lines, consumed: lastNl + 1 };
}

function statements(db) {
  return {
    processed: db.prepare('SELECT mtime, lines, offset FROM processed_files WHERE path = ?'),
    markProcessed: db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines, offset) VALUES (?, ?, ?, ?)'),
    deleteTurns: db.prepare('DELETE FROM turns WHERE session_id = ?'),
    insertTurn: db.prepare(`
      INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'claude')
    `),
    projectName: db.prepare('SELECT project_name FROM sessions WHERE session_id = ?'),
    totals: db.prepare(`
      SELECT COUNT(*) AS turns, MIN(timestamp) AS first, MAX(timestamp) AS last,
             SUM(input_tokens) AS input, SUM(output_tokens) AS output,
             SUM(cache_read_tokens) AS cacheRead, SUM(cache_creation_tokens) AS cacheWrite
      FROM turns WHERE session_id = ?
    `),
    lastModel: db.prepare('SELECT model FROM turns WHERE session_id = ? AND model IS NOT NULL ORDER BY timestamp DESC LIMIT 1'),
    upsertSession: db.prepare(`
      INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude')
    `)
  };
}

// Transcripts are append-only, so only the bytes added since the last scan are
// read. A file that shrank (or was never scanned with offsets) is read in full.
function scanFile(db, st, filePath, projectsDir) {
  db.transaction(() => {
    const stat = fs.statSync(filePath);
    const mtime = Math.floor(stat.mtimeMs);

    const existing = st.processed.get(filePath);
    if (existing && existing.mtime === mtime) return;

    const sessionId = sessionIdFromPath(filePath);
    const incremental = existing?.offset != null && stat.size >= existing.offset;
    const start = incremental ? existing.offset : 0;
    if (!incremental) st.deleteTurns.run(sessionId);

    const { lines, consumed } = readCompleteLines(filePath, start, stat.size);

    let cwd = null;
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch (e) { console.warn('[claude/scanner] JSON parse error in', filePath, ':', e.message); continue; }

      if (!cwd && record.cwd) cwd = record.cwd;
      if (record.type !== 'assistant') continue;
      const usage = record.message?.usage;
      const ts = record.timestamp || record.message?.timestamp;
      if (!usage || !ts) continue;

      st.insertTurn.run(sessionId, ts, record.message?.model || null,
        usage.input_tokens || 0, usage.output_tokens || 0,
        usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0);
    }

    const totals = st.totals.get(sessionId);
    if (totals.turns > 0) {
      const projectName = (incremental && st.projectName.get(sessionId)?.project_name)
        || projectNameFromCwd(incremental ? readCwd(filePath) : cwd)
        || projectNameFromCwd(cwd)
        || projectNameFromPath(filePath, projectsDir);
      st.upsertSession.run(sessionId, projectName, totals.first, totals.last,
        st.lastModel.get(sessionId)?.model || null, totals.turns,
        totals.input, totals.output, totals.cacheRead, totals.cacheWrite);
    }

    st.markProcessed.run(filePath, mtime, (incremental ? existing.lines || 0 : 0) + lines.length, start + consumed);
  })();
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

function scanAndStore(db, { projectsDir = CLAUDE_PROJECTS_DIR } = {}) {
  if (!fs.existsSync(projectsDir)) return { scanned: 0 };
  migrateProjectNames(db, projectsDir);

  const st = statements(db);
  let scanned = 0;
  for (const file of getAllJsonlFiles(projectsDir)) {
    try {
      scanFile(db, st, file, projectsDir);
      scanned++;
    } catch (e) {
      console.warn('[claude/scanner] skipped', file, ':', e.message);
    }
  }
  return { scanned };
}

module.exports = { scanAndStore, migrateProjectNames, projectNameFromCwd };
