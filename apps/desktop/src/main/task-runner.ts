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

export class TaskRunner {
  private activeTasks = new Map<string, ActiveTask>();
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

    // OpenCode binary resolution:
    //   1. settings.openCodePathOverride (user-configured explicit path)
    //   2. Falls through to adapter's own resolveBinPath():
    //      a. OPENCODE_BIN_PATH env var
    //      b. C:/Content/murl_spike dev-only fallback (guarded by fs.existsSync — silent on fresh clones)
    //      c. 'opencode' on PATH — explicit error from spawn() if not found
    const binPath = settings.openCodePathOverride || undefined;

    const taskId = crypto.randomUUID();

    const worktreeManager = new WorktreeManager(repoPath, worktreeRoot);
    const adapter = new OpenCodeAdapter(binPath ? { binPath } : undefined);

    // Create real worktree — can throw (e.g. git not found); caller gets the error
    const worktree = await worktreeManager.create(taskId, baseBranch);

    // Persist initial task record before launching so History is consistent
    this.store.createTask({
      taskId,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseBranch: baseBranch || 'main',
      repoPath,
      prompt,
      model,
      provider: 'together',
      status: 'running',
    });

    const abortController = new AbortController();
    const activeEntry: ActiveTask = {
      abortController,
      wasCancelled: false,
      worktreePath: worktree.path,
      worktreeManager,
    };
    this.activeTasks.set(taskId, activeEntry);

    // Fire the execution asynchronously — IPC events will push progress to renderer
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
      // Only reachable if _runAsync itself throws outside its own try/catch
      console.error('[TaskRunner] Unhandled error in _runAsync:', err);
    });

    return taskId;
  }

  /**
   * Triggers cancellation of an in-flight task. Sets wasCancelled=true first
   * so the error path can write 'cancelled' (not 'failed') status.
   */
  async cancel(taskId: string): Promise<void> {
    const entry = this.activeTasks.get(taskId);
    if (!entry) {
      // Task may have already completed/failed — not an error
      return;
    }
    entry.wasCancelled = true;
    entry.abortController.abort();
  }

  getHistory(): PersistedTask[] {
    return this.store.listTasks();
  }

  getRecord(taskId: string): TaskRecord | null {
    return this.store.getTask(taskId);
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

    let didStash = false;
    let originalHead = '';
    let isDetached = false;

    try {
      // 1. Check if original repo is dirty. If so, stash changes to avoid merge blocking
      const { stdout: statusOut } = await execInRepo('git status --porcelain');
      if (statusOut.trim()) {
        await execInRepo('git stash -u');
        didStash = true;
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
        if (didStash) {
          await execInRepo('git stash pop').catch(() => {});
        }
        return {
          success: false,
          message: `Merge conflict or failure: ${mergeErr.message || String(mergeErr)}`,
        };
      }

      // Merge succeeded! Restore original checked-out HEAD
      await execInRepo(`git checkout "${originalHead}"`);
      if (didStash) {
        await execInRepo('git stash pop').catch(() => {});
      }

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
    }
  }
}
