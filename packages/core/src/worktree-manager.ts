import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ManagedWorktree {
  path: string;
  branch: string;
  taskId: string;
  createdAt: Date;
}

export class WorktreeManager {
  private baseRepoPath: string;
  private worktreesRoot: string;

  constructor(
    baseRepoPath: string,
    worktreesRoot: string
  ) {
    this.baseRepoPath = path.resolve(baseRepoPath);
    this.worktreesRoot = path.resolve(worktreesRoot);
  }

  /**
   * Creates a new git worktree for a given base repo, on its own new branch.
   * Derived branch name: murl/task-<taskId>
   * Dedicated path: worktreesRoot/task-<taskId>
   */
  async create(taskId: string): Promise<ManagedWorktree> {
    const branchName = `murl/task-${taskId}`;
    const worktreePath = path.resolve(this.worktreesRoot, `task-${taskId}`);

    // Ensure worktreesRoot exists
    if (!fs.existsSync(this.worktreesRoot)) {
      fs.mkdirSync(this.worktreesRoot, { recursive: true });
    }

    // Clean up any pre-existing worktree or branch for this taskId to make it robust
    await this.cleanupTaskIdIfExists(taskId, worktreePath, branchName);

    // Run git worktree add
    const formattedPath = worktreePath.replace(/\\/g, '/');
    await execAsync(`git worktree add -b "${branchName}" "${formattedPath}"`, {
      cwd: this.baseRepoPath,
    });

    const stat = fs.statSync(worktreePath);
    const createdAt = stat.birthtime || stat.mtime || new Date();

    return {
      path: worktreePath,
      branch: branchName,
      taskId,
      createdAt,
    };
  }

  /**
   * Lists all worktrees currently managed by Murl for this repository.
   */
  async list(): Promise<ManagedWorktree[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: this.baseRepoPath,
      });

      const blocks = stdout.trim().split(/\r?\n\r?\n/);
      const worktrees: ManagedWorktree[] = [];

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split(/\r?\n/);
        let wpath = '';
        let branch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            wpath = path.resolve(line.substring(9).trim());
          } else if (line.startsWith('branch refs/heads/')) {
            branch = line.substring(18).trim();
          }
        }

        if (wpath && branch && branch.startsWith('murl/task-')) {
          const taskId = branch.substring(10);
          let createdAt = new Date();
          try {
            if (fs.existsSync(wpath)) {
              const stat = fs.statSync(wpath);
              createdAt = stat.birthtime || stat.mtime || new Date();
            }
          } catch {
            // Gracefully ignore filesystem stats errors
          }

          worktrees.push({
            path: wpath,
            branch,
            taskId,
            createdAt,
          });
        }
      }

      return worktrees;
    } catch (err) {
      // If git worktree list fails (e.g. no worktrees created yet or not a git repo)
      return [];
    }
  }

  /**
   * Removes a worktree and deletes its branch cleanly.
   * Force removes since these are disposable task branches.
   */
  async remove(worktreePath: string): Promise<void> {
    const resolvedPath = path.resolve(worktreePath);
    const list = await this.list();
    const found = list.find((w) => path.resolve(w.path) === resolvedPath);

    let branchName = found?.branch;
    if (!branchName) {
      // Inferred fallback from folder name
      const folderName = path.basename(resolvedPath);
      if (folderName.startsWith('task-')) {
        branchName = `murl/task-${folderName.substring(5)}`;
      }
    }

    // 1. Force remove worktree from git
    const formattedPath = resolvedPath.replace(/\\/g, '/');
    try {
      await execAsync(`git worktree remove --force "${formattedPath}"`, {
        cwd: this.baseRepoPath,
      });
    } catch {
      // Ignore errors if the worktree was already removed from git
    }

    // 2. Ensure folder is removed on disk (crucial Windows cleanup check)
    try {
      if (fs.existsSync(resolvedPath)) {
        fs.rmSync(resolvedPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore filesystem cleanup errors
    }

    // 3. Delete branch from git
    if (branchName) {
      try {
        await execAsync(`git branch -D "${branchName}"`, {
          cwd: this.baseRepoPath,
        });
      } catch {
        // Ignore errors if branch was already deleted
      }
    }

    // 4. Run git worktree prune to keep repo clean
    try {
      await execAsync('git worktree prune', { cwd: this.baseRepoPath });
    } catch {
      // Ignore prune errors
    }
  }

  /**
   * Prunes any orphan worktrees and branches matching murl/task-*
   * that are not in the activeTaskIds list.
   */
  async pruneOrphans(activeTaskIds: string[]): Promise<void> {
    const activeSet = new Set(activeTaskIds);
    const list = await this.list();

    // Remove orphan worktrees
    for (const w of list) {
      if (!activeSet.has(w.taskId)) {
        await this.remove(w.path);
      }
    }

    // Scan for and delete orphan branches that don't have active worktrees
    try {
      const { stdout } = await execAsync('git branch --list "murl/task-*"', {
        cwd: this.baseRepoPath,
      });
      const branches = stdout
        .split(/\r?\n/)
        .map((b: string) => b.replace(/^\*?\s+/, '').trim())
        .filter((b: string) => b.startsWith('murl/task-'));

      for (const branch of branches) {
        const taskId = branch.substring(10);
        if (!activeSet.has(taskId)) {
          try {
            await execAsync(`git branch -D "${branch}"`, {
              cwd: this.baseRepoPath,
            });
          } catch {
            // Ignore if branch cannot be deleted
          }
        }
      }
    } catch {
      // Ignore if branch list command fails
    }

    // Clean up administrative files
    try {
      await execAsync('git worktree prune', { cwd: this.baseRepoPath });
    } catch {
      // Ignore prune errors
    }
  }

  /**
   * Helper to clean up any pre-existing state for a specific taskId.
   */
  private async cleanupTaskIdIfExists(
    taskId: string,
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    // Check if the worktree path is registered
    try {
      await execAsync(`git worktree remove --force "${worktreePath.replace(/\\/g, '/')}"`, {
        cwd: this.baseRepoPath,
      });
    } catch {
      // Ignore if it wasn't registered
    }

    // Remove path from disk if it somehow exists
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch {
      // Ignore fs clean errors
    }

    // Delete branch if it exists
    try {
      await execAsync(`git branch -D "${branchName}"`, {
        cwd: this.baseRepoPath,
      });
    } catch {
      // Ignore if branch doesn't exist
    }

    // Run git worktree prune
    try {
      await execAsync('git worktree prune', { cwd: this.baseRepoPath });
    } catch {
      // Ignore prune errors
    }
  }
}
