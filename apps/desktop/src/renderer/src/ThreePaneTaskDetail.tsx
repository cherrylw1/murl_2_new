import React, { useEffect, useRef, useState } from 'react';
import { MurlEvent, PersistedTask } from '../../preload/types.js';
import { parseGitDiff, ParsedFileDiff } from './diff-parser.js';
import Prism from 'prismjs';

// Import languages for syntax highlighting
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-bash.js';

interface ThreePaneTaskDetailProps {
  task: Partial<PersistedTask>;
  events: MurlEvent[];
  diff: string;
  runState: 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';
  errorMessage?: string;
  onBack: () => void;
  onCancel?: () => void;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return 'plaintext';
  }
}

function renderToken(token: string | Prism.Token, key: number): React.ReactNode {
  if (typeof token === 'string') {
    return token;
  }
  const className = `token ${token.type}`;
  return (
    <span key={key} className={className}>
      {Array.isArray(token.content)
        ? token.content.map((t, idx) => renderToken(t, idx))
        : renderToken(token.content, 0)}
    </span>
  );
}

function highlightLine(content: string, language: string): React.ReactNode {
  if (language === 'plaintext' || !content.trim()) {
    return content;
  }
  try {
    const grammar = Prism.languages[language];
    if (!grammar) return content;
    const tokens = Prism.tokenize(content, grammar);
    return tokens.map((t, idx) => renderToken(t, idx));
  } catch (err) {
    console.error('Failed to tokenize line:', err);
    return content;
  }
}

function renderDetailEvent(event: MurlEvent, idx: number): React.ReactNode {
  if (event.type === 'status') {
    return (
      <div key={idx} className="text-aluminium/70 text-xs py-1 border-b border-aluminium/5 font-mono">
        ● {event.status.toUpperCase()}{event.error ? ` — ${event.error}` : ''}
      </div>
    );
  }
  if (event.type === 'message') {
    if (event.contentType === 'reasoning' && event.content) {
      return (
        <div key={idx} className="text-aluminium/45 text-xs italic whitespace-pre-wrap break-words py-1.5 border-b border-aluminium/5 font-mono">
          [thinking] {event.content}
        </div>
      );
    }
    if (event.content) {
      return (
        <div key={idx} className="text-chalk text-xs whitespace-pre-wrap break-words py-1.5 border-b border-aluminium/5 font-sans leading-relaxed">
          {event.content}
        </div>
      );
    }
    return null;
  }
  if (event.type === 'action') {
    const arrow = event.actionType === 'tool_call' ? '→' : '←';
    return (
      <div key={idx} className="text-aluminium text-xs py-1 border-b border-aluminium/5 font-mono">
        <span className="text-aluminium/40">{arrow}</span>{' '}
        <span className="font-semibold text-chalk/80">{event.toolName}</span>{' '}
        <span className="text-aluminium/50">[{event.status}]</span>
        {event.status === 'failed' && event.output && (
          <div className="text-signal/80 text-[10px] mt-0.5 truncate pl-3">{String(event.output)}</div>
        )}
      </div>
    );
  }
  return null;
}

export default function ThreePaneTaskDetail({
  task,
  events,
  diff,
  runState,
  errorMessage,
  onBack,
  onCancel,
}: ThreePaneTaskDetailProps) {
  const [parsedFiles, setParsedFiles] = useState<ParsedFileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const eventLogBottomRef = useRef<HTMLDivElement>(null);

  const [outcome, setOutcome] = useState<'kept' | 'discarded' | null>((task.outcome as any) || null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [isOutcomePending, setIsOutcomePending] = useState<boolean>(false);

  const handleKeep = async () => {
    if (!task.taskId) return;
    setIsOutcomePending(true);
    setOutcomeError(null);
    try {
      const result = await window.murl.keepTask(task.taskId);
      if (result.success) {
        setOutcome('kept');
      } else {
        setOutcomeError(result.message || 'Failed to keep task changes.');
      }
    } catch (err: any) {
      setOutcomeError(err.message || String(err));
    } finally {
      setIsOutcomePending(false);
    }
  };

  const handleDiscard = async () => {
    if (!task.taskId) return;
    setIsOutcomePending(true);
    setOutcomeError(null);
    try {
      const result = await window.murl.discardTask(task.taskId);
      if (result.success) {
        setOutcome('discarded');
      } else {
        setOutcomeError(result.message || 'Failed to discard task.');
      }
    } catch (err: any) {
      setOutcomeError(err.message || String(err));
    } finally {
      setIsOutcomePending(false);
    }
  };

  // Parse diff whenever it changes
  useEffect(() => {
    const files = parseGitDiff(diff);
    setParsedFiles(files);
    if (files.length > 0) {
      // Keep selection if it still exists, otherwise select the first file
      const stillExists = files.some((f) => f.filePath === selectedFile);
      if (!stillExists) {
        setSelectedFile(files[0].filePath);
      }
    } else {
      setSelectedFile('');
    }
  }, [diff]);

  // Auto-scroll event stream to bottom
  useEffect(() => {
    eventLogBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const activeFile = parsedFiles.find((f) => f.filePath === selectedFile);
  const fileLanguage = activeFile ? getLanguageFromPath(activeFile.filePath) : 'plaintext';

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
      {/* Header section */}
      <div className="flex flex-col gap-3 pb-4 border-b border-aluminium/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-label text-aluminium hover:text-chalk flex items-center gap-1.5 transition-taste"
            >
              ← Back
            </button>
            <h2 className="text-title text-chalk font-semibold truncate max-w-md">
              {task.prompt || 'Coding Task'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-carbon/50 px-3 py-1 rounded border border-aluminium/10">
              <div
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  runState === 'running'
                    ? 'bg-chalk shadow-active animate-breath'
                    : runState === 'completed'
                      ? 'bg-chalk shadow-active animate-breath'
                      : runState === 'failed'
                        ? 'bg-signal shadow-signal animate-pulse-signal'
                        : 'bg-aluminium'
                }`}
              />
              <span
                className={`text-label font-medium ${
                  runState === 'failed' ? 'text-signal' : 'text-chalk'
                }`}
              >
                {runState.toUpperCase()}
              </span>
            </div>

            {onCancel && runState === 'running' && (
              <button
                onClick={onCancel}
                className="px-4 py-1.5 rounded bg-carbon border border-signal/40 text-label text-signal font-semibold hover:bg-signal/10 transition-taste"
              >
                Cancel
              </button>
            )}

            {isOutcomePending && (
              <span className="text-label text-aluminium animate-breath">
                Processing merge decision…
              </span>
            )}

            {runState === 'completed' && outcome === null && !isOutcomePending && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleKeep}
                  className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk font-semibold hover:shadow-active transition-taste"
                >
                  Keep
                </button>
                <button
                  onClick={handleDiscard}
                  className="px-4 py-1.5 rounded bg-transparent border border-aluminium/15 text-label text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste"
                >
                  Discard
                </button>
              </div>
            )}

            {outcome && (
              <div className={`text-label text-[10px] px-2.5 py-1 rounded border font-mono select-none font-semibold ${
                outcome === 'kept'
                  ? 'border-aluminium/20 text-chalk bg-carbon/50 shadow-active animate-breath'
                  : 'border-transparent text-aluminium/65 bg-carbon/25'
              }`}>
                {outcome === 'kept' ? 'kept & merged' : 'discarded'}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-data text-aluminium/60 text-xs">
          {task.model && (
            <div>
              <span className="text-label text-[10px] text-aluminium/40 mr-1.5">MODEL:</span>
              <span className="font-mono text-aluminium/85">{task.model}</span>
            </div>
          )}
          {task.branch && (
            <div>
              <span className="text-label text-[10px] text-aluminium/40 mr-1.5">BRANCH:</span>
              <span className="font-mono text-aluminium/85">{task.branch}</span>
            </div>
          )}
          {task.createdAt && (
            <div>
              <span className="text-label text-[10px] text-aluminium/40 mr-1.5">STARTED:</span>
              <span className="font-mono text-aluminium/85">{new Date(task.createdAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        {runState === 'failed' && errorMessage && (
          <div className="bg-carbon/50 border border-signal/30 p-3.5 rounded flex items-start gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-signal shadow-signal animate-pulse-signal mt-1 flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-signal tracking-wider font-semibold">FAILURE ERROR LOG</span>
              <span className="text-data text-signal/80 text-xs break-words">{errorMessage}</span>
            </div>
          </div>
        )}

        {outcomeError && (
          <div className="bg-carbon/50 border border-signal/30 p-3.5 rounded flex items-start gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-signal shadow-signal animate-pulse-signal mt-1 flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-signal tracking-wider font-semibold">MERGE DECISION ERROR</span>
              <span className="text-data text-signal/80 text-xs break-words">{outcomeError}</span>
            </div>
          </div>
        )}
      </div>

      {/* Three Pane Layout */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden mt-4">
        
        {/* LEFT PANE: Changed Files Tree */}
        <div className="w-64 bg-carbon/25 border border-aluminium/10 rounded-lg p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="text-label text-aluminium/50 mb-3 text-[10px] tracking-wider shrink-0 select-none">
            CHANGED FILES
          </div>
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5">
            {parsedFiles.length === 0 ? (
              <div className="text-aluminium/40 text-xs italic p-2 select-none">
                {runState === 'running' ? 'Waiting for changes…' : 'No files changed.'}
              </div>
            ) : (
              parsedFiles.map((file) => {
                const isSelected = file.filePath === selectedFile;
                return (
                  <div
                    key={file.filePath}
                    onClick={() => setSelectedFile(file.filePath)}
                    className={`cursor-pointer rounded p-2.5 flex flex-col gap-1 border transition-taste ${
                      isSelected
                        ? 'bg-carbon/90 border-aluminium/20 shadow-active'
                        : 'bg-transparent border-transparent hover:bg-carbon/40'
                    }`}
                  >
                    <div className="text-xs font-mono text-chalk/90 break-all select-none">
                      {file.filePath}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-aluminium/60 font-mono select-none">
                      <span className="text-[9px] uppercase tracking-wide opacity-50">
                        {file.changeType}
                      </span>
                      <span className="bg-well/65 border border-aluminium/10 px-1.5 py-0.5 rounded text-[9px] font-semibold text-chalk/50">
                        +{file.additions} -{file.deletions}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CENTER PANE: Code / Diff Viewer */}
        <div className="flex-1 bg-carbon/25 border border-aluminium/10 rounded-lg p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="text-label text-aluminium/50 mb-3 text-[10px] tracking-wider shrink-0 select-none flex justify-between items-center">
            <span>DIFF VIEWER</span>
            {activeFile && (
              <span className="text-[9px] text-aluminium/40 font-mono uppercase bg-carbon/50 px-1.5 py-0.5 rounded border border-aluminium/10">
                {activeFile.changeType} · {fileLanguage}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 bg-well border border-aluminium/20 rounded-lg overflow-hidden flex flex-col">
            {!activeFile ? (
              <div className="flex-1 flex items-center justify-center text-aluminium/40 text-xs italic select-none">
                {runState === 'running'
                  ? 'Waiting for task execution to modify files…'
                  : 'No changes to display.'}
              </div>
            ) : activeFile.isBinary ? (
              <div className="flex-1 flex items-center justify-center text-aluminium/50 text-xs font-mono select-none">
                Binary file, diff not shown
              </div>
            ) : activeFile.hunks.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-aluminium/40 text-xs italic select-none">
                Empty file diff
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-3 select-text">
                <div className="min-w-max font-mono text-xs leading-relaxed text-chalk/90">
                  {activeFile.hunks.map((hunk, hunkIdx) => (
                    <div key={hunkIdx} className="mb-4">
                      {/* Hunk Header */}
                      <div className="text-aluminium/40 text-[10px] py-1 border-b border-aluminium/5 font-mono select-none">
                        {hunk.header}
                      </div>

                      {/* Hunk lines */}
                      <div className="flex flex-col mt-1">
                        {hunk.lines.map((line, lineIdx) => {
                          let lineBg = 'bg-transparent';
                          let lineTextClass = 'text-chalk/95';

                          if (line.type === 'added') {
                            lineBg = 'bg-chalk/5';
                            lineTextClass = 'text-chalk';
                          } else if (line.type === 'removed') {
                            lineBg = 'bg-transparent';
                            lineTextClass = 'text-aluminium/35 line-through decoration-aluminium/20';
                          }

                          return (
                            <div
                              key={lineIdx}
                              className={`flex items-stretch hover:bg-carbon/25 ${lineBg}`}
                            >
                              {/* Left line number (Old) */}
                              <div className="w-10 text-right pr-2.5 text-aluminium/30 select-none border-r border-aluminium/5 shrink-0">
                                {line.lnOld !== undefined ? line.lnOld : ''}
                              </div>
                              {/* Right line number (New) */}
                              <div className="w-10 text-right pr-2.5 text-aluminium/30 select-none border-r border-aluminium/5 shrink-0">
                                {line.lnNew !== undefined ? line.lnNew : ''}
                              </div>
                              {/* Action sign (+ / - / space) */}
                              <div
                                className={`w-6 text-center select-none shrink-0 ${
                                  line.type === 'added'
                                    ? 'text-chalk/70 font-semibold'
                                    : line.type === 'removed'
                                      ? 'text-aluminium/30'
                                      : 'text-aluminium/20'
                                }`}
                              >
                                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                              </div>
                              {/* Highlighted code */}
                              <div
                                className={`pl-2 pr-4 py-0.5 whitespace-pre min-w-0 font-mono ${lineTextClass}`}
                              >
                                {highlightLine(line.content, fileLanguage)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE: Agent Stream */}
        <div className="w-80 bg-carbon/25 border border-aluminium/10 rounded-lg p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="text-label text-aluminium/50 mb-3 text-[10px] tracking-wider shrink-0 select-none">
            AGENT STREAM
          </div>
          <div className="flex-1 min-h-0 bg-well border border-aluminium/20 rounded-lg p-3 overflow-y-auto">
            {events.length === 0 ? (
              <div className="text-aluminium/40 text-xs italic select-none">
                Waiting for agent events…
              </div>
            ) : (
              <div className="flex flex-col">
                {events.map((ev, i) => renderDetailEvent(ev, i))}
                <div ref={eventLogBottomRef} />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
