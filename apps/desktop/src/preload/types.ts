export interface HarnessSettings {
  provider: string;
  model: string;
  defaultRepoPath: string;
  worktreeRoot: string;
  concurrencyCap: number;
  openCodePathOverride: string;
  perTaskBudgetDefault: number;
}

export interface MurlApi {
  healthCheck(): Promise<{
    status: string;
    coreAlive: boolean;
    message: string;
  }>;
  getSettingsStatus(): Promise<{
    apiKeyConfigured: boolean;
    settings: HarnessSettings;
  }>;
  saveApiKey(provider: string, apiKey: string): Promise<void>;
  saveHarnessSettings(settings: HarnessSettings): Promise<void>;
  testConnection(provider: string, model: string): Promise<{
    success: boolean;
    message: string;
  }>;
}
