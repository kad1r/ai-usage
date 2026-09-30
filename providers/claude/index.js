// providers/claude/index.js
const fs = require('fs');
const BaseProvider = require('../base');

class ClaudeProvider extends BaseProvider {
  constructor(credentialsPath) {
    super();
    this.credentialsPath = credentialsPath;
  }

  get id()    { return 'claude'; }
  get name()  { return 'Claude'; }
  get icon()  { return '🟣'; }
  get color() { return '#d97706'; }

  async isAvailable() {
    return fs.existsSync(this.credentialsPath);
  }

  // Returns the (cached) usage API response
  setUsageSource(fn) { this._getUsage = fn; }

  async fetchQuota() {
    if (!this._getUsage) {
      return {
        provider: this.id, name: this.name, available: false,
        quota: { session: null, weekly: null, models: [] },
        error: 'Not authenticated'
      };
    }
    const data = await this._getUsage();

    return {
      provider: this.id,
      name: this.name,
      available: true,
      quota: {
        session: data.five_hour
          ? { utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at }
          : null,
        weekly: data.seven_day
          ? { utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at }
          : null,
        models: [
          data.seven_day_opus   ? { name: 'claude-opus',   utilization: data.seven_day_opus.utilization }   : null,
          data.seven_day_sonnet ? { name: 'claude-sonnet', utilization: data.seven_day_sonnet.utilization } : null,
        ].filter(Boolean),
        raw: data  // keep raw for existing renderer compatibility
      },
      error: null
    };
  }
}

module.exports = ClaudeProvider;
