# Phase 4.1 — Follow-up Session Design Decision

## The Question

OpenCode supports session resume/attach for true conversation continuation.
Murl's adapter (`opencode-adapter.ts`) starts a fresh server + session per
`runTask` call and tears it down on completion. For follow-ups, we have two
options:

**Option A — True continuation:** Keep the session alive across the original
run and the follow-up (or persist the session ID and re-attach it later),
so the model retains the full conversation context and "remembers" what it did.

**Option B — Pragmatic re-prompt:** Start a fresh OpenCode server and session,
scoped to the **same worktree directory**, with no memory of the prior
conversation. The model sees "the current state of the code" rather than
"remembering what it did."

## Decision: Option B — Pragmatic Re-prompt

### Why Option A is not practical given the current adapter

The adapter (`opencode-adapter.ts`) calls `adapter.stopServer()` in the
`finally` block of every `_runAsync` call. This kills the server process that
owns the session. Session IDs are never written to TaskStore. There is no
guarantee that the server is still running by the time the user sends a
follow-up (could be seconds or hours later). Re-attaching would require:

1. Not calling `stopServer()` at the end of each run (resource leak if task
   count grows, and the adapter is designed for per-task lifecycle).
2. Persisting the session ID in TaskStore (new column, migration).
3. Allocating a stable port per task so the re-attach knows where to connect
   (current design uses a single port 4096, shared across concurrent tasks
   via the worktree `directory` query param).
4. Handling the case where the server has since been killed (app restart,
   crash) — we'd need a fallback to option B anyway.

This is non-trivial rework of the adapter's lifecycle model with minimal
benefit for the use case.

### Why Option B works correctly

A git worktree is the source of truth. After the original task:
- OpenCode will have created/edited files in the worktree.
- The diff-capture step (`git add -N . && git diff`) captured those changes.
- The files on disk reflect the full result of the original run.

A fresh OpenCode server pointed at the same worktree directory sees exactly
what a human developer picking up the directory would see: the current state
of the code, with all the original changes present. It can read, understand,
and continue from there. The model does not need conversation memory — it has
**filesystem memory**, which is more reliable and durable.

### Cumulative diff correctness

After the follow-up adds more changes to the worktree, re-running
`git add -N . && git diff` produces a diff that shows **all** unstaged changes
relative to the branch's base commit — the original changes AND the follow-up
changes together, in one unified diff. This is exactly the right thing to show
the user: the cumulative effect of everything the agent has done, ready for
Keep/Discard review.

### The "separator" in the event stream

Because the follow-up runs as a fresh session, the adapter will emit its own
`{ type: 'status', status: 'started' }` and `{ type: 'status', status: 'running' }`
events. Before appending these to TaskStore, the TaskRunner injects a synthetic
separator event (a `status` event with a distinct label) so that when the
event stream is replayed in the three-pane detail view, the user can clearly
see where the original run ended and the follow-up began.

## Summary

> A fresh session on the same worktree is simpler, more reliable, and produces
> correct cumulative diffs with no change to the adapter's lifecycle model.
> Conversation memory is not needed when filesystem state is the ground truth.
