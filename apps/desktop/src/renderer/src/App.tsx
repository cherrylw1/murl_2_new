import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ProviderConfig,
  Recipe,
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
  const [taskBudgetCap, setTaskBudgetCap] = useState<string>('10.0');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [showSaveRecipeModal, setShowSaveRecipeModal] = useState(false);
  const [recipeNameInput, setRecipeNameInput] = useState('');
  const [recipeDescInput, setRecipeDescInput] = useState('');
  const [launcherError, setLauncherError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);

  // Bake-off states
  const [bakeOffMode, setBakeOffMode] = useState<boolean>(false);
  const [bakeOffModels, setBakeOffModels] = useState<Array<{ model: string; provider: string }>>([]);
  const [newBakeOffProvider, setNewBakeOffProvider] = useState<string>('together');
  const [newBakeOffModel, setNewBakeOffModel] = useState<string>('meta-llama/Llama-3.3-70B-Instruct-Turbo');

  // Custom Window chrome maximized state
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

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
  const [configuredProviders, setConfiguredProviders] = useState<Record<string, boolean>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<string>('together');
  const [taskProvider, setTaskProvider] = useState<string>('together');
  const [model, setModel] = useState<string>('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  const [defaultRepoPath, setDefaultRepoPath] = useState<string>('');
  const [worktreeRoot, setWorktreeRoot] = useState<string>('');
  const [concurrencyCap, setConcurrencyCap] = useState<number>(3);
  const [openCodePathOverride, setOpenCodePathOverride] = useState<string>('');
  const [perTaskBudgetDefault, setPerTaskBudgetDefault] = useState<number>(10.0);
  const [budgetGuardAction, setBudgetGuardAction] = useState<'warn' | 'halt'>('warn');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [testStatuses, setTestStatuses] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});

  // Ref for current inspecting task id — avoids stale closure in event handlers
  const inspectingTaskIdRef = useRef<string | null>(null);
  inspectingTaskIdRef.current = inspectingTaskId;

  // ─── Data fetchers ──────────────────────────────────────────────────────────

  const fetchSettings = useCallback(() => {
    window.murl.getSettingsStatus()
      .then(({ configuredProviders, settings }) => {
        setConfiguredProviders(configuredProviders);
        setProvider(settings.provider);
        setTaskProvider(settings.provider);
        setModel(settings.model);
        setDefaultRepoPath(settings.defaultRepoPath);
        setWorktreeRoot(settings.worktreeRoot);
        setConcurrencyCap(settings.concurrencyCap);
        setOpenCodePathOverride(settings.openCodePathOverride);
        setPerTaskBudgetDefault(settings.perTaskBudgetDefault);
        setTaskBudgetCap(String(settings.perTaskBudgetDefault));
        setBudgetGuardAction(settings.budgetGuardAction || 'warn');
        setRecentRepos(settings.recentRepos || []);
        setTaskModel(settings.model);
        setProviders(settings.providers || []);
      })
      .catch((err) => setError(err.message || String(err)));
  }, []);

  const fetchTaskHistory = useCallback(() => {
    window.murl.getTaskHistory()
      .then(setTaskHistory)
      .catch((err) => console.error('Failed to load task history:', err));
  }, []);

  const fetchRecipes = useCallback(() => {
    window.murl.listRecipes()
      .then(setRecipes)
      .catch((err) => console.error('Failed to load recipes:', err));
  }, []);

  // ─── Boot ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    window.murl.healthCheck()
      .then(setHealth)
      .catch((err) => setError(err.message || String(err)));
    fetchSettings();
    fetchTaskHistory();
    fetchRecipes();
  }, [fetchSettings, fetchTaskHistory, fetchRecipes]);

  // ─── Ticking elapsed timer (1 s resolution) ─────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const max = await window.murl.isWindowMaximized();
        setIsMaximized(max);
      } catch {}
    };
    window.addEventListener('resize', checkMaximized);
    checkMaximized();
    return () => window.removeEventListener('resize', checkMaximized);
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
      // Save all non-empty API keys for configured providers
      for (const [pId, key] of Object.entries(apiKeyInputs)) {
        if (key.trim()) {
          await window.murl.saveApiKey(pId, key.trim());
        }
      }
      setApiKeyInputs({});

      await window.murl.saveHarnessSettings({
        provider, model, defaultRepoPath, worktreeRoot,
        concurrencyCap: Number(concurrencyCap),
        openCodePathOverride,
        perTaskBudgetDefault: Number(perTaskBudgetDefault),
        recentRepos,
        providers,
        budgetGuardAction,
      } as HarnessSettings);
      setSaveStatus('success');
      fetchSettings();
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: unknown) {
      setSaveStatus('error');
      setError((err as Error).message || String(err));
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestStatuses(prev => ({ ...prev, [providerId]: 'testing' }));
    setTestMessages(prev => ({ ...prev, [providerId]: '' }));
    try {
      const typedKey = apiKeyInputs[providerId];
      if (typedKey && typedKey.trim()) {
        await window.murl.saveApiKey(providerId, typedKey.trim());
        setConfiguredProviders(prev => ({ ...prev, [providerId]: true }));
        setApiKeyInputs(prev => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
      }

      // Find connection test model from settings/defaults
      const testModel = providerId === 'together'
        ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
        : providerId === 'openai'
          ? 'gpt-4o-mini'
          : 'gpt-4o-mini'; // fallback for custom providers

      const result = await window.murl.testConnection(providerId, testModel);
      setTestStatuses(prev => ({ ...prev, [providerId]: result.success ? 'success' : 'error' }));
      setTestMessages(prev => ({ ...prev, [providerId]: result.message }));
    } catch (err: unknown) {
      setTestStatuses(prev => ({ ...prev, [providerId]: 'error' }));
      setTestMessages(prev => ({ ...prev, [providerId]: (err as Error).message || String(err) }));
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
    const cap = parseFloat(taskBudgetCap);
    if (isNaN(cap) || cap <= 0) {
      setLauncherError('Please enter a valid positive budget cap.');
      return;
    }
    if (bakeOffMode && bakeOffModels.length < 2) {
      setLauncherError('Add at least 2 models for a bake-off.');
      return;
    }
    setIsLaunching(true);
    try {
      if (bakeOffMode) {
        const groupId = crypto.randomUUID ? crypto.randomUUID() : 'group-' + Date.now() + '-' + Math.random().toString(36).substring(7);
        for (const item of bakeOffModels) {
          await window.murl.launchTask(activeRepo.path, taskDescription, item.model, item.provider, cap, taskBranch || undefined, groupId);
        }
      } else {
        await window.murl.launchTask(activeRepo.path, taskDescription, taskModel, taskProvider, cap, taskBranch || undefined);
      }
      // Clear the prompt after a successful launch so the form is ready for the next task
      setTaskDescription('');
      fetchTaskHistory();
    } catch (err: unknown) {
      setLauncherError((err as Error).message || String(err));
    } finally {
      setIsLaunching(false);
    }
  };

  const handleSaveRecipe = async () => {
    if (!activeRepo) return;
    if (!recipeNameInput.trim()) {
      alert('Please enter a recipe name.');
      return;
    }
    try {
      const budget = taskBudgetCap ? parseFloat(taskBudgetCap) : null;
      await window.murl.createRecipe({
        name: recipeNameInput.trim(),
        description: recipeDescInput.trim() || null,
        repoPath: activeRepo.path,
        prompt: taskDescription,
        model: taskModel,
        provider: taskProvider,
        baseBranch: taskBranch || null,
        budgetCap: isNaN(budget as any) || budget === null ? null : budget,
      });
      setShowSaveRecipeModal(false);
      setRecipeNameInput('');
      setRecipeDescInput('');
      fetchRecipes();
    } catch (err: any) {
      console.error('Failed to save recipe:', err);
    }
  };

  const handleOneClickRunRecipe = async (recipe: Recipe) => {
    try {
      const res = await window.murl.validateRepo(recipe.repoPath);
      if (!res.valid) {
        alert(`The repository path "${recipe.repoPath}" is not valid or no longer exists.`);
        return;
      }
      
      let baseBranch = recipe.baseBranch;
      if (!baseBranch) {
        try {
          baseBranch = await window.murl.getRepoBranch(recipe.repoPath);
        } catch {
          baseBranch = 'main';
        }
      }

      const cap = recipe.budgetCap !== null && recipe.budgetCap !== undefined
        ? recipe.budgetCap
        : perTaskBudgetDefault;

      await window.murl.launchTask(recipe.repoPath, recipe.prompt, recipe.model, recipe.provider, cap, baseBranch || 'main');
      
      fetchTaskHistory();
      setActiveTab('tasks');
    } catch (err: any) {
      alert(`Failed to run recipe: ${err.message || String(err)}`);
    }
  };

  const handleLoadRecipe = (recipe: Recipe) => {
    const foundRepo = recentRepos.find((r) => r.path === recipe.repoPath) || {
      path: recipe.repoPath,
      displayName: recipe.repoPath.split(/[/\\]/).pop() || 'Repo'
    };
    setActiveRepo(foundRepo);
    setTaskDescription(recipe.prompt);
    setTaskModel(recipe.model);
    setTaskProvider(recipe.provider);
    setTaskBranch(recipe.baseBranch || '');
    setTaskBudgetCap(recipe.budgetCap !== null && recipe.budgetCap !== undefined ? String(recipe.budgetCap) : String(perTaskBudgetDefault));
    setActiveTab('tasks');
  };

  const handleDeleteRecipe = async (id: string) => {
    if (confirm('Are you sure you want to delete this recipe?')) {
      try {
        await window.murl.deleteRecipe(id);
        fetchRecipes();
      } catch (err: any) {
        console.error('Failed to delete recipe:', err);
      }
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

  const handleAddBakeOffModel = () => {
    if (!newBakeOffModel.trim()) return;
    setBakeOffModels((prev) => {
      const exists = prev.some((m) => m.provider === newBakeOffProvider && m.model === newBakeOffModel.trim());
      if (exists) return prev;
      return [...prev, { provider: newBakeOffProvider, model: newBakeOffModel.trim() }];
    });
  };

  const handleRemoveBakeOffModel = (index: number) => {
    setBakeOffModels((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleInspectSiblingFromActive = async (taskId: string) => {
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
      console.error('Failed to load sibling record for active view:', err);
    }
  };

  const handleInspectSiblingFromHistory = async (taskId: string) => {
    try {
      const record = await window.murl.getTaskRecord(taskId);
      if (!record) return;
      setSelectedTaskId(taskId);
      setSelectedTaskRecord(record);
    } catch (err) {
      console.error('Failed to load sibling record for history view:', err);
    }
  };

  const handleKeepGroupFromActive = async (taskId: string) => {
    const siblings = inspectingGroupSiblings;
    const otherSiblings = siblings.filter((s: PersistedTask) => s.taskId !== taskId);

    const confirmMsg = `Keeping this variant will merge its changes and automatically discard the other ${otherSiblings.length} variant(s) in this bake-off group. Do you want to continue?`;
    if (!confirm(confirmMsg)) return;

    try {
      setIsLaunching(true);
      const result = await window.murl.keepTask(taskId);
      if (!result.success) {
        alert(result.message || 'Failed to keep task changes.');
        return;
      }

      for (const sibling of otherSiblings) {
        if (sibling.status === 'running' || sibling.status === 'queued') {
          await window.murl.cancelTask(sibling.taskId);
        }
        await window.murl.discardTask(sibling.taskId);
      }

      fetchTaskHistory();
      handleBackToDashboard();
    } catch (err: any) {
      alert(`Error keeping group: ${err.message || String(err)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleKeepGroupFromHistory = async (taskId: string) => {
    const siblings = selectedGroupSiblings;
    const otherSiblings = siblings.filter((s: PersistedTask) => s.taskId !== taskId);

    const confirmMsg = `Keeping this variant will merge its changes and automatically discard the other ${otherSiblings.length} variant(s) in this bake-off group. Do you want to continue?`;
    if (!confirm(confirmMsg)) return;

    try {
      setIsLaunching(true);
      const result = await window.murl.keepTask(taskId);
      if (!result.success) {
        alert(result.message || 'Failed to keep task changes.');
        return;
      }

      for (const sibling of otherSiblings) {
        if (sibling.status === 'running' || sibling.status === 'queued') {
          await window.murl.cancelTask(sibling.taskId);
        }
        await window.murl.discardTask(sibling.taskId);
      }

      fetchTaskHistory();
      const winnerRecord = await window.murl.getTaskRecord(taskId);
      if (winnerRecord) {
        setSelectedTaskRecord(winnerRecord);
      }
    } catch (err: any) {
      alert(`Error keeping group: ${err.message || String(err)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleDiscardGroupFromActive = async () => {
    const siblings = inspectingGroupSiblings;
    const confirmMsg = `Are you sure you want to discard all ${siblings.length} variant(s) in this bake-off group?`;
    if (!confirm(confirmMsg)) return;

    try {
      setIsLaunching(true);
      for (const sibling of siblings) {
        if (sibling.status === 'running' || sibling.status === 'queued') {
          await window.murl.cancelTask(sibling.taskId);
        }
        await window.murl.discardTask(sibling.taskId);
      }
      fetchTaskHistory();
      handleBackToDashboard();
    } catch (err: any) {
      alert(`Error discarding group: ${err.message || String(err)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleDiscardGroupFromHistory = async () => {
    const siblings = selectedGroupSiblings;
    const confirmMsg = `Are you sure you want to discard all ${siblings.length} variant(s) in this bake-off group?`;
    if (!confirm(confirmMsg)) return;

    try {
      setIsLaunching(true);
      for (const sibling of siblings) {
        if (sibling.status === 'running' || sibling.status === 'queued') {
          await window.murl.cancelTask(sibling.taskId);
        }
        await window.murl.discardTask(sibling.taskId);
      }
      fetchTaskHistory();
      setSelectedTaskId(null);
      setSelectedTaskRecord(null);
    } catch (err: any) {
      alert(`Error discarding group: ${err.message || String(err)}`);
    } finally {
      setIsLaunching(false);
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

  // Derived state for inspecting siblings in groups
  const inspectingGroupSiblings = useMemo(() => {
    const groupId = inspectingRecord?.task.groupId;
    if (!groupId) return [];
    return taskHistory
      .filter((t) => t.groupId === groupId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [taskHistory, inspectingRecord?.task.groupId]);

  const selectedGroupSiblings = useMemo(() => {
    const groupId = selectedTaskRecord?.task.groupId;
    if (!groupId) return [];
    return taskHistory
      .filter((t) => t.groupId === groupId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [taskHistory, selectedTaskRecord?.task.groupId]);

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

  const isMac = window.murl.platform === 'darwin';

  return (
    <div className="w-screen h-screen bg-ink bg-dotgrid bg-[size:8px_8px] text-chalk flex flex-col select-none overflow-hidden">
      {/* Custom Title Bar */}
      <div
        className="h-10 flex items-center justify-between bg-carbon border-b border-aluminium/10 select-none shrink-0 px-4"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-2">
          {/* Mac traffic light offset */}
          <span className={`font-dot text-[10px] text-chalk/50 tracking-widest ${isMac ? 'pl-20' : ''}`}>
            MURL
          </span>
        </div>
        <div className="text-[10px] font-mono text-aluminium/60 truncate max-w-xs md:max-w-md select-none">
          {activeRepo ? activeRepo.displayName : 'No repository active'}
        </div>

        {/* Window Controls (Windows/Linux only; hidden on Darwin) */}
        {!isMac ? (
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <button
              onClick={() => window.murl.minimizeWindow()}
              className="w-8 h-8 rounded flex items-center justify-center hover:bg-aluminium/10 text-aluminium hover:text-chalk transition-taste cursor-pointer"
              title="Minimize"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button
              onClick={() => window.murl.maximizeWindow()}
              className="w-8 h-8 rounded flex items-center justify-center hover:bg-aluminium/10 text-aluminium hover:text-chalk transition-taste cursor-pointer"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
              )}
            </button>
            <button
              onClick={() => window.murl.closeWindow()}
              className="w-8 h-8 rounded flex items-center justify-center hover:bg-signal/20 text-aluminium hover:text-signal transition-taste cursor-pointer"
              title="Close"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        ) : (
          <div className="w-[72px]" />
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-6 pt-4">
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
                    worktreePath={
                      inspectingRecord.task.outcome !== 'kept' && inspectingRecord.task.outcome !== 'discarded'
                        ? inspectingRecord.task.worktreePath
                        : undefined
                    }
                    onFollowUp={
                      inspectingRunState === 'completed' && inspectingRecord.task.outcome !== 'kept' && inspectingRecord.task.outcome !== 'discarded'
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
                    groupSiblings={inspectingGroupSiblings}
                    onInspectSibling={handleInspectSiblingFromActive}
                    onKeepGroup={handleKeepGroupFromActive}
                    onDiscardGroup={handleDiscardGroupFromActive}
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

                  {/* Bake-off Mode toggle */}
                  <div className="flex items-center gap-2 py-1 select-none">
                    <input
                      type="checkbox"
                      id="launcher-bake-off-toggle"
                      checked={bakeOffMode}
                      onChange={(e) => setBakeOffMode(e.target.checked)}
                      className="w-3.5 h-3.5 accent-chalk cursor-pointer"
                    />
                    <label htmlFor="launcher-bake-off-toggle" className="text-label text-aluminium cursor-pointer hover:text-chalk transition-taste">
                      Bake-off Mode (Multi-Model)
                    </label>
                  </div>

                  {bakeOffMode ? (
                    <div className="flex flex-col gap-3 bg-carbon/25 border border-aluminium/10 rounded p-3">
                      <label className="text-label text-aluminium font-semibold">Bake-off Models ({bakeOffModels.length})</label>
                      {bakeOffModels.length === 0 ? (
                        <div className="text-data text-aluminium/50 text-xs italic">No models added yet.</div>
                      ) : (
                        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                          {bakeOffModels.map((item, idx) => {
                            const pName = providers.find((p) => p.id === item.provider)?.name || item.provider;
                            return (
                              <div key={idx} className="flex items-center justify-between bg-carbon/50 border border-aluminium/10 px-2.5 py-1.5 rounded text-xs">
                                <span className="text-chalk truncate max-w-[170px]" title={`${pName}: ${item.model}`}>
                                  <span className="text-aluminium/60 font-mono mr-1">[{pName}]</span>
                                  {item.model.split('/').pop()}
                                </span>
                                <button
                                  onClick={() => handleRemoveBakeOffModel(idx)}
                                  className="text-aluminium/40 hover:text-signal text-[10px] font-mono ml-2 shrink-0"
                                >
                                  REMOVE
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="border-t border-aluminium/5 pt-2 mt-1 flex flex-col gap-2">
                        <div className="flex gap-2">
                          <div className="flex-1 flex flex-col gap-1">
                            <span className="text-[10px] text-aluminium/60">Provider</span>
                            <select
                              value={newBakeOffProvider}
                              onChange={(e) => {
                                const nextP = e.target.value;
                                setNewBakeOffProvider(nextP);
                                if (nextP === 'together') {
                                  setNewBakeOffModel('meta-llama/Llama-3.3-70B-Instruct-Turbo');
                                } else if (nextP === 'openai') {
                                  setNewBakeOffModel('gpt-4o-mini');
                                }
                              }}
                              className="bg-well border border-aluminium/20 rounded p-1.5 text-xs text-chalk outline-none cursor-pointer"
                            >
                              {providers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-[1.5] flex flex-col gap-1">
                            <span className="text-[10px] text-aluminium/60">Model</span>
                            <input
                              type="text"
                              value={newBakeOffModel}
                              onChange={(e) => setNewBakeOffModel(e.target.value)}
                              list="together-models-bakeoff"
                              className="bg-well border border-aluminium/20 rounded p-1.5 text-xs text-chalk outline-none"
                            />
                            <datalist id="together-models-bakeoff">
                              {newBakeOffProvider === 'openai' ? (
                                <>
                                  <option value="gpt-4o" />
                                  <option value="gpt-4o-mini" />
                                  <option value="gpt-3.5-turbo" />
                                </>
                              ) : (
                                <>
                                  <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                                  <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                                  <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                                  <option value="deepseek-ai/DeepSeek-V3" />
                                </>
                              )}
                            </datalist>
                          </div>
                        </div>
                        <button
                          onClick={handleAddBakeOffModel}
                          className="w-full py-1.5 rounded bg-carbon border border-aluminium/20 text-xs text-chalk hover:bg-carbon/70"
                        >
                          + Add Model
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Provider */}
                      <div className="flex flex-col gap-2">
                        <label className="text-label text-aluminium">Provider</label>
                        <select
                          id="launcher-provider"
                          value={taskProvider}
                          onChange={(e) => {
                            const nextP = e.target.value;
                            setTaskProvider(nextP);
                            if (nextP === 'together') {
                              setTaskModel('meta-llama/Llama-3.3-70B-Instruct-Turbo');
                            } else if (nextP === 'openai') {
                              setTaskModel('gpt-4o-mini');
                            }
                          }}
                          className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                        >
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
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
                          {taskProvider === 'openai' ? (
                            <>
                              <option value="gpt-4o" />
                              <option value="gpt-4o-mini" />
                              <option value="gpt-3.5-turbo" />
                            </>
                          ) : (
                            <>
                              <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                              <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                              <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                              <option value="deepseek-ai/DeepSeek-V3" />
                            </>
                          )}
                        </datalist>
                      </div>
                    </>
                  )}

                  {/* Budget Cap ($) */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Budget Cap ($)</label>
                    <input
                      id="launcher-budget-cap"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={taskBudgetCap}
                      onChange={(e) => setTaskBudgetCap(e.target.value)}
                      placeholder="10.00"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Launch button */}
                  <button
                    id="launch-task-btn"
                    onClick={handleLaunchTask}
                    disabled={isLaunching || !activeRepo || !taskDescription.trim()}
                    className="w-full px-4 py-3 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active disabled:opacity-40 disabled:cursor-not-allowed transition-taste mb-2"
                  >
                    {isLaunching ? 'Launching…' : bakeOffMode ? 'Run Bake-off' : 'Launch Task'}
                  </button>

                  <button
                    id="save-recipe-btn"
                    onClick={() => {
                      if (activeRepo && taskDescription.trim()) {
                        setShowSaveRecipeModal(true);
                      }
                    }}
                    disabled={!activeRepo || !taskDescription.trim()}
                    className="w-full px-4 py-2.5 rounded bg-transparent border border-aluminium/15 text-label text-aluminium hover:text-chalk hover:border-aluminium/30 disabled:opacity-40 disabled:cursor-not-allowed transition-taste"
                  >
                    Save as Recipe
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

            {activeTab === 'recipes' && (
              <div className="flex-1 flex flex-col p-8 overflow-y-auto min-h-0">
                <div>
                  <div className="text-label text-aluminium mb-1">LIBRARY</div>
                  <h2 className="text-title text-chalk mb-6">Saved Recipes</h2>
                </div>

                {recipes.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
                    <div className="text-center max-w-sm">
                      <p className="text-data text-aluminium/60 text-sm leading-relaxed mb-4">
                        No recipes saved yet. Compose a task in the launcher pane on the left, then click &quot;Save as Recipe&quot; to save it here for easy re-running.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recipes.map((recipe) => (
                      <div key={recipe.id} className="bg-carbon/40 border border-aluminium/10 rounded-lg p-5 flex flex-col justify-between gap-4 transition-taste hover:border-aluminium/20 hover:shadow-active">
                        <div>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-body font-semibold text-chalk text-sm">{recipe.name}</h3>
                              {recipe.description && (
                                <p className="text-data text-aluminium/70 text-xs mt-1 leading-relaxed">
                                  {recipe.description}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => handleDeleteRecipe(recipe.id)}
                              className="text-aluminium/40 hover:text-signal transition-taste text-xs p-1 font-mono"
                              title="Delete Recipe"
                            >
                              DELETE
                            </button>
                          </div>

                          <div className="flex flex-col gap-2 mt-4 border-t border-aluminium/5 pt-3">
                            <div className="flex items-center text-[10px] font-mono">
                              <span className="text-aluminium/45 w-16 uppercase">Repo:</span>
                              <span className="text-aluminium/85 truncate flex-1" title={recipe.repoPath}>
                                {recipe.repoPath.split(/[/\\]/).pop()}
                              </span>
                            </div>
                            <div className="flex items-center text-[10px] font-mono">
                              <span className="text-aluminium/45 w-16 uppercase">Provider:</span>
                              <span className="text-aluminium/85 truncate flex-1">{recipe.provider}</span>
                            </div>
                            <div className="flex items-center text-[10px] font-mono">
                              <span className="text-aluminium/45 w-16 uppercase">Model:</span>
                              <span className="text-aluminium/85 truncate flex-1">{recipe.model}</span>
                            </div>
                            {recipe.baseBranch && (
                              <div className="flex items-center text-[10px] font-mono">
                                <span className="text-aluminium/45 w-16 uppercase">Branch:</span>
                                <span className="text-aluminium/85 truncate flex-1">{recipe.baseBranch}</span>
                              </div>
                            )}
                            {recipe.budgetCap !== null && recipe.budgetCap !== undefined && (
                              <div className="flex items-center text-[10px] font-mono">
                                <span className="text-aluminium/45 w-16 uppercase">Budget:</span>
                                <span className="text-aluminium/85 truncate flex-1">${recipe.budgetCap.toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex items-start text-[10px] font-mono mt-1">
                              <span className="text-aluminium/45 w-16 uppercase shrink-0">Prompt:</span>
                              <span className="text-chalk/60 line-clamp-2 leading-relaxed flex-1 font-sans text-xs">
                                {recipe.prompt}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3 border-t border-aluminium/5 pt-3">
                          <button
                            onClick={() => handleOneClickRunRecipe(recipe)}
                            className="flex-1 px-4 py-2 rounded bg-carbon border border-aluminium/20 text-label text-chalk font-semibold hover:shadow-active transition-taste text-xs text-center"
                          >
                            Run Recipe
                          </button>
                          <button
                            onClick={() => handleLoadRecipe(recipe)}
                            className="px-4 py-2 rounded bg-transparent border border-aluminium/15 text-label text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste text-xs"
                          >
                            Load into Form
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                    worktreePath={
                      selectedTaskRecord.task.outcome !== 'kept' && selectedTaskRecord.task.outcome !== 'discarded'
                        ? selectedTaskRecord.task.worktreePath
                        : undefined
                    }
                    onFollowUp={
                      selectedTaskRecord.task.status === 'completed' && selectedTaskRecord.task.outcome !== 'kept' && selectedTaskRecord.task.outcome !== 'discarded'
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
                    groupSiblings={selectedGroupSiblings}
                    onInspectSibling={handleInspectSiblingFromHistory}
                    onKeepGroup={handleKeepGroupFromHistory}
                    onDiscardGroup={handleDiscardGroupFromHistory}
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
                                    t.outcome === 'kept' || t.outcome === 'pr-opened'
                                      ? 'border-aluminium/20 text-chalk bg-carbon/50 shadow-active'
                                      : 'border-transparent text-aluminium/55'
                                  }`}>
                                    {t.outcome.replace('-', ' ').toUpperCase()}
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

                  {/* Providers List Section */}
                  <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <label className="text-label text-aluminium font-semibold">LLM Providers</label>
                      <button
                        onClick={() => {
                          const newId = `custom-${Date.now()}`;
                          setProviders(prev => [
                            ...prev,
                            { id: newId, name: 'Custom Provider', baseURL: 'https://api.example.com/v1' }
                          ]);
                        }}
                        className="px-3 py-1 rounded bg-carbon border border-aluminium/15 text-xs text-chalk hover:bg-aluminium/5 transition-taste"
                      >
                        + Add Provider
                      </button>
                    </div>

                    <div className="flex flex-col gap-4">
                      {providers.map((p, idx) => {
                        const isConfigured = !!configuredProviders[p.id];
                        const keyInput = apiKeyInputs[p.id] || '';
                        const isDefault = p.id === 'together' || p.id === 'openai';
                        const tStatus = testStatuses[p.id] || 'idle';
                        const tMsg = testMessages[p.id] || '';

                        return (
                          <div key={p.id} className="bg-well border border-aluminium/10 rounded p-4 flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-semibold text-chalk/70 tracking-wider">
                                {isDefault ? `${p.name} (Built-in)` : 'Custom Provider'}
                              </span>
                              {!isDefault && (
                                <button
                                  onClick={() => {
                                    setProviders(prev => prev.filter(prov => prov.id !== p.id));
                                    setApiKeyInputs(prev => {
                                      const next = { ...prev };
                                      delete next[p.id];
                                      return next;
                                    });
                                  }}
                                  className="text-xs text-signal hover:underline"
                                >
                                  Remove
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-aluminium">Provider Name</label>
                                <input
                                  type="text"
                                  value={p.name}
                                  onChange={(e) => {
                                    const newName = e.target.value;
                                    setProviders(prev => prev.map((prov, i) => i === idx ? { ...prov, name: newName } : prov));
                                  }}
                                  disabled={isDefault}
                                  className="bg-carbon border border-aluminium/20 rounded px-2.5 py-1.5 text-xs text-chalk focus:border-chalk outline-none disabled:opacity-60"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-aluminium">Base URL</label>
                                <input
                                  type="text"
                                  value={p.baseURL}
                                  onChange={(e) => {
                                    const newURL = e.target.value;
                                    setProviders(prev => prev.map((prov, i) => i === idx ? { ...prov, baseURL: newURL } : prov));
                                  }}
                                  disabled={isDefault}
                                  className="bg-carbon border border-aluminium/20 rounded px-2.5 py-1.5 text-xs text-chalk focus:border-chalk outline-none disabled:opacity-60"
                                />
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] text-aluminium">API Key</label>
                                {isConfigured && (
                                  <span className="text-[9px] text-chalk font-semibold tracking-wider bg-carbon px-1.5 py-0.5 rounded border border-aluminium/15">KEY PERSISTED</span>
                                )}
                              </div>
                              <input
                                type="password"
                                value={keyInput}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setApiKeyInputs(prev => ({ ...prev, [p.id]: val }));
                                }}
                                placeholder={isConfigured ? '••••••••••••••••••••••••••••••••' : `Enter ${p.name} API key`}
                                className="bg-carbon border border-aluminium/20 rounded px-2.5 py-1.5 text-xs text-chalk focus:border-chalk outline-none"
                              />
                            </div>

                            <div className="flex items-center justify-between mt-1">
                              <button
                                onClick={() => handleTestConnection(p.id)}
                                disabled={tStatus === 'testing'}
                                className="px-3 py-1 rounded bg-carbon border border-aluminium/25 text-[10px] text-chalk hover:bg-aluminium/10 transition-taste disabled:opacity-50"
                              >
                                {tStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                              </button>

                              {tStatus !== 'idle' && (
                                <span className="text-[10px] truncate max-w-[280px]">
                                  {tStatus === 'testing' && <span className="text-aluminium animate-breath">Connecting…</span>}
                                  {tStatus === 'success' && <span className="text-chalk font-semibold">✓ Connected</span>}
                                  {tStatus === 'error' && <span className="text-signal">✗ {tMsg || 'Failed'}</span>}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Default launch provider */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Launch Provider</label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
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

                  {/* Budget guard action */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Budget Guard Action</label>
                    <select
                      value={budgetGuardAction}
                      onChange={(e) => setBudgetGuardAction(e.target.value as 'warn' | 'halt')}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                    >
                      <option value="warn">Warn</option>
                      <option value="halt">Halt</option>
                    </select>
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
                  </div>

                  {saveStatus !== 'idle' && (
                    <div className="flex items-center gap-3 bg-carbon/50 px-4 py-2 rounded border border-aluminium/10 max-w-sm">
                      <div className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                        saveStatus === 'saving'
                          ? 'bg-aluminium animate-breath shadow-active'
                          : saveStatus === 'success'
                            ? 'bg-chalk shadow-active animate-breath'
                            : 'bg-signal shadow-signal animate-pulse-signal'
                      }`} />
                      <span className="text-data text-xs truncate max-w-[280px]">
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
          {/* Save Recipe Modal Overlay */}
          {showSaveRecipeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-carbon border border-aluminium/20 w-[400px] rounded-lg p-6 flex flex-col gap-4 shadow-2xl">
                <div>
                  <h3 className="text-title text-chalk font-semibold mb-1">Save as Recipe</h3>
                  <p className="text-xs text-aluminium/60">Convert this composed task into a reusable template.</p>
                </div>
                
                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-label text-aluminium text-xs">Recipe Name</label>
                  <input
                    type="text"
                    value={recipeNameInput}
                    onChange={(e) => setRecipeNameInput(e.target.value)}
                    placeholder="e.g. Code Refactor"
                    className="bg-well border border-aluminium/20 rounded p-2 text-data text-chalk focus:border-chalk outline-none"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-label text-aluminium text-xs">Description (Optional)</label>
                  <textarea
                    value={recipeDescInput}
                    onChange={(e) => setRecipeDescInput(e.target.value)}
                    placeholder="e.g. Standard vitest tests setup or style refactoring"
                    rows={3}
                    className="bg-well border border-aluminium/20 rounded p-2 text-body text-chalk focus:border-chalk outline-none resize-none"
                  />
                </div>

                <div className="flex gap-3 justify-end mt-2">
                  <button
                    onClick={() => {
                      setShowSaveRecipeModal(false);
                      setRecipeNameInput('');
                      setRecipeDescInput('');
                    }}
                    className="px-4 py-2 rounded bg-transparent border border-aluminium/15 text-label text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRecipe}
                    disabled={!recipeNameInput.trim()}
                    className="px-4 py-2 rounded bg-carbon border border-aluminium/20 text-label text-chalk font-semibold hover:shadow-active disabled:opacity-40 disabled:cursor-not-allowed transition-taste"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}
