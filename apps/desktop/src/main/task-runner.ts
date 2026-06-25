/**
 * task-runner.ts — thin orchestration layer that connects Phase 0's
 * WorktreeManager, OpenCodeAdapter, and TaskStore to the IPC layer.
 *
 * Design rules enforced here:
 * - On SUCCESS:  do NOT remove the worktree/branch (Phase 2.4 needs it to keep/discard)
 * - On FAILURE or CANCELLATION: remove the worktree so nothing is orphaned
 * - 'cancelled' is a distinct TaskStore status from 'failed'
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type { WebContents } from 'electron';
import { exec } from 'child_process';
import { WorktreeManager, OpenCodeAdapter, TaskStore } from '@murl/core';
import type { MurlEvent, PersistedTask, TaskRecord, Recipe } from '@murl/core';
import { loadSettings } from './settings.js';

export let execHook = exec;
export function setExecHook(newExec: typeof exec) {
  execHook = newExec;
}

interface ActiveTask {
  abortController: AbortController;
  /** Set to true by cancel() before aborting so the catch block can write 'cancelled' status */
  wasCancelled: boolean;
  worktreePath: string;
  worktreeManager: WorktreeManager;
}

interface QueuedTask {
  taskId: string;
  repoPath: string;
  prompt: string;
  model: string;
  provider: string;
  budgetCap: number;
  webContents: WebContents;
  baseBranch?: string;
}

export class TaskRunner {
  private activeTasks = new Map<string, ActiveTask>();
  private queue: QueuedTask[] = [];
  private queueProcessing = false;
  private lastStartTimestamp = 0;
  private store: TaskStore;

  constructor(dbPath: string) {
    this.store = new TaskStore(dbPath);
  }

  /**
   * Validates settings for a pending launch, creates the worktree and TaskStore
   * record synchronously (so the IPC call returns a taskId immediately), then
   * fires the actual OpenCode run asynchronously via push IPC events.
   */
  async launch(
    repoPath: string,
    prompt: string,
    model: string,
    provider: string,
    budgetCap: number,
    webContents: WebContents,
    baseBranch?: string,
    groupId?: string
  ): Promise<string> {
    const settings = loadSettings();

    // Worktree root — use the saved setting; default is userData/worktrees
    const worktreeRoot = settings.worktreeRoot;
    if (!worktreeRoot) {
      throw new Error('Worktree root is not configured in settings.');
    }

    const taskId = crypto.randomUUID();

    // Compute expected branchName and worktreePath deterministically for database representation
    const branchName = `murl/task-${taskId}`;
    const worktreePath = path.resolve(worktreeRoot, `task-${taskId}`);

    // Persist initial task record as 'queued'
    this.store.createTask({
      taskId,
      worktreePath,
      branch: branchName,
      baseBranch: baseBranch || 'main',
      repoPath,
      prompt,
      model,
      provider: provider || 'together',
      status: 'queued',
      budgetCap,
      groupId,
    });

    // Notify renderer that it is queued immediately
    try {
      if (!webContents.isDestroyed()) {
        webContents.send('murl:task-event', {
          taskId,
          event: { type: 'status', status: 'queued' },
        });
      }
    } catch {}

    // Add to FIFO queue
    this.queue.push({
      taskId,
      repoPath,
      prompt,
      model,
      provider: provider || 'together',
      budgetCap,
      webContents,
      baseBranch,
    });

    // Fire queue processor asynchronously
    this.processQueue().catch((err) => {
      console.error('[TaskRunner] Error processing queue after launch:', err);
    });

    return taskId;
  }

  private async processQueue(): Promise<void> {
    if (this.queueProcessing) return;
    this.queueProcessing = true;

    try {
      while (this.queue.length > 0) {
        const settings = loadSettings();
        const cap = settings.concurrencyCap || 3;

        if (this.activeTasks.size >= cap) {
          break; // Cap reached, wait for running tasks to complete
        }

        // Calculate required stagger delay
        const now = Date.now();
        const elapsed = now - this.lastStartTimestamp;
        const delay = Math.max(0, 300 - elapsed);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Re-check cap and queue in case they changed during the delay
        if (this.queue.length === 0 || this.activeTasks.size >= cap) {
          break;
        }

        const nextTask = this.queue.shift();
        if (nextTask) {
          // Double check if cancelled while waiting
          const record = this.store.getTask(nextTask.taskId);
          if (!record || record.task.status === 'cancelled') {
            continue;
          }

          // Update last start time
          this.lastStartTimestamp = Date.now();

          // Start execution!
          this._startTask(nextTask).catch((err) => {
            console.error(`[TaskRunner] Failed to start task ${nextTask.taskId}:`, err);
          });
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  private async _startTask(task: QueuedTask): Promise<void> {
    const { taskId, repoPath, prompt, model, provider, webContents, baseBranch } = task;
    const settings = loadSettings();
    const worktreeRoot = settings.worktreeRoot;
    if (!worktreeRoot) {
      throw new Error('Worktree root is not configured in settings.');
    }

    const abortController = new AbortController();
    const worktreePath = path.resolve(worktreeRoot, `task-${taskId}`);
    const worktreeManager = new WorktreeManager(repoPath, worktreeRoot);

    const activeEntry: ActiveTask = {
      abortController,
      wasCancelled: false,
      worktreePath,
      worktreeManager,
    };
    this.activeTasks.set(taskId, activeEntry);

    try {
      const binPath = settings.openCodePathOverride || undefined;
      // Allocate a dynamic random port in safe unprivileged range
      const port = Math.floor(Math.random() * 10000) + 10000;
      const adapter = new OpenCodeAdapter({ binPath, port });

      // Create real git worktree
      const worktree = await worktreeManager.create(taskId, baseBranch);

      // Check if cancelled during worktree creation
      if (activeEntry.wasCancelled || abortController.signal.aborted) {
        // Clean up the worktree we just created
        await worktreeManager.remove(worktree.path).catch(() => {});
        throw new Error('Task was cancelled during startup');
      }

      // Update task status to 'running'
      this.store.updateTaskStatus(taskId, 'running');

      // Notify renderer that it is now running
      try {
        if (!webContents.isDestroyed()) {
          webContents.send('murl:task-event', {
            taskId,
            event: { type: 'status', status: 'running' },
          });
        }
      } catch {}

      // Execute OpenCode run asynchronously
      this._runAsync(
        taskId,
        worktree.path,
        prompt,
        model,
        provider,
        task.budgetCap,
        adapter,
        worktreeManager,
        abortController,
        webContents
      ).catch((err) => {
        console.error('[TaskRunner] Unhandled error in _runAsync:', err);
      });
    } catch (err: any) {
      console.error(`[TaskRunner] Startup of task ${taskId} failed:`, err);
      
      const wasCancelled = activeEntry.wasCancelled;
      const status = wasCancelled ? 'cancelled' : 'failed';
      
      try {
        this.store.updateTaskStatus(taskId, status, Date.now());
      } catch (dbErr) {
        console.error('[TaskRunner] Failed to update task status in DB:', dbErr);
      }

      try {
        if (!webContents.isDestroyed()) {
          if (wasCancelled) {
            webContents.send('murl:task-cancelled', { taskId });
          } else {
            webContents.send('murl:task-failed', {
              taskId,
              error: err.message || String(err),
            });
          }
        }
      } catch {}

      this.activeTasks.delete(taskId);

      // Process next in queue
      this.processQueue().catch((qErr) => {
        console.error('[TaskRunner] Error processing queue after startup failure:', qErr);
      });
    }
  }

  /**
   * Triggers cancellation of an in-flight or queued task.
   */
  async cancel(taskId: string): Promise<void> {
    // 1. Check if the task is currently in the queue
    const queuedIdx = this.queue.findIndex((q) => q.taskId === taskId);
    if (queuedIdx !== -1) {
      const [queuedTask] = this.queue.splice(queuedIdx, 1);
      // Mark cancelled
      this.store.updateTaskStatus(taskId, 'cancelled', Date.now());
      // Notify renderer
      try {
        if (queuedTask.webContents && !queuedTask.webContents.isDestroyed()) {
          queuedTask.webContents.send('murl:task-cancelled', { taskId });
        }
      } catch {}
      return;
    }

    // 2. Check if the task is actively running
    const entry = this.activeTasks.get(taskId);
    if (!entry) {
      return;
    }
    entry.wasCancelled = true;
    entry.abortController.abort();
  }

  getHistory(): PersistedTask[] {
    const list = this.store.listTasks();
    return list.map((task) => {
      if (task.status === 'queued') {
        const idx = this.queue.findIndex((q) => q.taskId === task.taskId);
        if (idx !== -1) {
          return { ...task, queuePosition: idx };
        }
      }
      return task;
    });
  }

  getRecord(taskId: string): TaskRecord | null {
    const record = this.store.getTask(taskId);
    if (!record) return null;

    if (record.task.status === 'queued') {
      const idx = this.queue.findIndex((q) => q.taskId === taskId);
      if (idx !== -1) {
        record.task.queuePosition = idx;
      }
    }
    return record;
  }

  getTasksByGroupId(groupId: string): PersistedTask[] {
    const list = this.store.listTasksByGroupId(groupId);
    return list.map((task) => {
      if (task.status === 'queued') {
        const idx = this.queue.findIndex((q) => q.taskId === task.taskId);
        if (idx !== -1) {
          return { ...task, queuePosition: idx };
        }
      }
      return task;
    });
  }

  async keep(taskId: string): Promise<{ success: boolean; message?: string }> {
    const record = this.store.getTask(taskId);
    if (!record) {
      return { success: false, message: `Task ${taskId} not found` };
    }
    if (record.task.status === 'running') {
      return { success: false, message: 'Cannot keep a running task.' };
    }
    if (record.task.outcome !== null) {
      return { success: false, message: `Task already has outcome: ${record.task.outcome}` };
    }

    const worktreePath = record.task.worktreePath;
    const taskBranch = record.task.branch;
    const baseBranch = record.task.baseBranch || 'main';
    const baseRepoPath = record.task.repoPath || await this.getBaseRepoPath(worktreePath);

    // Git commands execution helpers
    const execInRepo = async (cmd: string) => {
      const { promisify } = await import('util');
      const execAsync = promisify(execHook);
      return execAsync(cmd, { cwd: baseRepoPath });
    };

    let originalHead = '';
    let isDetached = false;

    try {
      // 1. Check if original repo is dirty. If so, refuse to merge
      const { stdout: statusOut } = await execInRepo('git status --porcelain');
      if (statusOut.trim()) {
        return {
          success: false,
          message: 'The base repository has uncommitted changes. Please commit or stash your changes in the base repository first before keeping this task.',
        };
      }

      // 2. Remember original HEAD
      const { stdout: headOut } = await execInRepo('git rev-parse --abbrev-ref HEAD');
      const headAbbrev = headOut.trim();
      if (headAbbrev === 'HEAD') {
        const { stdout: shaOut } = await execInRepo('git rev-parse HEAD');
        originalHead = shaOut.trim();
        isDetached = true;
      } else {
        originalHead = headAbbrev;
      }

      // 3. Checkout baseBranch
      await execInRepo(`git checkout "${baseBranch}"`);

      // 4. Perform git merge
      try {
        await execInRepo(`git merge "${taskBranch}" -m "Merge task branch ${taskBranch} into ${baseBranch}"`);
      } catch (mergeErr: any) {
        // Merge conflict or error! Abort immediately to leave repository clean.
        await execInRepo('git merge --abort').catch(() => {});
        // Switch back to original branch/commit
        await execInRepo(`git checkout "${originalHead}"`);
        return {
          success: false,
          message: `Merge conflict or failure: ${mergeErr.message || String(mergeErr)}`,
        };
      }

      // Merge succeeded! Restore original checked-out HEAD
      await execInRepo(`git checkout "${originalHead}"`);

      // Clean up the worktree and local task branch
      const worktreeManager = new WorktreeManager(baseRepoPath, path.dirname(worktreePath));
      await worktreeManager.remove(worktreePath);

      // Save outcome
      this.store.setOutcome(taskId, 'kept');
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: `Keep failed: ${err.message || String(err)}`,
      };
    }
  }

  async discard(taskId: string): Promise<{ success: boolean; message?: string }> {
    const record = this.store.getTask(taskId);
    if (!record) {
      return { success: false, message: `Task ${taskId} not found` };
    }
    if (record.task.status === 'running') {
      return { success: false, message: 'Cannot discard a running task.' };
    }
    if (record.task.outcome !== null) {
      return { success: false, message: `Task already has outcome: ${record.task.outcome}` };
    }

    const worktreePath = record.task.worktreePath;
    const baseRepoPath = record.task.repoPath || await this.getBaseRepoPath(worktreePath);

    try {
      const worktreeManager = new WorktreeManager(baseRepoPath, path.dirname(worktreePath));
      await worktreeManager.remove(worktreePath);

      this.store.setOutcome(taskId, 'discarded');
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: `Discard failed: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Opens a GitHub PR for a completed, undecided task.
   *
   * This is a mutually exclusive ALTERNATIVE to Keep/Discard — NOT something that
   * happens after Keep. See docs/pr-design-decision.md for the full rationale.
   *
   * Flow:
   * 1. Verify gh CLI is authenticated (gh auth status).
   * 2. Push the task's branch to origin: `git push -u origin <branch>`.
   * 3. Create the PR via `gh pr create`.
   * 4. Store the real PR URL and set outcome = 'pr-opened'.
   * 5. Do NOT touch the worktree — it stays alive for follow-ups.
   */
  async openPr(taskId: string): Promise<{ success: boolean; prUrl?: string; message?: string }> {
    const record = this.store.getTask(taskId);
    if (!record) {
      return { success: false, message: `Task ${taskId} not found.` };
    }
    if (record.task.status === 'running') {
      return { success: false, message: 'Cannot open a PR while the task is still running.' };
    }
    if (record.task.outcome !== null) {
      return {
        success: false,
        message: `Task already has outcome '${record.task.outcome}' — cannot open a PR.`,
      };
    }
    if (!fs.existsSync(record.task.worktreePath)) {
      return {
        success: false,
        message: `Worktree no longer exists at ${record.task.worktreePath}.`,
      };
    }

    const { promisify } = await import('util');
    const execAsync = promisify(execHook);

    const worktreePath = record.task.worktreePath;
    const branch = record.task.branch;
    const baseBranch = record.task.baseBranch || 'main';
    const prompt = record.task.prompt;

    // Helper: run a command in the worktree directory
    const execIn = (cmd: string) => execAsync(cmd, { cwd: worktreePath });

    // 1. Check gh authentication
    try {
      await execIn('gh auth status');
    } catch (authErr: any) {
      // gh auth status exits non-zero when not authenticated
      const msg = (authErr.stderr || authErr.stdout || authErr.message || '').trim();
      return {
        success: false,
        message:
          `GitHub CLI is not authenticated. Run \`gh auth login\` in your terminal first.\n\n` +
          `gh said: ${msg}`,
      };
    }

    // 2. Push the branch to origin
    try {
      await execIn(`git push -u origin "${branch}"`);
    } catch (pushErr: any) {
      const msg = (pushErr.stderr || pushErr.stdout || pushErr.message || '').trim();
      return {
        success: false,
        message: `Failed to push branch '${branch}' to origin:\n\n${msg}`,
      };
    }

    // 3. Build a sensible PR title and body from the task prompt
    const title = prompt.length > 72
      ? prompt.slice(0, 69).trimEnd() + '…'
      : prompt;
    const body =
      `Generated by [Murl](https://github.com/cherrylw1/murl_2_new) — AI-assisted coding agent.\n\n` +
      `**Task prompt:**\n${prompt}`;

    // 4. Create the PR via gh CLI
    let prUrl: string;
    try {
      const { stdout } = await execIn(
        `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --base "${baseBranch}" --head "${branch}"`
      );
      // gh pr create outputs the PR URL as the last line
      prUrl = stdout.trim().split('\n').filter(Boolean).pop() || '';
      if (!prUrl.startsWith('https://')) {
        throw new Error(`Unexpected gh output (expected PR URL, got): ${stdout.trim()}`);
      }
    } catch (prErr: any) {
      const msg = (prErr.stderr || prErr.stdout || prErr.message || '').trim();
      return {
        success: false,
        message: `Failed to create PR:\n\n${msg}`,
      };
    }

    // 5. Persist outcome — do NOT remove worktree
    this.store.setOutcome(taskId, 'pr-opened');
    this.store.setPrUrl(taskId, prUrl);

    return { success: true, prUrl };
  }


  /**
   * Sends a follow-up prompt to an existing completed task's worktree.
   * The task must be completed, have no outcome yet, and its worktree must exist on disk.
   * Runs a fresh OpenCode session against the same worktree (Option B — pragmatic re-prompt).
   * Events are appended to the existing TaskStore record; the diff is recaptured cumulatively.
   */
  async followUp(
    taskId: string,
    prompt: string,
    webContents: WebContents
  ): Promise<void> {
    const record = this.store.getTask(taskId);
    if (!record) {
      throw new Error(`Task ${taskId} not found.`);
    }
    if (record.task.status !== 'completed') {
      throw new Error(`Cannot follow up: task is not in 'completed' state (current: ${record.task.status}).`);
    }
    if (record.task.outcome !== null) {
      throw new Error(`Cannot follow up: task already has an outcome ('${record.task.outcome}') — its worktree has been removed.`);
    }
    if (!fs.existsSync(record.task.worktreePath)) {
      throw new Error(`Cannot follow up: worktree no longer exists at ${record.task.worktreePath}.`);
    }

    const { worktreePath, model, provider } = record.task;
    const abortController = new AbortController();
    const settings = loadSettings();
    const binPath = settings.openCodePathOverride || undefined;
    // Allocate a dynamic random port in safe unprivileged range
    const port = Math.floor(Math.random() * 10000) + 10000;
    const adapter = new OpenCodeAdapter({ binPath, port });

    // Register in activeTasks so cancel() can abort the follow-up
    const activeEntry: ActiveTask = {
      abortController,
      wasCancelled: false,
      worktreePath,
      worktreeManager: new WorktreeManager(record.task.repoPath || worktreePath, path.dirname(worktreePath)),
    };
    this.activeTasks.set(taskId, activeEntry);

    /** Safely push an IPC message to the renderer */
    const push = (channel: string, payload: unknown) => {
      try {
        if (!webContents.isDestroyed()) webContents.send(channel, payload);
      } catch { /* renderer closed */ }
    };

    try {
      // 1. Increment follow-up count and inject a separator event into the stream
      const followUpN = this.store.incrementFollowUpCount(taskId);
      const separatorEvent: MurlEvent = {
        type: 'status',
        status: 'running',
        error: `--- FOLLOW-UP ${followUpN} ---`,
      };
      this.store.appendEvents(taskId, [separatorEvent]);
      // Also push the separator live to the renderer (for users watching the detail view)
      push('murl:task-event', { taskId, event: separatorEvent });

      // 2. Transition back to running in DB + push to renderer
      this.store.updateTaskStatus(taskId, 'running');
      push('murl:task-event', { taskId, event: { type: 'status', status: 'running' } });

      // 3. Execute the follow-up run
      const collectedEvents: MurlEvent[] = [];
      const budgetCap = record.task.budgetCap || 0;
      const onEvent = (event: MurlEvent) => {
        collectedEvents.push(event);
        push('murl:task-event', { taskId, event });

        if (event.type === 'cost') {
          const { tokensIn, tokensOut, costUsd } = event;
          this.store.saveCost(taskId, { tokensIn, tokensOut, costUsd });
          const settings = loadSettings();
          if (costUsd > budgetCap && settings.budgetGuardAction === 'halt') {
            const entry = this.activeTasks.get(taskId);
            if (entry) {
              entry.wasCancelled = true;
            }
            abortController.abort();
          }
        }
      };

      const providerConfig = settings.providers?.find(p => p.id === provider) || {
        id: 'together',
        name: 'Together',
        baseURL: 'https://api.together.xyz/v1'
      };
      const { loadProviderKeys } = await import('./settings.js');
      const keys = loadProviderKeys();
      const apiKeyVal = keys[providerConfig.id] || '';

      const { diff } = await adapter.runTask(
        worktreePath,
        prompt,
        {
          model,
          providerId: providerConfig.id,
          providerName: providerConfig.name,
          providerBaseURL: providerConfig.baseURL,
          apiKeyEnvVarName: `MURL_API_KEY_${taskId}`,
          apiKeyVal
        },
        onEvent,
        abortController.signal
      );

      // 4. SUCCESS — append events, save cumulative diff, mark completed
      if (collectedEvents.length > 0) {
        this.store.appendEvents(taskId, collectedEvents);
      }
      this.store.saveDiff(taskId, diff); // INSERT OR REPLACE — overwrites with cumulative diff
      this.store.updateTaskStatus(taskId, 'completed', Date.now());
      push('murl:task-complete', { taskId, diff });
    } catch (err: any) {
      // 5. FAILURE — mark failed but do NOT remove worktree (original work is still there)
      const wasCancelled = activeEntry.wasCancelled;
      const status = wasCancelled ? 'cancelled' : 'failed';
      this.store.updateTaskStatus(taskId, status, Date.now());
      if (wasCancelled) {
        push('murl:task-cancelled', { taskId });
      } else {
        push('murl:task-failed', { taskId, error: err.message || String(err) });
      }
    } finally {
      this.activeTasks.delete(taskId);
      try { await adapter.stopServer(); } catch { /* ignore */ }
      this.processQueue().catch((qErr) => {
        console.error('[TaskRunner] Error processing queue after follow-up:', qErr);
      });
    }
  }

  private async getBaseRepoPath(worktreePath: string): Promise<string> {
    const { promisify } = await import('util');
    const execAsync = promisify(execHook);
    try {
      const { stdout } = await execAsync('git rev-parse --git-common-dir', { cwd: worktreePath });
      const gitCommonDir = path.resolve(worktreePath, stdout.trim());
      return path.dirname(gitCommonDir);
    } catch {
      // Fallback: parent dir of the worktree directory if git command fails
      return path.dirname(worktreePath);
    }
  }

  private async _runAsync(
    taskId: string,
    worktreePath: string,
    prompt: string,
    model: string,
    providerId: string,
    budgetCap: number,
    adapter: OpenCodeAdapter,
    worktreeManager: WorktreeManager,
    abortController: AbortController,
    webContents: WebContents
  ): Promise<void> {
    /** Safely push an IPC message to the renderer (guards against destroyed webContents) */
    const push = (channel: string, payload: unknown) => {
      try {
        if (!webContents.isDestroyed()) {
          webContents.send(channel, payload);
        }
      } catch {
        // Renderer may have been closed — swallow silently
      }
    };

    // Accumulate events here so we can persist the full batch in all exit paths
    const collectedEvents: MurlEvent[] = [];

    const onEvent = (event: MurlEvent) => {
      collectedEvents.push(event);
      push('murl:task-event', { taskId, event });

      if (event.type === 'cost') {
        const { tokensIn, tokensOut, costUsd } = event;
        this.store.saveCost(taskId, { tokensIn, tokensOut, costUsd });
        const settings = loadSettings();
        if (costUsd > budgetCap && settings.budgetGuardAction === 'halt') {
          const entry = this.activeTasks.get(taskId);
          if (entry) {
            entry.wasCancelled = true;
          }
          abortController.abort();
        }
      }
    };

    try {
      const settings = loadSettings();
      const providerConfig = settings.providers?.find(p => p.id === providerId) || {
        id: 'together',
        name: 'Together',
        baseURL: 'https://api.together.xyz/v1'
      };
      
      const { loadProviderKeys } = await import('./settings.js');
      const keys = loadProviderKeys();
      const apiKeyVal = keys[providerConfig.id] || '';

      const { diff } = await adapter.runTask(
        worktreePath,
        prompt,
        {
          model,
          providerId: providerConfig.id,
          providerName: providerConfig.name,
          providerBaseURL: providerConfig.baseURL,
          apiKeyEnvVarName: `MURL_API_KEY_${taskId}`,
          apiKeyVal
        },
        onEvent,
        abortController.signal
      );

      // — SUCCESS PATH —
      // Persist events + diff. Do NOT remove the worktree — Phase 2.4 needs it.
      if (collectedEvents.length > 0) {
        this.store.appendEvents(taskId, collectedEvents);
      }
      this.store.saveDiff(taskId, diff);
      this.store.updateTaskStatus(taskId, 'completed', Date.now());

      push('murl:task-complete', { taskId, diff });
    } catch (err: any) {
      // — FAILURE / CANCELLATION PATH —
      const entry = this.activeTasks.get(taskId);
      const wasCancelled = entry?.wasCancelled ?? false;
      const status = wasCancelled ? 'cancelled' : 'failed';
      const errorMessage = err.message || String(err);

      // Persist whatever events were captured before the failure
      if (collectedEvents.length > 0) {
        try {
          this.store.appendEvents(taskId, collectedEvents);
        } catch (persistErr) {
          console.error('[TaskRunner] Failed to persist partial events:', persistErr);
        }
      }
      this.store.updateTaskStatus(taskId, status, Date.now());

      // On failure/cancellation: clean up the worktree so nothing is orphaned
      try {
        await worktreeManager.remove(worktreePath);
      } catch (cleanupErr) {
        console.error('[TaskRunner] Worktree cleanup failed:', cleanupErr);
      }

      if (wasCancelled) {
        push('murl:task-cancelled', { taskId });
      } else {
        push('murl:task-failed', { taskId, error: errorMessage });
      }
    } finally {
      this.activeTasks.delete(taskId);
      // Shut down the per-task OpenCode server process
      try {
        await adapter.stopServer();
      } catch {
        // Ignore stop errors
      }
      // Process the next task in the queue
      this.processQueue().catch((qErr) => {
        console.error('[TaskRunner] Error processing queue after task execution:', qErr);
      });
    }
  }

  createRecipe(recipe: Omit<Recipe, 'id'>): Recipe {
    return this.store.createRecipe(recipe);
  }

  listRecipes(): Recipe[] {
    return this.store.listRecipes();
  }

  deleteRecipe(id: string): void {
    this.store.deleteRecipe(id);
  }
}
