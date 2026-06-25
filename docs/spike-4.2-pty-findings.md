# Phase 4.2 — Embedded Terminal Spike Findings

## Environment

- **Electron**: 35.7.5  
- **Node**: 24.17.0 (host process)  
- **Platform**: Windows 11 x64  
- **Library evaluated**: `node-pty@1.1.0`

---

## Spike Result: node-pty Works via Prebuilt Binaries ✅

`node-pty` ships prebuilt native binaries (`.node` files) for major platforms
via the `prebuild` mechanism. On Windows x64 with Electron 35, the package
found and used a prebuilt binary during `pnpm install` — **no C++ compiler,
no Python, no Visual Studio required**.

Installation output:
```
> Checking prebuilds... Done
> Copying conpty.dll -> build/Release/conpty/conpty.dll
> Copying OpenConsole.exe -> build/Release/conpty/OpenConsole.exe
```

The ConPTY components (`conpty.dll`, `OpenConsole.exe`) are Windows 10+
pseudo-console infrastructure bundled with node-pty for the Windows backend.

---

## What Needed to Change for Installation

The monorepo's `pnpm-workspace.yaml` had a placeholder:
```yaml
allowBuilds:
  node-pty: set this to true or false  # was a placeholder
```

Changed to `node-pty: true` to allow the `prebuild.js` install script to run.

---

## Proof of Mechanism

Spike test ran in the monorepo root directory:

```js
const pty = require('node-pty');
const t = pty.spawn('powershell.exe', [], { cols: 80, rows: 30, cwd: worktreePath });
t.onData(d => process.stdout.write(d));
t.write('git status\r');
```

Output received:
```
Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

PS C:\Content\murl_2_new> git status
On branch main
...
```

Real PTY process started (PID: 3064), command executed, output streamed,
shell exited cleanly.

---

## Electron Integration Notes

Native modules (`node-pty`) are loaded in the **main process only**, never
the renderer. The module must be declared as an Electron external in
`electron.vite.config.ts` via `externalizeDepsPlugin` so Vite doesn't attempt
to bundle the `.node` binary — it must be `require()`d at runtime.

For production packaging, `node-pty` and its `conpty/` directory must be
included in the Electron resources. In development, they resolve correctly
from `node_modules`.

---

## xterm.js for Renderer

`@xterm/xterm` (the canonical terminal emulator for Electron/browser) is pure
JavaScript — no native code, installs cleanly. It renders real VT100/ANSI
escape sequences including color codes. This pairs naturally with node-pty
for a proper terminal experience.

## ANSI Color Decision

Terminal output colors are **functionally meaningful** (error vs. success,
git diff colors, test runner output), not decorative. We allow standard ANSI
16-color rendering through xterm.js's default theme but configure the theme
colors to map into the existing Murl palette where practical:
- Background: `#0A0A0A` (ink)
- Foreground: chalk (`#E8E8E8`)
- Black/dark variants: carbon/aluminium family
- Keep standard terminal colors for red/green/yellow (they carry meaning)
  but use muted variants rather than saturated primaries where possible.

This is the one deliberate, scoped exception to the "no new accent colors"
rule — terminal colors ARE functional, not decorative, and suppressing them
would make `git diff`, `vitest`, and `npm` output unreadable.
