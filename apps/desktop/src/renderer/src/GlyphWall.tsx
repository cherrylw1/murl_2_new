/**
 * GlyphWall — the signature component.
 *
 * A grid of small status cells, one per active task. Visual language per
 * design.md §4 and taste.md §"The signature":
 *
 *   queued   → dim aluminium dot, static
 *   running  → chalk dot + shadow-active + animate-breath (3 s ease-in-out)
 *   done     → chalk dot + shadow-active, static (settled, not breathing)
 *   failed   → signal dot + shadow-signal + animate-pulse-signal (1 s)
 *   cancelled→ aluminium/30, static
 *
 * Hover: tooltip with task description, state word, elapsed time.
 * Click: calls onInspect(taskId).
 *
 * No new colors, no new animation curves — everything is direct reuse of
 * Phase 1.2's status-light language, now at scale.
 */

import React, { useState } from 'react';
import { PersistedTask } from '../../preload/types.js';

// ─── Props ────────────────────────────────────────────────────────────────────

interface GlyphWallProps {
  tasks: PersistedTask[];
  tickNow: number;
  onInspect: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(startMs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Short sequential ID derived from taskId suffix — "A1", "A2" … "A∞"
// We use the last 3 hex chars of the taskId, convert to a number mod 999.
// This is display-only; no uniqueness contract is needed across sessions.
function shortId(taskId: string, index: number): string {
  return String(index + 1).padStart(2, '0');
}

function stateWord(status: string): string {
  switch (status) {
    case 'running':   return 'RUNNING';
    case 'queued':    return 'QUEUED';
    case 'completed': return 'DONE';
    case 'failed':    return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    default:          return status.toUpperCase();
  }
}

// ─── Single cell ──────────────────────────────────────────────────────────────

interface GlyphCellProps {
  task: PersistedTask;
  index: number;
  tickNow: number;
  onInspect: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}

function GlyphCell({ task: t, index, tickNow, onInspect, onDismiss, onCancel }: GlyphCellProps) {
  const [hovered, setHovered] = useState(false);

  const isRunning   = t.status === 'running';
  const isQueued    = t.status === 'queued';
  const isDone      = t.status === 'completed';
  const isFailed    = t.status === 'failed';
  const isCancelled = t.status === 'cancelled';
  const isOverBudget = typeof t.costUsd === 'number' && typeof t.budgetCap === 'number' && t.costUsd > t.budgetCap;

  // Status dot classes — exact reuse of Phase 1.2 design system
  const dotClass = isOverBudget
    ? 'bg-signal shadow-signal animate-pulse-signal'   // over-budget matches signal pulse
    : isRunning
    ? 'bg-chalk shadow-active animate-breath'          // breathing white glow
    : isQueued
    ? 'bg-aluminium/30'                                // dim, static
    : isDone
    ? 'bg-chalk shadow-active'                         // steady glow, settled
    : isFailed
    ? 'bg-signal shadow-signal animate-pulse-signal'   // red pulse
    : 'bg-aluminium/20';                               // cancelled, very dim

  // Cell border brightens slightly on hover
  const cellBorder = hovered
    ? 'border-aluminium/30'
    : isOverBudget || isFailed
    ? 'border-signal/20'
    : isRunning
    ? 'border-aluminium/15'
    : 'border-aluminium/8';

  // Subtle cell glow when active (running or just-done)
  const cellGlow = isRunning
    ? 'shadow-[0_0_32px_rgba(250,250,250,0.04)]'
    : isOverBudget || isFailed
    ? 'shadow-[0_0_24px_rgba(215,25,33,0.08)]'
    : '';

  const elapsed = isRunning ? formatElapsed(t.createdAt, tickNow) : null;

  // Truncate prompt for tooltip
  const promptPreview = t.prompt.length > 72 ? t.prompt.slice(0, 69) + '…' : t.prompt;

  const canCancel  = isRunning || isQueued;
  const canDismiss = (isFailed || isCancelled) || (isDone && t.outcome !== null);

  return (
    <div
      id={`glyph-cell-${t.taskId}`}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Cell body ── */}
      <button
        onClick={() => onInspect(t.taskId)}
        aria-label={`Task ${shortId(t.taskId, index)}: ${stateWord(t.status)} — ${t.prompt.slice(0, 60)}`}
        className={[
          // Base surface — carbon, 6px radius, hairline — per design.md §4
          'w-20 h-20 bg-carbon rounded border transition-all duration-200',
          'flex flex-col items-start justify-between p-2.5',
          'cursor-pointer focus:outline-none focus:ring-1 focus:ring-chalk/40',
          cellBorder,
          cellGlow,
        ].join(' ')}
      >
        {/* Top row: status dot + ID */}
        <div className="flex items-center justify-between w-full">
          {/* Status dot — 8px, same as header status light in Phase 1.2 */}
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />

          {/* Task ID in micro-dot face */}
          <span className={`font-dot text-[8px] leading-none tracking-wider select-none ${
            isOverBudget || isFailed ? 'text-signal' : isRunning || isDone ? 'text-chalk/60' : 'text-aluminium/40'
          }`}>
            {shortId(t.taskId, index)}
          </span>
        </div>

        {/* Bottom: elapsed or outcome */}
        <div className="w-full text-left">
          {elapsed && (
            <span className="font-dot text-[7px] text-chalk/50 leading-none block tabular-nums">
              {elapsed}
            </span>
          )}
          {isDone && !elapsed && (
            <span className="font-dot text-[7px] text-chalk/40 leading-none block">
              {t.outcome ? t.outcome.replace('-', ' ').toUpperCase() : 'DONE'}
            </span>
          )}
          {isFailed && (
            <span className="font-dot text-[7px] text-signal/70 leading-none block">
              ERR
            </span>
          )}
          {isCancelled && (
            <span className="font-dot text-[7px] text-aluminium/35 leading-none block">
              CXLD
            </span>
          )}
          {isQueued && (
            <span className="font-dot text-[7px] text-aluminium/30 leading-none block">
              {t.queuePosition !== undefined ? `Q·${t.queuePosition + 1}` : 'Q'}
            </span>
          )}
          {typeof t.costUsd === 'number' && (
            <span className={`font-dot text-[7px] leading-none block mt-0.5 ${isOverBudget ? 'text-signal font-bold' : 'text-aluminium/50'}`}>
              ${t.costUsd.toFixed(2)}
            </span>
          )}
        </div>
      </button>

      {/* ── Hover tooltip ── */}
      {hovered && (
        <div
          className={[
            'absolute z-50 pointer-events-none',
            // Position above the cell; if there's no room, could overlap but
            // keeping it simple — always above
            'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2',
            'min-w-[200px] max-w-[280px]',
            'bg-carbon/95 border border-aluminium/20 rounded px-3 py-2.5',
            'flex flex-col gap-1',
            // Subtle backdrop blur for frosted-panel feel
            'backdrop-blur-sm',
            // Shadow to lift above surface
            'shadow-[0_4px_16px_rgba(0,0,0,0.6)]',
          ].join(' ')}
          role="tooltip"
        >
          {/* State word + elapsed — dot-face per design.md */}
          <div className="flex items-center gap-2">
            <span className={`font-dot text-[9px] leading-none font-bold ${
              isFailed ? 'text-signal' : isRunning ? 'text-chalk' : isQueued ? 'text-aluminium/60' : 'text-chalk/70'
            }`}>
              {stateWord(t.status)}
            </span>
            {elapsed && (
              <span className="font-dot text-[9px] leading-none text-aluminium/60 tabular-nums">
                {elapsed}
              </span>
            )}
            {t.outcome && (
              <span className="font-dot text-[9px] leading-none text-chalk/50">
                {t.outcome.replace('-', ' ').toUpperCase()}
              </span>
            )}
          </div>

          {/* Prompt preview — data/mono per design.md */}
          <p className="font-mono text-[10px] leading-snug text-chalk/70 break-words">
            {promptPreview}
          </p>

          {/* Cost display */}
          {typeof t.costUsd === 'number' && (
            <p className="font-mono text-[9px] leading-none mt-1">
              <span className={isOverBudget ? 'text-signal font-bold' : 'text-aluminium/60'}>
                Cost: ${t.costUsd.toFixed(4)}
              </span>
              {t.budgetCap && (
                <span className="text-aluminium/40">
                  {' '}/ Cap: ${t.budgetCap.toFixed(2)}
                </span>
              )}
            </p>
          )}

          {/* Repo + branch */}
          <p className="font-mono text-[9px] leading-none text-aluminium/50 truncate">
            {t.repoPath?.split(/[/\\]/).pop() ?? '—'} · {t.branch ?? '—'}
          </p>

          {/* Note: tooltip is pointer-events-none; Cancel/Dismiss are
              available after clicking the cell to open the detail pane. */}
        </div>
      )}
    </div>
  );
}

// ─── The Wall ─────────────────────────────────────────────────────────────────

export default function GlyphWall({ tasks, tickNow, onInspect, onDismiss, onCancel }: GlyphWallProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
        {/* Empty-state per design.md: dot-grid invitation, single dimmed line */}
        <div className="flex flex-col items-center gap-4">
          {/* A 3×3 grid of dim placeholder cells to hint the wall structure */}
          <div className="grid grid-cols-4 gap-2 opacity-20">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="w-20 h-20 bg-carbon/60 rounded border border-aluminium/8"
              />
            ))}
          </div>
          <p className="text-data text-aluminium/60 text-center text-xs max-w-[220px] leading-relaxed mt-2">
            No active tasks. Launch one from the panel on the left.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="glyph-wall"
      className="flex-1 overflow-y-auto min-h-0"
      aria-label={`Glyph Wall — ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
    >
      {/* Cells wrap naturally — the wall grows right then down */}
      <div className="flex flex-wrap gap-3 content-start pb-4">
        {tasks.map((t, i) => (
          <GlyphCell
            key={t.taskId}
            task={t}
            index={i}
            tickNow={tickNow}
            onInspect={onInspect}
            onDismiss={onDismiss}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}
