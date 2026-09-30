# Changelog

All notable changes to Claude Usage will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.1] - 2026-09-30

### Added
- **Most used models** card on the Overview — the top model and each model's share of requests over the last 7 days, for the selected provider. Share is by requests (turns): token share is dominated by cache reads, so it would overstate models with long cached contexts
- **"All" period** in the Detailed view (back from the pre-1.3.0 UI) — daily token bars are grouped into at most 45 buckets, with the date range shown on hover
- **Activity insights** in the Detailed view, for the selected period, provider and model:
  - Token types — input, output, cache read and cache write amounts with their share
  - Most time spent per project
  - Models used in each project (counted per request)
  - Longest sessions, with project, date, model and request count
  - Most active days by request count
- Durations are **active time**: gaps between requests up to 30 minutes are summed and longer gaps count as breaks, since sessions are often resumed hours or days later. Subagent sessions run in parallel with their parent, so they're left out of time totals (they still count towards requests and models)

### Fixed
- **Gemini usage missing since late April** — Gemini CLI now writes sessions as `.jsonl`, which the scanner didn't read. Both formats are parsed; messages that the CLI re-appends on update are counted once. Already-scanned files are re-read once with the corrected maths
- **Gemini token counts** — cached tokens were counted twice (Gemini's `input` already includes them) and thinking tokens were not counted; they are now billed as output
- **Cost estimates were too low** — Opus 4.8, Opus 5, Opus 5.5, Sonnet 5 and Fable models were missing from the price table and fell back to Sonnet prices; Opus 4.6/4.5 and Haiku 4.5 had outdated prices. The table now follows the official pricing page, including the lower cache-read rates of Opus 5.5 and Fable 5.1
- **Wrong project names** — subagent transcripts were all filed under a "subagents" project, and hyphenated or spaced names were cut to their last word ("Cts Ai Devs" → "Devs"). Names now come from the working directory recorded in each transcript; existing sessions are renamed once on the first scan, without re-scanning
- Dated model ids (e.g. `claude-haiku-4-5-20251001`) now use their model's price; Claude Code's `<synthetic>` entries cost nothing and are hidden from model lists; Gemini sessions are priced with Gemini rates instead of Claude's

---

## [1.3.0] - 2026-09-29

### Added

#### New "AI Usage" design
- Single 400×800 window with a new header (last-updated time, refresh, settings, overflow menu)
- Provider tabs showing each provider's peak utilisation, plus a `+` shortcut to provider settings
- **Summary view**
  - Account e-mail and subscription plan badge (e.g. `Max 20x`, read from Claude Code credentials)
  - Arc gauges for the 5-hour and weekly limits with status pill (Relaxed / Watch / Critical) and time to reset
  - Weekly-limit projection: estimates where the weekly limit will land at reset, or when it will fill up at the current pace
  - 7-day utilisation line chart (weekly + 5-hour) with hover tooltip and day highlight
  - Providers without limit data show a 7-day token chart instead
- **Detailed view**
  - 7 / 30 / 90-day period switch and model filter
  - Cost, session and turn KPI cards
  - Daily token bars with per-day hover, change vs the previous period, and cache / input / output mix
  - Model mix bar with per-model token share
  - Top projects ranked by cost
- **Settings screen**
  - Providers list with connection status and API key entry
  - Launch at Windows startup
  - **Theme: System / Light / Dark** — System follows the Windows theme live
  - Language (TR / EN), refresh interval (1 / 5 / 15 min)
  - Limit alert: desktop notification when a limit passes 80% (once per reset window)
- `Ctrl+Q` quits the app

#### Light theme
- Full light palette for every screen, chart and gauge

### Changed
- Charts are now inline SVG — Chart.js CDN dependency, `gauge.js`, `chart.js` and `detailedStats.js` removed
- Inter and Roboto Mono fonts are bundled in `fonts/`; the app no longer loads anything from the network for its UI and the CSP no longer allows external scripts or fonts
- Scanner returns per-project cost and cache-write tokens, and groups days in local time
- The header's "updated" time reflects when the data was actually fetched; cached data is marked as such

### Fixed
- **Usage failing with `HTTP 429`** — the usage endpoint is rate limited per OAuth token (shared with Claude Code). Responses are now cached for 2 minutes, concurrent requests are merged, `Retry-After` is honoured, and the last known data (persisted to disk) is shown while rate limited
- **Usage history could be wiped** — when two instances wrote `history.json` at the same time, a half-written file was read as empty and the next save overwrote all history
  - History, settings and usage cache are written atomically (temp file + rename)
  - An unreadable `history.json` is moved aside as `history.corrupt-<timestamp>.json` instead of being overwritten
  - Single-instance lock: launching the app again focuses the running instance
- Model-mix colours no longer repeat for two models of the same family

---

## [1.2.0] - 2026-04-16

### Changed

#### UI Redesign
- Pill-style segmented tab bar (clearer active state)
- Provider settings as bordered cards with two-row layout
- Provider tabs now have a separator border to prevent scroll bleed

#### Internationalisation (TR / EN)
- Language toggle button in the footer
- All labels, status text, chart annotations, and gauge statuses switch between Turkish and English

#### Authentication
- Removed OAuth / Client ID flow — the app now reads credentials directly from Claude Code's `~/.claude/.credentials.json`
- No setup screen needed; just run `claude login` if not already authenticated

#### Charts
- Smooth bezier area chart (two-pass fill + stroke, no noisy dots)
- Doughnut model-distribution chart with center-text token total and vibrant palette

### Fixed
- Provider settings button overflow (flex input min-width)
- WebKit flex + overflow-y padding-bottom bug in provider settings panel

---

## [1.1.0] - 2026-04-15

### Added

#### Multi-Provider Support
- **Provider plugin architecture** — `BaseProvider` abstract class + `ProviderRegistry` singleton for clean extensibility
- **Codex provider** — Scans OpenAI Codex CLI session logs from `~/.codex/`
- **Gemini provider** — Scans Google Gemini CLI chat sessions from `~/.gemini/tmp/<project>/chats/session-*.json`
- **Cursor provider** — Scans Cursor AI session data from `~/.cursor/`
- Provider switcher bar on the Özet tab — click any provider to see its stats and token chart
- Per-provider local stats: session count, turn count, and estimated cost
- Per-provider 7-day token chart (input vs output tokens)
- Provider Settings panel (⚙️ button) — enable/disable providers and enter optional API keys

#### Detailed Stats Tab ("Detaylı")
- New tab with full session history filterable by provider, model, and time range
- KPI cards: sessions, cost, turns for the selected period
- Daily token usage stacked bar chart
- Model distribution pie chart
- Top projects bar chart
- Recent sessions table (project, model, duration, turns, cost)
- Cost-by-model breakdown table

#### Local Scanning
- `scanner.js` — SQLite database (`better-sqlite3`) for storing and querying parsed session data
- `scan-local-usage` IPC handler triggers a full re-scan of all providers
- `get-detailed-stats` IPC handler returns filtered stats for the Detaylı tab
- `get-available-models` IPC handler returns distinct models seen in scan data
- Automatic scan on startup and every 5 minutes

#### Security
- OAuth credentials now encrypted at rest using `safeStorage` (Windows DPAPI / macOS Keychain)
- Automatic migration of existing plain-text credentials to encrypted format
- `safeOpenExternal()` — `shell.openExternal` restricted to an allowlist of trusted origins (`claude.ai`, `platform.claude.com`)
- Content Security Policy meta tag added to `index.html`
- `updateModelBreakdown` rewritten with DOM API to eliminate innerHTML with API data (XSS prevention)

### Changed

- Footer bar moved outside the scrollable content area — always visible regardless of scroll position
- `#app` height uses `calc(100vh / 1.08)` to compensate for any body zoom on high-DPI displays
- `package.json` version bumped to `1.1.0`
- `providers/**/*` added to electron-builder `files` list
- `asarUnpack` configured for `better-sqlite3` native module
- Gemini scanner completely rewritten to match actual CLI session format (`messages[]` with `tokens: {input, output, cached}`)

### Fixed

- Footer controls (Refresh, Launch at Login, Settings, Menu) no longer hidden when content overflows
- Chart height on two-column cards — added `maintainAspectRatio: false` and explicit CSS height
- CSS grid blowout on two-column cards — added `min-width: 0` to prevent overflow
- Light theme CSS selectors corrected for provider and stats UI elements
- Null guard added for missing usage data fields

---

## [1.0.0] - 2026-03-17

### Initial Release

The first public release of Claude Usage — a Windows system tray app for tracking your Claude AI usage in real time.

### Added

#### Authentication
- OAuth 2.0 sign-in with PKCE flow (no client secret stored)
- Automatic token refresh when credentials expire
- Secure credential storage in local JSON files
- Sign out support via hamburger menu

#### Dashboard
- **5-Hour usage gauge** — real-time utilization with animated gauge chart
- **7-Day usage gauge** — weekly utilization with animated gauge chart
- **Per-model breakdown** — individual Opus and Sonnet usage with color-coded progress bars
- **Extra usage tracking** — credit consumption against monthly limit (shown when enabled)
- **7-Day trend chart** — interactive line chart plotting all metrics over the past week
- **Reset timers** — countdown showing when each usage window resets

#### System Tray
- Runs as a lightweight system tray application
- Left-click tray icon to toggle the usage panel
- Right-click tray icon for context menu (Show / Quit)
- Auto-hide when clicking outside the panel

#### UI/UX
- Clean, modern interface with rounded cards and smooth animations
- **Dark/light theme** — automatically follows Windows system theme
- Color-coded usage levels (green → yellow → orange → red → pulsing red)
- Hamburger menu for Sign Out and Quit actions
- Refresh icon button for manual data refresh
- Launch at Login toggle for auto-start with Windows

#### Data & Performance
- Auto-refresh every 5 minutes
- Usage history stored locally (last 30 days)
- Chart legend with per-series color indicators
- Relative timestamps ("Updated 2 min, 30 sec ago")

#### Build & Distribution
- One-click NSIS installer for Windows (no admin rights required)
- Installs to user profile directory
- Electron 41 with context isolation and secure IPC

---

[1.3.1]: https://github.com/kad1r/claude-usage-widget/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/kad1r/claude-usage-widget/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/kad1r/claude-usage-widget/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/kad1r/claude-usage-widget/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kad1r/claude-usage-widget/releases/tag/release
