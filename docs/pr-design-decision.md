# Phase 4.4 — PR Creation: Sequencing Conflict Resolution

## The Conflict

Phase 2.4's `keep()` implementation:
1. Checks out `baseBranch` in the base repository
2. Runs `git merge <taskBranch> -m "Merge task branch..."` into base
3. **Removes the worktree** (`worktreeManager.remove(worktreePath)`)
4. Sets `outcome = 'kept'`

By the time a task is "kept," the task branch is **merged locally into base and the
worktree is gone.** There is no separate branch to push to a remote for a PR.

A PR in normal GitHub workflow requires:
- A branch that is **not yet merged** into the target branch
- The branch to be **present on the remote**

These conditions are impossible to satisfy post-keep.

## Resolution: "Open PR" as a Third Outcome Action

"Open PR" is a **mutually exclusive alternative** to Keep and Discard — a third
top-level action button in the same eligibility window (completed, outcome === null).

Clicking it:
1. Pushes the task's branch (`murl/task-<id>`) to the remote (`git push -u origin <branch>`)
2. Creates a PR via `gh pr create` with the task prompt as title/body
3. Captures the real PR URL from `gh`'s output
4. Sets `outcome = 'pr-opened'` in TaskStore
5. **Does NOT merge or remove the worktree** — the worktree stays alive so:
   - The user can keep iterating via follow-ups (Phase 4.1), pushing new commits to the PR
   - The actual merge happens when GitHub merges the PR
   - The worktree should be manually cleaned up later (or via a future "Close PR" action)

## What Happens to the Worktree After "Open PR"

Worktree stays. Unlike Keep (which merges+removes) or Discard (which just removes),
"Open PR" leaves the worktree in place. This is intentional:
- The branch needs to stay alive on the remote for the PR to remain open
- Follow-ups (Phase 4.1) can push additional commits to the same branch, updating the PR
- The user keeps the ability to run the terminal/preview tabs on that worktree

Cleaning up: the worktree will be removed when the user eventually Keeps (merges)
or Discards the task after the PR is closed/merged. Until then it stays.

## Schema Change

`PersistedTask.outcome` currently supports `'kept' | 'discarded' | null`.

Add `'pr-opened'`. Implemented additively per Phase 0.5's schema design:
- `ALTER TABLE tasks ADD COLUMN prUrl TEXT;` — stores the real PR URL
- `outcome = 'pr-opened'` — new value; SQLite stores this as TEXT, no constraint
- `setOutcome()` in TaskStore is extended to accept `'kept' | 'discarded' | 'pr-opened'`
- `setPrUrl()` new method stores the returned URL

## `gh` CLI Authentication Check

Before attempting push or PR creation, run `gh auth status` to confirm authentication.
If not authenticated: surface a clear message directing the user to run `gh auth login`
in their terminal. Do not attempt to handle OAuth flows inside Murl.

## Flow

```
completed + outcome === null
  ↓
[Keep]        → merge + remove worktree → outcome = 'kept'
[Open PR]     → push branch + gh pr create → outcome = 'pr-opened', prUrl stored
[Discard]     → remove worktree → outcome = 'discarded'
```

After outcome is set, the action buttons disappear. For `pr-opened`, the PR URL
is displayed as a clickable link (shell.openExternal, same as Preview pane).
