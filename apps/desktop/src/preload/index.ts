import { contextBridge, ipcRenderer } from 'electron';
import {
  MurlApi,
  HarnessSettings,
  TaskEventPayload,
  TaskCompletePayload,
  TaskFailedPayload,
  TaskCancelledPayload,
} from './types.js';

// ─── Push-listener wrapper maps ───────────────────────────────────────────────
// contextBridge cannot transfer listener references back, so we map each
// user-supplied callback to its IPC-wrapped version so removeListener works.

type AnyFn = (...args: unknown[]) => void;

function makePushBridge(channel: string) {
  const listenerMap = new Map<AnyFn, AnyFn>();
  return {
    on(cb: AnyFn) {
      const wrapped: AnyFn = (_event: unknown, payload: unknown) => cb(payload as never);
      listenerMap.set(cb, wrapped);
      ipcRenderer.on(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
    },
    off(cb: AnyFn) {
      const wrapped = listenerMap.get(cb);
      if (wrapped) {
        ipcRenderer.removeListener(channel, wrapped as Parameters<typeof ipcRenderer.removeListener>[1]);
        listenerMap.delete(cb);
      }
    },
  };
}

const taskEventBridge    = makePushBridge('murl:task-event');
const taskCompleteBridge = makePushBridge('murl:task-complete');
const taskFailedBridge   = makePushBridge('murl:task-failed');
const taskCancelledBridge = makePushBridge('murl:task-cancelled');

// ─── Full API exposed to renderer ─────────────────────────────────────────────

const murlApi: MurlApi = {
  // Health / system
  healthCheck: () => ipcRenderer.invoke('murl:health'),

  // Settings
  getSettingsStatus: () => ipcRenderer.invoke('murl:getSettingsStatus'),
  saveApiKey: (provider: string, apiKey: string) =>
    ipcRenderer.invoke('murl:saveApiKey', provider, apiKey),
  saveHarnessSettings: (settings: HarnessSettings) =>
    ipcRenderer.invoke('murl:saveHarnessSettings', settings),
  testConnection: (provider: string, model: string) =>
    ipcRenderer.invoke('murl:testConnection', provider, model),

  // Repo management
  pickRepoFolder: () => ipcRenderer.invoke('murl:pickRepoFolder'),
  validateRepo: (path: string) => ipcRenderer.invoke('murl:validateRepo', path),
  getRecentRepos: () => ipcRenderer.invoke('murl:getRecentRepos'),
  addRecentRepo: (path: string) => ipcRenderer.invoke('murl:addRecentRepo', path),
  getRepoBranch: (path: string) => ipcRenderer.invoke('murl:getRepoBranch', path),

  // Task execution
  launchTask: (repoPath: string, prompt: string, model: string, baseBranch?: string) =>
    ipcRenderer.invoke('murl:launchTask', repoPath, prompt, model, baseBranch),
  cancelTask: (taskId: string) =>
    ipcRenderer.invoke('murl:cancelTask', taskId),
  getTaskHistory: () => ipcRenderer.invoke('murl:getTaskHistory'),
  getTaskRecord: (taskId: string) => ipcRenderer.invoke('murl:getTaskRecord', taskId),
  keepTask: (taskId: string) => ipcRenderer.invoke('murl:keepTask', taskId),
  discardTask: (taskId: string) => ipcRenderer.invoke('murl:discardTask', taskId),
  followUpTask: (taskId: string, prompt: string) => ipcRenderer.invoke('murl:followUpTask', taskId, prompt),

  // Push event subscriptions
  onTaskEvent:    (cb) => taskEventBridge.on(cb as AnyFn),
  offTaskEvent:   (cb) => taskEventBridge.off(cb as AnyFn),
  onTaskComplete: (cb) => taskCompleteBridge.on(cb as AnyFn),
  offTaskComplete:(cb) => taskCompleteBridge.off(cb as AnyFn),
  onTaskFailed:   (cb) => taskFailedBridge.on(cb as AnyFn),
  offTaskFailed:  (cb) => taskFailedBridge.off(cb as AnyFn),
  onTaskCancelled:(cb) => taskCancelledBridge.on(cb as AnyFn),
  offTaskCancelled:(cb) => taskCancelledBridge.off(cb as AnyFn),
};

contextBridge.exposeInMainWorld('murl', murlApi);
