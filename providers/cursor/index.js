// providers/cursor/index.js
const fs = require('fs');
const BaseProvider = require('../base');
const scanner = require('./scanner');

class CursorProvider extends BaseProvider {
  get id()    { return 'cursor'; }
  get name()  { return 'Cursor'; }
  get icon()  { return '🔷'; }
  get color() { return '#7c83fd'; }

  async isAvailable() {
    return fs.existsSync(scanner.globalDbPath(scanner.CURSOR_USER_DIR));
  }

  async fetchQuota() {
    // Cursor keeps its quota server-side
    return {
      provider: this.id,
      name: this.name,
      available: await this.isAvailable(),
      quota: { session: null, weekly: null, models: [] },
      error: 'Quota data not available for Cursor — local scan only'
    };
  }
}

module.exports = CursorProvider;
