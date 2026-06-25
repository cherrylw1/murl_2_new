import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TaskRunner, setExecHook, execHook } from './task-runner.js';
import { TaskStore, OpenCodeAdapter } from '@murl/core';
import * as settingsModule from './settings.js';

const execAsync = promisify(exec);

// Mock Electron modules since they are not available in Node.js environment
vi.mock('electron', () => {
  const tempUserdata = path.resolve('./scratch/test-userdata');
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return tempUserdata;
        return path.resolve(`./scratch/test-${name}`);
      }
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      decryptString: () => '',
      encryptString: () => Buffer.from(''),
    }
  };
});


describe('TaskRunner Keep Safety tests', () => {
  const scratchDir = path.resolve('./scratch/test-taskrunner');
  const baseRepoPath = path.join(scratchDir, 'base-repo');
  const worktreesRoot = path.join(scratchDir, 'worktrees');
  const dbPath = path.join(scratchDir, 'test-tasks.db');

  let runners: TaskRunner[] = [];
  let mockRunTaskDiff = '';
  const taskResolvers = new Map<string, (val: any) => void>();
  let isQueueTesting = false;

  beforeEach(async () => {
    runners = [];
    mockRunTaskDiff = '';
    taskResolvers.clear();
    isQueueTesting = false;

    // Spy on OpenCodeAdapter to prevent executing real subprocesses or making network calls
    vi.spyOn(OpenCodeAdapter.prototype, 'startServer').mockResolvedValue(undefined);
    vi.spyOn(OpenCodeAdapter.prototype, 'stopServer').mockResolvedValue(undefined);
    vi.spyOn(OpenCodeAdapter.prototype, 'runTask').mockImplementation(async (worktreePath) => {
      const folderName = path.basename(worktreePath);
      const taskId = folderName.startsWith('task-') ? folderName.substring(5) : folderName;
      return new Promise((resolve) => {
        taskResolvers.set(taskId, resolve);
        if (!isQueueTesting) {
          process.nextTick(() => {
            resolve({ events: [], diff: mockRunTaskDiff });
          });
        }
      });
    });

    // Cleanup any leftovers and recreate fresh folders (retry for Windows git locks)
    if (fs.existsSync(scratchDir)) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(scratchDir, { recursive: true, force: true });
          break;
        } catch (err) {
          if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          } else {
            console.warn('Initial cleanup warning:', err);
          }
        }
      }
    }
    fs.mkdirSync(baseRepoPath, { recursive: true });
    fs.mkdirSync(worktreesRoot, { recursive: true });
    fs.mkdirSync(path.resolve('./scratch/test-userdata'), { recursive: true });

    // Initialize mock git repo
    await execAsync('git init', { cwd: baseRepoPath });
    await execAsync('git config user.name "Murl Test"', { cwd: baseRepoPath });
    await execAsync('git config user.email "test@murl.dev"', { cwd: baseRepoPath });
    await execAsync('git config gc.auto 0', { cwd: baseRepoPath });
    await execAsync('git checkout -b main', { cwd: baseRepoPath });
    fs.writeFileSync(path.join(baseRepoPath, 'README.md'), '# Initial README\n');
    await execAsync('git add README.md', { cwd: baseRepoPath });
    await execAsync('git commit -m "Initial commit"', { cwd: baseRepoPath });
  });

  afterEach(async () => {
    // 1. Cancel all active tasks in runners to ensure no background git commands or processes are running
    for (const runner of runners) {
      try {
        const activeIds = Array.from((runner as any).activeTasks.keys());
        for (const id of activeIds) {
          await runner.cancel(id as string).catch(() => {});
        }
      } catch {}
    }

    // 2. Resolve any remaining promises to allow async tasks to terminate cleanly
    for (const resolve of taskResolvers.values()) {
      try {
        resolve({ events: [], diff: '' });
      } catch {}
    }

    // 3. Give git processes extra time to release file locks (Windows needs more)
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 4. Close all database connections first to release file locks on Windows
    for (const runner of runners) {
      try {
        (runner as any).store.close();
      } catch {}
    }

    // 5. Cleanup files — retry with backoff since Windows git holds locks briefly
    const forceRmSync = async (dir: string, label: string) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!fs.existsSync(dir)) return;
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          return;
        } catch (err) {
          if (attempt < 4) {
            // Wait longer each retry (50ms, 150ms, 350ms, 750ms)
            await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          } else {
            console.warn(`Cleanup warning (${label}):`, err);
          }
        }
      }
    };
    await forceRmSync(scratchDir, 'scratchDir');
    await forceRmSync(path.resolve('./scratch/test-userdata'), 'userdataDir');
  });

  async function waitForTaskCompletion(runner: TaskRunner, taskId: string): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const record = runner.getRecord(taskId);
      if (record && record.task.status !== 'running' && record.task.status !== 'queued') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function waitForTaskRunning(runner: TaskRunner, taskId: string): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const record = runner.getRecord(taskId);
      if (record && (record.task.status === 'running' || record.task.status === 'completed')) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for task ${taskId} to start running`);
  }

  it('should successfully keep changes on a clean repository', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch a task
    const taskId = await runner.launch(
      baseRepoPath,
      'Add a new greeting file',
      'test-model',
      'together',
      10.0,
      mockWebContents,
      'main'
    );

    // Wait for task queue to start task and create worktree
    await waitForTaskRunning(runner, taskId);

    const record = runner.getRecord(taskId);
    expect(record).toBeDefined();
    const worktreePath = record!.task.worktreePath;
    const taskBranch = record!.task.branch;

    // Simulate task writes in the worktree branch
    fs.writeFileSync(path.join(worktreePath, 'greeting.txt'), 'Hello World\n');
    await execAsync('git add greeting.txt', { cwd: worktreePath });
    await execAsync('git commit -m "feat: add greeting"', { cwd: worktreePath });

    mockRunTaskDiff = 'diff --git a/greeting.txt b/greeting.txt\nnew file mode 100644\n--- /dev/null\n+++ b/greeting.txt\n@@ -0,0 +1 @@\n+Hello World\n';

    // Wait for the adapter's async run execution to complete
    await waitForTaskCompletion(runner, taskId);

    const completedRecord = runner.getRecord(taskId);
    expect(completedRecord!.task.status).toBe('completed');

    // 2. Keep the task
    const keepResult = await runner.keep(taskId);
    expect(keepResult.success).toBe(true);

    // 3. Verify changes are merged in the base repository
    const greetingContent = fs.readFileSync(path.join(baseRepoPath, 'greeting.txt'), 'utf8').trim();
    expect(greetingContent).toBe('Hello World');

    // 4. Verify worktree directory is deleted (with retry wait for Windows file locking)
    let exists = true;
    for (let i = 0; i < 15; i++) {
      exists = fs.existsSync(worktreePath);
      if (!exists) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(exists).toBe(false);

    // 5. Verify local task branch is deleted from base repository
    const { stdout: branchList } = await execAsync('git branch', { cwd: baseRepoPath });
    expect(branchList).not.toContain(taskBranch);

    // 6. Verify task outcome in store
    const updatedRecord = runner.getRecord(taskId);
    expect(updatedRecord!.task.outcome).toBe('kept');
  });

  it('should refuse to keep if the base repository is dirty', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);
    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch a task
    const taskId = await runner.launch(
      baseRepoPath,
      'Modify README',
      'test-model',
      'together',
      10.0,
      mockWebContents,
      'main'
    );

    // Wait for task queue to start task and create worktree
    await waitForTaskRunning(runner, taskId);

    const record = runner.getRecord(taskId);
    const worktreePath = record!.task.worktreePath;

    // Simulate changes in worktree
    fs.appendFileSync(path.join(worktreePath, 'README.md'), 'Worktree modification\n');
    await execAsync('git add README.md', { cwd: worktreePath });
    await execAsync('git commit -m "update readme in worktree"', { cwd: worktreePath });

    // Wait for the adapter's async run execution to complete
    await waitForTaskCompletion(runner, taskId);

    // 2. Make the base repository dirty
    fs.writeFileSync(path.join(baseRepoPath, 'dirty-untracked.txt'), 'some dirty work\n');

    // 3. Keep the task -> must fail
    const keepResult = await runner.keep(taskId);
    expect(keepResult.success).toBe(false);
    expect(keepResult.message).toContain('The base repository has uncommitted changes');

    // 4. Verify uncommitted changes in base repo are untouched
    expect(fs.existsSync(path.join(baseRepoPath, 'dirty-untracked.txt'))).toBe(true);

    // 5. Verify worktree and branch are still intact
    expect(fs.existsSync(worktreePath)).toBe(true);
    const { stdout: branchList } = await execAsync('git branch', { cwd: baseRepoPath });
    expect(branchList).toContain(record!.task.branch);
  });

  it('should clean up and abort on merge conflict, leaving base repo intact', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);
    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch a task
    const taskId = await runner.launch(
      baseRepoPath,
      'Create conflict',
      'test-model',
      'together',
      10.0,
      mockWebContents,
      'main'
    );

    // Wait for task queue to start task and create worktree
    await waitForTaskRunning(runner, taskId);

    const record = runner.getRecord(taskId);
    const worktreePath = record!.task.worktreePath;

    // Modify README in worktree
    fs.writeFileSync(path.join(worktreePath, 'README.md'), '# Worktree Version\n');
    await execAsync('git add README.md', { cwd: worktreePath });
    await execAsync('git commit -m "worktree edit"', { cwd: worktreePath });

    // Wait for the adapter's async run execution to complete
    await waitForTaskCompletion(runner, taskId);

    // 2. Modify README in base repo and commit it to create conflict
    fs.writeFileSync(path.join(baseRepoPath, 'README.md'), '# Base Version\n');
    await execAsync('git add README.md', { cwd: baseRepoPath });
    await execAsync('git commit -m "base edit"', { cwd: baseRepoPath });

    // Remember the HEAD commit of base repo
    const { stdout: baseHeadBefore } = await execAsync('git rev-parse HEAD', { cwd: baseRepoPath });

    // 3. Keep the task -> must fail due to merge conflict
    const keepResult = await runner.keep(taskId);
    expect(keepResult.success).toBe(false);
    expect(keepResult.message).toContain('Merge conflict or failure');

    // 4. Verify base repo HEAD is restored
    const { stdout: baseHeadAfter } = await execAsync('git rev-parse HEAD', { cwd: baseRepoPath });
    expect(baseHeadAfter.trim()).toBe(baseHeadBefore.trim());

    // 5. Verify base repo is clean (no active merge state)
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: baseRepoPath });
    expect(status.trim()).toBe('');

    // 6. Verify worktree and branch are still intact so we can resolve conflict or discard later
    expect(fs.existsSync(worktreePath)).toBe(true);
    const { stdout: branchList } = await execAsync('git branch', { cwd: baseRepoPath });
    expect(branchList).toContain(record!.task.branch);
  });

  it('should enforce concurrencyCap and queue additional tasks in FIFO order', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);
    isQueueTesting = true;

    // Mock settings with concurrencyCap = 2
    vi.spyOn(settingsModule, 'loadSettings').mockReturnValue({
      provider: 'together',
      model: 'test-model',
      defaultRepoPath: baseRepoPath,
      worktreeRoot: worktreesRoot,
      concurrencyCap: 2,
      openCodePathOverride: '',
      perTaskBudgetDefault: 10,
      recentRepos: [],
      providers: [
        { id: 'together', name: 'Together', baseURL: 'https://api.together.xyz/v1' }
      ],
      budgetGuardAction: 'warn',
    });

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch 3 tasks in quick succession
    const taskId1 = await runner.launch(baseRepoPath, 'Task 1', 'test-model', 'together', 10.0, mockWebContents, 'main');
    const taskId2 = await runner.launch(baseRepoPath, 'Task 2', 'test-model', 'together', 10.0, mockWebContents, 'main');
    const taskId3 = await runner.launch(baseRepoPath, 'Task 3', 'test-model', 'together', 10.0, mockWebContents, 'main');

    // Wait for task 1 and task 2 to start running (robust polling)
    await waitForTaskRunning(runner, taskId1);
    await waitForTaskRunning(runner, taskId2);

    // Verify task 1 and task 2 are running
    const record1 = runner.getRecord(taskId1);
    const record2 = runner.getRecord(taskId2);
    expect(record1!.task.status).toBe('running');
    expect(record2!.task.status).toBe('running');

    // Verify task 3 is queued
    const record3 = runner.getRecord(taskId3);
    expect(record3!.task.status).toBe('queued');
    expect(record3!.task.queuePosition).toBe(0);

    // Verify that only 2 worktrees exist on disk
    const worktreePath3 = record3!.task.worktreePath;
    expect(fs.existsSync(record1!.task.worktreePath)).toBe(true);
    expect(fs.existsSync(record2!.task.worktreePath)).toBe(true);
    expect(fs.existsSync(worktreePath3)).toBe(false);

    // 2. Complete Task 1 by resolving its runTask promise
    const resolve1 = taskResolvers.get(taskId1);
    expect(resolve1).toBeDefined();
    resolve1!({ events: [], diff: 'Task 1 diff' });

    // Wait for the exit/cleanup path of Task 1 to trigger processQueue
    await waitForTaskCompletion(runner, taskId1);

    // Wait for stagger delay + start tick
    await waitForTaskRunning(runner, taskId3);

    // Verify Task 3 is now running and its worktree is created
    const record3Running = runner.getRecord(taskId3);
    expect(record3Running!.task.status).toBe('running');
    expect(fs.existsSync(worktreePath3)).toBe(true);
  });

  it('should support instant cancellation of queued tasks', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);
    isQueueTesting = true;

    // Mock settings with concurrencyCap = 1
    vi.spyOn(settingsModule, 'loadSettings').mockReturnValue({
      provider: 'together',
      model: 'test-model',
      defaultRepoPath: baseRepoPath,
      worktreeRoot: worktreesRoot,
      concurrencyCap: 1,
      openCodePathOverride: '',
      perTaskBudgetDefault: 10,
      recentRepos: [],
      providers: [
        { id: 'together', name: 'Together', baseURL: 'https://api.together.xyz/v1' }
      ],
      budgetGuardAction: 'warn',
    });

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch 2 tasks
    const taskId1 = await runner.launch(baseRepoPath, 'Task 1', 'test-model', 'together', 10.0, mockWebContents, 'main');
    const taskId2 = await runner.launch(baseRepoPath, 'Task 2', 'test-model', 'together', 10.0, mockWebContents, 'main');

    // Wait for task 1 to start
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Verify task 2 is queued
    const record2 = runner.getRecord(taskId2);
    expect(record2!.task.status).toBe('queued');

    // 2. Cancel the queued task 2
    await runner.cancel(taskId2);

    // Verify task 2 is marked cancelled
    const record2Cancelled = runner.getRecord(taskId2);
    expect(record2Cancelled!.task.status).toBe('cancelled');

    // Verify no worktree was created for task 2
    expect(fs.existsSync(record2!.task.worktreePath)).toBe(false);
  });

  it('should successfully open a PR and update task outcome and url without removing worktree', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    // 1. Launch a task
    const taskId = await runner.launch(
      baseRepoPath,
      'Feature: add unit tests for openPr',
      'test-model',
      'together',
      10.0,
      mockWebContents,
      'main'
    );

    await waitForTaskRunning(runner, taskId);
    await waitForTaskCompletion(runner, taskId);

    const completedRecord = runner.getRecord(taskId);
    expect(completedRecord!.task.status).toBe('completed');
    const worktreePath = completedRecord!.task.worktreePath;

    // Set the exec hook mock
    const originalExec = execHook;
    const mockFunc = ((cmd: string, opts: any, callback: any) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb(null, '', '');
      return {} as any;
    }) as any;
    mockFunc[promisify.custom] = async (cmd: string, opts: any) => {
      if (cmd.includes('gh auth status')) {
        return { stdout: 'Logged in to github.com', stderr: '' };
      } else if (cmd.includes('git push')) {
        return { stdout: 'branch pushed', stderr: '' };
      } else if (cmd.includes('gh pr create')) {
        return { stdout: 'https://github.com/cherrylw1/murl_2_new/pull/123\n', stderr: '' };
      } else {
        return { stdout: '', stderr: '' };
      }
    };
    setExecHook(mockFunc);

    try {
      // 2. Open PR
      const prResult = await runner.openPr(taskId);
      expect(prResult.success).toBe(true);
      expect(prResult.prUrl).toBe('https://github.com/cherrylw1/murl_2_new/pull/123');

      // 3. Verify task outcome and prUrl in store
      const updatedRecord = runner.getRecord(taskId);
      expect(updatedRecord!.task.outcome).toBe('pr-opened');
      expect(updatedRecord!.task.prUrl).toBe('https://github.com/cherrylw1/murl_2_new/pull/123');

      // 4. Verify worktree still exists on disk
      expect(fs.existsSync(worktreePath)).toBe(true);
    } finally {
      setExecHook(originalExec);
    }
  });

  it('should support dynamic providers and set environment variable with decrypted key', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);

    const customProvider = {
      id: 'custom-provider-id',
      name: 'Custom Provider Name',
      baseURL: 'https://api.custom-provider.com/v1'
    };

    vi.spyOn(settingsModule, 'loadSettings').mockReturnValue({
      provider: 'custom-provider-id',
      model: 'custom-model',
      defaultRepoPath: baseRepoPath,
      worktreeRoot: worktreesRoot,
      concurrencyCap: 2,
      openCodePathOverride: '',
      perTaskBudgetDefault: 10,
      recentRepos: [],
      providers: [
        { id: 'together', name: 'Together', baseURL: 'https://api.together.xyz/v1' },
        customProvider
      ],
      budgetGuardAction: 'warn',
    });

    vi.spyOn(settingsModule, 'loadProviderKeys').mockReturnValue({
      'custom-provider-id': 'custom-api-key-value'
    });

    const runTaskSpy = vi.spyOn(OpenCodeAdapter.prototype, 'runTask');

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    const taskId = await runner.launch(
      baseRepoPath,
      'Test multi-provider task',
      'custom-model',
      'custom-provider-id',
      10.0,
      mockWebContents,
      'main'
    );

    await waitForTaskRunning(runner, taskId);
    await waitForTaskCompletion(runner, taskId);

    const runTaskCalls = runTaskSpy.mock.calls;
    const customCall = runTaskCalls.find(call => call[0].includes(taskId));
    expect(customCall).toBeDefined();
    const modelConfig = customCall![2];
    expect(modelConfig).toBeDefined();
    expect(modelConfig!.providerId).toBe('custom-provider-id');
    expect(modelConfig!.providerName).toBe('Custom Provider Name');
    expect(modelConfig!.providerBaseURL).toBe('https://api.custom-provider.com/v1');
    expect(modelConfig!.apiKeyEnvVarName).toBe(`MURL_API_KEY_${taskId}`);
    expect(modelConfig!.apiKeyVal).toBe('custom-api-key-value');
  });

  it('should abort and cancel the task if budgetGuardAction is halt and cost exceeds budgetCap', async () => {
    const runner = new TaskRunner(dbPath);
    runners.push(runner);

    // Mock settings with budgetGuardAction = 'halt'
    vi.spyOn(settingsModule, 'loadSettings').mockReturnValue({
      provider: 'together',
      model: 'test-model',
      defaultRepoPath: baseRepoPath,
      worktreeRoot: worktreesRoot,
      concurrencyCap: 2,
      openCodePathOverride: '',
      perTaskBudgetDefault: 0.05,
      recentRepos: [],
      providers: [
        { id: 'together', name: 'Together', baseURL: 'https://api.together.xyz/v1' }
      ],
      budgetGuardAction: 'halt',
    });

    // Mock runTask implementation to trigger a cost event that exceeds the budget cap ($0.01)
    let abortSignalObserved: AbortSignal | undefined;
    vi.spyOn(OpenCodeAdapter.prototype, 'runTask').mockImplementation(
      async (worktreePath, prompt, config, onEvent, signal) => {
        abortSignalObserved = signal;
        return new Promise((resolve, reject) => {
          // Monitor if the signal gets aborted
          if (signal) {
            if (signal.aborted) {
              reject(new Error('Task was cancelled.'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(new Error('Task was cancelled.'));
            });
          }

          // Delay the cost event trigger so that waitForTaskRunning can see the task as 'running' first
          setTimeout(() => {
            if (onEvent) {
              onEvent({
                type: 'cost',
                tokensIn: 100000,
                tokensOut: 100000,
                costUsd: 0.5, // Exceeds budget cap of 0.01
              });
            }
          }, 100);

          // Don't resolve immediately to let the abortion take place
          setTimeout(() => {
            resolve({ events: [], diff: '' });
          }, 1000);
        });
      }
    );

    const mockWebContents: any = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    const taskId = await runner.launch(
      baseRepoPath,
      'Test budget guard halt',
      'test-model',
      'together',
      0.01, // Budget cap is 0.01
      mockWebContents,
      'main'
    );

    await waitForTaskRunning(runner, taskId);
    await waitForTaskCompletion(runner, taskId);

    const record = runner.getRecord(taskId);
    expect(record).toBeDefined();
    expect(record!.task.status).toBe('cancelled');
    expect(abortSignalObserved?.aborted).toBe(true);
  });
});
