import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncVal } = require('node:sqlite');
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { MurlEvent } from './opencode-adapter.js';

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
  /** The real GitHub PR URL, set when outcome === 'pr-opened'. */
  prUrl?: string | null;
  queuePosition?: number;
  budgetCap?: number | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
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

export class TaskStore {
  private db: DatabaseSync;

  constructor(dbFilePath: string) {
    // Ensure parent directories exist
    const dir = path.dirname(path.resolve(dbFilePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSyncVal(dbFilePath);
    this.initSchema();
  }

  private initSchema(): void {
    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Idempotently create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL UNIQUE,
        worktreePath TEXT NOT NULL,
        branch TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        completedAt INTEGER,
        outcome TEXT,
        budgetCap REAL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(taskId) REFERENCES tasks(taskId) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS diffs (
        taskId TEXT PRIMARY KEY,
        diff TEXT NOT NULL,
        capturedAt INTEGER NOT NULL,
        FOREIGN KEY(taskId) REFERENCES tasks(taskId) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cost (
        taskId TEXT PRIMARY KEY,
        tokensIn INTEGER NOT NULL,
        tokensOut INTEGER NOT NULL,
        costUsd REAL NOT NULL,
        recordedAt INTEGER NOT NULL,
        FOREIGN KEY(taskId) REFERENCES tasks(taskId) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        repoPath TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        baseBranch TEXT,
        budgetCap REAL
      );
    `);

    // Safely add new columns if they do not exist
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN baseBranch TEXT;');
    } catch {
      // Swallowed since the column likely already exists
    }
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN repoPath TEXT;');
    } catch {
      // Swallowed since the column likely already exists
    }
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN followUpCount INTEGER NOT NULL DEFAULT 0;');
    } catch {
      // Swallowed since the column likely already exists
    }
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN prUrl TEXT;');
    } catch {
      // Swallowed since the column likely already exists
    }
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN budgetCap REAL;');
    } catch {
      // Swallowed since the column likely already exists
    }
  }

  createTask(task: Omit<PersistedTask, 'id' | 'createdAt' | 'completedAt' | 'outcome'>): PersistedTask {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const outcome = null;
    const completedAt = null;

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, taskId, worktreePath, branch, baseBranch, repoPath, prompt, model, provider, status, createdAt, completedAt, outcome, budgetCap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.taskId,
      task.worktreePath,
      task.branch,
      task.baseBranch || 'main',
      task.repoPath || '',
      task.prompt,
      task.model,
      task.provider,
      task.status,
      createdAt,
      completedAt,
      outcome,
      task.budgetCap || null
    );

    return {
      id,
      taskId: task.taskId,
      worktreePath: task.worktreePath,
      branch: task.branch,
      baseBranch: task.baseBranch || 'main',
      repoPath: task.repoPath || '',
      prompt: task.prompt,
      model: task.model,
      provider: task.provider,
      status: task.status,
      createdAt,
      completedAt,
      outcome,
      budgetCap: task.budgetCap || null,
    };
  }

  updateTaskStatus(taskId: string, status: string, completedAt?: number): void {
    if (completedAt !== undefined) {
      const stmt = this.db.prepare('UPDATE tasks SET status = ?, completedAt = ? WHERE taskId = ?');
      stmt.run(status, completedAt, taskId);
    } else {
      const stmt = this.db.prepare('UPDATE tasks SET status = ? WHERE taskId = ?');
      stmt.run(status, taskId);
    }
  }

  setOutcome(taskId: string, outcome: 'kept' | 'discarded' | 'pr-opened'): void {
    const stmt = this.db.prepare('UPDATE tasks SET outcome = ? WHERE taskId = ?');
    stmt.run(outcome, taskId);
  }

  /**
   * Stores the real GitHub PR URL returned by `gh pr create`.
   * Called immediately after setOutcome('pr-opened').
   */
  setPrUrl(taskId: string, prUrl: string): void {
    const stmt = this.db.prepare('UPDATE tasks SET prUrl = ? WHERE taskId = ?');
    stmt.run(prUrl, taskId);
  }

  /**
   * Atomically increments the follow-up counter for a task and returns the new value.
   * Used to number follow-up runs for separator labels in the event stream.
   */
  incrementFollowUpCount(taskId: string): number {
    this.db.prepare('UPDATE tasks SET followUpCount = followUpCount + 1 WHERE taskId = ?').run(taskId);
    const row = this.db.prepare('SELECT followUpCount FROM tasks WHERE taskId = ?').get(taskId) as { followUpCount: number } | undefined;
    return row ? Number(row.followUpCount) : 1;
  }

  appendEvents(taskId: string, events: MurlEvent[]): void {
    if (events.length === 0) return;

    // Find the current max sequence number for this taskId
    const seqStmt = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) as maxSeq FROM events WHERE taskId = ?');
    const seqRow = seqStmt.get(taskId) as { maxSeq: number } | undefined;
    let sequence = seqRow ? Number(seqRow.maxSeq) : 0;

    // Wrap the batch inserts in a transaction for atomicity and speed
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO events (taskId, sequence, type, payload, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      for (const event of events) {
        sequence++;
        insertStmt.run(taskId, sequence, event.type, JSON.stringify(event), now);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  saveDiff(taskId: string, diff: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO diffs (taskId, diff, capturedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, diff, now);
  }

  saveCost(taskId: string, cost: Omit<PersistedCost, 'taskId' | 'recordedAt'>): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cost (taskId, tokensIn, tokensOut, costUsd, recordedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, cost.tokensIn, cost.tokensOut, cost.costUsd, now);
  }

  getTask(taskId: string): TaskRecord | null {
    const taskStmt = this.db.prepare(`
      SELECT t.*, c.costUsd, c.tokensIn, c.tokensOut
      FROM tasks t
      LEFT JOIN cost c ON t.taskId = c.taskId
      WHERE t.taskId = ?
    `);
    const taskRow = taskStmt.get(taskId) as any;
    if (!taskRow) return null;

    // Map outcomes and completion values correctly
    const task: PersistedTask = {
      ...taskRow,
      completedAt: taskRow.completedAt === null ? null : Number(taskRow.completedAt),
      createdAt: Number(taskRow.createdAt),
      outcome: taskRow.outcome as any,
      prUrl: taskRow.prUrl ?? null,
      baseBranch: taskRow.baseBranch || 'main',
      repoPath: taskRow.repoPath || '',
      budgetCap: taskRow.budgetCap !== null && taskRow.budgetCap !== undefined ? Number(taskRow.budgetCap) : null,
      costUsd: taskRow.costUsd !== null && taskRow.costUsd !== undefined ? Number(taskRow.costUsd) : null,
      tokensIn: taskRow.tokensIn !== null && taskRow.tokensIn !== undefined ? Number(taskRow.tokensIn) : null,
      tokensOut: taskRow.tokensOut !== null && taskRow.tokensOut !== undefined ? Number(taskRow.tokensOut) : null,
    };

    // Query events
    const eventsStmt = this.db.prepare('SELECT payload FROM events WHERE taskId = ? ORDER BY sequence ASC');
    const eventRows = eventsStmt.all(taskId) as Array<{ payload: string }>;
    const events: MurlEvent[] = eventRows.map((r) => JSON.parse(r.payload));

    // Query diff
    const diffStmt = this.db.prepare('SELECT diff, capturedAt FROM diffs WHERE taskId = ?');
    const diffRow = diffStmt.get(taskId) as { diff: string; capturedAt: number } | undefined;
    const diff = diffRow ? diffRow.diff : null;

    // Query cost
    const costStmt = this.db.prepare('SELECT tokensIn, tokensOut, costUsd, recordedAt FROM cost WHERE taskId = ?');
    const costRow = costStmt.get(taskId) as Omit<PersistedCost, 'taskId'> | undefined;
    const cost = costRow
      ? {
          taskId,
          tokensIn: Number(costRow.tokensIn),
          tokensOut: Number(costRow.tokensOut),
          costUsd: Number(costRow.costUsd),
          recordedAt: Number(costRow.recordedAt),
        }
      : null;

    return {
      task,
      events,
      diff,
      cost,
    };
  }

  listTasks(): PersistedTask[] {
    const stmt = this.db.prepare(`
      SELECT t.*, c.costUsd, c.tokensIn, c.tokensOut
      FROM tasks t
      LEFT JOIN cost c ON t.taskId = c.taskId
      ORDER BY t.createdAt DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      ...row,
      completedAt: row.completedAt === null ? null : Number(row.completedAt),
      createdAt: Number(row.createdAt),
      outcome: row.outcome as any,
      prUrl: row.prUrl ?? null,
      baseBranch: row.baseBranch || 'main',
      repoPath: row.repoPath || '',
      budgetCap: row.budgetCap !== null && row.budgetCap !== undefined ? Number(row.budgetCap) : null,
      costUsd: row.costUsd !== null && row.costUsd !== undefined ? Number(row.costUsd) : null,
      tokensIn: row.tokensIn !== null && row.tokensIn !== undefined ? Number(row.tokensIn) : null,
      tokensOut: row.tokensOut !== null && row.tokensOut !== undefined ? Number(row.tokensOut) : null,
    }));
  }

  close(): void {
    this.db.close();
  }

  createRecipe(recipe: Omit<Recipe, 'id'>): Recipe {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO recipes (id, name, description, repoPath, prompt, model, provider, baseBranch, budgetCap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      recipe.name,
      recipe.description || null,
      recipe.repoPath,
      recipe.prompt,
      recipe.model,
      recipe.provider,
      recipe.baseBranch || null,
      recipe.budgetCap || null
    );
    return {
      id,
      ...recipe,
    };
  }

  listRecipes(): Recipe[] {
    const stmt = this.db.prepare('SELECT * FROM recipes ORDER BY name ASC');
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      repoPath: row.repoPath,
      prompt: row.prompt,
      model: row.model,
      provider: row.provider,
      baseBranch: row.baseBranch,
      budgetCap: row.budgetCap !== null && row.budgetCap !== undefined ? Number(row.budgetCap) : null,
    }));
  }

  deleteRecipe(id: string): void {
    const stmt = this.db.prepare('DELETE FROM recipes WHERE id = ?');
    stmt.run(id);
  }
}
