const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, screen, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const scanner = require('./scanner');
const registry = require('./providers/registry');
const ClaudeProvider = require('./providers/claude');
const CodexProvider = require('./providers/codex');
const GeminiProvider = require('./providers/gemini');
const CursorProvider = require('./providers/cursor');

let tray = null;
let mainWindow = null;

const DATA_DIR = path.join(app.getPath('userData'), 'claude-usage');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Claude Code stores OAuth credentials here after `claude login`
const CLAUDE_CODE_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USERINFO_URL = 'https://api.anthropic.com/api/oauth/userinfo';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── safeStorage helpers ──────────────────────────────────────────────────────
// Encrypts using OS keychain (Windows DPAPI / macOS Keychain).
// Falls back to plaintext if encryption is unavailable (e.g. headless Linux).
function encryptApiKey(plaintext) {
  if (!plaintext) return null;
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64');
  }
  console.warn('[safeStorage] Encryption not available — storing API key as plaintext');
  return plaintext;
}

function decryptApiKey(stored) {
  if (!stored) return null;
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    // Migration: value was stored as plaintext before safeStorage was introduced
    return stored;
  }
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

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {}
  return {};
}

function saveSettings(settings) {
  writeJsonAtomic(SETTINGS_PATH, settings);
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return { dataPoints: [] };
  try {
    const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (Array.isArray(history?.dataPoints)) return history;
  } catch (e) {}
  // Unreadable file: keep it aside instead of letting the next save overwrite it
  const backup = HISTORY_PATH.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
  try { fs.renameSync(HISTORY_PATH, backup); } catch (e) {}
  console.error('[history] unreadable history.json moved to', backup);
  return { dataPoints: [] };
}

function saveHistory(history) {
  const cutoff = Date.now() - 30 * 86400 * 1000;
  history.dataPoints = history.dataPoints.filter(p => p.timestamp > cutoff);
  writeJsonAtomic(HISTORY_PATH, history);
}

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
  if (!creds?.accessToken) {
    throw new Error('Claude Code oturumu bulunamadı. Terminalde `claude login` çalıştırın.');
  }

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20'
    }
  });

  if (response.status === 401) {
    throw new Error('Oturum süresi doldu. Terminalde `claude login` çalıştırın.');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

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
  const windowWidth = 380;
  const windowHeight = 680;

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
      nodeIntegration: false
    }
  });

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

async function scanAllProviders() {
  let db;
  try {
    db = scanner.openDb();
    for (const provider of registry.getAll()) {
      try {
        await provider.scanLocal(db);
      } catch (e) {
        console.error(`[scan] ${provider.id} failed:`, e.message);
      }
    }
  } catch (e) {
    console.error('[scanAllProviders]', e.message);
  } finally {
    db?.close();
  }
}

// One instance per data directory — two instances (e.g. installed + dev build)
// writing the same history file is how history got wiped.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  app.dock?.hide?.();

  // ClaudeProvider.isAvailable() checks if the credentials file exists
  const claudeProvider = new ClaudeProvider(CLAUDE_CODE_CREDENTIALS_PATH, HISTORY_PATH);
  registry.register(claudeProvider);
  registry.register(new CodexProvider());
  registry.register(new GeminiProvider());
  registry.register(new CursorProvider());
  claudeProvider.setAuthorizedFetch(authorizedFetch);

  scanAllProviders();
  setInterval(scanAllProviders, 5 * 60 * 1000);

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Usage');

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

ipcMain.handle('sign-out', () => true); // No-op: session managed by Claude Code CLI

// IPC: Usage & Profile
ipcMain.handle('fetch-usage', async () => {
  return await authorizedFetch(USAGE_URL);
});

ipcMain.handle('fetch-profile', async () => {
  try {
    const claudeConfig = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeConfig)) {
      const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      if (config.oauthAccount?.emailAddress) return { email: config.oauthAccount.emailAddress };
      if (config.oauthAccount?.displayName)  return { email: config.oauthAccount.displayName };
    }
  } catch (e) {}
  return await authorizedFetch(USERINFO_URL);
});

// IPC: History
ipcMain.handle('load-history', () => loadHistory());

ipcMain.handle('save-data-point', (_, point) => {
  const history = loadHistory();
  history.dataPoints.push({ ...point, timestamp: Date.now() });
  saveHistory(history);
  return true;
});

// IPC: Launch at login
ipcMain.handle('set-launch-at-login', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
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

// IPC: Local JSONL stats
ipcMain.handle('scan-local-usage', () => scanAllProviders());

ipcMain.handle('get-detailed-stats', (_, filters) => {
  try {
    return { success: true, data: scanner.queryStats(filters) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-available-models', () => {
  try {
    return scanner.getAvailableModels();
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

ipcMain.handle('save-provider-settings', async (event, { providerId, apiKey, enabled }) => {
  if (!registry.getById(providerId)) return { error: 'Unknown provider' };
  const scannerModule = require('./providers/claude/scanner');
  let db;
  try {
    db = scannerModule.openDb();
    db.prepare(`
      INSERT OR REPLACE INTO providers (id, enabled, api_key)
      VALUES (?, ?, ?)
    `).run(providerId, enabled ? 1 : 0, encryptApiKey(apiKey || null));
  } finally {
    db?.close();
  }
  return { ok: true };
});

ipcMain.handle('get-provider-api-key', async (event, { providerId }) => {
  const scannerModule = require('./providers/claude/scanner');
  let db;
  try {
    db = scannerModule.openDb();
    const row = db.prepare('SELECT api_key FROM providers WHERE id = ?').get(providerId);
    return { key: decryptApiKey(row?.api_key || null) };
  } finally {
    db?.close();
  }
});

ipcMain.handle('scan-provider-local', async (event, { providerId }) => {
  const provider = registry.getById(providerId);
  if (!provider) return { error: 'Provider not found' };
  const scannerModule = require('./providers/claude/scanner');
  let db;
  try {
    db = scannerModule.openDb();
    const result = await provider.scanLocal(db);
    return result;
  } finally {
    db?.close();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray
});
