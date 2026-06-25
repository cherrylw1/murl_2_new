import { contextBridge, ipcRenderer } from 'electron';
import {
  MurlApi,
  HarnessSettings,
  TaskEventPayload,
  TaskCompletePayload,
  TaskFailedPayload,
  TaskCancelledPayload,
  TerminalDataPayload,
  TerminalExitPayload,
  PreviewLogPayload,
  PreviewUrlPayload,
  PreviewExitPayload,
  Recipe,
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
const terminalDataBridge = makePushBridge('murl:terminal-data');
const terminalExitBridge = makePushBridge('murl:terminal-exit');
const previewLogBridge   = makePushBridge('murl:preview-log');
const previewUrlBridge   = makePushBridge('murl:preview-url');
const previewExitBridge  = makePushBridge('murl:preview-exit');

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
  launchTask: (repoPath: string, prompt: string, model: string, provider: string, budgetCap: number, baseBranch?: string, groupId?: string) =>
    ipcRenderer.invoke('murl:launchTask', repoPath, prompt, model, provider, budgetCap, baseBranch, groupId),
  cancelTask: (taskId: string) =>
    ipcRenderer.invoke('murl:cancelTask', taskId),
  getTaskHistory: () => ipcRenderer.invoke('murl:getTaskHistory'),
  getTaskRecord: (taskId: string) => ipcRenderer.invoke('murl:getTaskRecord', taskId),
  getTasksByGroupId: (groupId: string) => ipcRenderer.invoke('murl:getTasksByGroupId', groupId),
  keepTask: (taskId: string) => ipcRenderer.invoke('murl:keepTask', taskId),
  discardTask: (taskId: string) => ipcRenderer.invoke('murl:discardTask', taskId),
  openPrTask: (taskId: string) => ipcRenderer.invoke('murl:openPrTask', taskId),
  followUpTask: (taskId: string, prompt: string) => ipcRenderer.invoke('murl:followUpTask', taskId, prompt),

  // Recipes
  createRecipe: (recipe: Omit<Recipe, 'id'>) => ipcRenderer.invoke('murl:createRecipe', recipe),
  listRecipes: () => ipcRenderer.invoke('murl:listRecipes'),
  deleteRecipe: (id: string) => ipcRenderer.invoke('murl:deleteRecipe', id),

  // Terminal (pty)
  openTerminal: (taskId: string, worktreePath: string) => ipcRenderer.invoke('murl:openTerminal', taskId, worktreePath),
  terminalInput: (taskId: string, data: string) => ipcRenderer.invoke('murl:terminalInput', taskId, data),
  terminalResize: (taskId: string, cols: number, rows: number) => ipcRenderer.invoke('murl:terminalResize', taskId, cols, rows),
  closeTerminal: (taskId: string) => ipcRenderer.invoke('murl:closeTerminal', taskId),

  // Push event subscriptions
  onTaskEvent:    (cb) => taskEventBridge.on(cb as AnyFn),
  offTaskEvent:   (cb) => taskEventBridge.off(cb as AnyFn),
  onTaskComplete: (cb) => taskCompleteBridge.on(cb as AnyFn),
  offTaskComplete:(cb) => taskCompleteBridge.off(cb as AnyFn),
  onTaskFailed:   (cb) => taskFailedBridge.on(cb as AnyFn),
  offTaskFailed:  (cb) => taskFailedBridge.off(cb as AnyFn),
  onTaskCancelled:(cb) => taskCancelledBridge.on(cb as AnyFn),
  offTaskCancelled:(cb) => taskCancelledBridge.off(cb as AnyFn),

  // Terminal push events
  onTerminalData:  (cb) => terminalDataBridge.on(cb as AnyFn),
  offTerminalData: (cb) => terminalDataBridge.off(cb as AnyFn),
  onTerminalExit:  (cb) => terminalExitBridge.on(cb as AnyFn),
  offTerminalExit: (cb) => terminalExitBridge.off(cb as AnyFn),

  // Preview (dev server)
  getPreviewCommand: (worktreePath: string) => ipcRenderer.invoke('murl:getPreviewCommand', worktreePath),
  startPreview: (taskId: string, worktreePath: string, command: string) =>
    ipcRenderer.invoke('murl:startPreview', taskId, worktreePath, command),
  stopPreview: (taskId: string) => ipcRenderer.invoke('murl:stopPreview', taskId),
  openPreviewUrl: (url: string) => ipcRenderer.invoke('murl:openPreviewUrl', url),
  openUrl: (url: string) => ipcRenderer.invoke('murl:openUrl', url),

  // Preview push events
  onPreviewLog:    (cb) => previewLogBridge.on(cb as AnyFn),
  offPreviewLog:   (cb) => previewLogBridge.off(cb as AnyFn),
  onPreviewUrl:    (cb) => previewUrlBridge.on(cb as AnyFn),
  offPreviewUrl:   (cb) => previewUrlBridge.off(cb as AnyFn),
  onPreviewExit:   (cb) => previewExitBridge.on(cb as AnyFn),
  offPreviewExit:  (cb) => previewExitBridge.off(cb as AnyFn),

  platform: process.platform,
  minimizeWindow: () => ipcRenderer.invoke('murl:window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('murl:window-maximize'),
  closeWindow: () => ipcRenderer.invoke('murl:window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('murl:window-is-maximized'),
};

contextBridge.exposeInMainWorld('murl', murlApi);
