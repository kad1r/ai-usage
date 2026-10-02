# AI Usage (repo: kad1r/ai-usage)

Windows-only Electron tray app that shows AI coding-tool usage: live Claude quota from the Anthropic OAuth usage endpoint, plus token and cost stats built by scanning local transcripts of Claude Code, Codex, Gemini CLI and Cursor. Single user, desktop only — no server.

## Layout

- `main.js` — main process: tray, window, IPC, OAuth usage/profile calls (Claude Code credentials from `~/.claude/.credentials.json`), legacy-data migration.
- `scan-worker.js` — long-lived Electron `utilityProcess` that runs the scanners. Main starts it once and reuses it; don't spawn a process per scan (the exe is unsigned and antivirus inspects every new process).
- `providers/<id>/` — `index.js` (provider metadata, quota) and `scanner.js` (local transcript parsing); `base.js`, `registry.js` wire them up.
- `providers/pricing.js` — the single price table (USD per 1M tokens) with source URL and check date per provider.
- `db.js` — SQLite (better-sqlite3) at `%APPDATA%\ai-usage\data\usage.db`; `stats.js` — read-only queries for the Detailed view.
- `renderer.js`, `index.html`, `styles.css`, `preload.js` — UI with no external libraries; strings live in the i18n table in `renderer.js` (Turkish default, English).

## Commands

- `npm start` — run the app.
- `npm test` — runs `test/*.test.js` with `node:test` under Electron's Node, because better-sqlite3 is built for Electron's ABI.
- `npm run build` — Windows NSIS installer into `dist/`.

## Conventions

- `appId` stays `com.claude.usage-tracker` so installers upgrade existing installs in place.
- Releases: version bump commit + `CHANGELOG.md` entry, tag that commit, `gh release create` with `dist/AI Usage Setup X.Y.Z.exe`, then merge the PR into `main` with a merge commit.
- Scrollable lists inside a flex column must be `display: block` with `margin-bottom` on children: WebKit drops `padding-bottom` on flex `overflow-y` containers.
