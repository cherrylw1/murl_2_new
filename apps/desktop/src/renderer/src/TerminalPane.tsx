/**
 * TerminalPane.tsx — embedded xterm.js terminal for a task's worktree.
 *
 * Uses the xterm.js + FitAddon pair, wired to node-pty via IPC.
 * Mounts/unmounts cleanly, closes the PTY session on unmount.
 *
 * Styling decisions:
 * - Background: ink (#0A0A0A), foreground: chalk (#E8E8E8)
 * - Standard 16 ANSI colors are allowed (they carry functional meaning in
 *   terminal output — see docs/spike-4.2-pty-findings.md for rationale).
 * - Font: JetBrains Mono (already available via @fontsource/jetbrains-mono).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  taskId: string;
  worktreePath: string;
}

// Murl palette mapped to xterm theme
const XTERM_THEME = {
  background:      '#0A0A0A', // ink
  foreground:      '#E8E8E8', // chalk
  cursor:          '#E8E8E8',
  cursorAccent:    '#0A0A0A',
  selectionBackground: '#2A2A2A',
  // ANSI colors — standard terminal palette, muted slightly for the ink background
  black:           '#1A1A1A', // carbon
  brightBlack:     '#5A5A5A', // aluminium
  red:             '#CC4A4A', // signal-adjacent (muted)
  brightRed:       '#E06C75',
  green:           '#5A9E5A',
  brightGreen:     '#8AC279',
  yellow:          '#D4A03A',
  brightYellow:    '#E5C07B',
  blue:            '#5285C8',
  brightBlue:      '#61AFEF',
  magenta:         '#9C6EB8',
  brightMagenta:   '#C678DD',
  cyan:            '#3B9A9A',
  brightCyan:      '#56B6C2',
  white:           '#BABABA',
  brightWhite:     '#E8E8E8', // chalk
};

export default function TerminalPane({ taskId, worktreePath }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClosingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    // 1. Create the xterm Terminal
    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: '"JetBrains Mono", "Geist Mono", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 2000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 2. Open the PTY session via IPC
    window.murl.openTerminal(taskId, worktreePath)
      .then(() => {
        if (!mounted) return;
        setIsReady(true);

        // 3. Wire terminal input -> PTY
        term.onData((data) => {
          window.murl.terminalInput(taskId, data);
        });

        // 4. Handle resize
        term.onResize(({ cols, rows }) => {
          window.murl.terminalResize(taskId, cols, rows);
        });
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err.message || String(err));
      });

    // 5. Receive PTY output -> xterm
    const handleData = (payload: { taskId: string; data: string }) => {
      if (payload.taskId === taskId && termRef.current) {
        termRef.current.write(payload.data);
      }
    };

    const handleExit = (payload: { taskId: string; exitCode: number }) => {
      if (payload.taskId === taskId && termRef.current) {
        termRef.current.write(`\r\n\x1b[2m[shell exited: ${payload.exitCode}]\x1b[0m\r\n`);
      }
    };

    window.murl.onTerminalData(handleData);
    window.murl.onTerminalExit(handleExit);

    // 6. ResizeObserver to keep xterm fitted to its container
    const ro = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore resize errors on unmounted terminals
        }
      }
    });
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => {
      mounted = false;
      isClosingRef.current = true;

      window.murl.offTerminalData(handleData);
      window.murl.offTerminalExit(handleExit);

      ro.disconnect();

      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;

      // Tell the main process to kill the PTY
      window.murl.closeTerminal(taskId).catch(() => {});
    };
  }, [taskId, worktreePath]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 select-none">
        <div className="w-2 h-2 rounded-full bg-signal shadow-signal" />
        <div className="text-signal text-xs font-mono text-center max-w-sm break-words">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden rounded-lg"
      style={{ background: '#0A0A0A' }}
    >
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ padding: '8px' }}
      />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-aluminium/40 text-xs animate-breath">Starting terminal…</span>
        </div>
      )}
    </div>
  );
}
