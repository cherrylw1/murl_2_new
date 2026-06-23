import { contextBridge, ipcRenderer } from 'electron';
import { MurlApi, HarnessSettings } from './types.js';

const murlApi: MurlApi = {
  healthCheck: () => ipcRenderer.invoke('murl:health'),
  getSettingsStatus: () => ipcRenderer.invoke('murl:getSettingsStatus'),
  saveApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('murl:saveApiKey', provider, apiKey),
  saveHarnessSettings: (settings: HarnessSettings) => ipcRenderer.invoke('murl:saveHarnessSettings', settings),
  testConnection: (provider: string, model: string) => ipcRenderer.invoke('murl:testConnection', provider, model),
  pickRepoFolder: () => ipcRenderer.invoke('murl:pickRepoFolder'),
  validateRepo: (path: string) => ipcRenderer.invoke('murl:validateRepo', path),
  getRecentRepos: () => ipcRenderer.invoke('murl:getRecentRepos'),
  addRecentRepo: (path: string) => ipcRenderer.invoke('murl:addRecentRepo', path),
  getRepoBranch: (path: string) => ipcRenderer.invoke('murl:getRepoBranch', path)
};

contextBridge.exposeInMainWorld('murl', murlApi);
