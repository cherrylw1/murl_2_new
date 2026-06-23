import { ChildProcess, spawn } from 'child_process';
import { createOpencodeClient, OpencodeClient } from '@opencode-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type MurlTaskStatus = 'started' | 'running' | 'completed' | 'failed';

export interface MurlStatusEvent {
  type: 'status';
  status: MurlTaskStatus;
  error?: string;
}

export interface MurlMessageEvent {
  type: 'message';
  role: 'assistant' | 'user';
  contentType: 'text' | 'reasoning';
  content: string;
  delta?: string;
}

export interface MurlActionEvent {
  type: 'action';
  actionType: 'tool_call' | 'tool_response';
  toolName: string;
  input?: any;
  output?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export type MurlEvent = MurlStatusEvent | MurlMessageEvent | MurlActionEvent;

export class OpenCodeAdapter {
  private serverProcess: ChildProcess | null = null;
  private client: OpencodeClient | null = null;
  private port: number;
  private binPath: string;

  constructor(options?: { port?: number; binPath?: string }) {
    this.port = options?.port || 4096;
    this.binPath = options?.binPath || this.resolveBinPath();
  }

  private resolveBinPath(): string {
    if (process.env.OPENCODE_BIN_PATH) {
      return process.env.OPENCODE_BIN_PATH;
    }
    // Dev fallback for spike workspace
    const devFallback = 'C:/Content/murl_spike/node_modules/opencode-ai/bin/opencode.exe';
    if (fs.existsSync(devFallback)) {
      return devFallback;
    }
    return 'opencode';
  }

  /**
   * Returns whether the server process is currently running.
   */
  isServerRunning(): boolean {
    return this.serverProcess !== null;
  }

  /**
   * Starts the persistent opencode serve process if it is not already running.
   */
  async startServer(cwd?: string): Promise<void> {
    if (this.serverProcess) {
      return;
    }

    if (this.binPath.includes('/') || this.binPath.includes('\\')) {
      if (!fs.existsSync(this.binPath)) {
        throw new Error(`OpenCode binary not found at: ${this.binPath}`);
      }
    }

    this.serverProcess = spawn(this.binPath, ['serve', '--port', String(this.port), '--hostname', '127.0.0.1'], {
      cwd: cwd ? path.resolve(cwd) : undefined,
      env: { ...process.env },
      stdio: 'pipe',
    });

    // Prevent processes from blocking on full stdout/stderr buffers
    this.serverProcess.stdout?.on('data', () => {});
    this.serverProcess.stderr?.on('data', () => {});

    // Wait for the server daemon to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    this.client = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${this.port}`,
      throwOnError: true,
    });
  }

  /**
   * Shuts down the persistent opencode serve process cleanly.
   */
  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.client = null;
    }
  }

  /**
   * Runs a task in the specified worktree using the configured model and prompt.
   */
  async runTask(
    worktreePath: string,
    prompt: string,
    modelConfig?: {
      provider?: string;
      model?: string;
      timeoutMs?: number;
    },
    onEvent?: (event: MurlEvent) => void
  ): Promise<{
    events: MurlEvent[];
    diff: string;
  }> {
    await this.startServer(worktreePath);
    if (!this.client) {
      throw new Error('OpenCode client is not initialized.');
    }

    const controller = new AbortController();
    const model = modelConfig?.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
    const resolvedWorktreePath = path.resolve(worktreePath);

    // 1. Write the opencode.json settings file to enable multi-model support
    const opencodeJsonPath = path.join(resolvedWorktreePath, 'opencode.json');
    const opencodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        together: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Together',
          options: {
            baseURL: 'https://api.together.xyz/v1',
            apiKey: '{env:TOGETHER_API_KEY}',
          },
          models: {
            [model]: { name: model.split('/').pop() || 'Model' },
          },
        },
      },
      model: `together/${model}`,
    };
    fs.writeFileSync(opencodeJsonPath, JSON.stringify(opencodeConfig, null, 2));

    // 2. Create the session
    const sessionResponse = await this.client.session.create({
      query: { directory: resolvedWorktreePath.replace(/\\/g, '/') },
      body: { title: 'Murl Task Session' },
    });

    const sessionId = sessionResponse.data?.id;
    if (!sessionId) {
      throw new Error('Failed to create session: no session ID returned.');
    }

    const collectedEvents: MurlEvent[] = [];
    const emit = (event: MurlEvent) => {
      collectedEvents.push(event);
      if (onEvent) {
        onEvent(event);
      }
    };

    emit({ type: 'status', status: 'started' });

    let isDone = false;
    let errorMsg: string | undefined;

    // 3. Subscribe to the SSE event stream
    const sseResult = await this.client.event.subscribe({
      query: { directory: resolvedWorktreePath.replace(/\\/g, '/') },
      signal: controller.signal,
      onSseError: (err: any) => {
        console.error('SSE Stream Error:', err);
      },
    } as any);

    // Helper to abort signal and close stream iterator (safely supports mock stream return)
    const cleanup = () => {
      try {
        controller.abort();
        if (sseResult.stream && typeof sseResult.stream.return === 'function') {
          sseResult.stream.return(undefined).catch(() => {});
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    // 4. Consume the stream asynchronously in the background
    const consumePromise = (async () => {
      try {
        for await (const ev of sseResult.stream as any) {
          if (!ev) continue;

          if (ev.type === 'session.idle' && ev.properties?.sessionID === sessionId) {
            isDone = true;
            break;
          } else if (ev.type === 'session.error' && ev.properties?.sessionID === sessionId) {
            isDone = true;
            errorMsg = typeof ev.properties.error === 'string'
              ? ev.properties.error
              : JSON.stringify(ev.properties.error);
            break;
          } else if (ev.type === 'message.part.updated' && ev.properties?.part?.sessionID === sessionId) {
            const part = ev.properties.part;
            const delta = ev.properties.delta;

            if (part.type === 'text') {
              emit({
                type: 'message',
                role: 'assistant',
                contentType: 'text',
                content: part.text || '',
                delta,
              });
            } else if (part.type === 'reasoning') {
              emit({
                type: 'message',
                role: 'assistant',
                contentType: 'reasoning',
                content: part.text || '',
                delta,
              });
            } else if (part.type === 'tool') {
              const toolState = part.state;
              let status: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
              if (toolState.status === 'running') status = 'running';
              else if (toolState.status === 'completed') status = 'completed';
              else if (toolState.status === 'error') status = 'failed';

              emit({
                type: 'action',
                actionType: toolState.status === 'completed' || toolState.status === 'error' ? 'tool_response' : 'tool_call',
                toolName: part.tool || 'unknown',
                input: toolState.input,
                output: toolState.output || toolState.error,
                status,
              });
            }
          } else if (ev.type === 'file.edited') {
            const filePath = ev.properties?.file;
            if (filePath && path.resolve(filePath).startsWith(resolvedWorktreePath)) {
              emit({
                type: 'action',
                actionType: 'tool_response',
                toolName: 'file_edit',
                output: `Edited file: ${filePath}`,
                status: 'completed',
              });
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('SSE Generator Error:', err);
          errorMsg = err.message || String(err);
        }
        isDone = true;
      }
    })();

    emit({ type: 'status', status: 'running' });

    // 5. Send the prompt to initiate the task
    try {
      await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
        },
      });
    } catch (err: any) {
      isDone = true;
      errorMsg = err.message || String(err);
      cleanup();
    }

    // 6. Wait for the task execution to conclude (or time out)
    const timeoutMs = modelConfig?.timeoutMs || 5 * 60 * 1000;
    let timeoutId: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Task execution timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      await Promise.race([consumePromise, timeoutPromise]);
    } catch (err: any) {
      isDone = true;
      errorMsg = err.message || String(err);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // 7. Clean up SSE subscription
    cleanup();

    // 8. Verify task outcomes
    if (errorMsg) {
      emit({ type: 'status', status: 'failed', error: errorMsg });
      throw new Error(`OpenCode task failed: ${errorMsg}`);
    }

    emit({ type: 'status', status: 'completed' });

    // Intent-to-add followed by git diff
    let diff = '';
    try {
      await execAsync('git add -N .', { cwd: resolvedWorktreePath });
      const { stdout: diffOutput } = await execAsync('git diff', { cwd: resolvedWorktreePath });
      diff = diffOutput;
    } catch (err: any) {
      console.error('Failed to capture git diff:', err);
    }

    return {
      events: collectedEvents,
      diff,
    };
  }
}
