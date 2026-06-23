import { contextBridge, ipcRenderer } from 'electron';
import { MurlApi, HarnessSettings } from './types.js';

const murlApi: MurlApi = {
  healthCheck: () => ipcRenderer.invoke('murl:health'),
  getSettingsStatus: () => ipcRenderer.invoke('murl:getSettingsStatus'),
  saveApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('murl:saveApiKey', provider, apiKey),
  saveHarnessSettings: (settings: HarnessSettings) => ipcRenderer.invoke('murl:saveHarnessSettings', settings),
  testConnection: (provider: string, model: string) => ipcRenderer.invoke('murl:testConnection', provider, model)
};

contextBridge.exposeInMainWorld('murl', murlApi);
