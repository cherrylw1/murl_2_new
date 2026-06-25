/**
 * PreviewPane.tsx — dev server launcher + log stream + URL surfacing.
 *
 * Design (see docs/preview-design-decision.md):
 * - Shows an editable command field (defaulted from package.json "dev" script).
 * - Nothing runs until the user explicitly clicks "Start" — no surprise execution.
 * - Once running: streams raw stdout/stderr in mono style, shows detected URL
 *   as a clickable button that opens in the system browser (shell.openExternal).
 * - Stop button kills the process cleanly.
 * - Cleans up push listeners on unmount.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

type PreviewState = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

interface PreviewPaneProps {
  taskId: string;
  worktreePath: string;
}

export default function PreviewPane({ taskId, worktreePath }: PreviewPaneProps) {
  const [command, setCommand] = useState<string>('');
  const [commandLoaded, setCommandLoaded] = useState(false);
  const [state, setState] = useState<PreviewState>('idle');
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load the suggested command from the worktree's package.json
  useEffect(() => {
    window.murl.getPreviewCommand(worktreePath)
      .then((suggested) => {
        setCommand(suggested ?? 'npm run dev');
        setCommandLoaded(true);
      })
      .catch(() => {
        setCommand('npm run dev');
        setCommandLoaded(true);
      });
  }, [worktreePath]);

  // Wire push listeners for this task's preview session
  useEffect(() => {
    const handleLog = (payload: { taskId: string; line: string }) => {
      if (payload.taskId !== taskId) return;
      setLogs((prev) => [...prev, payload.line]);
    };

    const handleUrl = (payload: { taskId: string; url: string }) => {
      if (payload.taskId !== taskId) return;
      setDetectedUrl(payload.url);
      setState('running');
    };

    const handleExit = (payload: { taskId: string; code: number | null }) => {
      if (payload.taskId !== taskId) return;
      setState('stopped');
    };

    window.murl.onPreviewLog(handleLog);
    window.murl.onPreviewUrl(handleUrl);
    window.murl.onPreviewExit(handleExit);

    return () => {
      window.murl.offPreviewLog(handleLog);
      window.murl.offPreviewUrl(handleUrl);
      window.murl.offPreviewExit(handleExit);
      // Stop the preview server if still running when tab is closed/unmounted
      window.murl.stopPreview(taskId).catch(() => {});
    };
  }, [taskId]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = useCallback(async () => {
    if (!command.trim()) return;
    setState('starting');
    setLogs([]);
    setDetectedUrl(null);
    setError(null);
    try {
      await window.murl.startPreview(taskId, worktreePath, command.trim());
      // State becomes 'running' when murl:preview-url fires, or stays
      // 'starting' while we wait — logs stream in regardless.
    } catch (err: any) {
      setError(err.message || String(err));
      setState('error');
    }
  }, [taskId, worktreePath, command]);

  const handleStop = useCallback(async () => {
    await window.murl.stopPreview(taskId);
    setState('stopped');
  }, [taskId]);

  const handleOpenUrl = useCallback(async () => {
    if (detectedUrl) {
      await window.murl.openPreviewUrl(detectedUrl);
    }
  }, [detectedUrl]);

  const isActive = state === 'starting' || state === 'running';

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">

      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex-1 flex items-center gap-2 bg-carbon/50 border border-aluminium/15 rounded-lg px-3 py-2">
          <span className="text-aluminium/40 text-[10px] font-mono select-none shrink-0">$</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={isActive || !commandLoaded}
            placeholder={commandLoaded ? 'Enter dev command…' : 'Loading…'}
            className="flex-1 bg-transparent text-chalk text-xs font-mono outline-none placeholder-aluminium/25 disabled:opacity-50"
            onKeyDown={(e) => { if (e.key === 'Enter' && !isActive) handleStart(); }}
            spellCheck={false}
          />
        </div>

        {!isActive ? (
          <button
            onClick={handleStart}
            disabled={!command.trim() || !commandLoaded}
            className="px-3 py-2 rounded-lg bg-chalk/8 border border-aluminium/15 text-chalk/80 text-[10px] font-semibold tracking-wider transition-taste hover:bg-chalk/12 hover:text-chalk disabled:opacity-30 disabled:cursor-not-allowed select-none"
          >
            START
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="px-3 py-2 rounded-lg bg-signal/10 border border-signal/25 text-signal text-[10px] font-semibold tracking-wider transition-taste hover:bg-signal/15 select-none"
          >
            STOP
          </button>
        )}
      </div>

      {/* ── URL bar (shown when URL is detected) ────────────────────────── */}
      {detectedUrl && (
        <div className="shrink-0 flex items-center gap-3 bg-carbon/50 border border-aluminium/10 rounded-lg px-3 py-2.5 animate-fade-in">
          {/* Status dot — breathing while running, static when stopped */}
          <div
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              state === 'running'
                ? 'bg-chalk animate-breath'
                : 'bg-aluminium/40'
            }`}
          />
          <span className="text-aluminium/40 text-[10px] font-mono select-none shrink-0">URL</span>
          <button
            onClick={handleOpenUrl}
            title="Open in browser"
            className="flex-1 text-left text-chalk/80 text-xs font-mono hover:text-chalk underline decoration-aluminium/20 hover:decoration-chalk/40 transition-taste truncate select-text"
          >
            {detectedUrl}
          </button>
          <span className="text-aluminium/30 text-[9px] font-mono select-none shrink-0 italic">
            opens in browser
          </span>
        </div>
      )}

      {/* ── Waiting-for-URL nudge ────────────────────────────────────────── */}
      {state === 'starting' && !detectedUrl && logs.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 text-aluminium/40 text-[10px] select-none animate-breath">
          <div className="w-1 h-1 rounded-full bg-chalk/30 animate-breath" />
          Waiting for server URL…
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 text-signal text-xs font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-signal shrink-0 shadow-signal" />
          {error}
        </div>
      )}

      {/* ── Log stream ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-well border border-aluminium/10 rounded-lg overflow-y-auto p-3">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-aluminium/25 text-xs italic select-none">
            {state === 'idle' || state === 'stopped'
              ? 'Server output will appear here.'
              : 'Starting…'}
          </div>
        ) : (
          <div className="flex flex-col gap-0">
            {logs.map((line, i) => (
              <div
                key={i}
                className="font-mono text-[11px] text-chalk/70 leading-snug whitespace-pre-wrap break-all py-px"
              >
                {line || '\u00a0'}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* ── Stopped notice ──────────────────────────────────────────────── */}
      {state === 'stopped' && (
        <div className="shrink-0 text-aluminium/40 text-[10px] font-mono text-center select-none pb-1">
          Server stopped · Run the command again to restart
        </div>
      )}
    </div>
  );
}
