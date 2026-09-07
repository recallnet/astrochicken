---
doc_type: "architecture"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Canonical contract for shared software-development execution ownership and supervisor-local boundaries."
tags: [architecture, capability, docs, mothership, software-development]
written: "2026-03-14"
---
# Architecture: Software-Development Capability Contract

Start here: [Documentation Index](../INDEX.md)

This document is the canonical contract for shared `software_development` execution behavior.
It defines what is shared across factories vs. what remains mothership-supervisor local.

## Canonical contract sources (shipped)

The shared software-delivery model is currently composed from shipped capability contracts (`software_development` contract by composition):

- `packages/capability-goal-decomposition/capability-contract.v1.json`
- `packages/capability-coding/capability-contract.v1.json`
- `packages/capability-merge/capability-contract.v1.json`
- `packages/capability-release-reporting/capability-contract.v1.json`

Canonical contract path for the consolidated capability:

- `packages/capability-software-development/capability-contract.v1.json`

Execution role/session assumptions are sourced from:

- `factories/mothership/inventory/llm-role-session-baseline.json`

The consolidated capability contract is now checked in and versioned alongside the composed capability contracts above. Factories should treat those contract files as the canonical reusable capability surface.

## Graph entrypoints and ownership boundary

| Surface | Canonical graph(s) | Ownership |
|---|---|---|
| Goal intake + decomposition | `@hatch/capability-goal-decomposition/graphs/goal_run.dot` | Shared capability |
| Per-issue build/review contract | `@hatch/capability-coding/graphs/issue_execute_item.dot` | Shared capability |
| Merge/conflict resolution contract | `@hatch/capability-merge/graphs/merge_item.dot` | Shared capability |
| Release/reporting | `@hatch/capability-release-reporting/graphs/release_report_flow.dot` | Shared capability |
| Mothership supervisor orchestration adapters | `factories/mothership/graphs/factory_supervisor_tick.dot`, `factories/mothership/graphs/goal_execute.dot`, `factories/mothership/graphs/goal_issue_execute.dot` | Factory-local policy + scheduling |

The supervisor remains the deterministic owner of tick cadence, bug-fast routing, lifecycle gates, and detached run spawning. Shared capability graphs own the reusable software-delivery contracts.

## Required context keys (shared contract)

From the shipped capability contracts, shared execution requires (union set):

- Core identity/routing: `gh_repo`, `factory_id`, `trust_domain`, `trust_role`
- Goal decomposition inputs: `goal_issue`, `intent_stack`, `goal_context`, `issue_number`, `approved_features`, `review_notes`, `scenarios_root`
- Coding execution inputs: `repo`, `branch`, `issue_number`, `issue_title`, `goal_issue_number`, `goal_issue`, `review_qa_command`, `integration_command`, `capability_coding_skills`
- Merge execution inputs: `merge_item`, `repo`, `branch`, `issue_number`, `control_plane_repo`, `capability_merge_skills`

Mothership-local adapters additionally provide goal-branch/session wiring (for example `worktree_dir`, `agent_session_id`, `reviewer_session_id`) before invoking issue/merge contract steps.

## Understanding-debt contract

High-understanding-risk work now rides the normal goal issue flow instead of a separate post-hoc approval gate.

- Canonical owner: the goal execution-path packet persisted by `hatch-ops goal execution-path classify|resolve`.
- Durable metadata:
  - `understanding_risk`
  - `rationale_required`
- Current conservative default:
  - `hard` execution-path goals imply `understanding_risk=high`
  - `rationale_required=true`
  - explicit classifier signals may also mark `easy` or `medium` goals as rationale-required without changing their execution path

When `rationale_required=true`, decomposition/materialization appends one final synthetic feature with `work_item_kind=rationale_doc`. That feature is handled like any other goal issue:

- builder writes the rationale doc
- reviewer reviews it through the normal issue flow
- no special goal-finalization choke point is introduced

The standardized artifact path is:

- `docs/rationale/YYYY-MM-DD-<goal-slug>.md`

Required sections:

- `What Changed`
- `Why Now`
- `Subsystem Map`
- `Assumptions`
- `Known Unknowns`
- `What Future Humans Need To Know`
- `Verification`
- `Follow-ups`

Docs linting owns the structural floor:

- rationale docs must use exactly one frontmatter tag: `rationale`
- required sections must be present and non-trivial
- filler phrases such as `TBD`/`misc` are rejected
- at least one concrete file or symbol reference is required

This is intentionally light-touch: the quality bar is enforced through the same build/review path as other goal issues, with docs lint only checking structure and obvious partial-doc smell.

## Exported keys, artifacts, and handoff points

| Stage | Primary exports/artifacts | Downstream handoff |
|---|---|---|
| Decomposition (`goal_run`) | `goal_issue`, `goal_context`, `approved_features`, `issue_urls`, `triage_plan`, `triage_results`, `scenario_paths`, decomposition packet artifacts | Execution adapter (`goal_execute`) + operator reporting |
| Issue execution contract | `impl_result`, review evidence/context artifacts | Goal-level split/merge handling |
| Goal-level split/merge | `merge_candidates`, `review_failures`, `merged_results`, `merge_failures`, judge contract artifacts | Close/follow-up + release reporting |
| Release reporting | `release_report_context`, `release_narrative`, `release_slack_payload`, `release_slack_delivery` | Tick-idle cursor + operator channels |

Canonical handoff sequence:

1. Decomposition creates executable sub-issues and scenario context.
2. Goal execution runs issue build/review loops and accumulates `impl_result` packets.
3. Split stage routes review failures deterministically and passes merge candidates into merge/judge contracts.
4. Merge/judge outcomes drive close/follow-up actions.
5. Release reporting narrates shipped outcomes and advances dedup/idle cursors.

## Role/session assumptions (baseline contract)

Source of truth: `factories/mothership/inventory/llm-role-session-baseline.json`.

| Graph path | Node | Class | Handler | Session assumption |
|---|---|---|---|---|
| `factories/mothership/graphs/goal_issue_execute.dot` | `build` | `coder` | `agent.worktree` | `${agent_session_id}` |
| `factories/mothership/graphs/goal_issue_execute.dot` | `review` | `reviewer` | `codergen` | `${reviewer_session_id}` |
| `factories/mothership/graphs/goal_execute.dot` | `resolve_conflict` | `merge_resolver` | `stack.manager_loop` | none |
| `factories/mothership/graphs/goal_execute.dot` | `resolve_post_merge` | `merge_resolver` | `stack.manager_loop` | none |
| `factories/mothership/graphs/goal_execute.dot` | `resolve_push_failure` | `merge_resolver` | `stack.manager_loop` | none |
| `factories/mothership/graphs/goal_execute.dot` | `judge` | `post_merge_judge` | `codergen` | none |

## Explicit non-goals (supervisor-local policy)

The shared `software_development` capability contract does **not** own:

- Bug-fast-route triage and tick-halting logic
- Factory host lifecycle/daemon cadence
- External-factory lifecycle rejection handling (`rejected_upstream` control flow)
- Detached run spawning policy and tick-idle gating
- Factory-specific config choices (for example, max concurrent goals per tick)

Those remain in mothership supervisor graphs and `hatch-ops factory/supervisor` policy commands.

## Related docs

- [Architecture: Astrochicken Multi-Factory Runtime](./factory-internals.md)
- [Hatch/Mothership State Machines](../state-machines.md)
- [Factory Supervisor Tick Reference](../factory-supervisor-tick.md)
