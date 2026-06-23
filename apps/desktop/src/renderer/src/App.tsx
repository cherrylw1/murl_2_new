import React, { useEffect, useState } from 'react';

interface HealthStatus {
  status: string;
  coreAlive: boolean;
  message: string;
}

type TabType = 'tasks' | 'recipes' | 'history' | 'settings';

export default function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('tasks');

  useEffect(() => {
    // Perform real IPC health check
    window.murl.healthCheck()
      .then((data) => {
        setHealth(data);
      })
      .catch((err) => {
        setError(err.message || String(err));
      });
  }, []);

  const healthState = error ? 'error' : health ? 'active' : 'idle';

  return (
    <div className="w-screen h-screen bg-ink bg-dotgrid bg-[size:8px_8px] text-chalk flex flex-col select-none overflow-hidden p-6">
      
      {/* 1. Header / Custom Title Bar Chrome (Standard Window Frame kept for now) */}
      <header className="flex items-center justify-between h-8 border-b border-aluminium/10 pb-4">
        {/* Brand wordmark - LED Counter 7 font used as a signature logo mark */}
        <div className="text-display-dot font-dot tracking-wider text-chalk select-none">
          MURL
        </div>
        
        {/* System Title */}
        <div className="text-label text-aluminium select-none">
          CONDUCTOR SHELL · PHASE 1.2
        </div>

        {/* Status Light System */}
        <div className="flex items-center gap-3">
          <span className="text-label text-aluminium select-none">SYSTEM STATE:</span>
          <div className="flex items-center gap-2 bg-carbon/50 px-3 py-1 rounded border border-aluminium/10">
            {/* Status light dot matching design.md rules */}
            <div 
              className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                healthState === 'idle' 
                  ? 'bg-aluminium' 
                  : healthState === 'active' 
                    ? 'bg-chalk shadow-active animate-breath' 
                    : 'bg-signal shadow-signal animate-pulse-signal'
              }`}
            />
            <span className={`text-label font-medium ${
              healthState === 'idle' 
                ? 'text-aluminium' 
                : healthState === 'active' 
                  ? 'text-chalk' 
                  : 'text-signal'
            }`}>
              {healthState === 'idle' 
                ? 'STANDBY' 
                : healthState === 'active' 
                  ? 'ACTIVE' 
                  : 'ERROR'}
            </span>
          </div>
        </div>
      </header>

      {/* 2. Main Workspace Layout */}
      <main className="flex-1 flex gap-6 mt-6 overflow-hidden">
        
        {/* Sidebar Navigation - Frosted Panel */}
        <nav className="panel w-64 p-6 flex flex-col justify-between">
          <div className="flex flex-col gap-3">
            <div className="text-label text-aluminium mb-2 px-4">NAVIGATION</div>
            
            <button
              onClick={() => setActiveTab('tasks')}
              className={`w-full text-left py-3 px-4 rounded transition-taste text-label ${
                activeTab === 'tasks'
                  ? 'bg-carbon text-chalk border border-aluminium/20'
                  : 'text-aluminium hover:text-chalk hover:bg-carbon/50 border border-transparent'
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setActiveTab('recipes')}
              className={`w-full text-left py-3 px-4 rounded transition-taste text-label ${
                activeTab === 'recipes'
                  ? 'bg-carbon text-chalk border border-aluminium/20'
                  : 'text-aluminium hover:text-chalk hover:bg-carbon/50 border border-transparent'
              }`}
            >
              Recipes
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`w-full text-left py-3 px-4 rounded transition-taste text-label ${
                activeTab === 'history'
                  ? 'bg-carbon text-chalk border border-aluminium/20'
                  : 'text-aluminium hover:text-chalk hover:bg-carbon/50 border border-transparent'
              }`}
            >
              History
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full text-left py-3 px-4 rounded transition-taste text-label ${
                activeTab === 'settings'
                  ? 'bg-carbon text-chalk border border-aluminium/20'
                  : 'text-aluminium hover:text-chalk hover:bg-carbon/50 border border-transparent'
              }`}
            >
              Settings
            </button>
          </div>

          {/* Sidebar Footer Info */}
          <div className="border-t border-aluminium/10 pt-4 flex flex-col gap-1 px-2 select-none">
            <div className="text-label text-aluminium/60 font-semibold">WORKSPACE</div>
            <div className="text-data text-aluminium/80 truncate">murl_2_new</div>
          </div>
        </nav>

        {/* Workspace Display Area - Frosted Panel */}
        <section className="panel flex-1 p-8 flex flex-col justify-between overflow-y-auto">
          
          {/* Active Tab Contents */}
          <div className="flex-1 flex flex-col">
            {activeTab === 'tasks' && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                  <h2 className="text-title text-chalk mb-6">Task Queue</h2>
                  
                  {/* Empty state aligned to design.md */}
                  <div className="flex flex-col items-center justify-center border border-dashed border-aluminium/10 rounded-lg py-16 px-4 bg-carbon/20">
                    <p className="text-data text-aluminium text-center max-w-sm">
                      No active tasks. Load a recipe or create a new task to begin.
                    </p>
                  </div>
                </div>
                
                {/* Standard buttons layout */}
                <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                  <button className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste">
                    Create Task
                  </button>
                  <button className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste">
                    Import Repo
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'recipes' && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                  <h2 className="text-title text-chalk mb-6">Available Recipes</h2>
                  
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center p-4 bg-carbon/40 rounded border border-aluminium/10">
                      <div>
                        <div className="text-body font-semibold text-chalk">Git Refactor</div>
                        <div className="text-data text-aluminium text-xs mt-1">Refactor imports, rename variables, or clean styling.</div>
                      </div>
                      <button className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste">
                        Load
                      </button>
                    </div>

                    <div className="flex justify-between items-center p-4 bg-carbon/40 rounded border border-aluminium/10">
                      <div>
                        <div className="text-body font-semibold text-chalk">Test Suite Generator</div>
                        <div className="text-data text-aluminium text-xs mt-1">Generate comprehensive tests for source files.</div>
                      </div>
                      <button className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste">
                        Load
                      </button>
                    </div>

                    <div className="flex justify-between items-center p-4 bg-carbon/40 rounded border border-aluminium/10">
                      <div>
                        <div className="text-body font-semibold text-chalk">Documentation Writer</div>
                        <div className="text-data text-aluminium text-xs mt-1">Scan source files and write README or documentation pages.</div>
                      </div>
                      <button className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste">
                        Load
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                  <button className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste">
                    Custom Recipe
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                  <h2 className="text-title text-chalk mb-6">Recent Runs</h2>
                  
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center p-4 bg-carbon/30 rounded border border-aluminium/10">
                      <div className="flex items-center gap-4">
                        {/* Task identifier using dot font in micro size */}
                        <span className="text-micro-dot font-dot tracking-wider text-aluminium bg-carbon px-2 py-1 rounded">T-0043</span>
                        <div>
                          <div className="text-body font-semibold text-chalk">Verify task-store queries</div>
                          <div className="text-data text-aluminium text-xs mt-0.5">Model: together/Llama-3.3-70B</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-micro-dot font-dot text-chalk">$0.04</div>
                        <div className="text-data text-aluminium text-xs mt-1">COMPLETED</div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-4 bg-carbon/30 rounded border border-aluminium/10">
                      <div className="flex items-center gap-4">
                        <span className="text-micro-dot font-dot tracking-wider text-aluminium bg-carbon px-2 py-1 rounded">T-0042</span>
                        <div>
                          <div className="text-body font-semibold text-chalk">Fix SSE generator deadlock</div>
                          <div className="text-data text-aluminium text-xs mt-0.5">Model: together/Llama-3.3-70B</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-micro-dot font-dot text-chalk">$0.11</div>
                        <div className="text-data text-aluminium text-xs mt-1">COMPLETED</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                  <button className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste">
                    Clear History
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                  <h2 className="text-title text-chalk mb-6">Configuration</h2>
                  
                  <div className="flex flex-col gap-6 max-w-xl">
                    <div className="flex flex-col gap-2">
                      <label className="text-label text-aluminium">Together API Key</label>
                      <input 
                        type="password" 
                        value="••••••••••••••••••••••••••••••••" 
                        readOnly 
                        className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-label text-aluminium">Default Model</label>
                      <select 
                        defaultValue="together/meta-llama/Llama-3.3-70B-Instruct-Turbo" 
                        disabled
                        className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-aluminium cursor-not-allowed outline-none"
                      >
                        <option>together/meta-llama/Llama-3.3-70B-Instruct-Turbo</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-label text-aluminium">Local Git Repositories Root</label>
                      <input 
                        type="text" 
                        value="C:/Content/murl_2_new" 
                        readOnly 
                        className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-aluminium cursor-not-allowed outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 border-t border-aluminium/10 pt-6">
                  <button className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste">
                    Save Config
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Debug Console Output */}
          <footer className="mt-6 border-t border-aluminium/10 pt-6 flex flex-col gap-2">
            <div className="text-label text-aluminium select-none">IPC DIAGNOSTIC LOG</div>
            <div className="bg-well p-4 rounded border border-aluminium/10 text-data text-chalk select-text">
              {error ? (
                <span className="text-signal">{error}</span>
              ) : health ? (
                <span>
                  {`[${new Date().toISOString()}] IPC OK: `}
                  <span className="text-aluminium">{health.message}</span>
                </span>
              ) : (
                <span className="text-aluminium">Loading system bridge status...</span>
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
