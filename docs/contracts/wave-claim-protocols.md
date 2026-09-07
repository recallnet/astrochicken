---
doc_type: "reference"
owner: "factory-ops"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Behavioral protocol contract and dependency map for wave claim modules used by mothership wave execution."
tags: [claim, contracts, factory-ops, wave]
written: "2026-03-11"
---
# Wave claim protocol contracts

## Overview

This document is the behavioral contract for the four wave-claim-related command modules used by mothership wave execution.

### Import dependency graph (actual code shape)

```text
wave-claim-deterministic.mjs (pure decision logic)
  └─ imported by wave-marker-claim.mjs
       ├─ imported by wave-ready-claim-ops.mjs
       ├─ imported by wave-find-ready.mjs
       ├─ imported by wave-sanitize-state.mjs
       ├─ imported by supervisor-detect-stalled-wave.mjs
       └─ imported by wave-claim-diagnostics.mjs

wave-ready-lease.mjs (append-only lease event protocol)
  ├─ imported by wave-ready-claim-ops.mjs
  ├─ imported by wave-block-ready.mjs
  ├─ imported by wave-sanitize-state.mjs
  ├─ imported by wave-dispatch-select.mjs
  ├─ imported by wave-create-ready.mjs
  ├─ imported by wave-throughput-report.mjs
  └─ imported by wave-claim-diagnostics.mjs (indirectly via ops paths)
```

Evidence:
- `wave-marker-claim.mjs` imports from `./wave-claim-deterministic.mjs` at lines 2-8 (including `listWaveClaimTransitionOwners`, `evaluateWaveClaimInvariants`, `decideWaveClaimAcquisition`, `decideWaveClaimRelease`).
- `wave-ready-claim-ops.mjs` imports from both `./wave-marker-claim.mjs` and `./wave-ready-lease.mjs` at lines 1-10.

### Protocol classification

- `wave-claim-deterministic.mjs` is a **pure logic dependency** (no GitHub I/O), not an independent resource-claim protocol implementation.
- `wave-marker-claim.mjs` is a **CAS-style embedded body-block protocol** on the marker issue body (`<!-- taxi:wave-marker-claim --> ...`).
- `wave-ready-lease.mjs` is an **append-only comment event protocol** (`WAVE_READY_LEASE_EVENT <json>` in issue comments).
- `wave-ready-claim-ops.mjs` is an **orchestration layer** that composes marker-claim ownership with ready-lease event emission and marker closure operations.

## wave-claim-deterministic.mjs

Exported symbols: 9 total (2 constants + 7 functions). All functions are pure logic (no `gh`, no subprocess I/O).

### Exported constants

- `WAVE_CLAIM_OWNER_CONTRACT_VERSION`
- `WAVE_CLAIM_TRANSITION_OWNERS`

### Exported function contracts

| Export | Signature | GitHub API calls | State read | State written | Error/retry/contention behavior | Classification |
|---|---|---|---|---|---|---|
| `listWaveClaimTransitionOwners` | `()` | none | `WAVE_CLAIM_TRANSITION_OWNERS` constant | return object only | none | pure logic |
| `evaluateWaveClaimInvariants` | `(claim, { nowEpochMs }={})` | none | claim fields (`claim_token`, `owner_id`, lease timestamps, etc.) | return object only | returns deterministic `violations[]`; no throw | pure logic |
| `decideWaveClaimAcquisition` | `({ snapshot, issueNumber, milestoneTitle, ownerId, runId, claimToken, leaseSeconds, nowEpochMs, hasWaveInProgressLabel }={})` | none | current snapshot state (`active`, `stale`, owner/run/token); label guard flag | returns next claim candidate only | enforces contention rules: deny on active foreign owner; deny stale reclaim if `wave-in-progress`; returns `acquire`/`refresh`/`reclaim` decision | pure logic |
| `decideWaveClaimRelease` | `({ snapshot, ownerId, runId, claimToken, force, nowEpochMs, reason, issueNumber, milestoneTitle }={})` | none | current snapshot claim | returns released claim candidate only | owner/token boundary unless `force=true`; deterministic reasons (`claim_missing`, `claim_owned_by_other`, etc.) | pure logic |
| `nextRetryCircuitState` | `({ state, nowEpochMs, maxAttempts, baseBackoffMs, capBackoffMs, terminalOverflowCount }={})` | none | current retry/circuit counters | returns next state only | bounded retry, exponential backoff, terminal open-circuit state | pure logic |
| `planWaveClaimOrphanSweep` | `({ claimSnapshots, worktreeLocks, activeRunIds, nowEpochMs }={})` | none | claim snapshots + worktree lock inventory + active runs | returns sorted action plan only | identifies stale artifacts; deterministic action ordering | pure logic |
| `applyWaveClaimOrphanSweep` | `({ plan, releaseClaim, removeWorktreeLock }={})` | none directly | `plan.actions` | calls injected callbacks only | per-action success/failure accounting; no internal retries | pure logic orchestrator (side effects injected) |

## wave-marker-claim.mjs

Exported symbols: 14 total (4 constants + 10 functions). Protocol: embedded JSON claim block in issue body + patch/verify loop.

### Exported constants

- `WAVE_MARKER_CLAIM_SCHEMA_VERSION`
- `WAVE_MARKER_CLAIM_BLOCK_START`
- `WAVE_MARKER_CLAIM_BLOCK_END`
- `WAVE_MARKER_CLAIM_TRANSITION_OWNERS` (delegates to deterministic ownership map)

### Exported function contracts

| Export | Signature | GitHub API calls | State read | State written | Error/retry/contention behavior | Classification |
|---|---|---|---|---|---|---|
| `milestoneTitleForWaveMarker` | `(issue={})` | none | `issue.milestone.title`, `issue.title` | none | none | pure logic |
| `buildDeterministicClaimToken` | `({ ownerId, runId, issueNumber, milestoneTitle }={})` | none | owner/run/issue/milestone seed | none | deterministic SHA-256 token derivation | pure logic |
| `normalizeWaveMarkerClaim` | `(rawClaim, { issueNumber, milestoneTitle }={})` | none | raw claim payload | normalized claim object | returns `null` for invalid claim fields | pure logic |
| `parseWaveMarkerClaimFromBody` | `(body="", fallback=null)` | none | issue body text between marker block delimiters | none | fallback on parse failure/missing block | pure logic |
| `upsertWaveMarkerClaimInBody` | `(body="", claim=null)` | none | existing issue body and optional current block | full updated body text (return value only) | supports insert/replace/remove block | pure logic |
| `describeWaveMarkerClaim` | `(claim, { nowEpochMs }={})` | none | normalized claim timestamps/status | snapshot descriptor | classifies as `active`/`stale`/`released`/`unknown` | pure logic |
| `parseWaveMarkerClaimSnapshot` | `(issue={}, { nowEpochMs }={})` | none | issue body + milestone/title fallback | snapshot descriptor | parse/normalize/describe pipeline | pure logic |
| `createWaveClaimGhClient` | `({ spawn=spawnSync }={})` | `gh api -i repos/{repo}/issues/{n}` (GET), `gh api -X PATCH repos/{repo}/issues/{n}` (PATCH body) | issue payload + headers | issue body patch via Issues API | maps CLI errors; surfaces `precondition_failed` heuristic from stderr | mutating adapter |
| `acquireWaveMarkerClaim` | `({ repo, issueNumber, milestoneTitle, ownerId, runId, claimToken, leaseSeconds, nowEpochMs, client, maxAttempts }={})` | via client: repeated GET + PATCH + verify GET | issue state, labels, milestone/title, body claim block | issue body claim block (JSON upsert) | contention-safe loop (`maxAttempts`); deny foreign active owner; deny stale-claim steal with `wave-in-progress`; verify-after-write to prevent lost-write races; retries on precondition/collision; terminal reasons include `issue_load_failed`, `claim_invariant_failed`, `claim_patch_failed`, `cas_conflict_retry_exhausted` | mutating |
| `validateWaveMarkerClaimOwnership` | `({ repo, issueNumber, ownerId, runId, claimToken, nowEpochMs, client }={})` | via client: GET issue | current claim snapshot | none | explicit invalid reasons (`claim_missing`, `claim_stale`, `claim_owned_by_other`, `claim_token_mismatch`) | read-only |
| `releaseWaveMarkerClaim` | `({ repo, issueNumber, ownerId, runId, claimToken, reason, force, nowEpochMs, client, maxAttempts }={})` | via client: GET + PATCH | current claim snapshot in body | **removes claim block from body** on success | owner/token boundary unless `force`; retries on precondition conflicts; terminal reasons include `claim_missing`, `claim_not_released`, `claim_patch_failed`, `cas_conflict_retry_exhausted` | mutating |

### Marker-claim state mechanism (contract)

- State object is persisted in the marker issue body inside:
  - `<!-- taxi:wave-marker-claim -->`
  - JSON payload
  - `<!-- /taxi:wave-marker-claim -->`
- Ownership transition decisions are delegated to deterministic module functions before write.
- Release path intentionally clears the body block to avoid stale-claim re-detection in future ticks.

## wave-ready-claim-ops.mjs

Exported symbols: 3 functions. This file is an orchestration layer over marker-claim + lease-event modules.

| Export | Signature | GitHub API calls | State read | State written | Error/retry/contention behavior | Classification |
|---|---|---|---|---|---|---|
| `lockReadyWaveIssue` | `({ repo, readyIssueNumber, milestoneTitle, claimToken, claimOwnerId, claimRunId, leaseSeconds, nowEpochMs, claimAcquire, claimReleaser, execGh }={})` | `gh issue edit --add-label wave-in-progress` (via `execGh`) + delegated marker-claim calls | marker claim acquisition result | marker issue label; may release claim on label-edit failure | if claim not acquired: no label mutation; if label add fails: compensating `releaseWaveMarkerClaim` call with reason `failed_to_set_wave_in_progress` | mutating orchestrator |
| `completeReadyWaveIssue` | `({ repo, readyIssueNumber, milestoneTitle, claimToken, claimOwnerId, claimRunId, claimValidator, claimReleaser, execGh, listMilestoneOpenIssuesFn }={})` | `gh issue list` (milestone open issues), `gh issue comment` (lease event + human note), `gh issue close` | ownership validity, milestone open issues | appends release lease event comment, appends human comment, closes marker issue, releases marker body-claim | short-circuits if not owner or if non-marker milestone issues remain; close failure aborts claim release step | mutating orchestrator |
| `releaseReadyWaveClaim` | `({ repo, readyIssueNumber, claimToken, claimOwnerId, claimRunId, reason, force, claimReleaser }={})` | delegated marker-claim release only | none local | marker-claim release delegation | passthrough normalization of release result | mutating orchestrator |

## wave-ready-lease.mjs

Exported symbols: 9 total (2 constants + 7 functions). Protocol: append-only lease events in issue comments.

### Exported constants

- `WAVE_READY_LEASE_EVENT_SCHEMA_VERSION`
- `WAVE_READY_LEASE_EVENT_PREFIX`

### Exported function contracts

| Export | Signature | GitHub API calls | State read | State written | Error/retry/contention behavior | Classification |
|---|---|---|---|---|---|---|
| `parseWaveReadyLeaseEventsFromComment` | `(comment={}, { fallbackMilestone="", fallbackIssueNumber="" }={})` | none | comment body lines, created timestamp | none | ignores invalid prefix/JSON/schema/action | pure logic |
| `buildWaveReadyLeaseEvent` | `({ action, milestoneTitle, readyIssueNumber, runId, pipeline, reason, at }={})` | none | input fields | event object | normalizes action to `claim/release`, validates issue number coercion | pure logic |
| `renderWaveReadyLeaseComment` | `(event={})` | none | event object | comment string (`PREFIX + JSON`) | none | pure logic |
| `collectActiveWaveLeasesFromIssues` | `({ openIssues, commentsByIssue, nowEpochMs, staleClaimMinutes }={})` | none | marker issues, labels, parsed comment events | none | explicit event history is authoritative; optional stale timeout; legacy fallback to implicit `wave-in-progress` only when no explicit events exist | read-only |
| `collectActiveWaveLeasesFromRepo` | `({ repo, openIssues, nowEpochMs, staleClaimMinutes, execGhJson }={})` | `gh api repos/{repo}/issues/{n}/comments?per_page=100&page=k` paginated | open markers + per-marker comments from API | none | pagination up to 100 pages per issue; tolerant of empty pages/failures via fallback | read-only (network read) |
| `claimReadyWaveIssue` | `({ repo, readyIssueNumber, milestoneTitle, runId, pipeline, execGh }={})` | `gh issue edit --add-label wave-in-progress`; `gh issue comment --body <event>`; rollback `gh issue edit --remove-label wave-in-progress` on comment failure | issue identifier + milestone input | label mutation + appended `claim` event comment | rollback path if comment write fails; returns rollback result details | mutating |
| `releaseReadyWaveClaim` | `({ repo, readyIssueNumber, milestoneTitle, runId, pipeline, reason, removeLabel, execGh }={})` | `gh issue comment --body <event>`; optional `gh issue edit --remove-label wave-in-progress` | issue identifier + milestone input | appended `release` event comment; optional label removal | if comment fails returns error; if label removal fails returns failed `ok` with diagnostics | mutating |

### Ready-lease state mechanism (contract)

- Persistent state is append-only event lines in marker comments:
  - `WAVE_READY_LEASE_EVENT { ...json... }`
- No marker-body CAS JSON block and no patch/verify loop.
- Active lease derivation is reconstructed from comment history (+ legacy label fallback when no explicit event history exists).

## Caller Map

Runtime caller map for wave claim protocols (9 files requested), with exact imports/usages.

| Caller file | Imported/used exports |
|---|---|
| `packages/factory-ops/src/cli/commands/wave.mjs` | Dynamic imports: `lockReadyWaveIssue` (line 261), `claimReadyWaveIssue` (line 452), `completeReadyWaveIssue` (line 485), `releaseReadyWaveClaim` from ops alias `releaseReadyWaveClaimOps` (line 519), `releaseReadyWaveClaim` from lease module (line 525). |
| `packages/factory-ops/src/commands/wave-claim-diagnostics.ts` | From deterministic: `applyWaveClaimOrphanSweep`, `listWaveClaimTransitionOwners`, `nextRetryCircuitState`, `planWaveClaimOrphanSweep`. From marker: `acquireWaveMarkerClaim`, `buildDeterministicClaimToken`, `parseWaveMarkerClaimFromBody`, `releaseWaveMarkerClaim`, `upsertWaveMarkerClaimInBody`, `validateWaveMarkerClaimOwnership`, `WAVE_MARKER_CLAIM_SCHEMA_VERSION`. From ops: `completeReadyWaveIssue`, `lockReadyWaveIssue`. |
| `packages/factory-ops/src/commands/wave-block-ready.ts` | `releaseReadyWaveClaim` from `wave-ready-lease.mjs`. |
| `packages/factory-ops/src/commands/wave-sanitize-state.ts` | `releaseWaveMarkerClaim` from `wave-marker-claim.mjs`; `collectActiveWaveLeasesFromRepo` from `wave-ready-lease.mjs`. |
| `packages/factory-ops/src/commands/wave-find-ready.ts` | `acquireWaveMarkerClaim`, `buildDeterministicClaimToken`, `milestoneTitleForWaveMarker` from `wave-marker-claim.mjs`. |
| `packages/factory-ops/src/commands/wave-dispatch-select.ts` | `parseWaveReadyLeaseEventsFromComment` from `wave-ready-lease.mjs`. |
| `packages/factory-ops/src/commands/wave-create-ready.ts` | `parseWaveReadyLeaseEventsFromComment` from `wave-ready-lease.mjs`. |
| `packages/factory-ops/src/commands/wave-throughput-report.ts` | `collectActiveWaveLeasesFromIssues`, `parseWaveReadyLeaseEventsFromComment` from `wave-ready-lease.mjs`. |
| `packages/factory-ops/src/commands/supervisor-detect-stalled-wave.ts` | `parseWaveMarkerClaimSnapshot` from `wave-marker-claim.mjs`. |

## State protocol compatibility assessment

### Marker-claim vs ready-lease protocol mismatch

- `wave-marker-claim.mjs` uses issue-body embedded JSON + patch semantics + verify-after-write ownership checks.
- `wave-ready-lease.mjs` uses append-only comment events + replay to derive active state.

These are different persistence surfaces and conflict semantics:
- Marker-claim: overwrite/update body block (single latest contract object).
- Ready-lease: append immutable events (history log).

Therefore a single naive `acquireLock()` primitive is likely to be artificial unless it becomes a high-level facade that hides two fundamentally different storage/consistency mechanisms.

## Unification Strategy Recommendation

Decision options considered:

1. **Full 4→1 strategy pattern** (`acquireClaim()` + mode strategies)
   - Viability: low-to-medium.
   - Problem: treats `wave-claim-deterministic.mjs` as a mode even though it is a dependency library, not a protocol endpoint.
   - Problem: marker-body CAS semantics and lease-event append semantics do not share the same lock/write primitives.

2. **Layered-module approach (recommended baseline)**
   - Keep deterministic logic as shared lib (candidate rename in F-2: `lib/wave-claim-logic.mjs`).
   - Unification target should focus on operational entrypoints (`wave-marker-claim.mjs`, `wave-ready-claim-ops.mjs`, `wave-ready-lease.mjs`) with explicit protocol boundaries.
   - Preserves current architecture truth: deterministic decision layer + two distinct state protocols + orchestration layer.

3. **Do not force unification (split protocols, shared logic only)**
   - Also viable if F-2 scope prioritizes semantic clarity over LOC reduction.
   - Keep two protocol modules (`wave-marker-claim`, `wave-ready-lease`) and a thin orchestrator.

### Recommendation

**Use the layered-module approach.**

Rationale:
- Matches current dependency graph and avoids false equivalence of “four parallel claim implementations”.
- Preserves explicit protocol boundaries where state models are incompatible.
- Reduces abstraction risk: avoids creating a single `acquireLock()` contract that obscures materially different GitHub state transitions.

## Coverage contract gap (for follow-up)

`packages/factory-ops/test/wave-lifecycle-coverage-contract.test.mjs` includes `wave-ready-lease.mjs` exports in `COVERAGE_CONTRACT` (around lines 64-71), but omits:

- `wave-claim-deterministic.mjs`
- `wave-marker-claim.mjs`
- `wave-ready-claim-ops.mjs`

This means export-coverage drift in those claim modules is not currently guarded by the lifecycle coverage contract and should be closed in follow-up work.
