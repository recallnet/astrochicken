---
doc_type: "architecture"
owner: "factory-ops"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
written: "2026-03-19"
tags: [architecture, contract, factory, insight, observability]
summary: "Shared contract for factory insight events and CLI projection dimensions across status, tick-status, subscribe, and outcomes surfaces."
---

# Architecture: Factory Insight Contract

Start here: [Documentation Index](../INDEX.md)

## Purpose

`hatch-ops factory status`, `hatch-ops factory tick-status`,
`hatch-ops factory subscribe`, and `hatch-ops factory outcomes` are first-party
operator surfaces that should answer the same operational questions from one
stable schema contract.

This doc defines that contract and where it is enforced.

## Contract owners and source files

- Canonical event normalization and required fields:
  - `packages/factory-ops/src/lib/factory-insight-contract.ts`
- Shared contract wrapper for event kinds and projection dimensions:
  - `packages/factory-ops/src/lib/insight-contract.ts`
- Drift test coverage:
  - `packages/factory-ops/test/supervisor/insight-contract.contract.test.mjs`

## Event contract

### Event kinds

`InsightEventKind` exports canonical names used by operator-facing event
surfaces:

- `factory.run.start`
- `factory.run.node_change`
- `factory.run.complete`
- `factory.run.fail`
- `factory.run.merge`
- `factory.run.artifact`
- `factory.progress.heartbeat`
- `factory.status.snapshot`
- `factory.tick.snapshot`
- `factory.outcomes.snapshot`

### Required event shape

Every normalized event emitted to subscribe/watch surfaces must satisfy:

- `schemaVersion`
- `eventName`
- `runId`
- `goalId`
- `graphId`
- `nodeName`
- `semanticFamily`
- `semanticTarget`
- `status`
- `timestamp`
- `attempt`
- `payload`

`ensureInsightEvent(event)` enforces this shape and throws fail-closed errors on
missing fields.

## Projection dimensions by CLI surface

`PROJECTION_DIMENSIONS` defines required top-level fields for each projection.

### `factory status`

Required projection dimensions:

- `context`
- `active`
- `completed`
- `failed`
- `blocked_control_plane`
- `managed_state`
- `control_plane`

### `factory tick-status`

Required projection dimensions:

- `context`
- `ticks`

### `factory subscribe` event rows

Required projection dimensions:

- `schemaVersion`
- `eventName`
- `runId`
- `goalId`
- `graphId`
- `nodeName`
- `semanticFamily`
- `semanticTarget`
- `status`
- `timestamp`
- `attempt`
- `payload`

### `factory outcomes`

Required projection dimensions:

- `repo`
- `since_iso`
- `commits`
- `goals`
- `issues`
- `merged_prs`
- `merge_commits_main`
- `closed_goals`
- `closed_features`
- `closed_feature_bug_total`
- `outcomes_degraded`
- `gh_failures`

## Enforcement model

- Runtime projection guards:
  - `ensureProjectionDimensions(surface, projection)`
- Runtime event guard:
  - `ensureInsightEvent(event)`
- Contract tests fail on drift:
  - missing required event fields
  - projection dimension mismatch against command exports

## Schema evolution guidance

When adding a new insight consumer or extending an existing surface:

1. Add or update dimensions in `insight-contract.mjs` first.
2. Wire command output to satisfy the new dimensions.
3. Extend `insight-contract.contract.test.mjs` so drift is pinned in CI.
4. Update this document in the same change.

Do not add one-off projection schemas in command files; all operator insight
surfaces should reuse this module as the single source of truth.
