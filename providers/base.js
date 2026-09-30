// providers/base.js
// Local scanning lives in each provider's scanner.js and runs in scan-worker.js.
class BaseProvider {
  /** Unique machine-readable ID, e.g. 'claude' */
  get id()    { throw new Error(`${this.constructor.name} must implement id`); }
  /** Human-readable name, e.g. 'Claude' */
  get name()  { throw new Error(`${this.constructor.name} must implement name`); }
  /** Emoji or short string used in UI */
  get icon()  { return '🤖'; }
  /** CSS hex color for charts/UI */
  get color() { return '#888888'; }

  /**
   * Returns true if this provider can be used (its local data folder exists).
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return false; }

  /**
   * Fetches current quota/utilization data.
   * @returns {Promise<QuotaResult>}
   *
   * QuotaResult shape:
   * {
   *   provider: string,
   *   name: string,
   *   available: boolean,
   *   quota: {
   *     session:  { utilization: number, resetsAt: string|null } | null,
   *     weekly:   { utilization: number, resetsAt: string|null } | null,
   *     models:   [{ name: string, utilization: number }]
   *   },
   *   error: string|null
   * }
   */
  async fetchQuota() {
    throw new Error(`${this.constructor.name} must implement fetchQuota`);
  }
}

module.exports = BaseProvider;
