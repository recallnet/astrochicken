---
doc_type: "architecture"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-26"
status: "active"
summary: "Current Astrochicken architecture for Hatch multi-factory orchestration and operations."
tags: [architecture, docs, hatch, mothership, multi-factory]
written: "2026-02-20"
---
# Architecture: Astrochicken Multi-Factory Runtime

Start here: [Documentation Index](../INDEX.md)

This document describes the **current shipped architecture** for Hatch + Mothership. It is intentionally aligned to live graphs, live state paths, and live ops commands.

For node-by-node flow details, see:
- [Factory Supervisor Tick Reference](../factory-supervisor-tick.md)
- [Hatch/Mothership State Machines](../state-machines.md)
- [Architecture: Software-Development Capability Contract](./software-development-capability.md)
- [Architecture: Supervisor Streamline + Foreman Observer](./supervisor-streamline-and-foreman.md)

## System Model

Astrochicken is a control plane that builds and operates managed factories.

- **Control plane factory**: `factories/mothership/`
- **Runtime engine**: `apps/hatch/` DOT execution engine + handlers
- **Deterministic operations layer**: `hatch-ops` CLI (`packages/factory-ops/`)
- **Factory outcomes/state of record**: GitHub issues, milestones, labels, comments, and PRs

Semantic work (planning, review, triage) is done by LLM nodes. Deterministic tooling owns transport, contracts, retries, safety rails, and durable state transitions.

Managed-factory bundles follow the config-only pattern: `factory.config.json` points at shared runtime graphs (for example `managed_supervisor.dot` and `managed_software_delivery_domain.dot`), while factory-local files carry identity/env manifests and optional repo-specific skills.

## Factory Graph Topology (Mothership)

Primary orchestration graphs in `factories/mothership/graphs/`:

| Graph | Role |
|---|---|
| `factory_supervisor_tick.dot` | Top-level tick: config, recovery, goals, dispatch, wave execution, supervisor review |
| `goal_queue.dot` | Goal queue orchestration and fan-out preparation |
| `goal_run.dot` | Per-goal flow: intake/decompose → issue creation → triage → close-condition computation |
| `wave_dispatch.dot` | Dispatch selection and Wave Ready marker management |
| `wave_execute.dot` | Execute one ready wave: claim, issue loop, split/merge/review handling |
| `wave_issue_execute.dot` | Per-issue wave execution with build + review loop |

## Execution Cadence

Factories run as periodic ticks via:

```bash
scripts/factory-daemon.sh <factory_id>
```

Each daemon owns one factory instance and repeatedly executes its supervisor graph (`hatch run ... --live`) with recovery and host lifecycle controls between ticks.

## State and Persistence

### Durable state (authoritative)

Authoritative workflow state lives in GitHub:

- Goals/features/bugs: issues + labels + relationships
- Wave planning: milestones + Wave Ready markers
- Review and merge outcomes: PRs, comments, merge commits

### Runtime state (engine/ops)

Per-run state lives under:

```text
.hatch/<factory_id>/runs/<run-id>/
```

Key files:

- `metadata.json` — heartbeat/liveness/recovery metadata
- `state.json` — context map, current node, completed nodes, child run links, guard state

Managed-factory operator control state is persisted separately at:

```text
.hatch/factories/<factory_id>/control-state.json
```

## Ops Surface (`hatch-ops`)

Core operator/runtime commands:

| Purpose | Command |
|---|---|
| Snapshot active/recent runs | `hatch-ops factory status [--json]` |
| Inspect current tick stage | `hatch-ops factory tick-status` |
| Wait for the next meaningful event | `hatch-ops factory subscribe [--target next-goal-progress|next-issue|next-review|next-merge|next-release-report] [--timeout <sec>]` |
| Review shipped outcomes | `hatch-ops factory outcomes --repo <owner/repo> --lookback-hours <n> [--json]` |
| Wave result fan-in helper | `hatch-ops wave split-results ...` |
| Review-failure handling helper | `hatch-ops wave handle-review-failures ...` |
| Goal milestone comment builder | `hatch-ops goal build-milestone-comment ...` |

For canonical command sequencing and examples, use [Factory Supervisor Tick Reference](../factory-supervisor-tick.md).

## Handler Composition

Hatch composes these handler classes to execute factory graphs:

- `tool` (deterministic shell/CLI steps)
- `pipeline` (child graph composition)
- `fan_out.dynamic` / `fan_in.dynamic` (parallel decomposition/aggregation)
- `stack.manager_loop` (supervisor-style semantic review sessions)
- `agent.worktree` (coding sessions in isolated worktrees)
- `codergen` (single-turn generation)

Implementation references live in `apps/hatch/src/pipeline/handler/` and are cataloged in [Factory Supervisor Tick Reference](../factory-supervisor-tick.md).

## Monitoring and Recovery Contract

Operator workflow is expectation-driven and uses first-party CLI commands (status/tick-status/subscribe/outcomes), not ad-hoc polling scripts.

Recovery is deterministic and rerunnable:

- stale run detection + recovery sweep
- bounded review retry/quarantine handling
- supervisor action-item triage and replay
- idempotent graph re-entry from durable GitHub state

See:
- [Factory Supervisor Tick Reference](../factory-supervisor-tick.md)
- [Hatch/Mothership State Machines](../state-machines.md)
- [Host Lifecycle for Same-Machine Multi-Factory Runtime](../host-lifecycle.md)

## Design Invariants

1. **Single owner per transition**: each state transition has one deterministic owner node/command.
2. **Prompt-first semantic correction**: semantic defects are fixed via role/context/prompt contracts before adding wrappers.
3. **Deterministic guardrails**: retries, routing, and safety gates are explicit and testable.
4. **Crash-safe reruns**: pipelines must recover by rerunning from durable state, not manual state edits.
5. **Outcome over activity**: progress is measured by shipped merges/closed issues, not node churn.
