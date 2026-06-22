# OpenCode Headless Spike (Phase 0.2 Findings)

This document details the exploratory findings for running OpenCode headlessly on Windows in parallel worktrees, testing model-specific behaviors, and evaluating integration patterns.

---

## 1. Environment & Setup

### OpenCode Installation
- **Version:** `1.17.9`
- **Shell Auto-Discovery:** On Windows, OpenCode automatically discovers and executes tasks using **PowerShell**:
  `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.EXE`

### Custom Provider Configuration
Together was configured in `opencode.json` as a custom provider:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "together": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Together",
      "options": {
        "baseURL": "https://api.together.xyz/v1",
        "apiKey": "{env:TOGETHER_API_KEY}"
      },
      "models": {
        "openai/gpt-oss-120b": { "name": "GPT-OSS 120B" }
      }
    }
  },
  "model": "together/openai/gpt-oss-120b"
}
```

---

## 2. Core Findings & Validation

### Model Compatibility & Tool-Calling (Crucial Discovery)
1. **`openai/gpt-oss-120b` (Reasoning Model) Fails to Call Tools:**
   - Tested under both the per-task CLI process and the server + SDK patterns.
   - **Behavior:** The model outputs a complete chain of thought and text response declaring that files are created (e.g. *"Complete. Added src/reverse.ts..."*), but **does not trigger OpenCode's internal tool/file operations**. The logs show it exits the execution loop on step 1 without invoking any tool permissions or file edits.
   - **Reason:** Together's tool-calling implementation for reasoning models, or the AI SDK's custom compatibility mapping, fails to parse tool calls correctly when mixed with reasoning/thinking tokens.
2. **`meta-llama/Llama-3.3-70B-Instruct-Turbo` Works Perfectly:**
   - **Behavior:** Natively calls OpenCode's `edit` and file system tools. It successfully created `src/reverse.ts` and `src/reverse.test.ts` in our git worktree headlessly.
   - **Latency:** Extremely fast response and execution.

### Stdin Gotcha on Windows (Headless Blocking)
- **Problem:** Spawning `opencode run` in the background without terminal attachment can cause the process to block indefinitely at `init` while waiting on stdin.
- **Mitigation:** In headless CLI mode, stdin must be explicitly redirected from the null device (e.g. `< NUL` in cmd, or `< $null` in PowerShell) to prevent blocking.

---

## 3. Comparison of Orchestration Patterns

### Pattern A: Per-Task Process (`opencode run`)
*   **Pros:** Very simple, self-contained, no server state to manage.
*   **Cons:** 
    - High cold-start latency (~2-3s per run) because each process must load configs, initialize databases, spin up location services, and set up project snapshots.
    - **Parallel Collision Vulnerability:** Concurrent invocations of `opencode run` compete for write locks on the shared SQLite database `~/.local/share/opencode/opencode.db`. This causes a busy timeout, failing to initialize sessions and throwing `Error: Expected a string starting with "ses", got "none"`.

### Pattern B: Persistent Server + SDK (`opencode serve` + Client SDK)
*   **Pros:**
    - Low latency after initial boot.
    - Standardized event streaming via Server-Sent Events (SSE), making it perfect for feeding live logs/thinking tokens to the Murl UI.
    - Programmatic session control is much cleaner than parsing CLI stdout.
    - **Concurrency Safety:** A single persistent server process serializes/handles database operations. By passing the `directory` query parameter to the session creation call (`client.session.create({ query: { directory: '...' } })`), we can spin up multiple independent sessions targeting different workspaces concurrently without database lock collisions.
*   **Cons:** Requires managing the server lifecycle (port allocation, starting/stopping daemon, error recovery).
*   **SDK API Syntax Details:**
    - Creating a session returns an OpenAPI client structure containing `{ data, error }`. Accessing the session ID requires `sessionResponse.data.id` (not `sessionResponse.id`).
    - Sending a prompt: `client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: 'text', text: '...' }] } })`.

---

## 4. Architectural Decisions

1. **Standardized Pattern:** **Persistent Server + SDK (Pattern B)**. 
   - **Rationale:** Feeding live logs and thinking tokens to the UI over SSE is essential to the Nothing-inspired, glanceable interface. Furthermore, Pattern B is **required for concurrent task execution** to prevent SQLite lock collisions on the shared state database by routing all workspace sessions through a single server daemon using the `query: { directory: '...' }` parameter.
2. **Diff-Capture Method:** **Git Intent-to-Add (`git add -N .`) + `git diff`**.
   - **Rationale:** Because new files are untracked by default in git worktrees, a raw `git diff` returns empty. Staging the changes with `git add -N .` ensures that both modified and untracked files are correctly shown in the diff output.
3. **Model Tuning Options:**
   - Standard parameters (`temperature`, `top_p`, `max_tokens`) will be set in the `provider.options` block in `opencode.json` or equivalent settings.
   - Reasoning effort will be passed via the `--variant` CLI flag (or equivalent SDK payload option).
   - However, since `openai/gpt-oss-120b` does not trigger tool calling on Together, Murl will prioritize standard instruction models (like Llama-3.3-70B or GPT models) that have robust tool calling out-of-the-box.
