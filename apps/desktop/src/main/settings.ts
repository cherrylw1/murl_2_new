import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface RecentRepo {
  path: string;
  displayName: string;
}

export interface HarnessSettings {
  provider: string;
  model: string;
  defaultRepoPath: string;
  worktreeRoot: string;
  concurrencyCap: number;
  openCodePathOverride: string;
  perTaskBudgetDefault: number;
  recentRepos: RecentRepo[];
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
    recentRepos: [],
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

export function normalizePath(p: string): string {
  let resolved = path.resolve(p).replace(/\\/g, '/');
  if (resolved.endsWith('/') && !resolved.endsWith(':/')) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

export function addRecentRepo(repoPath: string): RecentRepo[] {
  const settings = loadSettings();
  const normalizedTarget = normalizePath(repoPath);
  const normalizedTargetLower = normalizedTarget.toLowerCase();

  // Filter out duplicates (checking normalized, case-insensitive)
  const list = (settings.recentRepos || []).filter(item => {
    return normalizePath(item.path).toLowerCase() !== normalizedTargetLower;
  });

  const displayName = path.basename(normalizedTarget) || normalizedTarget;
  
  // Add new one to the front
  list.unshift({
    path: normalizedTarget,
    displayName
  });

  // Limit list to 10 items
  const updatedList = list.slice(0, 10);
  
  saveSettings({
    ...settings,
    recentRepos: updatedList
  });

  return updatedList;
}

export function getRecentRepos(): RecentRepo[] {
  const settings = loadSettings();
  return settings.recentRepos || [];
}
