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
import type { WebContents } from 'electron';
import { WorktreeManager, OpenCodeAdapter, TaskStore } from '@murl/core';
import type { MurlEvent, PersistedTask, TaskRecord } from '@murl/core';
import { loadSettings } from './settings.js';

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
    webContents: WebContents,
    baseBranch?: string
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
      provider: 'together',
      status: 'queued',
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
    const { taskId, repoPath, prompt, model, webContents, baseBranch } = task;
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
      const adapter = new OpenCodeAdapter(binPath ? { binPath } : undefined);

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
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
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

  private async getBaseRepoPath(worktreePath: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
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
    };

    try {
      const { diff } = await adapter.runTask(
        worktreePath,
        prompt,
        { model },
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
}
