const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  fetchUsage: () => ipcRenderer.invoke('fetch-usage'),
  fetchProfile: () => ipcRenderer.invoke('fetch-profile'),
  signOut: () => ipcRenderer.invoke('sign-out'),
  loadHistory: () => ipcRenderer.invoke('load-history'),
  saveDataPoint: (point) => ipcRenderer.invoke('save-data-point', point),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('set-launch-at-login', enabled),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_event, isDark) => callback(isDark)),
  quit: () => ipcRenderer.invoke('quit-app'),
  scanLocalUsage: () => ipcRenderer.invoke('scan-local-usage'),
  getDetailedStats: (filters) => ipcRenderer.invoke('get-detailed-stats', filters),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  fetchAllProvidersQuota: () => ipcRenderer.invoke('fetch-all-providers-quota'),
  getProvidersList: () => ipcRenderer.invoke('get-providers-list'),
  saveProviderSettings: (opts) => ipcRenderer.invoke('save-provider-settings', opts),
  getProviderApiKey: (opts) => ipcRenderer.invoke('get-provider-api-key', opts),
  scanProviderLocal: (opts) => ipcRenderer.invoke('scan-provider-local', opts)
});
