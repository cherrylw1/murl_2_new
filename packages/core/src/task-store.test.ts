import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStore } from './task-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TaskStore', () => {
  let dbPath: string;
  let store: TaskStore;

  beforeEach(() => {
    // Generate a unique path for each test to run in isolation
    dbPath = path.join(
      os.tmpdir(),
      `murl-test-${Date.now()}-${Math.random().toString(36).substring(7)}.db`
    );
    store = new TaskStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // Ignore if already closed
    }

    // Clean up DB file and any auxiliary SQLite files (journal, wal, shm)
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith(base)) {
          try {
            fs.rmSync(path.join(dir, file), { force: true });
          } catch {
            // Ignore cleanup lock issues
          }
        }
      }
    }
  });

  it('should create a task and retrieve it back', () => {
    const taskInput = {
      taskId: 'test-task-1',
      worktreePath: '/path/to/wt1',
      branch: 'murl/test-task-1',
      prompt: 'Verify code works',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    };

    const created = store.createTask(taskInput);
    expect(created.id).toBeDefined();
    expect(created.taskId).toBe(taskInput.taskId);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.completedAt).toBeNull();
    expect(created.outcome).toBeNull();

    const record = store.getTask(taskInput.taskId);
    expect(record).not.toBeNull();
    expect(record!.task.id).toBe(created.id);
    expect(record!.task.taskId).toBe(taskInput.taskId);
    expect(record!.events).toEqual([]);
    expect(record!.diff).toBeNull();
    expect(record!.cost).toBeNull();
  });

  it('should update task status, timing, and outcome', () => {
    const taskInput = {
      taskId: 'test-task-2',
      worktreePath: '/path/to/wt2',
      branch: 'murl/test-task-2',
      prompt: 'Write another task',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    };

    store.createTask(taskInput);
    
    // Update status only
    store.updateTaskStatus(taskInput.taskId, 'running');
    let record = store.getTask(taskInput.taskId);
    expect(record!.task.status).toBe('running');
    expect(record!.task.completedAt).toBeNull();

    // Update status and completed time
    const completedAt = Date.now();
    store.updateTaskStatus(taskInput.taskId, 'completed', completedAt);
    record = store.getTask(taskInput.taskId);
    expect(record!.task.status).toBe('completed');
    expect(record!.task.completedAt).toBe(completedAt);

    // Set outcome
    store.setOutcome(taskInput.taskId, 'kept');
    record = store.getTask(taskInput.taskId);
    expect(record!.task.outcome).toBe('kept');
  });

  it('should append events and preserve their order', () => {
    const taskId = 'test-task-events';
    store.createTask({
      taskId,
      worktreePath: '/path/to/wt',
      branch: 'murl/test-task-events',
      prompt: 'Event testing',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    });

    // Batch 1
    store.appendEvents(taskId, [
      { type: 'status', status: 'started' },
    ]);

    // Batch 2
    store.appendEvents(taskId, [
      { type: 'message', role: 'assistant', contentType: 'text', content: 'First token' },
      { type: 'status', status: 'completed' },
    ]);

    const record = store.getTask(taskId);
    expect(record!.events.length).toBe(3);
    
    expect(record!.events[0]).toEqual({ type: 'status', status: 'started' });
    expect(record!.events[1]).toEqual({ type: 'message', role: 'assistant', contentType: 'text', content: 'First token' });
    expect(record!.events[2]).toEqual({ type: 'status', status: 'completed' });
  });

  it('should save and retrieve diff and cost round-trips correctly', () => {
    const taskId = 'test-task-diff-cost';
    store.createTask({
      taskId,
      worktreePath: '/path/to/wt',
      branch: 'murl/test-task-diff-cost',
      prompt: 'Diff and cost testing',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    });

    const diffContent = 'diff --git a/README.md b/README.md\n+hello';
    store.saveDiff(taskId, diffContent);

    const costData = {
      tokensIn: 1000,
      tokensOut: 2000,
      costUsd: 0.005,
    };
    store.saveCost(taskId, costData);

    const record = store.getTask(taskId);
    expect(record!.diff).toBe(diffContent);
    expect(record!.cost).toEqual({
      taskId,
      ...costData,
      recordedAt: expect.any(Number),
    });
  });

  it('should list tasks in most recent order', async () => {
    const t1 = store.createTask({
      taskId: 'list-task-1',
      worktreePath: '/path/to/wt1',
      branch: 'murl/list-task-1',
      prompt: 'Prompt 1',
      model: 'model',
      provider: 'together',
      status: 'started',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const t2 = store.createTask({
      taskId: 'list-task-2',
      worktreePath: '/path/to/wt2',
      branch: 'murl/list-task-2',
      prompt: 'Prompt 2',
      model: 'model',
      provider: 'together',
      status: 'started',
    });

    const tasks = store.listTasks();
    expect(tasks.length).toBe(2);
    // Most recent first
    expect(tasks[0].taskId).toBe(t2.taskId);
    expect(tasks[1].taskId).toBe(t1.taskId);
  });

  it('should reconstruct tasks after reopening the store (app restart)', () => {
    const taskId = 'test-restart-task';
    const taskInput = {
      taskId,
      worktreePath: '/path/to/wt',
      branch: 'murl/test-restart-task',
      prompt: 'Restart test',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    };

    store.createTask(taskInput);
    store.appendEvents(taskId, [{ type: 'status', status: 'started' }]);
    store.saveDiff(taskId, 'my diff');
    store.saveCost(taskId, { tokensIn: 5, tokensOut: 10, costUsd: 0.0001 });

    // Close the store
    store.close();

    // Reopen a new instance against the same file path
    const store2 = new TaskStore(dbPath);
    try {
      const record = store2.getTask(taskId);
      expect(record).not.toBeNull();
      expect(record!.task.taskId).toBe(taskId);
      expect(record!.events).toEqual([{ type: 'status', status: 'started' }]);
      expect(record!.diff).toBe('my diff');
      expect(record!.cost!.tokensIn).toBe(5);
      expect(record!.cost!.tokensOut).toBe(10);
    } finally {
      store2.close();
    }
  });

  it('should create, list, and delete recipes correctly', () => {
    const recipeInput = {
      name: 'Test Recipe',
      description: 'A test description',
      repoPath: '/path/to/repo',
      prompt: 'Test prompt content',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      baseBranch: 'main',
      budgetCap: 0.15,
    };

    const created = store.createRecipe(recipeInput);
    expect(created.id).toBeDefined();
    expect(created.name).toBe(recipeInput.name);
    expect(created.description).toBe(recipeInput.description);
    expect(created.repoPath).toBe(recipeInput.repoPath);
    expect(created.prompt).toBe(recipeInput.prompt);
    expect(created.model).toBe(recipeInput.model);
    expect(created.provider).toBe(recipeInput.provider);
    expect(created.baseBranch).toBe(recipeInput.baseBranch);
    expect(created.budgetCap).toBe(recipeInput.budgetCap);

    let recipes = store.listRecipes();
    expect(recipes.length).toBe(1);
    expect(recipes[0].id).toBe(created.id);
    expect(recipes[0].name).toBe(recipeInput.name);

    // Delete the recipe
    store.deleteRecipe(created.id);
    recipes = store.listRecipes();
    expect(recipes.length).toBe(0);
  });

  it('should support fanned-out tasks in a group (groupId)', () => {
    const groupId = 'test-group-1';

    const t1 = store.createTask({
      taskId: 'test-group-task-1',
      worktreePath: '/path/to/wt1',
      branch: 'murl/test-group-task-1',
      prompt: 'Task prompt',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
      groupId,
    });

    const t2 = store.createTask({
      taskId: 'test-group-task-2',
      worktreePath: '/path/to/wt2',
      branch: 'murl/test-group-task-2',
      prompt: 'Task prompt',
      model: 'gpt-4o-mini',
      provider: 'openai',
      status: 'started',
      groupId,
    });

    const groupTasks = store.listTasksByGroupId(groupId);
    expect(groupTasks.length).toBe(2);
    expect(groupTasks[0].taskId).toBe(t1.taskId);
    expect(groupTasks[1].taskId).toBe(t2.taskId);
    expect(groupTasks[0].groupId).toBe(groupId);
    expect(groupTasks[1].groupId).toBe(groupId);

    // Standalone task
    const t3 = store.createTask({
      taskId: 'test-standalone',
      worktreePath: '/path/to/wt3',
      branch: 'murl/test-standalone',
      prompt: 'Standalone prompt',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      provider: 'together',
      status: 'started',
    });
    expect(t3.groupId).toBeNull();
    const retrievedT3 = store.getTask(t3.taskId);
    expect(retrievedT3!.task.groupId).toBeNull();
  });
});

