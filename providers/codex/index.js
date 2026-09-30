// providers/codex/index.js
const fs = require('fs');
const BaseProvider = require('../base');
const scanner = require('./scanner');

class CodexProvider extends BaseProvider {
  get id()    { return 'codex'; }
  get name()  { return 'OpenAI Codex'; }
  get icon()  { return '🟢'; }
  get color() { return '#10a37f'; }

  async isAvailable() {
    return fs.existsSync(scanner.CODEX_DIR);
  }

  async fetchQuota() {
    const quota = scanner.readQuota();
    return {
      provider: this.id, name: this.name, available: true,
      quota: { session: quota?.session || null, weekly: quota?.weekly || null, models: [] },
      error: quota ? null : 'Quota data not available — local scan only'
    };
  }
}

module.exports = CodexProvider;
