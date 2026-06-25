import { app, BrowserWindow, ipcMain, Menu, Tray, dialog } from 'electron';
import { join } from 'path';
import { noop, Recipe } from '@murl/core';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  loadAndSetApiKey,
  loadSettings,
  saveSettings,
  saveApiKey,
  isApiKeyConfigured,
  HarnessSettings,
  addRecentRepo,
  getRecentRepos,
  loadProviderKeys,
  saveProviderKey
} from './settings.js';
import { TaskRunner } from './task-runner.js';
import { TerminalManager } from './terminal-manager.js';
import { PreviewManager } from './preview-manager.js';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let taskRunner: TaskRunner | null = null;
let terminalManager: TerminalManager | null = null;
let previewManager: PreviewManager | null = null;

function createDefaultMenu(): void {
  Menu.setApplicationMenu(null);
}

function createTray(): void {
  // Path resolution for tray icon
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png');

  tray = new Tray(iconPath);
  tray.setToolTip('Murl');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    backgroundColor: '#0A0A0A',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  if (app.isPackaged) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  } else {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devServerUrl) {
      mainWindow.loadURL(devServerUrl);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('murl:health', async () => {
  noop();
  return {
    status: 'healthy',
    coreAlive: true,
    message: 'Electron main is alive, @murl/core is reachable.'
  };
});

ipcMain.handle('murl:pickRepoFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('murl:validateRepo', async (_event, repoPath: string) => {
  if (!repoPath) {
    return { valid: false, reason: 'Path is empty.' };
  }
  
  if (!fs.existsSync(repoPath)) {
    return { valid: false, reason: 'Folder does not exist.' };
  }
  
  try {
    const stat = fs.statSync(repoPath);
    if (!stat.isDirectory()) {
      return { valid: false, reason: 'Path exists but is not a directory.' };
    }
  } catch {
    return { valid: false, reason: 'Folder does not exist.' };
  }

  // Shell validation via git rev-parse --is-inside-work-tree
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', { cwd: repoPath });
    if (stdout.trim() === 'true') {
      return { valid: true };
    }
    return { valid: false, reason: 'Folder exists but is not a git repository.' };
  } catch (err: any) {
    return { valid: false, reason: 'Folder exists but is not a git repository.' };
  }
});

ipcMain.handle('murl:getRecentRepos', async () => {
  return getRecentRepos();
});

ipcMain.handle('murl:addRecentRepo', async (_event, repoPath: string) => {
  return addRecentRepo(repoPath);
});

ipcMain.handle('murl:getRepoBranch', async (_event, repoPath: string) => {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return 'main';
  }
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
    return stdout.trim();
  } catch {
    return 'main';
  }
});

ipcMain.handle('murl:getSettingsStatus', async () => {
  const settings = loadSettings();
  const keys = loadProviderKeys();
  const configuredProviders: Record<string, boolean> = {};
  for (const p of settings.providers || []) {
    configuredProviders[p.id] = !!keys[p.id];
  }
  return {
    configuredProviders,
    settings
  };
});

ipcMain.handle('murl:saveApiKey', async (_event, provider: string, apiKey: string) => {
  saveProviderKey(provider, apiKey);
  if (provider === 'together') {
    process.env.TOGETHER_API_KEY = apiKey;
  }
});

ipcMain.handle('murl:saveHarnessSettings', async (_event, settings: HarnessSettings) => {
  saveSettings(settings);
});

ipcMain.handle('murl:testConnection', async (_event, provider: string, model: string) => {
  const settings = loadSettings();
  const providerConfig = settings.providers?.find(p => p.id === provider);
  if (!providerConfig) {
    return {
      success: false,
      message: `Provider '${provider}' not found in settings.`
    };
  }

  const keys = loadProviderKeys();
  const apiKey = keys[provider];
  if (!apiKey) {
    return {
      success: false,
      message: `No API key configured for ${providerConfig.name}.`
    };
  }

  try {
    const url = `${providerConfig.baseURL.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'health check' }],
        max_tokens: 1
      })
    });

    if (response.ok) {
      return {
        success: true,
        message: `Successfully connected to ${providerConfig.name} API.`
      };
    } else {
      let errText = '';
      try {
        const errJson = await response.json();
        errText = errJson?.error?.message || response.statusText;
      } catch {
        errText = (await response.text()) || response.statusText;
      }
      return {
        success: false,
        message: `API request failed: ${errText}`
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Connection error: ${err.message || String(err)}`
    };
  }
});

ipcMain.handle('murl:launchTask', async (_event, repoPath: string, prompt: string, model: string, provider: string, budgetCap: number, baseBranch?: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  if (!mainWindow) throw new Error('Main window not available.');
  return taskRunner.launch(repoPath, prompt, model, provider, budgetCap, mainWindow.webContents, baseBranch);
});

ipcMain.handle('murl:keepTask', async (_event, taskId: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  // Close any open terminal or preview for this task before removing its worktree
  terminalManager?.close(taskId);
  previewManager?.stop(taskId);
  return taskRunner.keep(taskId);
});

ipcMain.handle('murl:discardTask', async (_event, taskId: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  // Close any open terminal or preview for this task before removing its worktree
  terminalManager?.close(taskId);
  previewManager?.stop(taskId);
  return taskRunner.discard(taskId);
});

ipcMain.handle('murl:openPrTask', async (_event, taskId: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  return taskRunner.openPr(taskId);
});

ipcMain.handle('murl:followUpTask', async (_event, taskId: string, prompt: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  if (!mainWindow) throw new Error('Main window not available.');
  // followUp() is fire-and-forget (the result is streamed via push events),
  // but we await it to surface immediate validation errors (wrong state, missing worktree) back to the renderer.
  await taskRunner.followUp(taskId, prompt, mainWindow.webContents);
});

ipcMain.handle('murl:cancelTask', async (_event, taskId: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  await taskRunner.cancel(taskId);
});

ipcMain.handle('murl:getTaskHistory', async () => {
  if (!taskRunner) return [];
  return taskRunner.getHistory();
});

ipcMain.handle('murl:getTaskRecord', async (_event, taskId: string) => {
  if (!taskRunner) return null;
  return taskRunner.getRecord(taskId);
});

ipcMain.handle('murl:createRecipe', async (_event, recipe: Omit<Recipe, 'id'>) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  return taskRunner.createRecipe(recipe);
});

ipcMain.handle('murl:listRecipes', async () => {
  if (!taskRunner) return [];
  return taskRunner.listRecipes();
});

ipcMain.handle('murl:deleteRecipe', async (_event, id: string) => {
  if (!taskRunner) throw new Error('TaskRunner not initialized.');
  return taskRunner.deleteRecipe(id);
});

app.whenReady().then(() => {
  loadAndSetApiKey();

  // Create shared TaskRunner backed by a persistent SQLite DB in userData
  const dbPath = join(app.getPath('userData'), 'murl-tasks.db');
  taskRunner = new TaskRunner(dbPath);
  terminalManager = new TerminalManager();
  previewManager = new PreviewManager();

  createDefaultMenu();
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up all PTY processes and preview servers before quitting
  terminalManager?.closeAll();
  previewManager?.stopAll();
});

// ── Terminal IPC handlers ────────────────────────────────────────────────────

ipcMain.handle('murl:openTerminal', async (_event, taskId: string, worktreePath: string) => {
  if (!terminalManager) throw new Error('TerminalManager not initialized.');
  if (!mainWindow) throw new Error('Main window not available.');

  // open() enforces worktree existence — throws clearly if the worktree is gone
  const sessionId = terminalManager.open(
    taskId,
    worktreePath,
    (data: string) => {
      try {
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('murl:terminal-data', { taskId, data });
        }
      } catch { /* renderer closed */ }
    },
    (exitCode: number) => {
      try {
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('murl:terminal-exit', { taskId, exitCode });
        }
      } catch { /* renderer closed */ }
    }
  );
  return sessionId;
});

ipcMain.handle('murl:terminalInput', async (_event, taskId: string, data: string) => {
  terminalManager?.write(taskId, data);
});

ipcMain.handle('murl:terminalResize', async (_event, taskId: string, cols: number, rows: number) => {
  terminalManager?.resize(taskId, cols, rows);
});

ipcMain.handle('murl:closeTerminal', async (_event, taskId: string) => {
  terminalManager?.close(taskId);
});

// ── Preview IPC handlers ─────────────────────────────────────────────────────

/** Read package.json and return a suggested dev command. Does NOT run anything. */
ipcMain.handle('murl:getPreviewCommand', async (_event, worktreePath: string) => {
  if (!previewManager) throw new Error('PreviewManager not initialized.');
  return previewManager.getSuggestedCommand(worktreePath);
});

/** Start the dev server for a task. The user must have confirmed the command. */
ipcMain.handle('murl:startPreview', async (_event, taskId: string, worktreePath: string, command: string) => {
  if (!previewManager) throw new Error('PreviewManager not initialized.');
  if (!mainWindow) throw new Error('Main window not available.');

  const push = (channel: string, payload: unknown) => {
    try {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    } catch { /* renderer closed */ }
  };

  // start() enforces worktree existence — throws clearly if the worktree is gone
  previewManager.start(
    taskId,
    worktreePath,
    command,
    (line: string) => push('murl:preview-log', { taskId, line }),
    (url: string) => push('murl:preview-url', { taskId, url }),
    (code: number | null) => push('murl:preview-exit', { taskId, code })
  );
});

/** Stop the running dev server for a task. */
ipcMain.handle('murl:stopPreview', async (_event, taskId: string) => {
  previewManager?.stop(taskId);
});

/** Open the detected preview URL in the default system browser. */
ipcMain.handle('murl:openPreviewUrl', async (_event, url: string) => {
  const { shell } = await import('electron');
  await shell.openExternal(url);
});

ipcMain.handle('murl:openUrl', async (_event, url: string) => {
  const { shell } = await import('electron');
  await shell.openExternal(url);
});

