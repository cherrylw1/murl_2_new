/**
 * preview-manager.ts — manages per-task dev server processes.
 *
 * Design:
 * - One process per taskId (not a PTY — dev servers are not interactive;
 *   child_process.spawn with piped stdio is simpler and sufficient).
 * - Eligibility enforced here: worktree must exist on disk.
 * - URL detection: scans stdout/stderr for common dev-server URL patterns.
 * - Every process is cleaned up on stop(), stopAll(), keep/discard, app-quit.
 *
 * See docs/preview-design-decision.md for the BrowserView vs external-link
 * decision (short: external-link + log stream, matching VS Code / Cursor / Zed).
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

/** Common dev-server URL patterns to scan for in stdout/stderr. */
const URL_PATTERNS: RegExp[] = [
  /\bhttp:\/\/localhost:(\d+)\b/,
  /\bhttp:\/\/127\.0\.0\.1:(\d+)\b/,
  /Local:\s+http:\/\/localhost:(\d+)/i,
  /Local:\s+(http:\/\/[^\s]+)/i,
  /listening on.*?http:\/\/(localhost|127\.0\.0\.1):(\d+)/i,
  /server running at\s+(http:\/\/[^\s]+)/i,
  /ready.*?http:\/\/(localhost|127\.0\.0\.1):(\d+)/i,
  /started.*?http:\/\/(localhost|127\.0\.0\.1):(\d+)/i,
  /➜\s+Local:\s+(http:\/\/[^\s]+)/i,
  /\bhttp:\/\/localhost:(\d+)\/?\b/,
];

function detectUrl(line: string): string | null {
  for (const re of URL_PATTERNS) {
    const m = line.match(re);
    if (m) {
      // Return the full URL — prefer capture group that is a full URL
      for (let i = 1; i < m.length; i++) {
        if (m[i] && m[i].startsWith('http')) return m[i];
      }
      // Fallback: reconstruct from host+port captures
      if (m[1] && /^\d+$/.test(m[1])) return `http://localhost:${m[1]}`;
      if (m[2] && /^\d+$/.test(m[2])) return `http://localhost:${m[2]}`;
    }
  }
  return null;
}

export interface PreviewSession {
  taskId: string;
  worktreePath: string;
  command: string;
  process: ChildProcess;
  detectedUrl: string | null;
}

export class PreviewManager {
  private sessions = new Map<string, PreviewSession>();

  /**
   * Reads package.json in worktreePath and returns the suggested dev command.
   * Returns null if no package.json or no dev script is found.
   * Does NOT run anything.
   */
  getSuggestedCommand(worktreePath: string): string | null {
    try {
      const pkgPath = path.join(worktreePath, 'package.json');
      if (!fs.existsSync(pkgPath)) return null;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts: Record<string, string> = pkg.scripts || {};
      // Priority order: dev > start > serve > preview
      for (const name of ['dev', 'start', 'serve', 'preview']) {
        if (scripts[name]) return `npm run ${name}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Starts a dev server process for the given task.
   * @throws if worktree doesn't exist, or if a server is already running for this task.
   */
  start(
    taskId: string,
    worktreePath: string,
    command: string,
    onLog: (line: string) => void,
    onUrl: (url: string) => void,
    onExit: (code: number | null) => void
  ): void {
    // Backend eligibility check
    if (!fs.existsSync(worktreePath)) {
      throw new Error(
        `Preview refused: worktree no longer exists at ${worktreePath}. ` +
        `The task has been kept or discarded.`
      );
    }
    if (this.sessions.has(taskId)) {
      throw new Error(`Preview already running for task ${taskId}.`);
    }

    // Parse command into executable + args
    // Use shell:true to handle npm/npx commands on Windows correctly
    const child = spawn(command, [], {
      cwd: worktreePath,
      shell: true,
      env: {
        ...process.env,
        // Ensure color output from CLI tools
        FORCE_COLOR: '1',
        NO_COLOR: undefined,
      },
      // Pipe so we can read stdout/stderr
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const session: PreviewSession = {
      taskId,
      worktreePath,
      command,
      process: child,
      detectedUrl: null,
    };
    this.sessions.set(taskId, session);

    const processLine = (line: string) => {
      onLog(line);
      if (!session.detectedUrl) {
        const url = detectUrl(line);
        if (url) {
          session.detectedUrl = url;
          onUrl(url);
        }
      }
    };

    // Buffer partial lines
    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      lines.forEach(processLine);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      lines.forEach(processLine);
    });

    child.on('close', (code) => {
      // Flush any remaining buffer
      if (stdoutBuf) processLine(stdoutBuf);
      if (stderrBuf) processLine(stderrBuf);
      this.sessions.delete(taskId);
      onExit(code);
    });

    child.on('error', (err) => {
      processLine(`[ERROR] Failed to start process: ${err.message}`);
      this.sessions.delete(taskId);
      onExit(null);
    });
  }

  /**
   * Stops the running dev server for a task.
   */
  stop(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) return;
    try {
      // On Windows, kill the whole process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(session.process.pid), '/f', '/t'], {
          shell: false,
          stdio: 'ignore',
        });
      } else {
        session.process.kill('SIGTERM');
      }
    } catch {
      // Ignore errors — process may have already exited
    }
    this.sessions.delete(taskId);
  }

  /**
   * Stop all running dev servers (called on app quit / cleanup).
   */
  stopAll(): void {
    for (const [taskId] of this.sessions) {
      this.stop(taskId);
    }
  }

  /**
   * Returns the currently detected URL for a task's dev server, or null.
   */
  getDetectedUrl(taskId: string): string | null {
    return this.sessions.get(taskId)?.detectedUrl ?? null;
  }

  /**
   * Returns whether a dev server is currently running for a task.
   */
  isRunning(taskId: string): boolean {
    return this.sessions.has(taskId);
  }
}
