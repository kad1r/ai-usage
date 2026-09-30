// stats.js — read-only queries behind the Detailed view
const { calcCost } = require('./providers/pricing');

function queryStats(db, filters = {}) {
  const { model, days, provider } = filters;
  let whereSession = '1=1';
  const params = [];

  const d = Number(days);
  if (Number.isFinite(d) && d > 0) {
    const cutoff = new Date(Date.now() - d * 86400 * 1000).toISOString();
    whereSession += ' AND first_timestamp >= ?';
    params.push(cutoff);
  }
  if (model && model !== 'all') {
    whereSession += ' AND model LIKE ?';
    params.push(`%${model}%`);
  }
  if (provider && provider !== 'all') {
    whereSession += ' AND provider = ?';
    params.push(provider);
  }

  const summary = db.prepare(`
    SELECT COUNT(*) as sessionCount,
           SUM(turn_count) as totalTurns,
           SUM(total_input_tokens) as totalInput,
           SUM(total_output_tokens) as totalOutput,
           SUM(total_cache_read) as totalCacheRead,
           SUM(total_cache_creation) as totalCacheWrite
    FROM sessions WHERE ${whereSession}
  `).get(...params);

  const sessions = db.prepare(`SELECT * FROM sessions WHERE ${whereSession}`).all(...params);
  let totalCost = 0;
  const projectCost = new Map();
  for (const s of sessions) {
    const cost = calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation);
    totalCost += cost;
    projectCost.set(s.project_name, (projectCost.get(s.project_name) || 0) + cost);
  }

  const dailyRows = db.prepare(`
    SELECT DATE(first_timestamp, 'localtime') as day,
           SUM(total_input_tokens) as input,
           SUM(total_output_tokens) as output,
           SUM(total_cache_read) as cacheRead,
           SUM(total_cache_creation) as cacheWrite
    FROM sessions WHERE ${whereSession}
    GROUP BY day ORDER BY day ASC
  `).all(...params);

  const projectRows = db.prepare(`
    SELECT project_name,
           SUM(total_input_tokens + total_output_tokens) as totalTokens,
           COUNT(*) as sessionCount
    FROM sessions WHERE ${whereSession}
    GROUP BY project_name ORDER BY totalTokens DESC LIMIT 10
  `).all(...params).map(r => ({ ...r, cost: projectCost.get(r.project_name) || 0 }));

  const modelRows = db.prepare(`
    SELECT model,
           COUNT(*) as sessionCount,
           SUM(turn_count) as turns,
           SUM(total_input_tokens) as input,
           SUM(total_output_tokens) as output,
           SUM(total_cache_read) as cacheRead,
           SUM(total_cache_creation) as cacheWrite
    FROM sessions WHERE ${whereSession}
    GROUP BY model ORDER BY input DESC
  `).all(...params).map(r => ({
    ...r,
    cost: calcCost(r.model, r.input, r.output, r.cacheRead, r.cacheWrite)
  }));

  const recentSessions = db.prepare(`
    SELECT session_id, project_name, first_timestamp, last_timestamp, model,
           turn_count, total_input_tokens, total_output_tokens,
           total_cache_read, total_cache_creation
    FROM sessions WHERE ${whereSession}
    ORDER BY last_timestamp DESC LIMIT 50
  `).all(...params).map(s => ({
    ...s,
    cost: calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation),
    durationMinutes: s.first_timestamp && s.last_timestamp
      ? Math.round((new Date(s.last_timestamp) - new Date(s.first_timestamp)) / 60000)
      : 0
  }));

  const activity = filters.activity ? queryActivity(db, whereSession, params, sessions) : null;

  return { summary: { ...summary, totalCost }, dailyRows, projectRows, modelRows, recentSessions, activity };
}

// Gaps between consecutive requests up to this long count as working time;
// longer gaps are breaks (sessions are often resumed hours or days later).
const ACTIVE_GAP_SEC = 30 * 60;

/**
 * Turn-level activity for the sessions matching `whereSession`:
 * most active days, longest sessions and time per project (active time),
 * and which models each project used (counted per request).
 */
function queryActivity(db, whereSession, params, sessions) {
  const inSessions = `session_id IN (SELECT session_id FROM sessions WHERE ${whereSession})`;

  const activeDays = db.prepare(`
    SELECT DATE(timestamp, 'localtime') AS day,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) AS tokens
    FROM turns WHERE ${inSessions}
    GROUP BY day ORDER BY requests DESC LIMIT 5
  `).all(...params);

  const activeBySession = new Map(db.prepare(`
    WITH gaps AS (
      SELECT session_id,
             (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp))) * 86400 AS gap
      FROM turns WHERE ${inSessions}
    )
    SELECT session_id, SUM(CASE WHEN gap <= ${ACTIVE_GAP_SEC} THEN gap ELSE 0 END) AS activeSec
    FROM gaps GROUP BY session_id
  `).all(...params).map(r => [r.session_id, r.activeSec || 0]));

  // Subagent transcripts (agent-*.jsonl) run in parallel with their parent
  // session, so they're left out of time totals to avoid counting hours twice
  const timed = sessions
    .filter(s => !String(s.session_id).startsWith('agent-'))
    .map(s => ({ ...s, activeSec: Math.round(activeBySession.get(s.session_id) || 0) }))
    .filter(s => s.activeSec > 0);

  const longestSessions = [...timed]
    .sort((a, b) => b.activeSec - a.activeSec)
    .slice(0, 5)
    .map(s => ({ project_name: s.project_name, model: s.model, first_timestamp: s.first_timestamp, turns: s.turn_count, activeSec: s.activeSec }));

  const byProject = new Map();
  for (const s of timed) {
    const p = byProject.get(s.project_name) || { project_name: s.project_name, activeSec: 0, sessions: 0 };
    p.activeSec += s.activeSec;
    p.sessions += 1;
    byProject.set(s.project_name, p);
  }
  const projectTime = [...byProject.values()].sort((a, b) => b.activeSec - a.activeSec).slice(0, 5);

  // Models per project, counted per request (a session can switch models)
  const top = new Set(projectTime.map(p => p.project_name));
  const modelsByProject = new Map();
  for (const r of db.prepare(`
    SELECT s.project_name AS project, t.model AS model, COUNT(*) AS requests
    FROM turns t JOIN sessions s ON s.session_id = t.session_id
    WHERE t.${inSessions} AND t.model IS NOT NULL AND t.model NOT LIKE '<%'
    GROUP BY s.project_name, t.model
  `).all(...params)) {
    if (!top.has(r.project)) continue;
    if (!modelsByProject.has(r.project)) modelsByProject.set(r.project, []);
    modelsByProject.get(r.project).push({ model: r.model, requests: r.requests });
  }
  const projectModels = projectTime.map(p => ({
    project_name: p.project_name,
    models: (modelsByProject.get(p.project_name) || []).sort((a, b) => b.requests - a.requests)
  }));

  return { activeDays, longestSessions, projectTime, projectModels };
}

function getAvailableModels(db) {
  return db.prepare('SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL ORDER BY model').all().map(r => r.model);
}

module.exports = { queryStats, getAvailableModels };
