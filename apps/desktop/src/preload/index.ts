import { contextBridge, ipcRenderer } from 'electron';
import { MurlApi } from './types.js';

const murlApi: MurlApi = {
  healthCheck: () => ipcRenderer.invoke('murl:health')
};

contextBridge.exposeInMainWorld('murl', murlApi);
