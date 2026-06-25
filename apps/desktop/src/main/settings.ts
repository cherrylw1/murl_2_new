import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface RecentRepo {
  path: string;
  displayName: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseURL: string;
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
  providers: ProviderConfig[];
  budgetGuardAction: 'warn' | 'halt';
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
    budgetGuardAction: 'warn',
    providers: [
      {
        id: 'together',
        name: 'Together',
        baseURL: 'https://api.together.xyz/v1'
      },
      {
        id: 'openai',
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1'
      }
    ]
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
    const merged = {
      ...getDefaultSettings(),
      ...parsed
    };
    if (!merged.providers || merged.providers.length === 0) {
      merged.providers = getDefaultSettings().providers;
    }
    return merged;
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

export function getProviderKeysPath(): string {
  return path.join(app.getPath('userData'), 'provider-keys.enc');
}

export function loadProviderKeys(): Record<string, string> {
  const filePath = getProviderKeysPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const encryptedBuffer = fs.readFileSync(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(encryptedBuffer);
      return JSON.parse(decrypted);
    } else {
      console.warn('Encryption is not available, cannot decrypt provider keys.');
    }
  } catch (err) {
    console.error('Failed to decrypt and parse provider keys:', err);
  }
  return {};
}

export function saveProviderKey(providerId: string, apiKey: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not supported on this platform. Cannot store API key securely.');
  }
  const keys = loadProviderKeys();
  keys[providerId] = apiKey;
  const encryptedBuffer = safeStorage.encryptString(JSON.stringify(keys));
  const filePath = getProviderKeysPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, encryptedBuffer);
}

export function migrateOldTogetherKey(): void {
  const oldPath = getApiKeyPath();
  if (fs.existsSync(oldPath)) {
    try {
      const encryptedBuffer = fs.readFileSync(oldPath);
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(encryptedBuffer);
        saveProviderKey('together', decrypted);
        try {
          fs.rmSync(oldPath);
        } catch {}
        console.log('Successfully migrated Together API key to generalized provider keys.');
      }
    } catch (err) {
      console.error('Failed to migrate old Together API key:', err);
    }
  }
}

export function loadAndSetApiKey(): void {
  migrateOldTogetherKey();
  const keys = loadProviderKeys();
  if (keys.together) {
    process.env.TOGETHER_API_KEY = keys.together;
  }
}

export function saveApiKey(apiKey: string): void {
  saveProviderKey('together', apiKey);
  process.env.TOGETHER_API_KEY = apiKey;
}

export function isApiKeyConfigured(): boolean {
  migrateOldTogetherKey();
  const keys = loadProviderKeys();
  return !!keys.together;
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
