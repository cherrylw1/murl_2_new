// ─── Repo / Settings (existing) ──────────────────────────────────────────────

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

export type MurlEvent = MurlStatusEvent | MurlMessageEvent | MurlActionEvent;

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
  outcome: 'kept' | 'discarded' | null;
  queuePosition?: number;
}

export interface TaskRecord {
  task: PersistedTask;
  events: MurlEvent[];
  diff: string | null;
  cost: null;
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
    apiKeyConfigured: boolean;
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
  launchTask(repoPath: string, prompt: string, model: string, baseBranch?: string): Promise<string>;
  cancelTask(taskId: string): Promise<void>;
  getTaskHistory(): Promise<PersistedTask[]>;
  getTaskRecord(taskId: string): Promise<TaskRecord | null>;
  keepTask(taskId: string): Promise<{ success: boolean; message?: string }>;
  discardTask(taskId: string): Promise<{ success: boolean; message?: string }>;

  // Push listeners — subscribe to live task events from the main process
  onTaskEvent(cb: (payload: TaskEventPayload) => void): void;
  offTaskEvent(cb: (payload: TaskEventPayload) => void): void;
  onTaskComplete(cb: (payload: TaskCompletePayload) => void): void;
  offTaskComplete(cb: (payload: TaskCompletePayload) => void): void;
  onTaskFailed(cb: (payload: TaskFailedPayload) => void): void;
  offTaskFailed(cb: (payload: TaskFailedPayload) => void): void;
  onTaskCancelled(cb: (payload: TaskCancelledPayload) => void): void;
  offTaskCancelled(cb: (payload: TaskCancelledPayload) => void): void;
}
