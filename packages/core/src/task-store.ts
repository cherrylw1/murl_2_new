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
  prompt: string;
  model: string;
  provider: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  outcome: 'kept' | 'discarded' | null;
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
        outcome TEXT
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
    `);
  }

  createTask(task: Omit<PersistedTask, 'id' | 'createdAt' | 'completedAt' | 'outcome'>): PersistedTask {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const outcome = null;
    const completedAt = null;

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, taskId, worktreePath, branch, prompt, model, provider, status, createdAt, completedAt, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.taskId,
      task.worktreePath,
      task.branch,
      task.prompt,
      task.model,
      task.provider,
      task.status,
      createdAt,
      completedAt,
      outcome
    );

    return {
      id,
      taskId: task.taskId,
      worktreePath: task.worktreePath,
      branch: task.branch,
      prompt: task.prompt,
      model: task.model,
      provider: task.provider,
      status: task.status,
      createdAt,
      completedAt,
      outcome,
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

  setOutcome(taskId: string, outcome: 'kept' | 'discarded'): void {
    const stmt = this.db.prepare('UPDATE tasks SET outcome = ? WHERE taskId = ?');
    stmt.run(outcome, taskId);
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
    const taskStmt = this.db.prepare('SELECT * FROM tasks WHERE taskId = ?');
    const taskRow = taskStmt.get(taskId) as PersistedTask | undefined;
    if (!taskRow) return null;

    // Map outcomes and completion values correctly
    const task: PersistedTask = {
      ...taskRow,
      completedAt: taskRow.completedAt === null ? null : Number(taskRow.completedAt),
      createdAt: Number(taskRow.createdAt),
      outcome: taskRow.outcome as any,
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
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC');
    const rows = stmt.all() as unknown as PersistedTask[];
    return rows.map((row) => ({
      ...row,
      completedAt: row.completedAt === null ? null : Number(row.completedAt),
      createdAt: Number(row.createdAt),
      outcome: row.outcome as any,
    }));
  }

  close(): void {
    this.db.close();
  }
}
