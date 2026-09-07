---
doc_type: "architecture"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-26"
status: "active"
summary: "Decouple the supervisor from the tick cycle, give it persistent state via Postgres, and let it proactively investigate and repair the factory."
tags: [architecture, supervisor, factory-health, observability, postgres]
written: "2026-03-26"
---

# Architecture: Supervisor Elevation

Start here: [Documentation Index](../INDEX.md)

Prerequisite: [Postgres Canonical Truth Migration](postgres-canonical-truth-migration.md)
must be complete before this work begins. The supervisor elevation depends on
queryable canonical event history in the shared Postgres instance.

## Problem (Observed 2026-03-18, Still True)

The factory supervisor runs as a tick-bound LLM node inside
`factory_supervisor_tick.dot`. Three structural problems:

1. **The supervisor cannot investigate.** It only sees pre-classified action
   items with pre-computed remediation packets. If the deterministic sweep
   didn't classify a problem, the supervisor never sees it. A subprocess hung
   for 79 minutes — invisible because no action item was generated.

2. **The supervisor prompts are over-specified.** SKILL.md duplicates logic
   already in `determineOwnershipDecision()` and remediation packets. The LLM
   spends budget parsing taxonomy rules instead of reasoning about live state.
   3 consecutive ticks burned 10 min each executing stale conflict packets for
   an already-merged branch.

3. **No independent observer exists.** Nothing watches the factory between ticks
   or survives daemon crashes. When the circuit breaker paused the factory, it
   took 65 minutes for a human to notice.

## Solution

The previous version of this document proposed a two-phase approach: streamline
the supervisor prompts (Phase A), then create a separate "foreman" capability as
a new pi agent session (Phase B). That design was over-engineered.

The simpler answer: **decouple the supervisor from the tick cycle and let it run
continuously as a persistent pi session.** The supervisor is already the factory
controller — it just needs to stop being imprisoned inside a 30-second graph
node that only fires once per tick.

With Postgres canonical truth landed, the supervisor can query factory state
directly instead of depending on pre-classified action items. It doesn't need
pre-digested probes, structured anomaly verdicts, or a separate foreman role. It
needs tools and permission to look.

## Design Principles

1. **The supervisor is the top-of-factory controller.** It owns factory
   awareness, judgment, investigation, and repair. No separate foreman role.

2. **The supervisor must survive the observed.** It runs independently of the
   daemon as a persistent pi session. If the daemon crashes, the supervisor
   detects it. If a human closes the TUI, the supervisor continues.

3. **Give it tools, not rules.** The supervisor prompt describes available tools
   and investigation methodology. The LLM already knows how to reason — the
   prompt gets out of the way. No action-item taxonomies, no ownership mapping
   tables, no pre-classified remediation packets.

4. **Postgres is the supervisor's memory.** The canonical event log gives the
   supervisor queryable history: what happened, when, in what order. It doesn't
   need pre-computed state snapshots — it queries the projections directly.

5. **The human is optional, not required.** The supervisor operates autonomously.
   A human can attach a TUI at any time to observe, steer, or chat. Closing the
   TUI is safe; the supervisor continues.

6. **Measure everything.** The supervisor emits structured events into the
   canonical Postgres store. Investigation outcomes, repair actions, and costs
   are queryable alongside all other factory events.

7. **Autonomous repair is native, but policy-gated.** The supervisor may write
   code and repair the system directly. It must obey the standard worktree, QA,
   merge, and verification discipline as any other coding path.

## What Changes

### The supervisor stops being a graph node

Today the supervisor is a `class="supervisor"` LLM node inside
`factory_supervisor_tick.dot`. It fires once per tick, receives a pre-computed
state snapshot, processes action items, and exits.

After this change, the supervisor is a persistent pi session that:

- Runs continuously outside the daemon tick cycle
- Queries Postgres projections directly for factory state
- Investigates anomalies proactively, not just when an action item is generated
- Accepts human interaction at any time via pi TUI attach/detach
- Survives daemon crashes

The tick graph loses its supervisor LLM nodes. Deterministic dispatch (goal
selection, wave admission, merge routing) stays in the graph. The judgment calls
move to the persistent supervisor session.

### The supervisor prompt collapses

The current supervisor surface is ~200 lines across SKILL.md, review.md,
bug_fast.md, and supervisor_rules.md. Most of it duplicates logic already in
code or restates the action-item taxonomy.

The new prompt is approximately:

```
You are the factory supervisor. You run continuously and own factory health,
goal progress, anomaly investigation, and targeted repair.

Your state is in Postgres. Query it:
- factory_status_projection for current goals, issues, waves
- factory_tick_projection for recent tick history
- factory_events for raw event history
- factory_fleet_projection for cross-factory view

Your tools:
- hatch-ops factory status/tick-status/subscribe
- gh (issues, PRs, labels, comments)
- git, bash, standard CLI
- SQL queries against the canonical event store

When something is wrong, investigate and fix it. When everything is nominal,
say so briefly. When a human attaches, talk to them.

Skills are listed below. Use load_skill to read the full procedure before
following any skill.

{SKILL_INDEX}
```

That's it. No ownership mapping tables, no action-item taxonomy, no threshold
rules. The LLM reads factory state and decides what to do.

### Pre-classified action items become optional inputs

The deterministic sweep that produces action items (stale bugs, orphan features,
merge conflicts) still runs. But instead of being the supervisor's only input,
action items become one signal among many. The supervisor can also:

- Query tick history for failures the sweep didn't classify
- Check for stuck processes by querying event timestamps
- Detect circuit breaker state from the control-state projection
- Notice goal stalls by comparing goal events against wall clock
- Read daily lens reports for trend analysis

### Skills stay, infrastructure goes

The useful parts of the foreman doc were the skills — `investigate`,
`goal-writer`, `factory-advisor`, `factory-bootstrap`. These become supervisor
skills, shipped in `packages/capability-foreman/skills/` (package may be renamed
to `capability-supervisor` or merged into existing supervisor surface).

The infrastructure that goes away:

- Probe health command with structured anomaly verdicts (the supervisor queries
  Postgres directly)
- Host scheduling layer with probe coalescing (the supervisor runs continuously)
- Incident ledger (incidents are canonical events in Postgres)
- Telemetry extension with custom artifact writers (the supervisor emits
  canonical events like everything else)
- Three-layer architecture diagram (it's just a pi session with tools)

### Cross-factory monitoring is a Postgres query

All factories write to the same shared Postgres instance. Cross-factory
monitoring is:

```sql
SELECT factory_id, event_family, count(*)
FROM factory_events
WHERE occurred_at > now() - interval '24 hours'
GROUP BY factory_id, event_family
ORDER BY factory_id, count(*) DESC;
```

No custom telemetry collection system. No per-factory artifact writers. No
cross-factory aggregation service.

## Review Gate

Every migration commit must carry this header in its commit body:

```text
Type: <proof|cutover>
New Owner: <single owner or none>
Deleted Owner: <single deleted owner or none>
Invariant Added: <gate or rule>
Proof Run: <tests/fixtures/live smoke>
```

Same commit types as the Postgres migration: `proof` adds contracts/tests
without transferring ownership; `cutover` transfers ownership AND deletes the
old path in the same commit. No grace periods, no compatibility shims.

## Commit Ledger

> **Tracking:** Each commit section has a `Landed` field:
>
> - `pending` — not started
> - `dispatched` — work assigned, waiting for commit
> - `<short-hash>` (e.g., `a1b2c3d`) — commit landed
>
> Update the field as each transition occurs. This is the single source of
> migration progress.

### Commit 01

Type: `proof`
Title: `feat(supervisor): add supervisor skills directory and skill index`
New Owner: `supervisor skills directory`
Deleted Owner: `none`
Invariant Added: `skill index loaded into system prompt template`
Proof Run: `skill files exist with trigger conditions + docs check`
Landed: `pending`

Acceptance:

- Skill files exist: investigate, goal-writer, factory-advisor, factory-bootstrap
- SKILL_INDEX.md loaded into system prompt template
- Existing supervisor behavior unchanged

### Commit 02

Type: `cutover`
Title: `refactor(supervisor): replace tick-bound supervisor nodes with persistent pi session`
New Owner: `persistent pi supervisor session`
Deleted Owner: `supervisor LLM nodes in factory_supervisor_tick.dot`
Invariant Added: `tick graph contains no supervisor LLM nodes`
Proof Run: `deterministic dispatch tests + live smoke on mothership`
Landed: `pending`

Acceptance:

- Supervisor runs as a persistent pi session outside the tick cycle
- Tick graph no longer contains supervisor LLM nodes
- Deterministic dispatch still works (goal selection, wave admission, merge)
- Process wrapper keeps the supervisor alive on crash
- Human can attach/detach via pi TUI
- Live smoke on mothership

### Commit 03

Type: `cutover`
Title: `refactor(supervisor): replace pre-computed state snapshots with direct Postgres queries`
New Owner: `Postgres projections as supervisor state source`
Deleted Owner: `pre-computed state snapshots as sole supervisor input`
Invariant Added: `supervisor reads projections directly, not pre-digested snapshots`
Proof Run: `supervisor queries projection tables + detects anomalies outside sweep`
Landed: `pending`

Acceptance:

- Supervisor prompt references Postgres projections as primary state source
- Pre-computed state snapshots no longer required for supervisor operation
- Action items still available as one input among many
- Supervisor can detect anomalies not covered by the deterministic sweep

### Commit 04

Type: `cutover`
Title: `refactor(supervisor): collapse supervisor prompts to minimal tool-oriented surface`
New Owner: `minimal supervisor prompt (<50 lines)`
Deleted Owner: `SKILL.md ownership tables + review.md taxonomy + bug_fast.md routing rules`
Invariant Added: `supervisor prompt contains no ownership mapping tables or action-item taxonomy`
Proof Run: `prompt contract tests + LLM role session baseline regenerated`
Landed: `pending`

Acceptance:

- Supervisor prompt is under 50 lines (excluding skill index)
- No ownership mapping tables in prompts
- No action-item taxonomy in prompts
- Prompt contract tests updated
- LLM role session baseline regenerated

### Commit 05

Type: `cutover`
Title: `refactor(supervisor): delete legacy tick-bound supervisor infrastructure`
New Owner: `persistent supervisor with Postgres queries`
Deleted Owner: `pre-computed state snapshot generation + action-item-only dispatch gate + remediation packet pre-processing`
Invariant Added: `no code generates pre-computed state snapshots for supervisor consumption`
Proof Run: `live smoke on mothership and example-trading`
Landed: `pending`

Acceptance:

- Supervisor operates from Postgres queries and tools only
- No pre-computed state snapshot generation for supervisor
- Deterministic dispatch in the tick graph is unaffected
- Live smoke on mothership and example-trading

### Commit 06

Type: `cutover`
Title: `feat(supervisor): cross-factory rollout and QA gate enforcement`
New Owner: `persistent supervisor as required factory component`
Deleted Owner: `factory configs without supervisor session configuration`
Invariant Added: `QA gate enforces supervisor presence in all factory configs`
Proof Run: `live smoke on all factories + cross-factory Postgres queries`
Landed: `pending`

Acceptance:

- All factory configs include supervisor session configuration
- Process wrapper template exists for new factories
- QA gates enforce supervisor presence
- Cross-factory queries work against the shared Postgres instance
- Live smoke on all factories

## What Stays the Same

- **Deterministic dispatch stays in the tick graph.** Goal selection, wave
  admission, issue readiness checks, merge routing — all deterministic logic
  remains in `factory_supervisor_tick.dot` and its subgraphs. The supervisor
  elevation only removes the LLM judgment nodes.

- **The tick cycle still runs.** The daemon still ticks. Deterministic work
  still happens on a schedule. The supervisor just stops being imprisoned
  inside it.

- **Action items still exist.** The deterministic sweep still classifies bugs,
  orphans, and merge conflicts. The supervisor can still read them. They just
  stop being the only thing the supervisor sees.

- **Standard coding discipline.** The supervisor repairs code using the same
  worktree → test → commit → merge flow as any coding agent. No special
  privileges.

## What the Foreman Doc Got Right

The previous version of this document (the foreman design) correctly identified:

- The supervisor needs to run independently of the tick cycle
- The supervisor needs to survive daemon crashes
- A human should be able to attach/detach at any time
- Skills should be loaded on demand, not baked into the prompt
- Autonomous repair should use the standard coding flow
- Cross-factory monitoring should use a shared telemetry format

It over-engineered the solution by creating a separate role (foreman) with
dedicated infrastructure (probes, host scheduler, incident ledger, telemetry
extension) instead of simply elevating the existing supervisor.

## Migration Path

No backward compatibility needed (v0 policy). The persistent supervisor replaces
the tick-bound supervisor atomically. The Postgres migration must land first
(all 10 commits in `postgres-canonical-truth-migration.md`). Then:

1. Commits 01-02: Skills + persistent session. Other factories unaffected.
2. Commits 03-04: Postgres queries + prompt collapse. Mothership first.
3. Commits 05-06: Legacy cleanup + cross-factory rollout.
