import React, { useEffect, useState } from 'react';
import { HarnessSettings, RecentRepo } from '../../preload/types.js';

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

  // Tasks launcher state
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);
  const [activeRepo, setActiveRepo] = useState<RecentRepo | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState<boolean>(false);
  const [taskDescription, setTaskDescription] = useState<string>('');
  const [taskBranch, setTaskBranch] = useState<string>('');
  const [taskModel, setTaskModel] = useState<string>('');
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'ready'>('idle');
  const [launcherError, setLauncherError] = useState<string | null>(null);

  // Harness Settings State
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [provider, setProvider] = useState<string>('together');
  const [model, setModel] = useState<string>('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  const [defaultRepoPath, setDefaultRepoPath] = useState<string>('');
  const [worktreeRoot, setWorktreeRoot] = useState<string>('');
  const [concurrencyCap, setConcurrencyCap] = useState<number>(3);
  const [openCodePathOverride, setOpenCodePathOverride] = useState<string>('');
  const [perTaskBudgetDefault, setPerTaskBudgetDefault] = useState<number>(10.0);

  // Status/interaction state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  const fetchSettings = () => {
    window.murl.getSettingsStatus()
      .then(({ apiKeyConfigured, settings }) => {
        setApiKeyConfigured(apiKeyConfigured);
        setProvider(settings.provider);
        setModel(settings.model);
        setDefaultRepoPath(settings.defaultRepoPath);
        setWorktreeRoot(settings.worktreeRoot);
        setConcurrencyCap(settings.concurrencyCap);
        setOpenCodePathOverride(settings.openCodePathOverride);
        setPerTaskBudgetDefault(settings.perTaskBudgetDefault);
        setRecentRepos(settings.recentRepos || []);
        setTaskModel(settings.model);
      })
      .catch((err) => {
        setError(err.message || String(err));
      });
  };

  useEffect(() => {
    // Perform real IPC health check
    window.murl.healthCheck()
      .then((data) => {
        setHealth(data);
      })
      .catch((err) => {
        setError(err.message || String(err));
      });

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      if (apiKeyInput.trim()) {
        await window.murl.saveApiKey(provider, apiKeyInput.trim());
        setApiKeyConfigured(true);
        setApiKeyInput(''); // Clear raw key input for security
      }
      await window.murl.saveHarnessSettings({
        provider,
        model,
        defaultRepoPath,
        worktreeRoot,
        concurrencyCap: Number(concurrencyCap),
        openCodePathOverride,
        perTaskBudgetDefault: Number(perTaskBudgetDefault),
        recentRepos
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setSaveStatus('error');
      setError(err.message || String(err));
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await window.murl.testConnection(provider, model);
      if (result.success) {
        setTestStatus('success');
        setTestMessage(result.message);
      } else {
        setTestStatus('error');
        setTestMessage(result.message);
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err.message || String(err));
    }
  };

  const handleImportRepo = async () => {
    setLauncherError(null);
    try {
      const folderPath = await window.murl.pickRepoFolder();
      if (!folderPath) {
        return;
      }
      
      const validation = await window.murl.validateRepo(folderPath);
      if (!validation.valid) {
        setLauncherError(validation.reason || 'Invalid repository folder.');
        return;
      }
      
      const updatedList = await window.murl.addRecentRepo(folderPath);
      setRecentRepos(updatedList);
      
      const display = folderPath.split(/[/\\]/).pop() || folderPath;
      const imported = { path: folderPath, displayName: display };
      setActiveRepo(imported);
      setIsCreatingTask(true);
      
      const branchName = await window.murl.getRepoBranch(folderPath);
      setTaskBranch(branchName);
      
    } catch (err: any) {
      setLauncherError(err.message || String(err));
    }
  };

  const handleSelectRecentRepo = async (repo: RecentRepo) => {
    setLauncherError(null);
    setActiveRepo(repo);
    try {
      const branchName = await window.murl.getRepoBranch(repo.path);
      setTaskBranch(branchName);
    } catch (err: any) {
      setTaskBranch('main');
    }
  };

  const handleLaunchTask = () => {
    setLauncherError(null);
    if (!activeRepo) {
      setLauncherError('Please select or import a git repository first.');
      return;
    }
    if (!taskDescription.trim()) {
      setLauncherError('Please enter a description of the task.');
      return;
    }
    setLaunchStatus('ready');
  };

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
          MURL · CODING HARNESS
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
              <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
                {launchStatus === 'ready' ? (
                  /* Ready to launch confirmation well */
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="flex-1 overflow-y-auto pr-2 min-h-0 flex flex-col gap-6 max-w-xl">
                      <div>
                        <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                        <h2 className="text-title text-chalk mb-6 font-semibold">Task Preparation</h2>
                      </div>
                      
                      <div className="flex flex-col gap-4 border border-aluminium/20 rounded-lg p-6 bg-well shadow-active">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-chalk shadow-active animate-breath" />
                          <span className="text-label text-chalk tracking-wider font-semibold">TASK CONSTITUTED</span>
                        </div>
                        <p className="text-body text-chalk/90">
                          The task environment has been prepared and is ready for launch.
                        </p>
                        
                        <div className="flex flex-col gap-3 bg-carbon/50 p-4 rounded border border-aluminium/10 font-mono text-xs text-aluminium/80">
                          <div>
                            <span className="text-chalk font-semibold uppercase tracking-wider block text-[10px] mb-1">REPOSITORY</span> 
                            <span className="text-data break-all">{activeRepo?.path}</span>
                          </div>
                          <div>
                            <span className="text-chalk font-semibold uppercase tracking-wider block text-[10px] mb-1">BRANCH</span> 
                            <span className="text-data">{taskBranch}</span>
                          </div>
                          <div>
                            <span className="text-chalk font-semibold uppercase tracking-wider block text-[10px] mb-1">MODEL</span> 
                            <span className="text-data">{taskModel}</span>
                          </div>
                          <div className="border-t border-aluminium/10 pt-3">
                            <span className="text-chalk font-semibold uppercase tracking-wider block text-[10px] mb-1">PROMPT</span>
                            <span className="text-body text-chalk/90 break-words whitespace-pre-wrap">{taskDescription}</span>
                          </div>
                        </div>
                        
                        <p className="text-xs text-aluminium/60 italic mt-2">
                          Note: Task execution (worktree instantiation and OpenCode adapter serving) will be fully wired in Phase 2.2.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-4 border-t border-aluminium/10 pt-6 mt-6">
                      <button 
                        onClick={() => {
                          setLaunchStatus('idle');
                          setIsCreatingTask(false);
                          setTaskDescription('');
                        }}
                        className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste"
                      >
                        Reset / Back
                      </button>
                    </div>
                  </div>
                ) : isCreatingTask ? (
                  /* Create Task Form */
                  <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
                    <div className="flex-1 overflow-y-auto pr-2 min-h-0 flex flex-col gap-6 max-w-xl">
                      <div>
                        <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                        <h2 className="text-title text-chalk mb-6 font-semibold">Create Coding Task</h2>
                      </div>

                      {launcherError && (
                        <div className="bg-carbon/50 border border-signal/30 p-4 rounded flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-signal shadow-signal animate-pulse-signal" />
                          <span className="text-data text-signal text-xs">{launcherError}</span>
                        </div>
                      )}

                      {/* Repository Selector */}
                      <div className="flex flex-col gap-2">
                        <label className="text-label text-aluminium">Git Repository</label>
                        <div className="flex gap-3">
                          <select
                            value={activeRepo ? activeRepo.path : ''}
                            onChange={(e) => {
                              const found = recentRepos.find(r => r.path === e.target.value);
                              if (found) {
                                handleSelectRecentRepo(found);
                              } else {
                                setActiveRepo(null);
                              }
                            }}
                            className="flex-1 bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                          >
                            <option value="">-- Select a Repository --</option>
                            {recentRepos.map((repo) => (
                              <option key={repo.path} value={repo.path}>
                                {repo.displayName} ({repo.path})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleImportRepo}
                            className="px-4 py-2 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste whitespace-nowrap"
                          >
                            Import Repo
                          </button>
                        </div>
                      </div>

                      {activeRepo && (
                        <>
                          {/* Task Description */}
                          <div className="flex flex-col gap-2">
                            <label className="text-label text-aluminium">Task Description (Prompt)</label>
                            <textarea
                              value={taskDescription}
                              onChange={(e) => setTaskDescription(e.target.value)}
                              placeholder="e.g. Add a function capitalize(str) and write a vitest file to verify it..."
                              rows={5}
                              className="bg-well border border-aluminium/20 rounded p-2.5 text-body text-chalk focus:border-chalk outline-none resize-none"
                            />
                          </div>

                          {/* Base Branch */}
                          <div className="flex flex-col gap-2">
                            <label className="text-label text-aluminium">Base Branch</label>
                            <input
                              type="text"
                              value={taskBranch}
                              onChange={(e) => setTaskBranch(e.target.value)}
                              className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                            />
                          </div>

                          {/* Model Override */}
                          <div className="flex flex-col gap-2">
                            <label className="text-label text-aluminium">Model</label>
                            <input
                              type="text"
                              value={taskModel}
                              onChange={(e) => setTaskModel(e.target.value)}
                              list="together-models-override"
                              className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                            />
                            <datalist id="together-models-override">
                              <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                              <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                              <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                              <option value="deepseek-ai/DeepSeek-V3" />
                            </datalist>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex gap-4 border-t border-aluminium/10 pt-6 mt-6">
                      {activeRepo ? (
                        <>
                          <button
                            onClick={handleLaunchTask}
                            className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste"
                          >
                            Launch Task
                          </button>
                          <button
                            onClick={() => {
                              setIsCreatingTask(false);
                              setActiveRepo(null);
                            }}
                            className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setIsCreatingTask(false);
                          }}
                          className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste"
                        >
                          Back
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Standard Queue view / Recents list */
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                      <h2 className="text-title text-chalk mb-6 font-semibold">Task Queue</h2>
                      
                      {launcherError && (
                        <div className="bg-carbon/50 border border-signal/30 p-4 rounded flex items-center gap-3 mb-6 max-w-xl">
                          <div className="w-2 h-2 rounded-full bg-signal shadow-signal animate-pulse-signal" />
                          <span className="text-data text-signal text-xs">{launcherError}</span>
                        </div>
                      )}

                      {recentRepos.length > 0 ? (
                        <div className="flex flex-col gap-4">
                          <div className="text-label text-aluminium/60 font-semibold mb-1">KNOWN REPOSITORIES</div>
                          <div className="flex flex-col gap-3 max-w-xl">
                            {recentRepos.map((repo) => (
                              <div key={repo.path} className="flex justify-between items-center p-4 bg-carbon/40 rounded border border-aluminium/10">
                                <div className="truncate pr-4">
                                  <div className="text-body font-semibold text-chalk">{repo.displayName}</div>
                                  <div className="text-data text-aluminium text-xs mt-1 truncate">{repo.path}</div>
                                </div>
                                <button
                                  onClick={() => {
                                    handleSelectRecentRepo(repo);
                                    setIsCreatingTask(true);
                                  }}
                                  className="px-4 py-1.5 rounded bg-carbon border border-aluminium/20 text-label text-chalk hover:shadow-active transition-taste whitespace-nowrap"
                                >
                                  Create Task
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center border border-dashed border-aluminium/10 rounded-lg py-16 px-4 bg-carbon/20 max-w-xl">
                          <p className="text-data text-aluminium text-center max-w-sm">
                            No active tasks. Load a recipe or import a repository to begin.
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex gap-4 border-t border-aluminium/10 pt-6 mt-6">
                      <button 
                        onClick={() => {
                          if (recentRepos.length > 0) {
                            handleSelectRecentRepo(recentRepos[0]);
                          }
                          setIsCreatingTask(true);
                        }}
                        className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active transition-taste"
                      >
                        Create Task
                      </button>
                      <button 
                        onClick={handleImportRepo}
                        className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 transition-taste"
                      >
                        Import Repo
                      </button>
                    </div>
                  </div>
                )}
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
                  
                  <div className="flex flex-col items-center justify-center border border-dashed border-aluminium/10 rounded-lg py-16 px-4 bg-carbon/20">
                    <p className="text-data text-aluminium text-center max-w-sm">
                      No run history found. Run a task to see history and cost logs.
                    </p>
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
              <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto pr-2 min-h-0 flex flex-col gap-6 max-w-xl">
                  <div>
                    <div className="text-label text-aluminium mb-1">CURRENT AREA</div>
                    <h2 className="text-title text-chalk mb-6 font-semibold">Configuration</h2>
                  </div>

                  {/* API Key Input */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <label className="text-label text-aluminium">Together API Key</label>
                      {apiKeyConfigured && (
                        <div className="flex items-center gap-2 bg-well px-2.5 py-1 rounded border border-aluminium/10">
                          <div className="w-2 h-2 rounded-full bg-chalk shadow-active animate-breath" />
                          <span className="text-micro-dot font-semibold text-chalk tracking-wider">KEY PERSISTED</span>
                        </div>
                      )}
                    </div>
                    <input 
                      type="password" 
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={apiKeyConfigured ? "••••••••••••••••••••••••••••••••" : "Enter Together API key"}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <span className="text-xs text-aluminium/60">
                      {apiKeyConfigured ? "A key is securely saved. Enter a new key to overwrite it." : "Provide your Together AI API key to enable remote LLM execution."}
                    </span>
                  </div>

                  {/* Provider Selection */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Provider</label>
                    <select 
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none cursor-pointer"
                    >
                      <option value="together">Together AI</option>
                    </select>
                  </div>

                  {/* Model ID Selector */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Model</label>
                    <input 
                      type="text" 
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      list="together-models"
                      placeholder="Select or type a model ID"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                    <datalist id="together-models">
                      <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo" />
                      <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo" />
                      <option value="Qwen/Qwen2.5-72B-Instruct-Turbo" />
                      <option value="deepseek-ai/DeepSeek-V3" />
                    </datalist>
                  </div>

                  {/* Default Repo Path */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Git Repository Path</label>
                    <input 
                      type="text" 
                      value={defaultRepoPath}
                      onChange={(e) => setDefaultRepoPath(e.target.value)}
                      placeholder="e.g. C:/Content/murl_2_new"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Worktree Root */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Worktrees Root Directory</label>
                    <input 
                      type="text" 
                      value={worktreeRoot}
                      onChange={(e) => setWorktreeRoot(e.target.value)}
                      placeholder="e.g. C:/Users/name/.murl/worktrees"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Concurrency Cap */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Concurrency Cap</label>
                    <input 
                      type="number" 
                      value={concurrencyCap}
                      onChange={(e) => setConcurrencyCap(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      max="20"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* OpenCode Path Override */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">OpenCode Binary Path Override (Optional)</label>
                    <input 
                      type="text" 
                      value={openCodePathOverride}
                      onChange={(e) => setOpenCodePathOverride(e.target.value)}
                      placeholder="Leave empty to use system PATH"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>

                  {/* Per-Task Budget */}
                  <div className="flex flex-col gap-2">
                    <label className="text-label text-aluminium">Default Per-Task Cost Budget (USD)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={perTaskBudgetDefault}
                      onChange={(e) => setPerTaskBudgetDefault(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                      min="0.01"
                      className="bg-well border border-aluminium/20 rounded p-2.5 text-data text-chalk focus:border-chalk outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-aluminium/10 pt-6 mt-6">
                  <div className="flex gap-4">
                    <button 
                      onClick={handleSave}
                      disabled={saveStatus === 'saving'}
                      className="px-6 py-2.5 rounded bg-carbon border border-aluminium/20 text-body text-chalk font-semibold hover:shadow-active disabled:opacity-50 transition-taste"
                    >
                      {saveStatus === 'saving' ? 'Saving...' : 'Save Config'}
                    </button>
                    
                    <button 
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing'}
                      className="px-6 py-2.5 rounded bg-transparent border border-aluminium/15 text-body text-aluminium hover:text-chalk hover:border-aluminium/30 disabled:opacity-50 transition-taste"
                    >
                      {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>

                  {/* Connection status light system */}
                  {(testStatus !== 'idle' || testMessage || saveStatus !== 'idle') && (
                    <div className="flex items-center gap-3 bg-carbon/50 px-4 py-2 rounded border border-aluminium/10 max-w-sm">
                      <div 
                        className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                          testStatus === 'testing' || saveStatus === 'saving'
                            ? 'bg-aluminium animate-breath shadow-active'
                            : testStatus === 'success' || saveStatus === 'success'
                              ? 'bg-chalk shadow-active animate-breath'
                              : testStatus === 'error' || saveStatus === 'error'
                                ? 'bg-signal shadow-signal animate-pulse-signal'
                                : 'bg-aluminium'
                        }`}
                      />
                      <span className="text-data text-xs truncate max-w-[280px]">
                        {testStatus === 'testing' && 'Connecting to API...'}
                        {testStatus === 'success' && (testMessage || 'Connection successful')}
                        {testStatus === 'error' && `Failed: ${testMessage}`}
                        {saveStatus === 'saving' && 'Persisting settings...'}
                        {saveStatus === 'success' && 'Settings saved successfully.'}
                        {saveStatus === 'error' && 'Failed to save settings.'}
                      </span>
                    </div>
                  )}
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
