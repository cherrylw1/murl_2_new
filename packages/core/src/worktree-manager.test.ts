import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorktreeManager } from './worktree-manager';

const execAsync = promisify(exec);

describe('WorktreeManager', () => {
  let tempDir: string;
  let baseRepoPath: string;
  let worktreesRoot: string;
  let manager: WorktreeManager;

  beforeAll(async () => {
    // Create a unique temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murl-test-wt-'));
    baseRepoPath = path.join(tempDir, 'repo');
    worktreesRoot = path.join(tempDir, 'worktrees');

    fs.mkdirSync(baseRepoPath, { recursive: true });
    fs.mkdirSync(worktreesRoot, { recursive: true });

    // Initialize git repository
    await execAsync('git init', { cwd: baseRepoPath });
    await execAsync('git config user.name "Murl Test"', { cwd: baseRepoPath });
    await execAsync('git config user.email "test@murl.dev"', { cwd: baseRepoPath });
    await execAsync('git checkout -b main', { cwd: baseRepoPath });

    // Make initial commit
    fs.writeFileSync(path.join(baseRepoPath, 'README.md'), '# Murl Test Repo');
    await execAsync('git add README.md', { cwd: baseRepoPath });
    await execAsync('git commit -m "initial commit"', { cwd: baseRepoPath });

    manager = new WorktreeManager(baseRepoPath, worktreesRoot);
  });

  afterAll(async () => {
    // Cleanup all worktrees
    try {
      const list = await manager.list();
      for (const w of list) {
        await manager.remove(w.path);
      }
    } catch {
      // Ignore errors during final list/remove
    }

    // Force remove temp directory with retry loop for Windows file locking
    if (fs.existsSync(tempDir)) {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  });

  it('should successfully create a worktree on a new branch', async () => {
    const taskId = 'test-create';
    const result = await manager.create(taskId);

    expect(result.taskId).toBe(taskId);
    expect(result.branch).toBe('murl/task-test-create');
    expect(fs.existsSync(result.path)).toBe(true);
    expect(fs.existsSync(path.join(result.path, 'README.md'))).toBe(true);

    // Verify git branch exists
    const { stdout: branchList } = await execAsync('git branch --list murl/task-test-create', {
      cwd: baseRepoPath,
    });
    expect(branchList.trim()).toContain('murl/task-test-create');

    // Clean up
    await manager.remove(result.path);
  });

  it('should list only managed worktrees', async () => {
    const task1 = await manager.create('list-1');
    const task2 = await manager.create('list-2');

    const list = await manager.list();
    expect(list.length).toBe(2);

    const taskIds = list.map((w) => w.taskId);
    expect(taskIds).toContain('list-1');
    expect(taskIds).toContain('list-2');

    // Clean up
    await manager.remove(task1.path);
    await manager.remove(task2.path);
  });

  it('should remove worktree and branch cleanly even with uncommitted changes', async () => {
    const task = await manager.create('test-remove');

    // Add uncommitted changes in the worktree
    fs.writeFileSync(path.join(task.path, 'dirty.txt'), 'dirty contents');

    // Verify list sees it
    let list = await manager.list();
    expect(list.find((w) => w.taskId === 'test-remove')).toBeDefined();

    // Remove
    await manager.remove(task.path);

    // Verify it is gone from disk
    expect(fs.existsSync(task.path)).toBe(false);

    // Verify branch is deleted
    const { stdout: branchList } = await execAsync('git branch --list murl/task-test-remove', {
      cwd: baseRepoPath,
    });
    expect(branchList.trim()).toBe('');

    // Verify list no longer returns it
    list = await manager.list();
    expect(list.find((w) => w.taskId === 'test-remove')).toBeUndefined();
  });

  it('should prune orphan worktrees and branches', async () => {
    const activeTask = await manager.create('active-task');
    const orphanTask = await manager.create('orphan-task');

    // Verify both exist
    let list = await manager.list();
    expect(list.length).toBe(2);

    // Prune, retaining only 'active-task'
    await manager.pruneOrphans(['active-task']);

    // Verify active remains but orphan is pruned
    list = await manager.list();
    expect(list.length).toBe(1);
    expect(list[0].taskId).toBe('active-task');
    expect(fs.existsSync(orphanTask.path)).toBe(false);

    // Verify orphan branch is deleted
    const { stdout: branchList } = await execAsync('git branch --list "murl/task-*"', {
      cwd: baseRepoPath,
    });
    expect(branchList).toContain('murl/task-active-task');
    expect(branchList).not.toContain('murl/task-orphan-task');

    // Clean up
    await manager.remove(activeTask.path);
  });

  it('should create multiple worktrees concurrently without corruption', async () => {
    const promises = [
      manager.create('concurrent-1'),
      manager.create('concurrent-2'),
      manager.create('concurrent-3'),
    ];

    const results = await Promise.all(promises);
    expect(results.length).toBe(3);

    for (const r of results) {
      expect(fs.existsSync(r.path)).toBe(true);
      expect(fs.existsSync(path.join(r.path, 'README.md'))).toBe(true);
    }

    const list = await manager.list();
    expect(list.length).toBe(3);

    // Clean up
    await Promise.all(results.map((r) => manager.remove(r.path)));
  });
});
