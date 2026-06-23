import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import { join } from 'path';
import { noop } from '@murl/core';
import {
  loadAndSetApiKey,
  loadSettings,
  saveSettings,
  saveApiKey,
  isApiKeyConfigured,
  HarnessSettings
} from './settings.js';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

ipcMain.handle('murl:getSettingsStatus', async () => {
  const settings = loadSettings();
  const apiKeyConfigured = isApiKeyConfigured();
  return {
    apiKeyConfigured,
    settings
  };
});

ipcMain.handle('murl:saveApiKey', async (_event, provider: string, apiKey: string) => {
  saveApiKey(apiKey);
});

ipcMain.handle('murl:saveHarnessSettings', async (_event, settings: HarnessSettings) => {
  saveSettings(settings);
});

ipcMain.handle('murl:testConnection', async (_event, provider: string, model: string) => {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      message: 'No API key configured.'
    };
  }

  try {
    const url = 'https://api.together.xyz/v1/chat/completions';
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
        message: 'Successfully connected to Together AI API.'
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

app.whenReady().then(() => {
  loadAndSetApiKey();
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
