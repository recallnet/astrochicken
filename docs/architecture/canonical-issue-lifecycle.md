---
doc_type: "architecture"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-30"
status: "active"
summary: "Canonical design for moving goal and sub-issue lifecycle truth from GitHub side effects to Postgres-owned state with GitHub as a projection target only."
tags: [architecture, factory-ops, github, lifecycle, postgres]
written: "2026-03-30"
---

# Canonical Issue Lifecycle

This document defines the target architecture for goal and sub-issue lifecycle
truth.

Current AstroChicken behavior still lets GitHub issue state decide whether work
is complete, retryable, or safe to close. That is the wrong ownership model.
Postgres canonical state must own lifecycle truth. GitHub is a projection.

## Fixed Decision

Postgres is the source of truth for goal and sub-issue lifecycle.

GitHub is a projection.

That means:

- execution-critical lifecycle decisions do not depend on GitHub open/closed
  state
- GitHub comments, labels, and closes are projections of canonical lifecycle
  state
- failed merge/push paths remain retryable in canonical state even if GitHub
  never observes a closing side effect
- `Closes #N` commit-message behavior becomes a convenience projection, not a
  required mechanism for correctness

## Why This Exists

The current design created three recurring failure modes:

- merge or push failed after sub-issue execution completed, so GitHub never ran
  the `Closes #N` side effect and sub-issues stayed open forever
- sweep and finalization logic had to guess whether open GitHub issues
  represented unfinished work or stale projection state
- goals and sub-issues could be closed without code landing on `main` because
  reconciliation mixed GitHub readback, packet history, and run-state hints

The `allSubIssueExecutionsCompleted` workaround is the clearest evidence that
ownership is wrong. It exists only because canonical execution state and GitHub
closure state can disagree.

## Current State

Current lifecycle truth is spread across Postgres/run state, packets, and
GitHub issue state.

### Current lifecycle readers that depend on GitHub

- `packages/factory-ops/src/commands/goal-final-state-review.ts`
  - `reconcileGoalFinalState`
  - performs final closure decisions and still accepts
    `allSubIssueExecutionsCompleted`
- `packages/factory-ops/src/lib/goal-final-state-projection.ts`
  - `projectGoalFinalState`
  - reads current GitHub sub-issue state to decide whether a goal is complete
- `packages/factory-ops/src/commands/goal-sweep-completed.ts`
  - `sweepCompletedGoals`
  - lists open goal issues on GitHub and reconciles them
- `packages/factory-ops/src/commands/wave-close-merged.ts`
  - `closeMergedIssues`
  - directly comments on and closes merged sub-issues on GitHub
- `apps/hatch/src/pipeline/action-registry-goal-execute.ts`
  - passes `mergedCount > 0` into `allSubIssueExecutionsCompleted`
  - relies on merge success hints to repair GitHub lifecycle state

### Current GitHub-dependent mechanisms

- Builder prompt contract requires `Closes #<issue_number>` in the commit
  message.
- Merge success is followed by `closeMergedIssues`.
- Goal completion relies on sub-issues appearing closed on GitHub.
- Sweep logic reads GitHub to find open goals and open sub-issues.

### Why that is wrong

GitHub issue closure is an external side effect. It is not a durable internal
execution fact.

Internal facts we actually care about are things like:

- decomposition completed
- sub-issues created
- issue build completed
- issue review approved
- merge_attempted
- merged
- pushed
- closed_on_gh

Only the last one is inherently a GitHub projection concern.

## Target Lifecycle Model

Canonical lifecycle lives in Postgres and is replayable from canonical events.

### Goal lifecycle states

- `decomposed`
- `sub_issues_created`
- `in_progress`
- `merge_attempted`
- `merged`
- `pushed`
- `closed_on_gh`

### Sub-issue lifecycle states

- `decomposed`
- `built`
- `reviewed`
- `merge_attempted`
- `merged`
- `pushed`
- `closed_on_gh`

These are cumulative execution facts, not mutually exclusive labels. The
projection for a row may materialize them as a latest state plus timestamps for
each achieved milestone.

### Transition rules

- `decomposed`
  - emitted when a goal or sub-issue is materially created for execution
- `built`
  - emitted only after the builder produced a committed implementation result
- `reviewed`
  - emitted only after deterministic review approval
- `merge_attempted`
  - emitted when the merge ceremony begins for that issue or goal candidate
- `merged`
  - emitted when the merge commit is created in the merge worktree
- `pushed`
  - emitted only after the merge result lands on `origin/main`
- `closed_on_gh`
  - emitted only after GitHub close projection succeeds

Hard rule:

- `pushed` is the last execution-critical success state
- `closed_on_gh` is downstream projection confirmation
- failure to reach `closed_on_gh` must never roll back `pushed`
- failure to reach `pushed` must never masquerade as `merged` or completed

## Projection Model

GitHub becomes an outbound projection target with projection receipts.

Required outbound projection receipts:

- comment posted
- label added or removed
- issue closed
- sub-issue link created

Every GitHub mutation should continue to go through the shared GitHub adapter
and projection target owner:

- `packages/factory-ops/src/lib/github-projection-target.ts`
- `packages/github-adapter/src/github-adapter.mjs`

The canonical event stream owns the lifecycle fact. GitHub mutation success or
failure is recorded as a projection receipt, not treated as lifecycle truth.

## What Changes

### 1. `reconcileGoalFinalState`

`reconcileGoalFinalState` stops asking GitHub whether work is done.

Target behavior:

- read canonical lifecycle projection for the goal and its sub-issues
- close a goal only when every canonical child is `pushed`
- project GitHub goal closure only after that canonical condition is true
- never infer success from GitHub sub-issue state

### 2. `projectGoalFinalState`

`projectGoalFinalState` becomes a Postgres-owned projection reader.

Target behavior:

- project sub-issue membership from canonical decomposition/materialization
- project execution completion from canonical issue lifecycle rows
- use GitHub only for projection health or readback dashboards when explicitly
  requested, not for execution-critical closure

### 3. `sweepCompletedGoals`

`sweepCompletedGoals` stops being a GitHub-open-goal reconciliation pass.

Target behavior:

- query canonical lifecycle projection for goals whose children are all `pushed`
- emit closure projections for goals not yet `closed_on_gh`
- record retryable projection failures without reopening lifecycle questions

### 4. `closeMergedIssues`

`closeMergedIssues` becomes a projection worker, not a lifecycle decider.

Target behavior:

- consume canonical `pushed` sub-issue rows that are not yet `closed_on_gh`
- close those GitHub issues
- emit `closed_on_gh` only on successful GitHub close projection

### 5. Builder commit message contract

`Closes #N` is no longer a correctness dependency.

We may keep it as a convenience and for human readability, but:

- missing `Closes #N` must not break lifecycle correctness
- GitHub auto-close firing must not be required for canonical progress
- lifecycle correctness must survive squash, rebase, amended merge messages,
  and push failure recovery

## Elimination Target

The migration eliminates `allSubIssueExecutionsCompleted`.

Reason:

- it is a synthetic bridge from canonical execution hints to GitHub truth
- once lifecycle truth is canonical, there is no reason to ask a caller to
  assert that all execution completed just to repair GitHub state

Deletion condition:

- canonical lifecycle projection exists for goals and sub-issues
- final-state reconciliation reads canonical lifecycle only
- merge-close projection operates from canonical `pushed` rows

## Migration Path

This migration should follow the same proof-then-cutover discipline used in the
Postgres truth migration.

### Phase 1: Proof inventory

- document every lifecycle read and write path listed above
- add a checked-in inventory of execution-critical GitHub lifecycle reads
- fail closed on newly introduced GitHub lifecycle reads outside the approved
  migration surface

### Phase 2: Canonical event families

Add canonical event families for:

- goal decomposed or materialized
- sub-issue created
- issue built
- issue reviewed
- merge_attempted
- merged
- pushed
- GitHub projection receipt events
- closed_on_gh

### Phase 3: Lifecycle projection tables

Build replayable Postgres projections for:

- `goal_lifecycle_projection`
- `sub_issue_lifecycle_projection`
- `github_projection_receipts`

The projection must answer:

- which sub-issues belong to which goal
- which sub-issues reached `pushed`
- which goals are canonically complete
- which GitHub close projections are pending or failed

### Phase 4: Command cutover

Cut over these owners in one deterministic sequence:

1. `goal-final-state-review.mjs`
2. `goal-final-state-projection.mjs`
3. `goal-sweep-completed.mjs`
4. `wave-close-merged.mjs`
5. prompt and runtime references that still imply GitHub closure as lifecycle
   truth

Each cutover commit must delete the legacy GitHub-truth branch in the same
change. No fallback path remains reachable after cutover.

### Phase 5: Prompt and docs cleanup

- remove language that says `Closes #N` is required for correctness
- update `docs/goal-lifecycle-walkthrough.md`
- delete the `allSubIssueExecutionsCompleted` workaround

## Non-Negotiable Invariants

- A goal or sub-issue that did not reach `pushed` is not complete.
- GitHub close success is not proof that code shipped.
- GitHub close failure is not proof that code did not ship.
- Canonical lifecycle state must be derivable without querying live GitHub
  issue open or closed state.
- Projection receipts are observable and retryable.
- Merge or push failure leaves work retryable in canonical state.

## Review Checklist

Before implementation begins, the approved design must explicitly answer:

- where goal and sub-issue membership is canonically stored
- which event owns the transition to `pushed`
- how failed GitHub close projections are retried
- how existing goals and sub-issues are backfilled into canonical lifecycle
- how `reconcileGoalFinalState`, `projectGoalFinalState`,
  `sweepCompletedGoals`, and `closeMergedIssues` change owner behavior
- how the `Closes #N` commit-message dependency is downgraded from correctness
  requirement to optional projection aid

## Bottom Line

Postgres must own lifecycle truth.

GitHub should show the truth, not define it.
