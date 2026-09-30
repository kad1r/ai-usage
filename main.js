const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, screen, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { openDb, migrateLegacyDb } = require('./db');
const stats = require('./stats');
const registry = require('./providers/registry');
const ClaudeProvider = require('./providers/claude');
const CodexProvider = require('./providers/codex');
const GeminiProvider = require('./providers/gemini');
const CursorProvider = require('./providers/cursor');

let tray = null;
let mainWindow = null;

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const DB_PATH = path.join(DATA_DIR, 'usage.db');
// Up to 1.4.x the database lived inside Claude Code's folder
const LEGACY_DB_PATH = path.join(os.homedir(), '.claude', 'usage.db');

// Claude Code stores OAuth credentials here after `claude login`
const CLAUDE_CODE_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USERINFO_URL = 'https://api.anthropic.com/api/oauth/userinfo';
const FETCH_TIMEOUT_MS = 15 * 1000;

// Errors reaching the renderer carry a code it translates (see cleanError there)
function codedError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Migration from "Claude Usage" (≤ 1.3.x) ──────────────────────────────────
// The app was renamed to "AI Usage" in 1.4.0, which moved its user-data folder
// (%APPDATA%\claude-usage-app -> %APPDATA%\ai-usage) and its install path.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'claude-usage-app');
const LEGACY_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude-usage-app', 'Claude Usage.exe');

// Copies history, usage cache, settings and renderer preferences on first run.
// The legacy folder is left in place.
function migrateLegacyData() {
  const legacyData = path.join(LEGACY_USER_DATA, 'claude-usage');
  if (fs.existsSync(DATA_DIR) || !fs.existsSync(legacyData)) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const entry of fs.readdirSync(legacyData, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      fs.copyFileSync(path.join(legacyData, entry.name), path.join(DATA_DIR, entry.name));
    } catch (e) {
      console.warn('[migrate] could not copy', entry.name, e.message);
    }
  }

  // Theme, language, refresh interval and alert state live in Local Storage
  const legacyStorage = path.join(LEGACY_USER_DATA, 'Local Storage');
  const storage = path.join(app.getPath('userData'), 'Local Storage');
  if (fs.existsSync(legacyStorage) && !fs.existsSync(storage)) {
    try {
      fs.cpSync(legacyStorage, storage, { recursive: true });
    } catch (e) {
      console.warn('[migrate] could not copy Local Storage:', e.message);
    }
  }
  console.log('[migrate] copied data from', LEGACY_USER_DATA);
}

// Launch-at-login points at the old exe; move it to the new one if it was on
function migrateLegacyLoginItem() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  if (app.getLoginItemSettings().openAtLogin) return;
  if (app.getLoginItemSettings({ path: LEGACY_EXE }).openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
}

// ─── Database ─────────────────────────────────────────────────────────────────
// The main process only reads (stats queries); scan-worker.js does the writing
// over its own connection.
let db = null;
function getDb() {
  if (!db) db = openDb(DB_PATH);
  return db;
}

// Write to a temp file and rename over the target, so a reader never sees a
// half-written file.
function writeJsonAtomic(file, data) {
  ensureDataDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Target locked by another reader (Windows): fall back to a direct write
    fs.writeFileSync(file, JSON.stringify(data));
    fs.rmSync(tmp, { force: true });
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
// Kept in memory after the first read; only this process writes the file.
let history = null;

function loadHistory() {
  if (history) return history;
  history = { dataPoints: [] };
  if (!fs.existsSync(HISTORY_PATH)) return history;
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (Array.isArray(parsed?.dataPoints)) return (history = parsed);
  } catch (e) {}
  // Unreadable file: keep it aside instead of letting the next save overwrite it
  const backup = HISTORY_PATH.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
  try { fs.renameSync(HISTORY_PATH, backup); } catch (e) {}
  console.error('[history] unreadable history.json moved to', backup);
  return history;
}

function saveHistory() {
  const cutoff = Date.now() - 30 * 86400 * 1000;
  history.dataPoints = history.dataPoints.filter(p => p.timestamp > cutoff);
  writeJsonAtomic(HISTORY_PATH, history);
}

// Only the known percentage fields are stored
function sanitizePoint(point) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    pct5h: num(point?.pct5h) ?? 0,
    pct7d: num(point?.pct7d) ?? 0,
    pctOpus: num(point?.pctOpus),
    pctSonnet: num(point?.pctSonnet)
  };
}

// ─── Claude usage API ─────────────────────────────────────────────────────────
// Read the OAuth token that Claude Code CLI stores after `claude login`
function loadClaudeCodeCredentials() {
  try {
    if (!fs.existsSync(CLAUDE_CODE_CREDENTIALS_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CLAUDE_CODE_CREDENTIALS_PATH, 'utf8'));
    return data?.claudeAiOauth || null;
  } catch (e) {
    return null;
  }
}

async function authorizedFetch(url) {
  const creds = loadClaudeCodeCredentials();
  if (!creds?.accessToken) throw codedError('ERR_NO_SESSION');

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw codedError('ERR_TIMEOUT');
    throw e;
  }

  if (response.status === 401) throw codedError('ERR_SESSION_EXPIRED');

  if (response.status === 429) {
    const err = new Error('HTTP 429');
    err.retryAfterSec = parseInt(response.headers.get('retry-after'), 10) || 300;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// ─── Usage cache ──────────────────────────────────────────────────────────────
// The usage endpoint is rate limited per OAuth token, and Claude Code itself
// polls it with the same token. Cache responses, share in-flight requests and
// back off on 429 so the app keeps showing the last known values.
const USAGE_CACHE_PATH = path.join(DATA_DIR, 'usage-cache.json');
const USAGE_TTL_MS = 2 * 60 * 1000;

let usageCache = null;       // { data, fetchedAt }
let usageInFlight = null;
let usageBlockedUntil = 0;

function loadUsageCache() {
  try {
    if (fs.existsSync(USAGE_CACHE_PATH)) return JSON.parse(fs.readFileSync(USAGE_CACHE_PATH, 'utf8'));
  } catch (e) {}
  return null;
}

function saveUsageCache(cache) {
  try {
    writeJsonAtomic(USAGE_CACHE_PATH, cache);
  } catch (e) {}
}

function withCacheMeta(cache, stale) {
  return { ...cache.data, _fetchedAt: cache.fetchedAt, _stale: stale };
}

const rateLimited = sec => codedError(`ERR_RATE_LIMITED:${Math.ceil(sec / 60)}`);

async function getUsage() {
  if (!usageCache) usageCache = loadUsageCache();

  const now = Date.now();
  if (usageCache && now - usageCache.fetchedAt < USAGE_TTL_MS) return withCacheMeta(usageCache, false);

  if (now < usageBlockedUntil) {
    if (usageCache) return withCacheMeta(usageCache, true);
    throw rateLimited((usageBlockedUntil - now) / 1000);
  }

  if (!usageInFlight) {
    usageInFlight = authorizedFetch(USAGE_URL)
      .then(data => {
        usageCache = { data, fetchedAt: Date.now() };
        saveUsageCache(usageCache);
        return withCacheMeta(usageCache, false);
      })
      .catch(err => {
        if (err.retryAfterSec) {
          usageBlockedUntil = Date.now() + err.retryAfterSec * 1000;
          console.warn(`[usage] rate limited, retry after ${err.retryAfterSec}s`);
          if (usageCache) return withCacheMeta(usageCache, true);
          throw rateLimited(err.retryAfterSec);
        }
        // Signed out: say so. Network errors, timeouts, 5xx: keep the last values.
        if (err.code === 'ERR_NO_SESSION' || err.code === 'ERR_SESSION_EXPIRED' || !usageCache) throw err;
        console.warn('[usage] fetch failed, showing cached values:', err.message);
        return withCacheMeta(usageCache, true);
      })
      .finally(() => { usageInFlight = null; });
  }
  return usageInFlight;
}

// ─── Local scan ───────────────────────────────────────────────────────────────
// One scan at a time; callers arriving meanwhile share the running one.
const SCAN_TIMEOUT_MS = 10 * 60 * 1000;
let scanInFlight = null;

function runScan() {
  if (scanInFlight) return scanInFlight;
  scanInFlight = new Promise(resolve => {
    const child = utilityProcess.fork(path.join(__dirname, 'scan-worker.js'), [], {
      serviceName: 'AI Usage Scanner',
      stdio: 'inherit'
    });
    let done = false;
    const finish = results => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(results);
    };
    const timer = setTimeout(() => {
      console.error('[scan] timed out');
      finish({ error: 'timeout' });
    }, SCAN_TIMEOUT_MS);
    child.once('message', msg => finish(msg?.results || {}));
    child.once('exit', code => finish({ error: `scanner exited with code ${code}` }));
    child.postMessage({ dbPath: DB_PATH, providers: registry.getAll().map(p => p.id) });
  }).finally(() => { scanInFlight = null; });
  return scanInFlight;
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 400;
  const windowHeight = Math.min(800, screenHeight - 20);

  const x = screenWidth - windowWidth - 10;
  const y = screenHeight - windowHeight - 10;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The window only ever shows index.html
  mainWindow.webContents.on('will-navigate', e => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile('index.html');

  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// One instance per data directory — two instances (e.g. installed + dev build)
// writing the same history file is how history got wiped.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
  migrateLegacyData();
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  app.dock?.hide?.();
  migrateLegacyLoginItem();
  try {
    if (migrateLegacyDb(LEGACY_DB_PATH, DB_PATH)) console.log('[migrate] copied', LEGACY_DB_PATH, 'to', DB_PATH);
  } catch (e) {
    console.error('[migrate] could not copy the usage database:', e.message);
  }

  // ClaudeProvider.isAvailable() checks if the credentials file exists
  const claudeProvider = new ClaudeProvider(CLAUDE_CODE_CREDENTIALS_PATH);
  claudeProvider.setUsageSource(getUsage);
  registry.register(claudeProvider);
  registry.register(new CodexProvider());
  registry.register(new GeminiProvider());
  registry.register(new CursorProvider());

  runScan();
  setInterval(runScan, 5 * 60 * 1000);

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('AI Usage');

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      createWindow();
    }
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show', click: () => createWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.popUpContextMenu(contextMenu);
  });
});

// IPC: Auth — reads Claude Code's own credentials, no separate sign-in flow needed
ipcMain.handle('check-auth', () => {
  const creds = loadClaudeCodeCredentials();
  return creds?.accessToken != null;
});

// IPC: Usage & Profile
ipcMain.handle('fetch-usage', () => getUsage());

// "default_claude_max_5x" → "Max 5x", subscriptionType "pro" → "Pro"
function formatPlan(creds) {
  const tier = creds?.rateLimitTier?.match(/max_(\d+x)/i);
  if (tier) return `Max ${tier[1]}`;
  const sub = creds?.subscriptionType;
  return sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : null;
}

ipcMain.handle('fetch-profile', async () => {
  const plan = formatPlan(loadClaudeCodeCredentials());
  try {
    const claudeConfig = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeConfig)) {
      const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      const email = config.oauthAccount?.emailAddress || config.oauthAccount?.displayName;
      if (email) return { email, plan };
    }
  } catch (e) {}
  return { ...(await authorizedFetch(USERINFO_URL)), plan };
});

// IPC: History
ipcMain.handle('load-history', () => loadHistory());

ipcMain.handle('save-data-point', (_, point) => {
  loadHistory().dataPoints.push({ ...sanitizePoint(point), timestamp: Date.now() });
  saveHistory();
  return true;
});

// IPC: Launch at login
ipcMain.handle('set-launch-at-login', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
});

ipcMain.handle('get-launch-at-login', () => {
  return app.getLoginItemSettings().openAtLogin;
});

// IPC: Theme
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);

nativeTheme.on('updated', () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', isDark);
  }
});

// IPC: Quit
ipcMain.handle('quit-app', () => app.quit());

// IPC: Local usage database
ipcMain.handle('scan-local-usage', () => runScan());

ipcMain.handle('get-detailed-stats', (_, filters) => {
  try {
    return { success: true, data: stats.queryStats(getDb(), filters) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-available-models', () => {
  try {
    return stats.getAvailableModels(getDb());
  } catch (e) {
    return [];
  }
});

// IPC: Multi-provider
ipcMain.handle('fetch-all-providers-quota', async () => {
  try {
    return await registry.fetchAllQuotas();
  } catch (err) {
    console.error('[fetch-all-providers-quota]', err);
    return [];
  }
});

ipcMain.handle('get-providers-list', async () => {
  return Promise.all(registry.getAll().map(async p => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    color: p.color,
    available: await p.isAvailable()
  })));
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('will-quit', () => {
  db?.close();
  db = null;
});
