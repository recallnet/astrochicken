# @hatch/capability-goal-decomposition

Goal decomposition capability graphs and prompts.

## Graph overview

- `graphs/goal_queue.dot` — selects ready goals and fans out `goal_run`.
- `graphs/goal_run.dot` — per-goal routing + admission + execution path handling.
- `graphs/goal_hard_plan.dot` — hard-path planning-first branch (planning-only hold).
- `graphs/goal_intake_decompose.dot` — intake/decomposition LLM flow.
- `graphs/write_issues.dot` / `graphs/write_issue_item.dot` — issue materialization.

## `goal_run.dot` routing contract (hard-path planning hold)

`goal_run.dot` resolves durable execution-path metadata first, then performs admission checks.

Routing behavior:

- `easy` → direct execution (`goal_execute.dot`)
- `medium` → decomposition + issue creation + triage
- `hard`:
  - if `planning_state != approved`, route to `goal_hard_plan.dot`
  - if `planning_state = approved`, route through `materialize_hard_plan -> approved_hard_plan_resume -> encode_goal_issue_b64` so approved hard-plan artifacts are persisted as a standard `goal_decomposition_packet`, the `awaiting-human` hold label is cleared, and triage/execution continues without re-planning

## `goal_hard_plan.dot` contract

`goal_hard_plan.dot` is planning-only. It does **not** generate executable issues.

It performs, in order:

1. run deep intake/decomposition planning
2. persist a durable `hard_plan_packet` artifact (`hatch-ops goal persist-hard-plan-artifact`)
3. validate artifact deterministically (`hatch-ops goal validate-planning-artifact`)
4. attach planning artifact linkage comment to goal issue (`hatch-ops goal attach-planning-artifacts`)
5. remove `ready` + add human hold label + transition execution packet to `planning_state=pending_review` with artifact path (`hatch-ops goal mark-planned`)

## Resume semantics

- `planning_state=pending_review` means planning is complete and waiting for human review.
- While pending review and `ready` is absent, admission denies execution (`pending_review_requires_ready`).
- When reviewer re-applies `ready`, admission allows approved-plan resume and `goal_run` materializes the approved hard-plan artifact into deterministic child issues before continuing triage/execution.

## Factory-request prerequisite goal-graph contract

For `goal_request_type=factory_request`, the hard-plan artifact must include `factory_request_goal_graph` and it is validated fail-closed by `hatch-ops goal validate-planning-artifact`.

Validation rejects:

- missing `factory_request_goal_graph`
- goal edges that reference unknown goals
- self-edges (`goal_a -> goal_a`)
- cyclic graphs
- invalid final-goal shape (including final-goal outgoing edges)

`hatch-ops goal attach-planning-artifacts` renders a **Prerequisite goal graph** section in the planning comment with:

- topological goal order
- explicit final-goal callout
- prerequisite/dependent edges (`blockedBy` direction: prerequisite → dependent)

This guarantees operators can review prerequisite ordering before re-applying `ready`.

## Status visibility

Execution metadata now includes:

- `decomposition_state`
- `planning_state` (`pending_review` / `approved` supported)
- optional `planning_artifact_path`
- `planning_review_required=true` when `planning_state=pending_review`

These fields flow into factory status/tick/dashboard output and presenter rendering.
