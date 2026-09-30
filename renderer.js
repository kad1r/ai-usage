// renderer.js — AI Usage window (single dark UI, no external libs)

// ─── Preferences (per-machine conveniences) ──────────────────────────────────
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  lang: loadPref('lang', 'tr'),
  interval: loadPref('refreshInterval', 5),
  alert: loadPref('limitAlert', true),
  themePref: loadPref('theme', 'system'),  // 'system' | 'light' | 'dark'
  systemDark: true,
  view: 'summary',
  provider: 'claude',
  period: 30,
  model: 'all',
  providers: [],       // available providers from main
  quotas: [],          // fetchAllProvidersQuota result
  usage: null,         // Claude usage API response
  profile: null,
  history: { dataPoints: [] },
  lastFetch: null,
  stale: false,
  lineHover: -1,
  barHover: -1,
  detail: null,        // cached detail query results
  openSetting: 'claude'
};

// Per-theme palettes; `text` is the provider colour when used as text on a surface
const PROVIDER_COLORS = {
  dark: {
    claude: { color: '#FF8C42', text: '#FF8C42' },
    codex:  { color: '#34D399', text: '#34D399' },
    gemini: { color: '#4D9FFF', text: '#4D9FFF' },
    cursor: { color: '#8B7CF6', text: '#8B7CF6' }
  },
  light: {
    claude: { color: '#FF8C42', text: '#C2540F' },
    codex:  { color: '#34D399', text: '#0F9F6E' },
    gemini: { color: '#2F7FF0', text: '#1F6FE0' },
    cursor: { color: '#8B7CF6', text: '#6D5BD9' }
  }
};
const STATUS = {
  dark: {
    ok:   { c: '#22C55E', bg: 'rgba(34,197,94,0.13)' },
    warn: { c: '#F5A524', bg: 'rgba(245,165,36,0.14)' },
    bad:  { c: '#FF4D5A', bg: 'rgba(255,77,90,0.15)' }
  },
  light: {
    ok:   { c: '#16A34A', bg: 'rgba(22,163,74,0.13)' },
    warn: { c: '#D97706', bg: 'rgba(245,165,36,0.14)' },
    bad:  { c: '#E5484D', bg: 'rgba(229,72,77,0.15)' }
  }
};

// ─── i18n ────────────────────────────────────────────────────────────────────
const I18N = {
  tr: {
    'login-not-found': 'Claude Code oturumu bulunamadı.',
    'login-instructions': 'Terminalde şu komutu çalıştırın:',
    'login-reopen': 'Giriş yaptıktan sonra uygulamayı yeniden açın.',
    'refresh': 'Yenile', 'settings': 'Ayarlar', 'menu': 'Menü', 'back': 'Geri',
    'add-provider': 'Provider ekle',
    'view-summary': 'Özet', 'view-detail': 'Detaylı',
    'last-7-days': 'Son 7 gün', 'last-7-days-tokens': 'Son 7 gün · token',
    'weekly': 'Haftalık', 'five-hour': '5 saatlik',
    'kpi-cost': 'Maliyet', 'kpi-sessions': 'Oturum', 'kpi-turns': 'Dönüş',
    'daily-tokens': 'Günlük token', 'token-word': 'token',
    'model-dist': 'Model dağılımı', 'top-projects': 'En çok kullanan projeler',
    'top-models': 'En çok kullanılan modeller', 'top-models-sub': 'Son 7 gün · istek', 'requests': 'istek',
    'quit': 'Uygulamayı kapat',
    'providers-label': "PROVIDER'LAR", 'general-label': 'GENEL', 'account-label': 'HESAP',
    'launch-at-login': 'Windows açılışında başlat', 'language': 'Dil',
    'theme': 'Tema', 'theme-system': 'Sistem', 'theme-light': 'Açık', 'theme-dark': 'Koyu',
    'refresh-interval': 'Yenileme sıklığı', 'limit-alert': 'Limit uyarısı',
    'limit-alert-sub': "%80'i geçince bildirim gönder",
    'min': 'dk', 'day-suffix': 'g',
    'updated-now': 'Az önce güncellendi',
    'updated-sec': '{s} sn önce güncellendi',
    'updated-min': '{m} dk {s} sn önce güncellendi',
    'cached': 'önbellek',
    'status-ok': 'Rahat', 'status-warn': 'Dikkat', 'status-bad': 'Kritik',
    'used': 'kullanıldı',
    'reset-dh': '{d} gün {h} sa', 'reset-hm': '{h} sa {m} dk', 'reset-m': '{m} dk', 'reset-soon': 'Birazdan',
    'proj-ok': 'Bu hızla haftalık limit sıfırlanmadan önce yaklaşık %{p} seviyesine ulaşır.',
    'proj-bad': 'Bu hızla haftalık limit yaklaşık {full} içinde dolar. Sıfırlanmaya {reset} var.',
    'dur-dh': '{d} gün {h} saat', 'dur-hm': '{h} saat {m} dakika', 'dur-m': '{m} dakika',
    'today': 'Bugün',
    'collecting': 'Veri toplanıyor…',
    'no-limits': 'Bu provider limit verisi sunmuyor — yerel kullanım gösteriliyor.',
    'no-data': 'Bu dönem için veri yok.',
    'all-models': 'Tüm modeller', 'other': 'Diğer',
    'period-total': 'Son {n} gün toplamı',
    'change': 'Önceki döneme göre {v} {w}.', 'up': 'arttı', 'down': 'azaldı',
    'connected': 'Bağlı', 'not-found': 'Bulunamadı',
    'hint-on': 'Yerel CLI oturumundan otomatik algılandı. Farklı bir hesap için API anahtarı girebilirsin.',
    'hint-off': 'Yerel kurulum bulunamadı. Bağlanmak için API anahtarını gir.',
    'api-key': 'API anahtarı (isteğe bağlı)', 'save': 'Kaydet', 'saved': 'Kaydedildi', 'save-error': 'Hata',
    'alert-title': '{name} limiti %{p}',
    'alert-body': '{label} limiti %80\'i geçti. Sıfırlanmaya {reset} var.',
    'months': ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
    'numLocale': 'tr-TR'
  },
  en: {
    'login-not-found': 'Claude Code session not found.',
    'login-instructions': 'Run this command in your terminal:',
    'login-reopen': 'Reopen the app after signing in.',
    'refresh': 'Refresh', 'settings': 'Settings', 'menu': 'Menu', 'back': 'Back',
    'add-provider': 'Add provider',
    'view-summary': 'Overview', 'view-detail': 'Detailed',
    'last-7-days': 'Last 7 days', 'last-7-days-tokens': 'Last 7 days · tokens',
    'weekly': 'Weekly', 'five-hour': '5-hour',
    'kpi-cost': 'Cost', 'kpi-sessions': 'Sessions', 'kpi-turns': 'Turns',
    'daily-tokens': 'Daily tokens', 'token-word': 'tokens',
    'model-dist': 'Model mix', 'top-projects': 'Top projects',
    'top-models': 'Most used models', 'top-models-sub': 'Last 7 days · requests', 'requests': 'requests',
    'quit': 'Quit app',
    'providers-label': 'PROVIDERS', 'general-label': 'GENERAL', 'account-label': 'ACCOUNT',
    'launch-at-login': 'Launch at Windows startup', 'language': 'Language',
    'theme': 'Theme', 'theme-system': 'System', 'theme-light': 'Light', 'theme-dark': 'Dark',
    'refresh-interval': 'Refresh interval', 'limit-alert': 'Limit alert',
    'limit-alert-sub': 'Notify when usage passes 80%',
    'min': 'min', 'day-suffix': 'd',
    'updated-now': 'Updated just now',
    'updated-sec': 'Updated {s}s ago',
    'updated-min': 'Updated {m}m {s}s ago',
    'cached': 'cached',
    'status-ok': 'Relaxed', 'status-warn': 'Watch', 'status-bad': 'Critical',
    'used': 'used',
    'reset-dh': '{d}d {h}h', 'reset-hm': '{h}h {m}m', 'reset-m': '{m}m', 'reset-soon': 'Soon',
    'proj-ok': 'At this pace the weekly limit will reach about {p}% before it resets.',
    'proj-bad': 'At this pace the weekly limit fills in about {full}. It resets in {reset}.',
    'dur-dh': '{d} days {h} hours', 'dur-hm': '{h} hours {m} minutes', 'dur-m': '{m} minutes',
    'today': 'Today',
    'collecting': 'Collecting data…',
    'no-limits': 'This provider has no limit data — showing local usage.',
    'no-data': 'No data for this period.',
    'all-models': 'All models', 'other': 'Other',
    'period-total': 'Last {n} days total',
    'change': '{v} {w} vs previous period.', 'up': 'up', 'down': 'down',
    'connected': 'Connected', 'not-found': 'Not found',
    'hint-on': 'Detected from the local CLI session. Enter an API key to use a different account.',
    'hint-off': 'No local install found. Enter an API key to connect.',
    'api-key': 'API key (optional)', 'save': 'Save', 'saved': 'Saved', 'save-error': 'Error',
    'alert-title': '{name} limit at {p}%',
    'alert-body': '{label} limit passed 80%. Resets in {reset}.',
    'months': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    'numLocale': 'en-US'
  }
};

function t(key, vars) {
  let s = I18N[state.lang]?.[key] ?? I18N.tr[key] ?? key;
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  return s;
}

function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('#interval-tabs button').forEach(b => { b.textContent = `${b.dataset.interval} ${t('min')}`; });
  document.querySelectorAll('#period-tabs button').forEach(b => { b.textContent = `${b.dataset.period}${t('day-suffix')}`; });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function theme() {
  return state.themePref === 'system' ? (state.systemDark ? 'dark' : 'light') : state.themePref;
}

function applyTheme() {
  document.documentElement.dataset.theme = theme();
}

function statusOf(pct) {
  const s = STATUS[theme()];
  if (pct < 50) return { ...s.ok, label: t('status-ok') };
  if (pct < 80) return { ...s.warn, label: t('status-warn') };
  return { ...s.bad, label: t('status-bad') };
}

function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

function fmtCost(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 ? 0 : 2 });
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function dateLabel(d) {
  const m = t('months')[d.getMonth()];
  return state.lang === 'en' ? `${m} ${d.getDate()}` : `${d.getDate()} ${m}`;
}

function fmtReset(resetsAt) {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt) - Date.now();
  if (diff <= 0) return t('reset-soon');
  const mins = Math.floor(diff / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return t('reset-dh', { d, h });
  if (h > 0) return t('reset-hm', { h, m });
  return t('reset-m', { m });
}

function fmtDuration(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return t('dur-dh', { d, h });
  if (h > 0) return t('dur-hm', { h, m });
  return t('dur-m', { m });
}

function shortModel(model) {
  if (!model) return '?';
  const m = model.match(/(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  return model;
}

// Family colour for the first model of each family, palette for the rest
function modelColors(names) {
  const family = { opus: '#FF8C42', sonnet: '#8B7CF6', haiku: '#34D399' };
  const palette = [providerColor('gemini'), '#F5A524', '#FF6B75', '#E879F9'];
  const used = new Set();
  let next = 0;
  return names.map(name => {
    const f = name.match(/opus|sonnet|haiku/i)?.[0].toLowerCase();
    if (f && !used.has(f)) { used.add(f); return family[f]; }
    return palette[next++ % palette.length];
  });
}

function providerColor(id) {
  return PROVIDER_COLORS[theme()][id]?.color || '#A1A1AA';
}

function providerText(id) {
  return PROVIDER_COLORS[theme()][id]?.text || providerColor(id);
}

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el.hidden = true; }, 5000);
}

// ─── Screens ─────────────────────────────────────────────────────────────────
function showScreen(name) {
  $('login-screen').hidden = name !== 'login';
  $('main-screen').hidden = name !== 'main';
  $('settings-screen').hidden = name !== 'settings';
}

function setProviderTheme() {
  const c = providerColor(state.provider);
  const app = $('app');
  app.style.setProperty('--pcolor', c);
  app.style.setProperty('--ptext', providerText(state.provider));
  app.style.setProperty('--tint', hexA(c, 0.14));
  app.style.setProperty('--track', hexA(c, 0.08));
}

// ─── Data loading ────────────────────────────────────────────────────────────
let refreshing = false;
let refreshTurns = 0;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  refreshTurns += 1;
  $('refresh-icon').style.transform = `rotate(${refreshTurns * 360}deg)`;

  try {
    const [usageRes, profile, history, providers] = await Promise.all([
      window.electronAPI.fetchUsage().then(v => ({ ok: v }), e => ({ err: e })),
      state.profile ? state.profile : window.electronAPI.fetchProfile().catch(() => null),
      window.electronAPI.loadHistory().catch(() => ({ dataPoints: [] })),
      window.electronAPI.getProvidersList().catch(() => [])
    ]);

    state.profile = profile;
    state.history = history || { dataPoints: [] };
    state.providers = providers.filter(p => p.available);
    if (!state.providers.some(p => p.id === state.provider)) state.provider = state.providers[0]?.id || 'claude';

    if (usageRes.ok) {
      const usage = usageRes.ok;
      state.usage = usage;
      state.stale = !!usage._stale;
      state.lastFetch = usage._fetchedAt ? new Date(usage._fetchedAt) : new Date();
      await recordHistoryPoint(usage);
      checkLimitAlerts(usage);
    } else {
      showToast(cleanError(usageRes.err));
    }

    // Other providers' quota (Claude's comes from the cached usage call)
    if (state.providers.length > 1) {
      state.quotas = await window.electronAPI.fetchAllProvidersQuota().catch(() => []);
    }
  } finally {
    refreshing = false;
  }

  state.detail = null;
  render();
}

function cleanError(err) {
  return String(err?.message || err || 'Error').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function recordHistoryPoint(usage) {
  const point = {
    pct5h: usage.five_hour?.utilization || 0,
    pct7d: usage.seven_day?.utilization || 0,
    pctOpus: usage.seven_day_opus?.utilization ?? null,
    pctSonnet: usage.seven_day_sonnet?.utilization ?? null
  };
  // Skip cached responses already recorded in history
  const pts = state.history.dataPoints;
  const last = pts[pts.length - 1];
  if (!usage._fetchedAt || !last || usage._fetchedAt > last.timestamp) {
    await window.electronAPI.saveDataPoint(point);
    pts.push({ ...point, timestamp: Date.now() });
  }
}

function checkLimitAlerts(usage) {
  if (!state.alert || typeof Notification === 'undefined') return;
  const sent = loadPref('alertsSent', {});
  const windows = [
    ['five_hour', t('five-hour')],
    ['seven_day', t('weekly')]
  ];
  for (const [key, label] of windows) {
    const w = usage[key];
    if (!w || w.utilization < 80) continue;
    const id = `${key}:${w.resets_at}`;
    if (sent[id]) continue;
    sent[id] = Date.now();
    new Notification(t('alert-title', { name: 'Claude', p: Math.round(w.utilization) }), {
      body: t('alert-body', { label, reset: fmtReset(w.resets_at) })
    });
  }
  // Drop entries older than 8 days
  const cutoff = Date.now() - 8 * 86400000;
  for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
  savePref('alertsSent', sent);
}

async function loadDetail() {
  const provider = state.provider;
  const days = state.period;
  const model = state.model;
  const q = f => window.electronAPI.getDetailedStats(f).then(r => (r.success ? r.data : null)).catch(() => null);

  const [all, filtered, twice] = await Promise.all([
    q({ provider, days }),
    model === 'all' ? null : q({ provider, days, model }),
    q({ provider, days: days * 2, model })
  ]);
  state.detail = { key: `${provider}|${days}|${model}`, all, current: filtered || all, twice };
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render() {
  setProviderTheme();
  renderTopbar();
  renderProviderTabs();
  document.querySelectorAll('.view-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('view-summary').hidden = state.view !== 'summary';
  $('view-detail').hidden = state.view !== 'detail';
  if (state.view === 'summary') renderSummary();
  else renderDetail();
}

function renderTopbar() {
  const el = $('updated-text');
  if (!state.lastFetch) { el.textContent = ''; return; }
  const up = Math.max(0, Math.floor((Date.now() - state.lastFetch.getTime()) / 1000));
  let text = up < 5 ? t('updated-now')
    : up < 60 ? t('updated-sec', { s: up })
    : t('updated-min', { m: Math.floor(up / 60), s: up % 60 });
  if (state.stale) text += ` · ${t('cached')}`;
  el.textContent = text;
  el.classList.toggle('stale', state.stale);
}

function quotaFor(id) {
  if (id === 'claude') {
    const u = state.usage;
    if (!u) return null;
    return {
      session: u.five_hour ? { utilization: u.five_hour.utilization, resetsAt: u.five_hour.resets_at } : null,
      weekly: u.seven_day ? { utilization: u.seven_day.utilization, resetsAt: u.seven_day.resets_at } : null
    };
  }
  return state.quotas.find(q => q.provider === id)?.quota || null;
}

function peakPct(id) {
  const q = quotaFor(id);
  const vals = [q?.session?.utilization, q?.weekly?.utilization].filter(v => v != null);
  return vals.length ? Math.round(Math.max(...vals)) : null;
}

function renderProviderTabs() {
  const list = state.providers.length ? state.providers : [{ id: 'claude', name: 'Claude' }];
  $('provider-tabs').innerHTML = list.map(p => {
    const pct = peakPct(p.id);
    const color = providerColor(p.id);
    const pctColor = pct == null ? 'var(--text-3)' : statusOf(pct).c;
    return `<button class="provider-tab${p.id === state.provider ? ' active' : ''}" data-provider="${esc(p.id)}" style="--tab-color:${color}">
      <span class="name"><span class="dot" style="background:${color}"></span>${esc(p.name)}</span>
      <span class="pct" style="color:${pctColor}">${pct == null ? '—' : pct + '%'}</span>
    </button>`;
  }).join('');
}

// ─── Summary view ────────────────────────────────────────────────────────────
function renderSummary() {
  const isClaude = state.provider === 'claude';

  const acct = document.querySelector('.account-row');
  acct.hidden = !isClaude;
  $('account-email').textContent = state.profile?.email || '';
  $('account-plan').textContent = state.profile?.plan || '';
  $('account-plan').hidden = !state.profile?.plan;

  const q = quotaFor(state.provider);
  const limits = [];
  if (q?.session) limits.push([t('five-hour'), q.session]);
  if (q?.weekly) limits.push([t('weekly'), q.weekly]);

  $('limit-grid').innerHTML = limits.length
    ? limits.map(([label, w]) => limitCard(label, w)).join('')
    : `<div class="card empty-card">${esc(isClaude ? t('collecting') : t('no-limits'))}</div>`;

  renderProjection(isClaude ? q?.weekly : null);

  $('history-card').hidden = !isClaude;
  $('token-summary-card').hidden = isClaude;
  if (isClaude) renderLineChart();
  renderSummaryLocal(isClaude);
}

function limitCard(label, w) {
  const pct = Math.round(w.utilization || 0);
  const s = statusOf(pct);
  const numColor = pct >= 80 ? s.c : 'var(--text)';
  const a = Math.PI * (1 - Math.min(pct, 100) / 100);
  const kx = (80 + 64 * Math.cos(a)).toFixed(1);
  const ky = (84 - 64 * Math.sin(a)).toFixed(1);
  return `<div class="card">
    <div class="limit-head">
      <span class="limit-label">${esc(label)}</span>
      <span class="status-pill" style="color:${s.c};background:${s.bg}">${esc(s.label)}</span>
    </div>
    <div class="gauge">
      <svg viewBox="0 0 160 92">
        <path d="M16,84 A64,64 0 0 1 144,84" fill="none" stroke="${s.c}24" stroke-width="11" stroke-linecap="round"/>
        <path d="M31,84 A49,49 0 0 1 129,84" fill="none" style="stroke:var(--border-3)" stroke-width="1" stroke-dasharray="2 4"/>
        <path class="arc" d="M16,84 A64,64 0 0 1 144,84" fill="none" stroke="${s.c}" stroke-width="11" stroke-linecap="round" pathLength="100" stroke-dasharray="${Math.max(0.01, Math.min(pct, 100))} 100"/>
        <circle cx="${kx}" cy="${ky}" r="6.5" style="fill:var(--knob)" stroke="${s.c}" stroke-width="3.5"/>
      </svg>
      <div class="gauge-center">
        <span class="gauge-caption">${esc(t('used'))}</span>
        <span class="gauge-value" style="color:${numColor}">${pct}<small>%</small></span>
      </div>
    </div>
    <div class="limit-reset">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
      <span>${esc(fmtReset(w.resetsAt))}</span>
    </div>
  </div>`;
}

function renderProjection(weekly) {
  const box = $('projection');
  box.hidden = true;
  if (!weekly?.resetsAt || !weekly.utilization) return;

  const WEEK = 7 * 86400000;
  const remaining = new Date(weekly.resetsAt) - Date.now();
  const elapsed = WEEK - remaining;
  if (remaining <= 0 || elapsed < 6 * 3600000) return; // too early to extrapolate

  const pct = weekly.utilization;
  const rate = pct / elapsed; // % per ms
  const projected = pct + rate * remaining;
  const bad = projected >= 100;
  $('projection-text').textContent = bad
    ? t('proj-bad', { full: fmtDuration((100 - pct) / rate), reset: fmtDuration(remaining) })
    : t('proj-ok', { p: Math.round(projected) });
  box.classList.toggle('bad', bad);
  box.hidden = false;
}

// 7 days × 4 six-hour buckets, aligned to local midnights so day labels line up
const LC = { W: 334, X0: 30, X1: 330, Y0: 12, Y1: 132, N: 28 };

function buildSeries() {
  const start = daysAgo(6).getTime();
  const slot = 6 * 3600000;
  const now = Date.now();
  const cur = Math.min(LC.N - 1, Math.floor((now - start) / slot));
  const pts = state.history.dataPoints.filter(p => p.timestamp >= start);

  const b7 = new Array(LC.N).fill(null), b5 = new Array(LC.N).fill(null);
  for (const p of pts) {
    const i = Math.min(LC.N - 1, Math.floor((p.timestamp - start) / slot));
    b7[i] = p.pct7d || 0;                             // last value in slot
    b5[i] = Math.max(b5[i] ?? 0, p.pct5h || 0);       // peak in slot
  }
  // Carry last known value across gaps, stop at "now"
  const series = [];
  let l7 = null, l5 = null;
  for (let i = 0; i <= cur; i++) {
    if (b7[i] != null) { l7 = b7[i]; l5 = b5[i]; }
    if (l7 != null) series.push({ i, v7: l7, v5: l5 });
  }
  return { series, start, slot, cur };
}

function lcXY(v, i) {
  return [LC.X0 + (LC.X1 - LC.X0) * i / (LC.N - 1), LC.Y1 - (LC.Y1 - LC.Y0) * Math.min(v, 100) / 100];
}

function smoothPath(pts) {
  const f = v => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, k = 0.2;
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const cl = y => Math.max(lo, Math.min(hi, y));
    d += ` C${f(p1[0] + (p2[0] - p0[0]) * k)},${f(cl(p1[1] + (p2[1] - p0[1]) * k))} ${f(p2[0] - (p3[0] - p1[0]) * k)},${f(cl(p2[1] - (p3[1] - p1[1]) * k))} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

function renderLineChart() {
  const el = $('line-chart');
  const { series, start, slot, cur } = buildSeries();

  const grid = [100, 75, 50, 25, 0].map(v => {
    const y = LC.Y1 - (LC.Y1 - LC.Y0) * v / 100;
    return `<div class="grid-line" style="top:${y}px"></div><span class="grid-label" style="top:${y - 7}px">${v}%</span>`;
  }).join('');

  let hoverDay = Math.floor(cur / 4);
  let body = '';
  if (series.length < 2) {
    body = `<div class="chart-empty">${esc(t('collecting'))}</div>`;
  } else {
    const p7 = series.map(s => lcXY(s.v7, s.i));
    const p5 = series.map(s => lcXY(s.v5, s.i));
    const line7 = smoothPath(p7);
    const area7 = `${line7} L${p7[p7.length - 1][0].toFixed(1)},${LC.Y1} L${p7[0][0].toFixed(1)},${LC.Y1} Z`;

    const h = series.find(s => s.i === state.lineHover) || series[series.length - 1];
    const [hx, hy] = lcXY(h.v7, h.i);
    hoverDay = Math.floor(h.i / 4);
    const when = new Date(start + h.i * slot);
    const tipPct = Math.max(16, Math.min(84, hx / LC.W * 100));
    const tipTop = hy - 54 < -6 ? hy + 14 : hy - 54;

    body = `<svg viewBox="0 0 ${LC.W} 150" preserveAspectRatio="none">
        <defs><linearGradient id="g7" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8C42" stop-opacity="0.32"/><stop offset="1" stop-color="#FF8C42" stop-opacity="0"/></linearGradient></defs>
        <path d="${area7}" fill="url(#g7)"/>
        <path d="${smoothPath(p5)}" fill="none" style="stroke:var(--blue)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.55"/>
        <path d="${line7}" fill="none" stroke="#FF8C42" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="hover-line" style="left:${hx / LC.W * 100}%"></div>
      <div class="hover-dot" style="left:calc(${hx / LC.W * 100}% - 6px);top:${hy - 6}px"></div>
      <div class="tooltip" style="left:${tipPct}%;top:${tipTop}px">
        <span class="main">${esc(t('weekly'))} ${Math.round(h.v7)}%</span>
        <span class="sub">${esc(t('five-hour'))} ${Math.round(h.v5)}% · ${esc(dateLabel(when))} ${String(when.getHours()).padStart(2, '0')}:00</span>
      </div>`;
  }
  el.innerHTML = grid + body;
  el.dataset.first = series[0]?.i ?? 0;
  el.dataset.last = series[series.length - 1]?.i ?? 0;

  const labels = [];
  for (let d = 0; d < 7; d++) {
    const on = d === hoverDay;
    labels.push(`<span class="${on ? 'on' : ''}">${esc(d === 6 ? t('today') : dateLabel(daysAgo(6 - d)))}</span>`);
  }
  $('day-labels').innerHTML = labels.join('');
}

function onLineMove(e) {
  const el = $('line-chart');
  const r = el.getBoundingClientRect();
  const vx = (e.clientX - r.left) / r.width * LC.W;
  const first = Number(el.dataset.first), last = Number(el.dataset.last);
  const i = Math.max(first, Math.min(last, Math.round((vx - LC.X0) / (LC.X1 - LC.X0) * (LC.N - 1))));
  if (i !== state.lineHover) {
    state.lineHover = i;
    renderLineChart();
  }
}

// Local-scan parts of the summary: most-used models (all providers) and the
// 7-day token bars (providers without limit data)
async function renderSummaryLocal(isClaude) {
  const provider = state.provider;
  const res = await window.electronAPI.getDetailedStats({ provider, days: 7 }).catch(() => null);
  if (provider !== state.provider || state.view !== 'summary') return;
  const data = res?.success ? res.data : null;

  renderTopModels(data?.modelRows);
  if (isClaude) return;
  const vals = dailyTotals(data?.dailyRows || [], 7);
  $('summary-bars').innerHTML = barsHtml(vals, -1);
  $('summary-bar-labels').innerHTML = [6, 3, 0].map(n => `<span>${esc(n === 0 ? t('today') : dateLabel(daysAgo(n)))}</span>`).join('');
}

// Share of requests (turns) per model. Tokens are dominated by cache reads and
// cost depends on the pricing table, so turns best reflect "how often".
function renderTopModels(modelRows) {
  const merged = new Map();
  for (const r of modelRows || []) {
    if (!r.model || r.model.startsWith('<')) continue; // e.g. Claude Code's "<synthetic>"
    const name = shortModel(r.model);
    merged.set(name, (merged.get(name) || 0) + (r.turns || 0));
  }
  let list = [...merged].map(([name, turns]) => ({ name, turns })).filter(m => m.turns > 0).sort((a, b) => b.turns - a.turns);
  const total = list.reduce((a, b) => a + b.turns, 0);

  $('top-models-card').hidden = total === 0;
  if (!total) return;

  if (list.length > 4) {
    const rest = list.slice(3).reduce((a, b) => a + b.turns, 0);
    list = [...list.slice(0, 3), { name: t('other'), turns: rest, other: true }];
  }
  const colors = modelColors(list.map(m => m.name));
  const items = list.map((m, i) => ({ ...m, color: m.other ? 'var(--text-4)' : colors[i], share: m.turns / total }));
  const pct = s => (s > 0 && s < 0.01 ? '<1%' : `${Math.round(s * 100)}%`);
  const count = n => (n >= 10000 ? fmtTokens(n) : n.toLocaleString(t('numLocale')));

  $('top-model-name').textContent = items[0].name;
  $('top-model-pct').textContent = pct(items[0].share);
  $('top-models-stack').innerHTML = items.map(m => `<div style="width:${m.share * 100}%;background:${m.color}"></div>`).join('');
  $('top-models-list').innerHTML = items.map(m => `<div class="model-row">
      <span class="sw" style="background:${m.color}"></span>
      <span class="name">${esc(m.name)}</span>
      <span class="tok">${count(m.turns)} ${esc(t('requests'))}</span>
      <span class="pct">${pct(m.share)}</span>
    </div>`).join('');
}

// ─── Detail view ─────────────────────────────────────────────────────────────
function rowTotal(r) {
  return (r.input || 0) + (r.output || 0) + (r.cacheRead || 0) + (r.cacheWrite || 0);
}

// One value per calendar day, oldest first, zero-filled
function dailyTotals(rows, days, offset = 0) {
  const byDay = new Map((rows || []).map(r => [r.day, rowTotal(r)]));
  const out = [];
  for (let n = days - 1 + offset; n >= offset; n--) out.push(byDay.get(dateKey(daysAgo(n))) || 0);
  return out;
}

function barsHtml(vals, hover) {
  const max = Math.max(...vals, 1) * 1.05;
  return vals.map((v, i) =>
    `<div class="bar${i === hover ? ' on' : ''}" data-i="${i}"><div style="height:${v > 0 ? Math.max(6, v / max * 100) : 0}%"></div></div>`
  ).join('');
}

async function renderDetail() {
  const key = `${state.provider}|${state.period}|${state.model}`;
  if (!state.detail || state.detail.key !== key) {
    await loadDetail();
    if (state.view !== 'detail') return;
  }
  const { all, current, twice } = state.detail;

  document.querySelectorAll('#period-tabs button').forEach(b => b.classList.toggle('active', Number(b.dataset.period) === state.period));

  // Model select — options from the unfiltered period query
  const models = (all?.modelRows || []).filter(r => r.model);
  const sel = $('model-select');
  sel.innerHTML = `<option value="all">${esc(t('all-models'))}</option>` +
    models.map(r => `<option value="${esc(r.model)}">${esc(shortModel(r.model))}</option>`).join('');
  sel.value = models.some(r => r.model === state.model) ? state.model : 'all';

  // KPIs
  const s = current?.summary || {};
  $('kpi-cost').textContent = fmtCost(s.totalCost || 0);
  $('kpi-sessions').textContent = (s.sessionCount || 0).toLocaleString(t('numLocale'));
  $('kpi-turns').textContent = fmtTokens(s.totalTurns || 0);

  renderDailyBars(current, twice);
  renderModelMix(all);
  renderProjects(current);
}

function detailBars() {
  let vals = dailyTotals(state.detail.current?.dailyRows, state.period);
  let step = 1;
  if (state.period === 90) {
    const g = [];
    for (let i = 0; i < vals.length; i += 2) g.push(vals[i] + (vals[i + 1] || 0));
    vals = g;
    step = 2;
  }
  return { vals, step };
}

function renderDailyBars(current, twice) {
  const { vals, step } = detailBars();
  const total = vals.reduce((a, b) => a + b, 0);
  const hv = state.barHover >= 0 && state.barHover < vals.length ? state.barHover : -1;
  const back = i => (vals.length - 1 - i) * step;

  const bars = $('daily-bars');
  bars.innerHTML = barsHtml(vals, hv);
  bars.classList.toggle('hovering', hv >= 0);

  $('tok-big').textContent = fmtTokens(hv >= 0 ? vals[hv] : total);
  $('tok-sub').textContent = hv >= 0
    ? (step === 2 ? `${dateLabel(daysAgo(back(hv) + 1))} – ${dateLabel(daysAgo(back(hv)))}` : dateLabel(daysAgo(back(hv))))
    : t('period-total', { n: state.period });

  const labels = [];
  for (let i = 0; i < 5; i++) labels.push(dateLabel(daysAgo(back(Math.round(i * (vals.length - 1) / 4)))));
  $('daily-bar-labels').innerHTML = labels.map(l => `<span>${esc(l)}</span>`).join('');

  // Change vs previous period of equal length
  const prev = dailyTotals(twice?.dailyRows, state.period, state.period).reduce((a, b) => a + b, 0);
  const chEl = $('tok-change');
  if (prev > 0 && total > 0) {
    const ch = Math.round((total / prev - 1) * 100);
    const color = ch >= 0 ? 'var(--text)' : 'var(--green)';
    chEl.innerHTML = esc(t('change', { v: '\u0000', w: t(ch >= 0 ? 'up' : 'down') }))
      .replace('\u0000', `<span class="mono" style="color:${color}">${Math.abs(ch)}%</span>`);
    chEl.hidden = false;
  } else {
    chEl.hidden = true;
  }

  // Token mix
  const sm = current?.summary || {};
  const cache = (sm.totalCacheRead || 0) + (sm.totalCacheWrite || 0);
  const all = cache + (sm.totalInput || 0) + (sm.totalOutput || 0);
  const share = v => {
    const p = v / all * 100;
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  $('tok-mix').textContent = all > 0
    ? `Cache ${share(cache)} · Input ${share(sm.totalInput || 0)} · Output ${share(sm.totalOutput || 0)}`
    : t('no-data');
}

function renderModelMix(all) {
  const rows = (all?.modelRows || [])
    .map(r => ({ name: shortModel(r.model), tokens: rowTotal(r) }))
    .filter(r => r.tokens > 0);

  // Merge rows that share a short name (e.g. dated model ids)
  const merged = new Map();
  for (const r of rows) merged.set(r.name, (merged.get(r.name) || 0) + r.tokens);
  let list = [...merged].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens);
  if (list.length > 4) {
    const rest = list.slice(3).reduce((a, b) => a + b.tokens, 0);
    list = [...list.slice(0, 3), { name: t('other'), tokens: rest, other: true }];
  }
  const total = list.reduce((a, b) => a + b.tokens, 0);
  $('model-total').textContent = `${fmtTokens(total)} ${t('token-word')}`;

  if (!total) {
    $('model-stack').innerHTML = '';
    $('model-list').innerHTML = `<span class="list-empty">${esc(t('no-data'))}</span>`;
    return;
  }
  const colors = modelColors(list.map(m => m.name));
  const items = list.map((m, i) => ({ ...m, color: m.other ? 'var(--text-4)' : colors[i], share: m.tokens / total }));
  $('model-stack').innerHTML = items.map(m => `<div style="width:${m.share * 100}%;background:${m.color}"></div>`).join('');
  $('model-list').innerHTML = items.map(m => `<div class="model-row">
      <span class="sw" style="background:${m.color}"></span>
      <span class="name">${esc(m.name)}</span>
      <span class="tok">${fmtTokens(m.tokens)}</span>
      <span class="pct">${Math.round(m.share * 100)}%</span>
    </div>`).join('');
}

function renderProjects(current) {
  const rows = (current?.projectRows || []).filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 5);
  if (!rows.length) {
    $('project-list').innerHTML = `<span class="list-empty">${esc(t('no-data'))}</span>`;
    return;
  }
  const max = rows[0].cost;
  $('project-list').innerHTML = rows.map(r => `<div class="project-row">
      <span class="name" title="${esc(r.project_name)}">${esc(r.project_name || '—')}</span>
      <div class="track"><div style="width:${r.cost / max * 100}%"></div></div>
      <span class="cost">${fmtCost(r.cost)}</span>
    </div>`).join('');
}

// ─── Settings ────────────────────────────────────────────────────────────────
async function openSettings() {
  closeMenu();
  showScreen('settings');
  renderSettings();
}

async function renderSettings() {
  document.querySelectorAll('#theme-tabs button').forEach(b => b.classList.toggle('active', b.dataset.themePref === state.themePref));
  document.querySelectorAll('#lang-tabs button').forEach(b => b.classList.toggle('active', b.dataset.lang === state.lang));
  document.querySelectorAll('#interval-tabs button').forEach(b => b.classList.toggle('active', Number(b.dataset.interval) === state.interval));
  $('alert-switch').classList.toggle('on', state.alert);
  $('settings-email').textContent = state.profile?.email || '—';
  $('settings-plan').textContent = state.profile?.plan || '';
  $('settings-plan').hidden = !state.profile?.plan;

  window.electronAPI.getLaunchAtLogin().then(on => $('launch-switch').classList.toggle('on', !!on)).catch(() => {});

  const providers = await window.electronAPI.getProvidersList().catch(() => []);
  $('settings-providers').innerHTML = providers.map(p => {
    const color = providerColor(p.id);
    const statusColor = p.available ? 'var(--green)' : 'var(--text-3)';
    return `<div class="sp-item${state.openSetting === p.id ? ' open' : ''}" data-provider="${esc(p.id)}">
      <button class="sp-head">
        <span class="dot" style="background:${color}"></span>
        <span class="name">${esc(p.name)}</span>
        <span class="sp-status" style="color:${statusColor}"><i></i>${esc(t(p.available ? 'connected' : 'not-found'))}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="stroke:var(--text-4)" stroke-width="2.2" stroke-linecap="round"><polyline points="9 6 15 12 9 18"/></svg>
      </button>
      <div class="sp-body">
        <span class="sp-hint">${esc(t(p.available ? 'hint-on' : 'hint-off'))}</span>
        <div class="sp-form">
          <input type="password" placeholder="${esc(t('api-key'))}">
          <button class="sp-save">${esc(t('save'))}</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function saveProviderKey(item) {
  const btn = item.querySelector('.sp-save');
  const input = item.querySelector('input');
  try {
    await window.electronAPI.saveProviderSettings({ providerId: item.dataset.provider, apiKey: input.value.trim() || null, enabled: true });
    btn.textContent = t('saved');
    input.value = '';
  } catch {
    btn.textContent = t('save-error');
  }
  setTimeout(() => { btn.textContent = t('save'); }, 1500);
}

// ─── Menu ────────────────────────────────────────────────────────────────────
function toggleMenu(open) {
  const show = open ?? $('menu').hidden;
  $('menu').hidden = !show;
  $('menu-backdrop').hidden = !show;
  $('menu-btn').classList.toggle('active', show);
}
function closeMenu() { toggleMenu(false); }

// ─── Timers ──────────────────────────────────────────────────────────────────
let refreshTimer = null;
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!$('main-screen').hidden || !$('settings-screen').hidden) refresh();
  }, state.interval * 60000);
}

// ─── Events ──────────────────────────────────────────────────────────────────
function bindEvents() {
  $('refresh-btn').addEventListener('click', refresh);
  $('settings-btn').addEventListener('click', openSettings);
  $('provider-add-btn').addEventListener('click', openSettings);
  $('menu-btn').addEventListener('click', () => toggleMenu());
  $('menu-backdrop').addEventListener('click', closeMenu);
  $('menu-settings').addEventListener('click', openSettings);
  $('menu-quit').addEventListener('click', () => window.electronAPI.quit());

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'q') window.electronAPI.quit();
    if (e.key === 'Escape') closeMenu();
  });

  $('provider-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.provider-tab');
    if (!btn || btn.dataset.provider === state.provider) return;
    state.provider = btn.dataset.provider;
    state.model = 'all';
    state.barHover = -1;
    state.lineHover = -1;
    render();
  });

  document.querySelector('.view-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.view = btn.dataset.view;
    $('content-scroll').scrollTop = 0;
    render();
  });

  $('period-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.period = Number(btn.dataset.period);
    state.barHover = -1;
    renderDetail();
  });

  $('model-select').addEventListener('change', e => {
    state.model = e.target.value;
    state.barHover = -1;
    renderDetail();
  });

  const lineChart = $('line-chart');
  lineChart.addEventListener('mousemove', onLineMove);
  lineChart.addEventListener('mouseleave', () => { state.lineHover = -1; renderLineChart(); });

  const dailyBars = $('daily-bars');
  dailyBars.addEventListener('mouseover', e => {
    const bar = e.target.closest('.bar');
    if (!bar || Number(bar.dataset.i) === state.barHover) return;
    state.barHover = Number(bar.dataset.i);
    renderDailyBars(state.detail.current, state.detail.twice);
  });
  dailyBars.addEventListener('mouseleave', () => {
    state.barHover = -1;
    if (state.detail) renderDailyBars(state.detail.current, state.detail.twice);
  });

  // Settings
  $('settings-back').addEventListener('click', () => { showScreen('main'); render(); });

  $('settings-providers').addEventListener('click', e => {
    const item = e.target.closest('.sp-item');
    if (!item) return;
    if (e.target.closest('.sp-save')) { saveProviderKey(item); return; }
    if (e.target.closest('.sp-head')) {
      const id = item.dataset.provider;
      state.openSetting = state.openSetting === id ? null : id;
      document.querySelectorAll('.sp-item').forEach(el => el.classList.toggle('open', el.dataset.provider === state.openSetting));
    }
  });

  $('launch-switch').addEventListener('click', async e => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    await window.electronAPI.setLaunchAtLogin(on);
  });

  $('alert-switch').addEventListener('click', () => {
    state.alert = !state.alert;
    savePref('limitAlert', state.alert);
    renderSettings();
  });

  $('theme-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.themePref = btn.dataset.themePref;
    savePref('theme', state.themePref);
    applyTheme();
    renderSettings();
  });

  $('lang-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.lang = btn.dataset.lang;
    savePref('lang', state.lang);
    applyStaticText();
    renderSettings();
  });

  $('interval-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.interval = Number(btn.dataset.interval);
    savePref('refreshInterval', state.interval);
    scheduleRefresh();
    renderSettings();
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  state.systemDark = await window.electronAPI.getTheme().catch(() => true);
  applyTheme();
  window.electronAPI.onThemeChanged(dark => {
    state.systemDark = dark;
    if (state.themePref !== 'system') return;
    applyTheme();
    if (!$('main-screen').hidden) render();
  });

  applyStaticText();
  bindEvents();

  const isAuth = await window.electronAPI.checkAuth().catch(() => false);
  if (!isAuth) {
    showScreen('login');
    return;
  }

  showScreen('main');
  render();
  await refresh();
  scheduleRefresh();
  setInterval(renderTopbar, 1000);
}

init();
