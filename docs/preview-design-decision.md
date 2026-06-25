# Phase 4.3 — Preview: Embedded BrowserView vs. External Link Decision

## The Question

When surfacing a task's dev server URL to the user, should Murl:

**Option A — Embed inline (BrowserView / WebContentsView)**
Spawn `BrowserView`/`WebContentsView` inside the Murl window showing the
live localhost page.

**Option B — External link + raw log output**
Detect the URL from server stdout, show it as a clickable button that opens
in the default system browser. Show raw server stdout/stderr inside Murl
as a log stream in the existing mono/data style.

---

## Decision: Option B — External link + raw log output

### Reasons against Option A

1. **Security surface.** `BrowserView`/`WebContentsView` renders a full
   renderer process with access to Electron APIs unless carefully sandboxed.
   A dev server's localhost output is arbitrary code — it could contain
   scripts that interact with Electron's IPC bridge. Sandboxing requires
   explicit `contextIsolation`, careful `webPreferences`, and partitioned
   sessions — non-trivial for a preview feature.

2. **API instability.** `BrowserView` was deprecated in Electron 28 in favour
   of `WebContentsView`. `WebContentsView` has a different API, different
   z-ordering model, and different attachment lifecycle. The added complexity
   is meaningful for a preview feature that may not even be used by every user.

3. **Layout complexity.** Positioning a `BrowserView`/`WebContentsView` over
   a specific region of the renderer UI requires pixel-perfect coordinate
   calculations (no CSS layout, it's positioned at the window level). When
   the user navigates away from the task detail view, the view must be hidden;
   when they return it must be re-shown — this is a separate state machine.

4. **"Surface its URL/output" reads as external-first.** The spec language
   describes showing where the server is and what it's doing — not rendering
   the page inside Murl. Users who want to interact with the running app will
   naturally reach for their browser (where devtools, bookmarks, and history
   exist); an inline preview inside Murl doesn't add much.

### Reasons for Option B

1. **VS Code, Cursor, Zed, and JetBrains all use this pattern.** The "Port
   Forwarding" / "Ports" panel shows a URL + a button to open in browser.
   This is the established, well-understood convention.

2. **Zero added complexity.** The URL is extracted from stdout via regex,
   rendered as a clickable link. `shell.openExternal(url)` opens it in the
   system browser with one line. No new process management, no view lifecycle.

3. **Clean separation of concerns.** Murl shows server state (running/stopped),
   server output (the log stream), and the URL. The browser shows the actual
   rendered output. Each tool does what it's good at.

4. **Works correctly when the preview is complex.** If the dev server serves
   a React SPA with HMR, WebSockets, etc., an embedded `BrowserView` would
   need to handle all of that correctly. The external browser already does.

---

## Implementation Shape

- **`PreviewManager`** — main process, one process per taskId, using
  `child_process.spawn()` (not a PTY — dev servers are not interactive;
  piped stdout/stderr is simpler and sufficient).
- **URL detection** — regex scan of each stdout/stderr chunk for common
  patterns: `localhost:PORT`, `http://localhost:PORT`, `Local: ...`, etc.
  First match triggers `murl:preview-url` push event. If not auto-detected,
  the log stream shows everything so the user can read the URL themselves.
- **Command confirmation** — `getPreviewCommand(worktreePath)` reads
  `package.json` scripts and returns a suggested command. The renderer shows
  this in an editable input field before running. Nothing runs until the user
  clicks "Start".
- **Output display** — raw lines pushed via `murl:preview-log`, rendered in
  the existing mono/data style (same as the agent stream pane, no new chrome).
- **Open in browser** — `shell.openExternal(url)` from the main process,
  triggered by an IPC call from the renderer when the user clicks the URL.
