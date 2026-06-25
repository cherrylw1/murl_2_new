/**
 * terminal-manager.ts — manages per-task PTY instances.
 *
 * Design rules:
 * - One PTY per taskId. Attempting to open a second terminal for the same
 *   task returns the existing one's ID (or creates fresh if closed).
 * - PTYs are scoped to the task's worktree path as their cwd.
 * - Eligibility is enforced here (not just in the UI): a task must have a
 *   worktree on disk and no outcome yet, OR be a special case where the
 *   worktree still exists (e.g. running task).
 * - Every PTY is cleaned up on explicit close, app quit, or when
 *   keep/discard removes the worktree.
 */

import * as fs from 'fs';
import * as os from 'os';

// node-pty is a native module — loaded via require() so Vite doesn't bundle it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty');

export interface TerminalSession {
  taskId: string;
  /** Unique session ID for this terminal (so we can reference it in IPC) */
  sessionId: string;
  ptyProcess: ReturnType<typeof pty.spawn>;
  worktreePath: string;
}

export class TerminalManager {
  /** Map from taskId to its active terminal session */
  private sessions = new Map<string, TerminalSession>();

  /**
   * Opens (or returns existing) a terminal for the given task.
   * @param taskId — task identifier
   * @param worktreePath — absolute path to the worktree (used as cwd + eligibility check)
   * @param onData — callback for data streaming back to renderer
   * @param onExit — callback when the shell exits
   * @returns sessionId string
   * @throws if worktree doesn't exist on disk
   */
  open(
    taskId: string,
    worktreePath: string,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ): string {
    // Eligibility check in the backend (not just UI)
    if (!fs.existsSync(worktreePath)) {
      throw new Error(
        `Terminal refused: worktree no longer exists at ${worktreePath}. ` +
        `The task has been kept or discarded.`
      );
    }

    // If there's an existing live session for this task, return it
    const existing = this.sessions.get(taskId);
    if (existing) {
      return existing.sessionId;
    }

    const sessionId = `terminal-${taskId}`;
    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: worktreePath,
      env: {
        ...process.env,
        TERM: 'xterm-color',
        // Suppress PAGER so commands like git log don't wait for input
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      },
    });

    const session: TerminalSession = { taskId, sessionId, ptyProcess, worktreePath };
    this.sessions.set(taskId, session);

    ptyProcess.onData((data) => {
      onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(taskId);
      onExit(exitCode ?? 0);
    });

    return sessionId;
  }

  /**
   * Write data (keystrokes) to the terminal's stdin.
   */
  write(taskId: string, data: string): void {
    const session = this.sessions.get(taskId);
    if (session) {
      session.ptyProcess.write(data);
    }
  }

  /**
   * Resize the terminal (called when the renderer's xterm resizes).
   */
  resize(taskId: string, cols: number, rows: number): void {
    const session = this.sessions.get(taskId);
    if (session) {
      try {
        session.ptyProcess.resize(cols, rows);
      } catch {
        // Ignore resize errors on already-closed ptys
      }
    }
  }

  /**
   * Explicitly close/kill a terminal session.
   */
  close(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (session) {
      try {
        session.ptyProcess.kill();
      } catch {
        // Ignore kill errors
      }
      this.sessions.delete(taskId);
    }
  }

  /**
   * Close all active terminal sessions (called on app quit).
   */
  closeAll(): void {
    for (const [taskId] of this.sessions) {
      this.close(taskId);
    }
  }

  /**
   * Returns true if this task has an active terminal session.
   */
  hasSession(taskId: string): boolean {
    return this.sessions.has(taskId);
  }
}
