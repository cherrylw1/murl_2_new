import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter, MurlEvent } from './opencode-adapter.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process module
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    spawn: vi.fn().mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    }),
    exec: vi.fn((cmd, opts, callback) => {
      if (cmd.includes('git diff')) {
        callback(null, { stdout: 'mocked diff content' });
      } else {
        callback(null, { stdout: '' });
      }
    }),
  };
});

// Mock SDK client methods using hoisted block for correct initialization order
const { mockSubscribe, mockPrompt, mockCreateSession } = vi.hoisted(() => {
  return {
    mockSubscribe: vi.fn(),
    mockPrompt: vi.fn(),
    mockCreateSession: vi.fn(),
  };
});

vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencodeClient: vi.fn().mockReturnValue({
      session: {
        create: mockCreateSession,
        prompt: mockPrompt,
      },
      event: {
        subscribe: mockSubscribe,
      },
    }),
  };
});

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  let triggerSseEvent: any;
  const mockWorktreePath = path.resolve('./temp-mock-wt');

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp-mock-wt folder so fs.existsSync checks pass
    if (!fs.existsSync(mockWorktreePath)) {
      fs.mkdirSync(mockWorktreePath, { recursive: true });
    }

    adapter = new OpenCodeAdapter({
      binPath: 'mocked-opencode.exe',
      port: 5000,
    });

    const eventQueue: any[] = [];
    let resolveNext: (() => void) | null = null;
    let isTerminated = false;

    triggerSseEvent = (event: any) => {
      eventQueue.push(event);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    mockSubscribe.mockImplementation(() => {
      const generator = (async function* () {
        while (!isTerminated) {
          if (eventQueue.length > 0) {
            const ev = eventQueue.shift();
            yield ev ? ev.data : undefined;
          } else {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }
        }
      })();

      const mockReturn = vi.fn().mockImplementation(async () => {
        isTerminated = true;
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
        return { value: undefined, done: true };
      });

      return {
        stream: {
          [Symbol.asyncIterator]() {
            return generator;
          },
          return: mockReturn,
        },
      };
    });
  });

  afterEach(() => {
    if (fs.existsSync(mockWorktreePath)) {
      fs.rmSync(mockWorktreePath, { recursive: true, force: true });
    }
  });

  it('should successfully run a task and map SSE events', async () => {
    mockCreateSession.mockResolvedValue({
      data: { id: 'ses_mock123' },
    });

    mockPrompt.mockImplementation(async () => {
      // Simulate asynchronous events arriving during prompt processing
      process.nextTick(() => {
        // 1. Text token message
        triggerSseEvent({
          data: {
            type: 'message.part.updated',
            properties: {
              part: {
                sessionID: 'ses_mock123',
                type: 'text',
                text: 'Thinking text',
              },
              delta: 'Thinking',
            },
          },
        });

        // 2. Tool call action
        triggerSseEvent({
          data: {
            type: 'message.part.updated',
            properties: {
              part: {
                sessionID: 'ses_mock123',
                type: 'tool',
                tool: 'write',
                state: {
                  status: 'completed',
                  input: { filePath: 'src/main.ts' },
                  output: 'Wrote file successfully',
                },
              },
            },
          },
        });

        // 3. Complete task via idle event
        triggerSseEvent({
          data: {
            type: 'session.idle',
            properties: {
              sessionID: 'ses_mock123',
            },
          },
        });
      });
    });

    const events: MurlEvent[] = [];
    const result = await adapter.runTask(
      mockWorktreePath,
      'Write main.ts',
      {},
      (e: MurlEvent) => events.push(e)
    );

    // Verify correct properties in opencode.json written to worktree
    const configWritten = JSON.parse(
      fs.readFileSync(path.join(mockWorktreePath, 'opencode.json'), 'utf8')
    );
    expect(configWritten.model).toContain('meta-llama/Llama-3.3-70B-Instruct-Turbo');

    expect(result.diff).toBe('mocked diff content');

    // Verify events list
    expect(events).toContainEqual({ type: 'status', status: 'started' });
    expect(events).toContainEqual({ type: 'status', status: 'running' });
    expect(events).toContainEqual({
      type: 'message',
      role: 'assistant',
      contentType: 'text',
      content: 'Thinking text',
      delta: 'Thinking',
    });
    expect(events).toContainEqual({
      type: 'action',
      actionType: 'tool_response',
      toolName: 'write',
      input: { filePath: 'src/main.ts' },
      output: 'Wrote file successfully',
      status: 'completed',
    });
    expect(events).toContainEqual({ type: 'status', status: 'completed' });
  });

  it('should handle session execution failures gracefully', async () => {
    mockCreateSession.mockResolvedValue({
      data: { id: 'ses_mock123' },
    });

    mockPrompt.mockImplementation(async () => {
      process.nextTick(() => {
        triggerSseEvent({
          data: {
            type: 'session.error',
            properties: {
              sessionID: 'ses_mock123',
              error: 'Failed to access key',
            },
          },
        });
      });
    });

    await expect(
      adapter.runTask(mockWorktreePath, 'Failed prompt', {})
    ).rejects.toThrow('OpenCode task failed: Failed to access key');
  });

  it('should handle prompt rejection failures gracefully', async () => {
    mockCreateSession.mockResolvedValue({
      data: { id: 'ses_mock123' },
    });

    mockPrompt.mockRejectedValue(new Error('Prompt error'));

    await expect(
      adapter.runTask(mockWorktreePath, 'Rejected prompt', {})
    ).rejects.toThrow('OpenCode task failed: Prompt error');
  });
});
