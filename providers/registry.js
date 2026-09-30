// providers/registry.js
class ProviderRegistry {
  constructor() {
    this._providers = [];
  }

  register(provider) {
    if (this._providers.some(p => p.id === provider.id)) {
      throw new Error(`Provider '${provider.id}' is already registered`);
    }
    this._providers.push(provider);
  }

  getAll() {
    return this._providers;
  }

  getById(id) {
    return this._providers.find(p => p.id === id) || null;
  }

  async fetchAllQuotas() {
    return Promise.all(this._providers.map(p => p.fetchQuota().catch(err => ({
      provider: p.id,
      name: p.name,
      available: false,
      quota: { session: null, weekly: null, models: [] },
      error: err.message
    }))));
  }
}

const registry = new ProviderRegistry();
// Singleton: all parts of the app share one registry instance.
module.exports = registry;
