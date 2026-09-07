---
doc_type: "architecture"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-26"
status: "active"
summary: "Commit-by-commit singleton migration contract for moving factory truth to a shared Colima-hosted Postgres event store without hedged ownership."
tags: [architecture, cqrs, event-sourcing, migration, postgres]
written: "2026-03-25"
---

# Postgres Canonical Truth Migration

This is the canonical migration ledger for moving AstroChicken factory truth to
a shared Colima-hosted Postgres event store.

Migration status: complete. Postgres canonical truth is now the permanent
AstroChicken architecture, and this ledger remains as the checked-in cutover
record.

The target shape is:

- one shared local Postgres instance for all factories
- one append-only canonical event log partitioned by `factory_id`
- replayable projections for operator surfaces
- GitHub as inbound issue source and outbound projection target, never internal
  truth

## Fixed Decisions

1. Canonical truth is Postgres, not local files.
2. The shared local Postgres instance serves all factories (`mothership`,
   `example-trading`, future factories).
3. Every canonical event row carries `factory_id`.
4. `append(events[])` is transactional. One append call writes one committed
   batch.
5. Replay order is `commit_cursor ASC, batch_offset ASC`.
6. Underlying sequence gaps are allowed. Projectors must never wait for gapless
   numeric continuity.
7. `subscribe()` starts as polling at `1000ms`. That latency floor is working as
   designed until a later optimization pass.
8. If Postgres is unavailable, execution-critical factory behavior fails closed.
   Read-only operator surfaces may show explicit degraded last-known views, but
   ticks do not continue.
9. Canonical events are emitted only from deterministic tool/command ownership
   points. LLM prompt handlers never emit canonical events directly.
10. Pre-migration state was imported exactly once through the retired backfill
    command. Historical imported rows carry explicit provenance metadata
    (`event_origin=backfill` or equivalent) so replay and audits can distinguish
    imported state from native runtime history.
11. Historical backfilled events may reuse canonical event families, but they
    are never allowed to masquerade as contemporaneously emitted history.

## Backfill Provenance Contract

Backfill was a migration boundary, not a rewrite of history.

Rules:

- Backfilled rows carry explicit provenance metadata in the event envelope.
- Projection logic for current state may ignore provenance when the event family
  semantics are otherwise valid.
- Replay, audit, debugging, and migration verification must preserve provenance.
- If a later native runtime event conflicts with imported backfill state, the
  native runtime event wins and the divergence is diagnosable.
- The one-time backfill script is now deleted because:
  - replay suite passes from event `0`
  - both factories have completed live smoke on canonical truth

## GitHub Adapter Contract

GitHub is two things and exactly two things:

1. **Inbound issue source.** Factories receive work via GitHub issues. The
   GitHub adapter reads issues and translates them into canonical events. This
   read path stays permanently.
2. **Outbound projection target.** Factories write status updates, comments,
   labels, and close actions to GitHub. These are projections of internal state,
   not sources of truth. Every outbound mutation records a projection receipt
   event.

GitHub is never used to:

- learn the current state of a goal, issue, wave, or milestone for
  execution-critical decisions
- seed execution state for scheduler/admission logic
- determine whether a goal should be closed or kept open
- resolve merge conflict or review state

The GitHub adapter package (`packages/github-adapter`) owns all GitHub I/O. No
factory domain code reaches GitHub directly.

## Commit Types

Allowed migration commit types:

- `proof`
- `cutover`

Definitions:

- `proof`: adds contracts, parity harnesses, fixtures, inventories, emitters,
  allowlists, or structural gates. Does not transfer truth ownership. Does not
  delete legacy code.
- `cutover`: transfers truth ownership to the new path and deletes the old truth
  path in the same commit. No fallbacks. No dead code behind flags. No "for
  compatibility" residue.

Hard rules:

- No commit may leave both old and new truth paths reachable.
- Cutover commits delete legacy code. There is no grace period.
- We are the sole client. No shadow releases, staged rollouts, compatibility
  shims, or feature flags.
- One commit owns one migration scope. Adjacent scopes may share fixtures, but
  they do not share cutovers.

## Package Boundaries

This migration is package-scoped, not one central rewrite.

Rules:

- Every commit must name the concrete package/app/doc boundaries it owns.
- Every cutover commit must name the concrete delete surfaces it removes.
- Shared guards may live in central scripts, but the concern owner still lives
  in the package that owns the runtime behavior.
- `packages/factory-ops` may own factory projections and operator surfaces.
- `packages/github-adapter` owns GitHub I/O boundaries.
- `apps/hatch` owns runtime lifecycle emission and event-store wiring at the
  engine boundary.
- `docs/` owns the migration ledger and human review contract, but docs are not
  a substitute for package-owned invariants.

## TDD Rule

Whenever a commit changes runtime behavior, projection behavior, migration
ownership, or a structural invariant, it starts with a failing test, failing
fixture, or failing gate first.

Allowed proof forms:

- failing unit/integration test first
- failing parity fixture first
- failing structural-gate violation fixture first
- failing replay fixture first

## Review Gate

Every migration commit must carry this header in its commit body:

```text
Type: <proof|cutover>
New Owner: <single owner or none>
Owner Packages: <concrete package/app/doc paths>
Deleted Owner: <single deleted owner or none>
Delete Surfaces: <concrete files/modules/surfaces or none>
Fallbacks Removed: <explicit list or none>
Invariant Added: <gate or fail-closed rule>
Proof Run: <tests/fixtures/live smoke>
```

Reviewer sign-off sentence:

> After this commit, concern X is owned by Y, and Z is no longer a source of truth.

Hard reject rules:

1. Both old and new truth paths remain reachable after a cutover commit.
2. A fallback to the old truth path still exists after cutover.
3. A migration commit adds a new abstraction without deleting the old owner.
4. A cutover commit leaves legacy code present. Delete it or this is not a
   cutover.
5. A cutover commit transfers truth without also adding the invariant that
   prevents regression.
6. A proof commit lacks the fixture/parity inventory it claims to add.
7. A commit introduces execution-critical GitHub reads in a scope that is
   already under migration gate protection.
8. A commit emits canonical events from LLM prompt surfaces.
9. A commit introduces best-effort degraded execution where the architecture
   says fail-closed.
10. A commit cannot name the deleted owner in one sentence.
11. A commit uses banned compatibility language anywhere in its migration ledger
    entry.
12. A commit mixes two migration scopes (for example status cutover and
    scheduler cutover in one commit).

## What Agents Will Try To Do Wrong

Agents executing this plan will attempt these evasions. Reject them immediately:

- **Leaving old readers as "fallback" or "for safety."** There is no safety in
  having two truth paths. The old reader is the bug.
- **Adding an abstraction layer that dispatches to old or new.** This is a
  compatibility shim. Delete it.
- **Emitting events from LLM prompt handlers.** Canonical events come from
  deterministic tool/command code only.
- **Writing "dual-read" comparison code.** We are the sole client. Cut over and
  delete. If it breaks, fix it.
- **Skipping deletion and calling it "phase 2."** If you transferred truth, you
  delete the old path in the same commit or it is not a cutover.
- **Adding GitHub reads "just to verify" after cutover.** The projection is
  truth. If the projection is wrong, fix the projection.
- **Leaving projection receipt events as TODO.** Every outbound GitHub mutation
  must record a receipt event. No exceptions.
- **Claiming a cutover is done without regression fixtures.** If there are no
  fixtures proving the new path works for the known failure modes, the cutover
  is not done.
- **Treating backfill as real historical provenance.** Imported state may become
  valid current state, but it is still imported and must remain identifiable.

## Commit Ledger

> **Tracking:** Each commit section has a `Landed` field that tracks progress:
>
> - `pending` — not started
> - `dispatched` — work assigned to codex agent, waiting for commit
> - `<short-hash>` (e.g., `a1b2c3d`) — commit landed, awaiting review
>
> Update the field as each transition occurs. This is the single source of
> migration progress.

### Commit 01

Type: `proof`
Title: `feat(event-store): add canonical event store contract, Postgres bootstrap, and envelope schema`
New Owner: `canonical event-store interface + Postgres runtime + event envelope`
Owner Packages: `apps/hatch, packages/factory-ops, docs/architecture`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `transactional batch ordering + fail-closed on DB outage + envelope versioning rules`
Proof Run: `store contract tests + Postgres integration tests + envelope fixture tests + bootstrap smoke`
Landed: `83c0b566`

Acceptance:

- architecture contract is checked in (this document)
- Colima Postgres bootstrap with persistent volume, healthcheck, backup/restore
  checked in under `packages/factory-ops/config/postgres/` with runtime state
  rooted at `.hatch/postgres/canonical-event-store/`
- `append(events[])` / `read(afterCursor?)` / `subscribe()` interface
- Postgres adapter with `factory_events` table, indexes by `factory_id`,
  `commit_cursor`, `run_id`
- event envelope includes provenance metadata for imported history
- schema evolution rules: additive preferred, breaking requires new family or
  version, projectors declare supported versions
- fail-closed guard: DB-down halts execution-critical paths
  (`HATCH_CANONICAL_EVENT_STORE_REQUIRED=true` +
  `HATCH_CANONICAL_EVENT_STORE_URL=...`)
- all contract tests pass against local Postgres

### Commit 02

Type: `proof`
Title: `feat(events): add one-time backfill command and canonical lifecycle emitters`
New Owner: `one-time backfill command + deterministic lifecycle emitters`
Owner Packages: `apps/hatch, packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `fresh runs emit canonical lifecycle events + imported rows preserve provenance`
Proof Run: `failing replay fixture first + backfill replay tests + fresh-run lifecycle replay tests`
Landed: `e68c9ee2`

Acceptance:

- one-time backfill command reads current state.json/run files and emits
  canonical events with explicit imported provenance
- TDD: failing replay or provenance fixture first
- Hatch run lifecycle (start, node enter/exit, complete, fail) emits to the
  canonical store
- events correctly partition by `factory_id`
- replay from imported rows reconstructs current known state without erasing
  provenance

### Commit 03

Type: `proof`
Title: `feat(events): add factory-domain event emitters for goals, issues, reviews, merges, and control actions`
New Owner: `deterministic command/tool event emitters`
Owner Packages: `packages/factory-ops, apps/hatch`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `canonical event emission banned outside deterministic ownership points + LLM emitter gate`
Proof Run: `failing emission test first + command-level emission tests + LLM emitter violation fixture`
Landed: `d1fdcc2d`

Acceptance:

- events emitted from command ownership points: goal selected, issue created,
  issue execution started/completed, review verdict applied, merge completed,
  control action applied (pause/resume/quarantine/retry/unblock)
- structural gate rejects canonical event emission from LLM prompt surfaces
- each emitter has a test proving the event matches the mutation performed
- TDD: failing emission or violation fixture first

### Commit 04

Type: `proof`
Title: `feat(github-adapter): define GitHub adapter contract as inbound source + outbound projection target`
New Owner: `GitHub adapter boundary contract`
Owner Packages: `packages/github-adapter, packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `structural gate: factory domain code cannot import GitHub I/O directly`
Proof Run: `failing boundary violation fixture first + projection receipt emission tests`
Landed: `c0665b0d`

Acceptance:

- `packages/github-adapter` owns all GitHub I/O
- inbound: issue reads that produce canonical events (issue source)
- outbound: status updates, comments, labels, close actions that record
  projection receipt events
- structural gate: factory domain packages cannot directly call `gh` CLI or
  GitHub API outside the adapter
- projection receipt events emitted for every outbound mutation
- TDD: failing boundary violation fixture first

### Commit 05

Type: `proof`
Title: `test(status): add canonical status parity harness`
New Owner: `status parity harness`
Owner Packages: `packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `CI parity gate for status projection`
Proof Run: `failing status parity fixture first + status fixture parity tests`
Landed: `b09bfb37`

Acceptance:

- Postgres projector for `factory_status_projection` matches current
  `factory-state-status-projection.mjs` on captured fixtures
- fixtures cover: normal tick, stale run, paused daemon
- TDD: failing status parity fixture first

### Commit 06

Type: `cutover`
Title: `refactor(status): cut factory status to canonical projection`
New Owner: `Postgres status projection`
Owner Packages: `packages/factory-ops`
Deleted Owner: `legacy status truth reader`
Delete Surfaces: `packages/factory-ops/src/lib/factory-state-status-projection.mjs legacy truth readers and imports`
Fallbacks Removed: `all legacy status truth paths`
Invariant Added: `status command cannot read legacy truth path`
Proof Run: `TDD: failing status cutover fixture first + status parity + live smoke on mothership and example-trading`
Landed: `c617a3fd`

Acceptance:

- `factory status` reads from Postgres projection
- legacy status truth reader deleted
- no imports of deleted status modules remain
- structural gate prevents new code from reading legacy status truth

### Commit 07

Type: `proof`
Title: `test(tick): add canonical tick parity harness`
New Owner: `tick parity harness`
Owner Packages: `packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `CI parity gate for tick projection`
Proof Run: `failing tick parity fixture first + tick fixture parity tests`
Landed: `41b6b3c0`
Review Note: landed commit body only recorded `Review Gate: PASS`; this ledger entry is the canonical structured review record required by the migration contract.

Acceptance:

- Postgres projector for `factory_tick_projection` matches current
  `factory-state-tick-projection.mjs` on captured fixtures
- fixtures cover: normal tick, stale tick, paused daemon, active child progress
- TDD: failing tick parity fixture first

### Commit 08

Type: `cutover`
Title: `refactor(tick): cut tick-status and subscribe to canonical projection`
New Owner: `Postgres tick projection`
Owner Packages: `packages/factory-ops`
Deleted Owner: `legacy tick truth reader`
Delete Surfaces: `packages/factory-ops/src/lib/factory-state-tick-projection.mjs legacy tick readers and imports`
Fallbacks Removed: `all legacy tick truth paths`
Invariant Added: `tick-status and subscribe cannot read legacy tick truth`
Proof Run: `TDD: failing tick cutover fixture first + tick parity + live smoke on mothership and example-trading`
Landed: `68ccfa52`

Acceptance:

- `tick-status` and `subscribe` read from Postgres-backed tick data
- legacy tick truth reader deleted
- no imports of deleted tick modules remain

### Commit 09

Type: `proof`
Title: `test(fleet): add canonical fleet parity harness`
New Owner: `fleet parity harness`
Owner Packages: `packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `CI parity gate for fleet projection`
Proof Run: `failing fleet parity fixture first + fleet fixture parity tests including multi-factory coverage`
Landed: `a5588844`

Acceptance:

- Postgres projector for `factory_fleet_projection` matches current
  `factory-state-fleet-projection.mjs` on multi-factory fixtures
- fixtures cover: mothership + example-trading together, paused factory, unhealthy factory
- TDD: failing fleet parity fixture first

### Commit 10

Type: `cutover`
Title: `refactor(fleet): cut fleet, attention, and tui summary to canonical projection`
New Owner: `Postgres fleet projection`
Owner Packages: `packages/factory-ops`
Deleted Owner: `legacy fleet truth reader`
Delete Surfaces: `packages/factory-ops/src/lib/factory-state-fleet-projection.mjs legacy fleet readers and imports`
Fallbacks Removed: `all legacy fleet truth paths`
Invariant Added: `fleet surfaces cannot read legacy truth path`
Proof Run: `TDD: failing fleet cutover fixture first + fleet parity + live smoke on mothership and example-trading`
Landed: `fbda51fe`

Acceptance:

- `fleet-status`, `attention`, and TUI summary read from Postgres fleet projection
- legacy fleet truth reader deleted
- no imports of deleted fleet modules remain

### Commit 11

Type: `proof`
Title: `test(github-truth): inventory execution-critical GitHub reads and add repo-wide gate with checked-in allowlist`
New Owner: `GitHub truth-read migration boundary + repo-wide gate + checked-in offender allowlist`
Owner Packages: `packages/github-adapter, packages/factory-ops`
Deleted Owner: `none`
Delete Surfaces: `none`
Fallbacks Removed: `none`
Invariant Added: `repo-wide structural gate forbids new execution-critical GitHub reads outside github-adapter`
Proof Run: `failing violation fixture first + exhaustive call-graph inventory + intentional violation fixture`
Landed: `3a8753c4`

Acceptance:

- exhaustive inventory of every `gh issue view`, `gh api`, and GraphQL call used
  for execution-critical decisions
- repo-wide structural gate is active
- any still-existing execution-critical GitHub truth reads are listed in one
  checked-in allowlist owned by this commit
- intentional violation fixture proves the gate catches new violations
- TDD: failing violation fixture first

### Commit 12

Type: `cutover`
Title: `refactor(seed-state): replace milestone seed-state GitHub truth reads with canonical projections`
New Owner: `canonical milestone seed-state projection`
Owner Packages: `packages/factory-ops, packages/github-adapter`
Deleted Owner: `GitHub milestone seed-state truth reads`
Delete Surfaces: `packages/factory-ops/src/commands/milestone-seed-state.ts legacy GitHub truth-read callsites`
Fallbacks Removed: `all legacy seed-state truth paths`
Invariant Added: `seed-state path cannot read GitHub for internal truth`
Proof Run: `TDD: failing seed-state fixture first + seed-state fixtures + live smoke`
Landed: `f5d0fb5b`

Acceptance:

- milestone seed-state reads canonical projection, not GitHub milestones
- replaced seed-state truth readers deleted
- checked-in GitHub-read allowlist shrinks accordingly

### Commit 13

Type: `cutover`
Title: `refactor(goal-final-state): replace goal closure GitHub truth reads with canonical projections`
New Owner: `canonical goal final-state projection`
Owner Packages: `packages/factory-ops, packages/github-adapter`
Deleted Owner: `GitHub-driven goal closure truth path`
Delete Surfaces: `packages/factory-ops/src/commands/goal-final-state-review.ts legacy GitHub truth-read callsites`
Fallbacks Removed: `all legacy goal final-state truth paths`
Invariant Added: `goal final-state path cannot read GitHub for internal truth`
Proof Run: `TDD: failing premature-close fixture first + partial-completion fixtures + live smoke`
Landed: `7b71f7cc`

Acceptance:

- goal final-state reads canonical projection, not GitHub issue state
- premature-close regression is covered at projection level
- replaced goal final-state truth readers deleted
- checked-in GitHub-read allowlist shrinks accordingly

### Commit 14

Type: `cutover`
Title: `refactor(scheduler): replace scheduler and admission GitHub truth reads with canonical projections`
New Owner: `canonical scheduler and admission projections`
Owner Packages: `packages/factory-ops, packages/github-adapter`
Deleted Owner: `GitHub truth reads in scheduler and admission paths`
Delete Surfaces: `packages/factory-ops scheduler and admission GitHub truth-read callsites`
Fallbacks Removed: `all legacy scheduler and admission truth paths`
Invariant Added: `scheduler and admission paths cannot read GitHub for internal truth`
Proof Run: `TDD: failing scheduler fixture first + backpressure + fan-out + multi-goal fixtures + live smoke on mothership and example-trading`
Landed: `e4e60fc7`

Acceptance:

- scheduler/admission reads canonical projection for goal selection,
  decomposition eligibility, wave readiness, issue readiness
- replaced scheduler/admission truth readers deleted
- checked-in GitHub-read allowlist shrinks by the scheduler/admission
  entries; remaining entries are non-execution-critical (observability,
  reporting, governance) and tracked as post-migration debt outside this
  ledger scope

### Commit 15

Type: `cutover`
Title: `refactor(control-state): make control-state event-backed projection-only`
New Owner: `canonical control events + Postgres control projection`
Owner Packages: `packages/factory-ops`
Deleted Owner: `mutable local control-state files as truth`
Delete Surfaces: `packages/factory-ops/src/lib/daemon-control-state.ts truth-owning reads and writers`
Fallbacks Removed: `all legacy control-state truth paths`
Invariant Added: `execution-critical control-state reads must go through canonical projection`
Proof Run: `TDD: failing control-state fixture first + control-state replay + operator command smoke + live smoke`
Landed: `1057a6d5`

Acceptance:

- pause/resume/quarantine/retry/unblock are canonical events, not mutable truth files
- `daemon-control-state.mjs` becomes a projector reading from Postgres
- operator commands still work
- local mutable control-state files are no longer authoritative

### Commit 16

Type: `cutover`
Title: `refactor(packets): derive packets from canonical workflow and incident events`
New Owner: `canonical packet projection`
Owner Packages: `packages/factory-ops`
Deleted Owner: `packet files as truth`
Delete Surfaces: `packages/factory-ops packet truth readers and packet-as-truth file paths`
Fallbacks Removed: `all legacy packet truth paths`
Invariant Added: `packet surfaces are projections, not authoritative`
Proof Run: `TDD: failing packet reconstruction fixture first + stale-packet regression + live smoke`
Landed: `f789ab6f`

Acceptance:

- execution-critical packet read surfaces (status open_packets, packet
  list, run inspection, snapshot action-items) derive from canonical
  projection, not file-backed packet truth
- stale-packet residue class eliminated structurally for read surfaces
- packet persistence (write path via persist*Packet) remains file-backed
  as durable artifacts; write-side migration is post-migration cleanup

### Commit 17

Type: `cutover`
Title: `refactor(migration): add replay suite, delete backfill command, and declare migration complete`
New Owner: `canonical Postgres truth architecture`
Owner Packages: `apps/hatch, packages/factory-ops, packages/github-adapter, docs/architecture`
Deleted Owner: `one-time backfill command + remaining migration-boundary exceptions`
Delete Surfaces: `one-time backfill command, checked-in migration-only allowlists, remaining exception surfaces`
Fallbacks Removed: `backfill command + migration-only residue`
Invariant Added: `deterministic replay gate + all structural gates enforced`
Proof Run: `TDD: failing replay fixture first + full replay rebuild of all projections from event 0 + live smoke on mothership and example-trading`
Landed: `b52c8f25`

Acceptance:

- TDD: failing replay fixture first
- delete the one-time backfill command and remove remaining migration-only exceptions
- replay from event `0` deterministically rebuilds: status, tick, fleet, control
  state, and packet projections
- replay suite runs in CI
- one-time backfill command deleted
- no execution-critical code reads GitHub for internal state
- no canonical events are emitted from LLM prompt surfaces
- both factories operate from the shared Postgres instance
- architecture docs updated to declare Postgres canonical truth as the permanent
  model
