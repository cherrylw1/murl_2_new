import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  HarnessSettings,
  MurlEvent,
  PersistedTask,
  RecentRepo,
  TaskCancelledPayload,
  TaskCompletePayload,
  TaskEventPayload,
  TaskFailedPayload,
  TaskRecord,
} from '../../preload/types.js';
import ThreePaneTaskDetail from './ThreePaneTaskDetail.js';
import GlyphWall from './GlyphWall.js';

// ─── Local types ──────────────────────────────────────────────────────────────

interface HealthStatus {
  status: string;
  coreAlive: boolean;
  message: string;
}

type TabType = 'tasks' | 'recipes' | 'history' | 'settings';
type TaskRunState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';


// ─── Active-grid transition rule ──────────────────────────────────────────────
// A task is "active" (shown in the dashboard grid) if:
//   running | queued
//   completed AND outcome === null (pending keep/discard decision)
//   failed | cancelled AND NOT in dismissedTaskIds
// Once decided (outcome !== null) it lives in History only.

function isActiveTask(t: PersistedTask, dismissed: Set<string>): boolean {
  if (t.status === 'running' || t.status === 'queued') return true;
  if (t.status === 'completed' && t.outcome === null) return true;
  if ((t.status === 'failed' || t.status === 'cancelled') && !dismissed.has(t.taskId)) return true;
  return false;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  // System
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('tasks');

  // Launcher / repo selection
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);
  const [activeRepo, setActiveRepo] = useState<RecentRepo | null>(null);
  const [taskDescription, setTaskDescription] = useState<string>('');
  const [taskBranch, setTaskBranch] = useState<string>('');
  const [taskModel, setTaskModel] = useState<string>('');
  const [launcherError, setLauncherError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);

  // Dashboard / grid state
  const [taskHistory, setTaskHistory] = useState<PersistedTask[]>([]);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());
  const [tickNow, setTickNow] = useState<number>(Date.now());

  // Inspecting a task (detail view opened from grid tile)
  const [inspectingTaskId, setInspectingTaskId] = useState<string | null>(null);
  const [inspectingRecord, setInspectingRecord] = useState<TaskRecord | null>(null);
  const [inspectingLiveEvents, setInspectingLiveEvents] = useState<MurlEvent[]>([]);
  const [inspectingDiff, setInspectingDiff] = useState<string>('');
  const [inspectingError, setInspectingError] = useState<string>('');

  // History tab (separate navigation context)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskRecord, setSelectedTaskRecord] = useState<TaskRecord | null>(null);

  // Settings
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [provider, setProvider] = useState<string>('together');
  const [model, setModel] = useState<string>('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  const [defaultRepoPath, setDefaultRepoPath] = useState<string>('');
  const [worktreeRoot, setWorktreeRoot] = useState<string>('');
  const [concurrencyCap, setConcurrencyCap] = useState<number>(3);
  const [openCodePathOverride, setOpenCodePathOverride] = useState<string>('');
  const [perTaskBudgetDefault, setPerTaskBudgetDefault] = useState<number>(10.0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  // Ref for current inspecting task id — avoids stale closure in event handlers
  const inspectingTaskIdRef = useRef<string | null>(null);
  inspectingTaskIdRef.current = inspectingTaskId;

  // ─── Data fetchers ──────────────────────────────────────────────────────────

  const fetchSettings = useCallback(() => {
    window.murl.getSettingsStatus()
      .then(({ apiKeyConfigured, settings }) => {
        setApiKeyConfigured(apiKeyConfigured);
        setProvider(settings.provider);
        setModel(settings.model);
        setDefaultRepoPath(settings.defaultRepoPath);
        setWorktreeRoot(settings.worktreeRoot);
        setConcurrencyCap(settings.concurrencyCap);
        setOpenCodePathOverride(settings.openCodePathOverride);
        setPerTaskBudgetDefault(settings.perTaskBudgetDefault);
        setRecentRepos(settings.recentRepos || []);
        setTaskModel(settings.model);
      })
      .catch((err) => setError(err.message || String(err)));
  }, []);

  const fetchTaskHistory = useCallback(() => {
    window.murl.getTaskHistory()
      .then(setTaskHistory)
      .catch((err) => console.error('Failed to load task history:', err));
  }, []);

  // ─── Boot ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    window.murl.healthCheck()
      .then(setHealth)
      .catch((err) => setError(err.message || String(err)));
    fetchSettings();
    fetchTaskHistory();
  }, [fetchSettings, fetchTaskHistory]);

  // ─── Ticking elapsed timer (1 s resolution) ─────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Push-event subscriptions (all tasks, not just one) ─────────────────────

  useEffect(() => {
    const handleEvent = (payload: TaskEventPayload) => {
      // Always refresh the grid so statuses + queue positions update live
      fetchTaskHistory();
      // Stream into the detail view if this is the currently inspected task
      if (payload.taskId === inspectingTaskIdRef.current) {
        setInspectingLiveEvents((prev) => [...prev, payload.event]);
      }
    };

    const handleComplete = (payload: TaskCompletePayload) => {
      fetchTaskHistory();
      if (payload.taskId === inspectingTaskIdRef.current) {
        setInspectingDiff(payload.diff);
        window.murl.getTaskRecord(payload.taskId)
          .then((r) => { if (r) setInspectingRecord(r); })
          .catch(() => {});
      }
    };

    const handleFailed = (payload: TaskFailedPayload) => {
      fetchTaskHistory();
      if (payload.taskId === inspectingTaskIdRef.current) {
        setInspectingError(payload.error);
        window.murl.getTaskRecord(payload.taskId)
          .then((r) => { if (r) setInspectingRecord(r); })
          .catch(() => {});
      }
    };

    const handleCancelled = (payload: TaskCancelledPayload) => {
      fetchTaskHistory();
      if (payload.taskId === inspectingTaskIdRef.current) {
        window.murl.getTaskRecord(payload.taskId)
          .then((r) => { if (r) setInspectingRecord(r); })
          .catch(() => {});
      }
    };

    window.murl.onTaskEvent(handleEvent);
    window.murl.onTaskComplete(handleComplete);
    window.murl.onTaskFailed(handleFailed);
    window.murl.onTaskCancelled(handleCancelled);

    return () => {
      window.murl.offTaskEvent(handleEvent);
      window.murl.offTaskComplete(handleComplete);
      window.murl.offTaskFailed(handleFailed);
      window.murl.offTaskCancelled(handleCancelled);
    };
  }, [fetchTaskHistory]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      if (apiKeyInput.trim()) {
        await window.murl.saveApiKey(provider, apiKeyInput.trim());
        setApiKeyConfigured(true);
        setApiKeyInput('');
      }
      await window.murl.saveHarnessSettings({
        provider, model, defaultRepoPath, worktreeRoot,
        concurrencyCap: Number(concurrencyCap),
        openCodePathOverride,
        perTaskBudgetDefault: Number(perTaskBudgetDefault),
        recentRepos,
      } as HarnessSettings);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: unknown) {
      setSaveStatus('error');
      setError((err as Error).message || String(err));
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await window.murl.testConnection(provider, model);
      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage((err as Error).message || String(err));
    }
  };

  const handleImportRepo = async () => {
    setLauncherError(null);
    try {
      const folderPath = await window.murl.pickRepoFolder();
      if (!folderPath) return;
      const validation = await window.murl.validateRepo(folderPath);
      if (!validation.valid) {
        setLauncherError(validation.reason || 'Invalid repository folder.');
        return;
      }
      const updatedList = await window.murl.addRecentRepo(folderPath);
      setRecentRepos(updatedList);
      const display = folderPath.split(/[/\\]/).pop() || folderPath;
      setActiveRepo({ path: folderPath, displayName: display });
      const branchName = await window.murl.getRepoBranch(folderPath);
      setTaskBranch(branchName);
    } catch (err: unknown) {
      setLauncherError((err as Error).message || String(err));
    }
  };

  const handleSelectRecentRepo = async (repo: RecentRepo) => {
    setLauncherError(null);
    setActiveRepo(repo);
    try {
      const branchName = await window.murl.getRepoBranch(repo.path);
      setTaskBranch(branchName);
    } catch {
      setTaskBranch('main');
    }
  };

  const handleLaunchTask = async () => {
    setLauncherError(null);
    if (!activeRepo) {
      setLauncherError('Please select or import a git repository first.');
      return;
    }
    if (!taskDescription.trim()) {
      setLauncherError('Please enter a description of the task.');
      return;
    }
    setIsLaunching(true);
    try {
      await window.murl.launchTask(activeRepo.path, taskDescription, taskModel, taskBranch);
      // Clear the prompt after a successful launch so the form is ready for the next task
      setTaskDescription('');
      fetchTaskHistory();
    } catch (err: unknown) {
      setLauncherError((err as Error).message || String(err));
    } finally {
      setIsLaunching(false);
    }
  };

  // Open a task in the full detail pane (from a grid tile click)
  const handleInspectTask = async (taskId: string) => {
    try {
      const record = await window.murl.getTaskRecord(taskId);
      if (!record) return;
      setInspectingTaskId(taskId);
      setInspectingRecord(record);
      setInspectingLiveEvents(record.events || []);
      setInspectingDiff(record.diff || '');
      setInspectingError(
        record.task.status === 'failed'
          ? ((record.events.find((e) => e.type === 'status' && (e as any).error) as any)?.error || 'Task failed')
          : ''
      );
    } catch (err) {
      console.error('Failed to load task record:', err);
    }
  };

  // Back from detail pane to dashboard
  const handleBackToDashboard = () => {
    setInspectingTaskId(null);
    setInspectingRecord(null);
    setInspectingLiveEvents([]);
    setInspectingDiff('');
    setInspectingError('');
    fetchTaskHistory();
  };

  const handleDismissTask = (taskId: string) => {
    setDismissedTaskIds((prev) => new Set([...prev, taskId]));
  };

  const handleCancelTaskFromGrid = async (taskId: string) => {
    try {
      await window.murl.cancelTask(taskId);
    } catch (err: unknown) {
      console.error('Failed to cancel task:', (err as Error).message);
    }
  };

  // ─── Derived state ──────────────────────────────────────────────────────────

  const healthState = error ? 'error' : health ? 'active' : 'idle';

  // Sort: running first, queued, completed-pending, then terminal
  const statusOrder: Record<string, number> = {
    running: 0, queued: 1, completed: 2, failed: 3, cancelled: 4,
  };
  const activeTasks = taskHistory
    .filter((t) => isActiveTask(t, dismissedTaskIds))
    .sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5));

  const runningCount = taskHistory.filter((t) => t.status === 'running').length;
  const queuedCount  = taskHistory.filter((t) => t.status === 'queued').length;
  const doneCount    = taskHistory.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  ).length;

  // Live run-state for the inspected task (derived from taskHistory, not stale state)
  const inspectingTaskLive = inspectingTaskId
    ? taskHistory.find((t) => t.taskId === inspectingTaskId)
    : null;
  const inspectingRunState: TaskRunState = (inspectingTaskLive?.status as TaskRunState) ?? 'idle';

  // History tab — shows only tasks that have definitively ended.
  // Transition rule (must match isActiveTask complement):
  //   - completed + outcome !== null → decided, moved to history
  //   - failed / cancelled → always in history (no decision needed)
  //   - completed + outcome === null → still on Glyph Wall, NOT in history yet
  //   - running / queued → never in history
  const historyTasks = taskHistory.filter((t) => {
    if (t.status === 'running' || t.status === 'queued') return false;
    if (t.status === 'completed' && t.outcome === null) return false; // still active
    return true; // failed, cancelled, or completed+decided
  });

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-screen h-screen bg-ink bg-dotgrid bg-[size:8px_8px] text-chalk flex flex-col select-none overflow-hidden p-6">

      {/* Header */}
      <header className="flex items-center justify-between h-8 border-b border-aluminium/10 pb-4">
        <div className="text-display-dot font-dot tracking-wider text-chalk select-none">
          MURL
        </div>
        <div className="text-label text-aluminium select-none">
          MURL · CODING HARNESS
        </div>
        <div className="flex items-center gap-3">
          <span className="text-label text-aluminium select-none">SYSTEM STATE:</span>
          <div className="flex items-center gap-2 bg-carbon/50 px-3 py-1 rounded border border-aluminium/10">
            <div
              className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                healthState === 'idle'
                  ? 'bg-aluminium'
                  : healthState === 'active'
                    ? 'bg-chalk shadow-active animate-breath'
                    : 'bg-signal shadow-signal animate-pulse-signal'
              }`}
            />
            <span className={`text-label font-medium ${
              healthState === 'idle'
                ? 'text-aluminium'
                : healthState === 'active'
                  ? 'text-chalk'
                  : 'text-signal'
            }`}>
              {healthState === 'idle' ? 'STANDBY' : healthState === 'active' ? 'ACTIVE' : 'ERROR'}
            </span>
          </div>
        </div>
      </header>

      {/* Main workspace */}
      <main className="flex-1 flex gap-6 mt-6 overflow-hidden">

        {/* Sidebar */}
        <nav className="panel w-64 p-6 flex flex-col justify-between">
          <div className="flex flex-col gap-3">
            <div className="text-label text-aluminium mb-2 px-4">NAVIGATION</div>
            {(['tasks', 'recipes', 'history', 'settings'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab !== 'history') {
                    setSelectedTaskId(null);
                    setSelectedTaskRecord(null);
                  }
                }}
                className={`w-full text-left py-3 px-4 rounded transition-taste text-label ${
                  activeTab === tab
                    ? 'bg-carbon text-chalk border border-aluminium/20'
                    : 'text-aluminium hover:text-chalk hover:bg-carbon/50 border border-transparent'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="border-t border-aluminium/10 pt-4 flex flex-col gap-1 px-2 select-none">
            <div className="text-label text-aluminium/60 font-semibold">WORKSPACE</div>
            <div className="text-data text-aluminium/80 truncate">murl_2_new</div>
          </div>
        </nav>

        {/* Workspace panel */}
        <section className="panel flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* ── TASKS TAB ───────────────────────────────────────────────── */}
            {activeTab === 'tasks' && (

              /* ── DETAIL VIEW (tile was clicked) ── */
              inspectingTaskId && inspectingRecord ? (
                <div className="flex-1 flex flex-col justify-between h-full overflow-hidden p-8">
                  <ThreePaneTaskDetail
                    task={inspectingRecord.task}
                    events={inspectingLiveEvents}
                    diff={inspectingDiff}
                    runState={inspectingRunState}
                    errorMessage={inspectingError || undefined}
                    onFollowUp={
                      inspectingRunState === 'completed' && inspectingRecord.task.outcome === null
                        ? async (prompt) => {
                            await window.murl.followUpTask(inspectingRecord.task.taskId, prompt);
                          }
                        : undefined
                    }
                    onBack={handleBackToDashboard}
                    onCancel={
                      inspectingRunState === 'running' || inspectingRunState === 'queued'
                        ? async () => { await handleCancelTaskFromGrid(inspectingTaskId); }
                        : undefined
                    }
                  />
                </div>
              ) : (

              /* ── DASHBOARD (default landing surface) ── */
              <div className="flex-1 flex overflow-hidden h-full">

                {/* Left column — Launcher */}
                <div className="w-80 border-r border-aluminium/10 flex flex-col overflow-y-auto p-8 gap-5 shrink-0">
                  <div>
                    <div className="text-label text-aluminium mb-1">LAUNCHER</div>
                    <h2 className="text-title text-chalk font-semibold">New Task</h2>
                  </div>

                  {launcherError && (
                    <div className="bg-carbon/50 border border-signal/30 p-3 rounded flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-signal shadow-signal animate-pulse-signal shrink-0" />
                      <span className="text-data text-signal text-xs">{launcherError}</span>
                    </div>
                  )}

                  {/* Repository selector */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Git Repository</label>
                    <select
                      id="launcher-repo-select"
                      value={activeRepo ? activeRepo.path : ''}
                      onChange={(e) => {
                        const found = recentRepos.find((r) => r.path === e.target.value);
                        if (found) handleSelectRecentRepo(found);
                        else setActiveRepo(null);
                      }}
                      className="w-full bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                    >
                      <option value="">— Select Repository —</option>
                      {recentRepos.map((repo) => (
                        <option key={repo.path} value={repo.path}>
                          {repo.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleImportRepo}
                      className="w-full px-3 py-2 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste"
                    >
                      Import Repo
                    </button>
                  </div>

                  {/* Task description */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Task Prompt</label>
                    <textarea
                      id="launcher-prompt"
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      placeholder="e.g. Add capitalize(str) and write a vitest test…"
                      rows={5}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-body text-chalk focus:border-chalk outline-none resize-none"
                    />
                  </div>

                  {/* Base branch */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Base Branch</label>
                    <input
                      id="launcher-branch"
                      type="text"
                      value={taskBranch}
                      onChange={(e) => setTaskBranch(e.target.value)}
                      placeholder="main"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Model override */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Model</label>
                    <input
                      id="launcher-model"
                      type="text"
                      value={taskModel}
                      onChange={(e) => setTaskModel(e.target.value)}
                      list="together-models-launcher"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <datalist id="together-models-launcher">
                      <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                      <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                      <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                      <option value="deepseek-ai/DeepSeek-V3" />
                    </datalist>
                  </div>

                  {/* Launch button */}
                  <button
                    id="launch-task-btn"
                    onClick={handleLaunchTask}
                    disabled={isLaunching || !activeRepo || !taskDescription.trim()}
                    className="w-full px-4 py-3 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active disabled:opacity-40 disabled:cursor-not-allowed transition-taste"
                  >
                    {isLaunching ? 'Launching…' : 'Launch Task'}
                  </button>
                </div>

                {/* Right column — Glyph Wall */}
                <div className="flex-1 flex flex-col overflow-hidden p-8 gap-5">

                  {/* Summary bar — quiet, informational */}
                  <div className="flex items-center justify-between shrink-0">
                    <div>
                      <div className="text-label text-aluminium mb-1">GLYPH WALL</div>
                      <h2 className="text-title text-chalk font-semibold">Active Tasks</h2>
                    </div>
                    <div id="dashboard-summary" className="flex items-center gap-3 bg-carbon/40 border border-aluminium/10 px-4 py-2 rounded text-label">
                      <span className="font-dot text-[11px] text-chalk">{runningCount}</span>
                      <span className="text-aluminium/60">running</span>
                      <span className="text-aluminium/30">·</span>
                      <span className="font-dot text-[11px] text-chalk/60">{queuedCount}</span>
                      <span className="text-aluminium/60">queued</span>
                      <span className="text-aluminium/30">·</span>
                      <span className="font-dot text-[11px] text-aluminium/50">{doneCount}</span>
                      <span className="text-aluminium/60">done</span>
                    </div>
                  </div>

                  {/* The Wall — the signature moment */}
                  <GlyphWall
                    tasks={activeTasks}
                    tickNow={tickNow}
                    onInspect={handleInspectTask}
                    onDismiss={handleDismissTask}
                    onCancel={handleCancelTaskFromGrid}
                  />
                </div>
              </div>
              )
            )}

            {/* ── RECIPES TAB ─────────────────────────────────────────────── */}
            {activeTab === 'recipes' && (
              <div className="flex-1 flex flex-col justify-between p-8">
                <div>
                  <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                  <h2 className="text-title text-chalk mb-6">Available Recipes</h2>
                  <div className="flex flex-col gap-3">
                    {[
                      { name: 'Git Refactor', desc: 'Refactor imports, rename variables, or clean styling.' },
                      { name: 'Test Suite Generator', desc: 'Generate comprehensive tests for source files.' },
                      { name: 'Documentation Writer', desc: 'Scan source files and write README or documentation pages.' },
                    ].map((recipe) => (
                      <div key={recipe.name} className="flex justify-between items-center p-4 bg-carbon/40 rounded border border-aluminium/10">
                        <div>
                          <div className="text-body font-semibold text-chalk">{recipe.name}</div>
                          <div className="text-data text-aluminium text-xs mt-1">{recipe.desc}</div>
                        </div>
                        <button className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste">
                          Load
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                  <button className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste">
                    Custom Recipe
                  </button>
                </div>
              </div>
            )}

            {/* ── HISTORY TAB ─────────────────────────────────────────────── */}
            {activeTab === 'history' && (
              selectedTaskId && selectedTaskRecord ? (
                <div className="flex-1 flex flex-col justify-between h-full overflow-hidden p-8">
                  <ThreePaneTaskDetail
                    task={selectedTaskRecord.task}
                    events={selectedTaskRecord.events}
                    diff={selectedTaskRecord.diff || ''}
                    runState={selectedTaskRecord.task.status as TaskRunState}
                    errorMessage={
                      selectedTaskRecord.task.status === 'failed'
                        ? (selectedTaskRecord.events.find((e) => e.type === 'status' && (e as any).error) as any)?.error ||
                          'Task execution failed'
                        : undefined
                    }
                    onFollowUp={
                      selectedTaskRecord.task.status === 'completed' && selectedTaskRecord.task.outcome === null
                        ? async (prompt) => {
                            await window.murl.followUpTask(selectedTaskRecord.task.taskId, prompt);
                            // Refresh the record so the updated diff + events are shown
                            const updated = await window.murl.getTaskRecord(selectedTaskRecord.task.taskId);
                            if (updated) setSelectedTaskRecord(updated);
                          }
                        : undefined
                    }
                    onBack={() => {
                      setSelectedTaskId(null);
                      setSelectedTaskRecord(null);
                      fetchTaskHistory();
                    }}
                    onCancel={
                      selectedTaskRecord.task.status === 'running' || selectedTaskRecord.task.status === 'queued'
                        ? async () => {
                            try {
                              await window.murl.cancelTask(selectedTaskRecord.task.taskId);
                              const record = await window.murl.getTaskRecord(selectedTaskRecord.task.taskId);
                              setSelectedTaskRecord(record);
                              fetchTaskHistory();
                            } catch (err) {
                              console.error('Failed to cancel task:', err);
                            }
                          }
                        : undefined
                    }
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-between p-8">
                  <div>
                    <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                    <h2 className="text-title text-chalk mb-6">Recent Runs</h2>

                    {historyTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center border border-dashed border-aluminium/10 rounded-lg py-16 px-4 bg-carbon/20">
                        <p className="text-data text-aluminium text-center max-w-sm">
                          No run history found. Run a task to see history and cost logs.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 max-w-xl">
                        {historyTasks.map((t) => {
                          // Duration in seconds, if both timestamps available
                          const durationSecs = t.completedAt && t.createdAt
                            ? Math.round((t.completedAt - t.createdAt) / 1000)
                            : null;
                          const durationStr = durationSecs !== null
                            ? durationSecs >= 60
                              ? `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s`
                              : `${durationSecs}s`
                            : null;

                          return (
                          <div
                            key={t.taskId}
                            onClick={async () => {
                              try {
                                const record = await window.murl.getTaskRecord(t.taskId);
                                if (record) {
                                  setSelectedTaskId(t.taskId);
                                  setSelectedTaskRecord(record);
                                }
                              } catch (err) {
                                console.error('Failed to load task record:', err);
                              }
                            }}
                            className="p-4 bg-carbon/40 rounded border border-aluminium/10 flex flex-col gap-2 hover:border-aluminium/35 hover:bg-carbon/60 cursor-pointer transition-taste"
                          >
                            {/* Row header: status dot + label + outcome badge + timestamp */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  t.status === 'completed' ? 'bg-chalk shadow-active' :
                                  t.status === 'failed'    ? 'bg-signal shadow-signal' :
                                                            'bg-aluminium'
                                }`} />
                                <span className={`text-label text-xs font-semibold ${
                                  t.status === 'completed' ? 'text-chalk' :
                                  t.status === 'failed'    ? 'text-signal' :
                                                            'text-aluminium/60'
                                }`}>
                                  {t.status.toUpperCase()}
                                </span>
                                {t.outcome && (
                                  <span className={`text-label text-[9px] px-1.5 py-0.5 rounded border font-mono select-none ${
                                    t.outcome === 'kept'
                                      ? 'border-aluminium/20 text-chalk bg-carbon/50 shadow-active'
                                      : 'border-transparent text-aluminium/55'
                                  }`}>
                                    {t.outcome.toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                {durationStr && (
                                  <span className="font-dot text-[9px] text-aluminium/50 tabular-nums">{durationStr}</span>
                                )}
                                <span className="text-data text-aluminium/40 text-xs">
                                  {new Date(t.completedAt ?? t.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </div>

                            {/* Prompt — truncated */}
                            <div className="text-body text-chalk text-xs line-clamp-2 leading-relaxed">{t.prompt}</div>

                            {/* Meta: model · branch */}
                            <div className="text-data text-aluminium/50 text-xs truncate">
                              {t.model} · {t.branch ?? t.baseBranch ?? '—'}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                    <button
                      onClick={fetchTaskHistory}
                      className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste"
                    >
                      Refresh History
                    </button>
                  </div>
                </div>
              )
            )}

            {/* ── SETTINGS TAB ────────────────────────────────────────────── */}
            {activeTab === 'settings' && (
              <div className="flex-1 flex flex-col justify-between h-full overflow-hidden p-8">
                <div className="flex-1 overflow-y-auto pr-2 min-h-0 flex flex-col gap-6 max-w-xl">
                  <div>
                    <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                    <h2 className="text-title text-chalk mb-6 font-semibold">Configuration</h2>
                  </div>

                  {/* API Key */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <label className="text-label text-aluminium">Together API Key</label>
                      {apiKeyConfigured && (
                        <div className="flex items-center gap-2 bg-well px-2.5 py-1 rounded border border-aluminium/10">
                          <div className="w-2 h-2 rounded-full bg-chalk shadow-active animate-breath" />
                          <span className="text-micro-dot font-semibold text-chalk tracking-wider">KEY PERSISTED</span>
                        </div>
                      )}
                    </div>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={apiKeyConfigured ? '••••••••••••••••••••••••••••••••' : 'Enter Together API key'}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <span className="text-xs text-aluminium/60">
                      {apiKeyConfigured
                        ? 'A key is securely saved. Enter a new key to overwrite it.'
                        : 'Provide your Together AI API key to enable remote LLM execution.'}
                    </span>
                  </div>

                  {/* Provider */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Provider</label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                    >
                      <option value="together">Together AI</option>
                    </select>
                  </div>

                  {/* Model */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Model</label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      list="together-models"
                      placeholder="Select or type a model ID"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <datalist id="together-models">
                      <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                      <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                      <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                      <option value="deepseek-ai/DeepSeek-V3" />
                    </datalist>
                  </div>

                  {/* Default repo path */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Git Repository Path</label>
                    <input
                      type="text"
                      value={defaultRepoPath}
                      onChange={(e) => setDefaultRepoPath(e.target.value)}
                      placeholder="e.g. C:/Content/murl_2_new"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Worktree root */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Worktrees Root Directory</label>
                    <input
                      type="text"
                      value={worktreeRoot}
                      onChange={(e) => setWorktreeRoot(e.target.value)}
                      placeholder="e.g. C:/Users/name/.murl/worktrees"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Concurrency cap */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Concurrency Cap</label>
                    <input
                      type="number"
                      value={concurrencyCap}
                      onChange={(e) => setConcurrencyCap(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1" max="20"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* OpenCode binary override */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">OpenCode Binary Path Override (Optional)</label>
                    <input
                      type="text"
                      value={openCodePathOverride}
                      onChange={(e) => setOpenCodePathOverride(e.target.value)}
                      placeholder="Leave empty to use 'opencode' on PATH"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <span className="text-xs text-aluminium/60">
                      If empty: checks OPENCODE_BIN_PATH env var, then falls back to &apos;opencode&apos; on PATH.
                    </span>
                  </div>

                  {/* Per-task budget */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Per-Task Cost Budget (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={perTaskBudgetDefault}
                      onChange={(e) => setPerTaskBudgetDefault(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                      min="0.01"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-aluminium/10 pt-6 mt-6">
                  <div className="flex gap-4">
                    <button
                      onClick={handleSave}
                      disabled={saveStatus === 'saving'}
                      className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active disabled:opacity-50 transition-taste"
                    >
                      {saveStatus === 'saving' ? 'Saving…' : 'Save Config'}
                    </button>
                    <button
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing'}
                      className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 disabled:opacity-50 transition-taste"
                    >
                      {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                    </button>
                  </div>

                  {(testStatus !== 'idle' || testMessage || saveStatus !== 'idle') && (
                    <div className="flex items-center gap-3 bg-carbon/50 px-4 py-2 rounded border border-aluminium/10 max-w-sm">
                      <div className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                        testStatus === 'testing' || saveStatus === 'saving'
                          ? 'bg-aluminium animate-breath shadow-active'
                          : testStatus === 'success' || saveStatus === 'success'
                            ? 'bg-chalk shadow-active animate-breath'
                            : testStatus === 'error' || saveStatus === 'error'
                              ? 'bg-signal shadow-signal animate-pulse-signal'
                              : 'bg-aluminium'
                      }`} />
                      <span className="text-data text-xs truncate max-w-[280px]">
                        {testStatus === 'testing' && 'Connecting to API…'}
                        {testStatus === 'success' && (testMessage || 'Connection successful')}
                        {testStatus === 'error' && `Failed: ${testMessage}`}
                        {saveStatus === 'saving' && 'Persisting settings…'}
                        {saveStatus === 'success' && 'Settings saved successfully.'}
                        {saveStatus === 'error' && 'Failed to save settings.'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* IPC diagnostic footer */}
          <footer className="border-t border-aluminium/10 p-6 flex flex-col gap-2 shrink-0">
            <div className="text-label text-aluminium select-none">IPC DIAGNOSTIC LOG</div>
            <div className="bg-well p-4 rounded border border-aluminium/10 text-data text-chalk select-text">
              {error ? (
                <span className="text-signal">{error}</span>
              ) : health ? (
                <span>
                  {`[${new Date().toISOString()}] IPC OK: `}
                  <span className="text-aluminium">{health.message}</span>
                </span>
              ) : (
                <span className="text-aluminium">Loading system bridge status…</span>
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
