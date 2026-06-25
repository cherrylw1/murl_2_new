export interface ProviderConfig {
  id: string;
  name: string;
  baseURL: string;
}

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
  providers: ProviderConfig[];
  budgetGuardAction: 'warn' | 'halt';
}

// ─── Task event types (mirrors @murl/core — defined here so the renderer
//     never imports core directly, which is unsafe in the renderer context) ────

export type MurlTaskStatus = 'queued' | 'started' | 'running' | 'completed' | 'failed';

export interface MurlStatusEvent {
  type: 'status';
  status: MurlTaskStatus;
  error?: string;
}

interface MurlMessageEvent {
  type: 'message';
  role: 'assistant' | 'user';
  contentType: 'text' | 'reasoning';
  content: string;
  delta?: string;
}

export interface MurlActionEvent {
  type: 'action';
  actionType: 'tool_call' | 'tool_response';
  toolName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface MurlCostEvent {
  type: 'cost';
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type MurlEvent = MurlStatusEvent | MurlMessageEvent | MurlActionEvent | MurlCostEvent;

// ─── Persisted task record (mirrors @murl/core TaskStore types) ───────────────

export interface PersistedTask {
  id: string;
  taskId: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  repoPath?: string;
  prompt: string;
  model: string;
  provider: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  outcome: 'kept' | 'discarded' | 'pr-opened' | null;
  prUrl?: string | null;
  queuePosition?: number;
  budgetCap?: number | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  groupId?: string | null;
}

export interface PersistedCost {
  taskId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  recordedAt: number;
}

export interface TaskRecord {
  task: PersistedTask;
  events: MurlEvent[];
  diff: string | null;
  cost: PersistedCost | null;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string | null;
  repoPath: string;
  prompt: string;
  model: string;
  provider: string;
  baseBranch?: string | null;
  budgetCap?: number | null;
}

// ─── Push-event payloads ──────────────────────────────────────────────────────

export interface TaskEventPayload {
  taskId: string;
  event: MurlEvent;
}

export interface TaskCompletePayload {
  taskId: string;
  diff: string;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
}

export interface TaskCancelledPayload {
  taskId: string;
}

export interface TerminalDataPayload {
  taskId: string;
  data: string;
}

export interface TerminalExitPayload {
  taskId: string;
  exitCode: number;
}

export interface PreviewLogPayload {
  taskId: string;
  line: string;
}

export interface PreviewUrlPayload {
  taskId: string;
  url: string;
}

export interface PreviewExitPayload {
  taskId: string;
  code: number | null;
}

// ─── Full window.murl API surface ─────────────────────────────────────────────

export interface MurlApi {
  // Health / system
  healthCheck(): Promise<{
    status: string;
    coreAlive: boolean;
    message: string;
  }>;

  // Settings
  getSettingsStatus(): Promise<{
    configuredProviders: Record<string, boolean>;
    settings: HarnessSettings;
  }>;
  saveApiKey(provider: string, apiKey: string): Promise<void>;
  saveHarnessSettings(settings: HarnessSettings): Promise<void>;
  testConnection(provider: string, model: string): Promise<{
    success: boolean;
    message: string;
  }>;

  // Repo management
  pickRepoFolder(): Promise<string | null>;
  validateRepo(path: string): Promise<{ valid: boolean; reason?: string }>;
  getRecentRepos(): Promise<RecentRepo[]>;
  addRecentRepo(path: string): Promise<RecentRepo[]>;
  getRepoBranch(path: string): Promise<string>;

  // Task execution
  launchTask(repoPath: string, prompt: string, model: string, provider: string, budgetCap: number, baseBranch?: string, groupId?: string): Promise<string>;
  cancelTask(taskId: string): Promise<void>;
  getTaskHistory(): Promise<PersistedTask[]>;
  getTaskRecord(taskId: string): Promise<TaskRecord | null>;
  getTasksByGroupId(groupId: string): Promise<PersistedTask[]>;
  keepTask(taskId: string): Promise<{ success: boolean; message?: string }>;
  discardTask(taskId: string): Promise<{ success: boolean; message?: string }>;
  openPrTask(taskId: string): Promise<{ success: boolean; prUrl?: string; message?: string }>;
  followUpTask(taskId: string, prompt: string): Promise<void>;

  // Recipes
  createRecipe(recipe: Omit<Recipe, 'id'>): Promise<Recipe>;
  listRecipes(): Promise<Recipe[]>;
  deleteRecipe(id: string): Promise<void>;

  // Terminal (pty)
  openTerminal(taskId: string, worktreePath: string): Promise<string>;
  terminalInput(taskId: string, data: string): Promise<void>;
  terminalResize(taskId: string, cols: number, rows: number): Promise<void>;
  closeTerminal(taskId: string): Promise<void>;

  // Push listeners — subscribe to live task events from the main process
  onTaskEvent(cb: (payload: TaskEventPayload) => void): void;
  offTaskEvent(cb: (payload: TaskEventPayload) => void): void;
  onTaskComplete(cb: (payload: TaskCompletePayload) => void): void;
  offTaskComplete(cb: (payload: TaskCompletePayload) => void): void;
  onTaskFailed(cb: (payload: TaskFailedPayload) => void): void;
  offTaskFailed(cb: (payload: TaskFailedPayload) => void): void;
  onTaskCancelled(cb: (payload: TaskCancelledPayload) => void): void;
  offTaskCancelled(cb: (payload: TaskCancelledPayload) => void): void;

  // Terminal push events
  onTerminalData(cb: (payload: TerminalDataPayload) => void): void;
  offTerminalData(cb: (payload: TerminalDataPayload) => void): void;
  onTerminalExit(cb: (payload: TerminalExitPayload) => void): void;
  offTerminalExit(cb: (payload: TerminalExitPayload) => void): void;

  // Preview (dev server)
  getPreviewCommand(worktreePath: string): Promise<string | null>;
  startPreview(taskId: string, worktreePath: string, command: string): Promise<void>;
  stopPreview(taskId: string): Promise<void>;
  openPreviewUrl(url: string): Promise<void>;
  openUrl(url: string): Promise<void>;

  // Preview push events
  onPreviewLog(cb: (payload: PreviewLogPayload) => void): void;
  offPreviewLog(cb: (payload: PreviewLogPayload) => void): void;
  onPreviewUrl(cb: (payload: PreviewUrlPayload) => void): void;
  offPreviewUrl(cb: (payload: PreviewUrlPayload) => void): void;
  onPreviewExit(cb: (payload: PreviewExitPayload) => void): void;
  offPreviewExit(cb: (payload: PreviewExitPayload) => void): void;

  platform: string;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
}
