// providers/gemini/index.js
const fs = require('fs');
const BaseProvider = require('../base');
const scanner = require('./scanner');

class GeminiProvider extends BaseProvider {
  get id()    { return 'gemini'; }
  get name()  { return 'Gemini'; }
  get icon()  { return '🔵'; }
  get color() { return '#4285f4'; }

  async isAvailable() {
    return fs.existsSync(scanner.GEMINI_DIR);
  }

  async fetchQuota() {
    // Gemini CLI doesn't record quota locally
    return {
      provider: this.id, name: this.name, available: true,
      quota: { session: null, weekly: null, models: [] },
      error: 'Quota data not available — local scan only'
    };
  }
}

module.exports = GeminiProvider;
