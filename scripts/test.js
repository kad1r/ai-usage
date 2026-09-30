// Runs test/*.test.js with Electron's own Node, because better-sqlite3 is
// compiled for Electron's ABI and won't load in the system Node.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).map(f => path.join(dir, f));

const { status } = spawnSync(electron, ['--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
process.exit(status ?? 1);
