import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface HarnessSettings {
  provider: string;
  model: string;
  defaultRepoPath: string;
  worktreeRoot: string;
  concurrencyCap: number;
  openCodePathOverride: string;
  perTaskBudgetDefault: number;
}

const SETTINGS_FILE_NAME = 'harness-settings.json';
const API_KEY_FILE_NAME = 'api-key.enc';

export function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

export function getApiKeyPath(): string {
  return path.join(app.getPath('userData'), API_KEY_FILE_NAME);
}

export function getDefaultSettings(): HarnessSettings {
  return {
    provider: 'together',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultRepoPath: '',
    worktreeRoot: path.join(app.getPath('userData'), 'worktrees'),
    concurrencyCap: 3,
    openCodePathOverride: '',
    perTaskBudgetDefault: 10.0,
  };
}

export function loadSettings(): HarnessSettings {
  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) {
    const defaults = getDefaultSettings();
    saveSettings(defaults);
    return defaults;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...getDefaultSettings(),
      ...parsed
    };
  } catch (err) {
    console.error('Failed to parse settings, returning defaults:', err);
    return getDefaultSettings();
  }
}

export function saveSettings(settings: HarnessSettings): void {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

export function loadAndSetApiKey(): void {
  const filePath = getApiKeyPath();
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    const encryptedBuffer = fs.readFileSync(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(encryptedBuffer);
      process.env.TOGETHER_API_KEY = decrypted;
    } else {
      console.warn('Encryption is not available, cannot decrypt API key.');
    }
  } catch (err) {
    console.error('Failed to decrypt and set API key:', err);
  }
}

export function saveApiKey(apiKey: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not supported on this platform. Cannot store API key securely.');
  }
  const encryptedBuffer = safeStorage.encryptString(apiKey);
  const filePath = getApiKeyPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, encryptedBuffer);
  process.env.TOGETHER_API_KEY = apiKey;
}

export function isApiKeyConfigured(): boolean {
  const filePath = getApiKeyPath();
  return fs.existsSync(filePath);
}
