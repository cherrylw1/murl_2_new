# Murl — Coding Harness

This is the Murl coding-harness build: a Conductor-style orchestrator for the OpenCode agent across parallel git worktrees, built in the **Nothing** design language.

## Architecture & Principles
- **Core Loop:** Orchestrates headless OpenCode execution in isolated git worktrees.
- **Local-first:** User data, SQLite runs, and worktrees live on the local machine.
- **BYOK:** Supports OpenRouter, Together AI, and Ollama out-of-the-box.
- **Design System:** Strictly uses a minimalist, grid-snapped, monochrome aesthetic inspired by Nothing and Teenage Engineering, with `docs/taste.md` as the ultimate filter.

## Important Constraint
> [!IMPORTANT]
> **Every single UI decision going forward must be graded against [docs/taste.md](docs/taste.md).**
> Any deviation from the tiny palette, the strict typography hierarchy (LED Counter 7 / Geist), grid alignment, or the status-as-light model is a failure.

## Documentation
- [taste.md](docs/taste.md) — Design philosophy and taste rules.
- [design.md](docs/design.md) — Exact styling tokens, layouts, fonts, and specs.
- [glyph-wall.html](docs/glyph-wall.html) — Interactive prototype of the breathing status dashboard.

## Packages
- `@murl/core` — Headless worktree manager and OpenCode adapter.
- `@murl/desktop` — Electron-based desktop application shell and React user interface.
