---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Canonical Hatch contract for graph transition selection, convergence, retries, terminals, and pipeline composition."
tags: [contracts, docs, hatch, pipeline, reference]
written: "2026-03-18"
---
# Hatch Transition/Convergence Contract

This is the canonical, human-readable contract for how Hatch decides **where execution goes next**, **how parallel paths converge**, and **how retries/terminal outcomes behave**.

Use this document as the authoritative semantic reference for routing behavior. Use [`docs/state-machines.md`](./state-machines.md) and [`docs/factory-supervisor-tick.md`](./factory-supervisor-tick.md) for lifecycle topology and operator flow.

## Scope and ownership

Runtime ownership for transition/convergence behavior is concentrated in:

- `apps/hatch/src/pipeline/engine.ts` (execution loop, edge selection, terminal handling)
- `apps/hatch/src/pipeline/engine-execution.ts` (attempt/retry loop per node)
- `apps/hatch/src/pipeline/graph.ts` (graph/node/edge accessors and handler typing)
- `apps/hatch/src/pipeline/condition.ts` (edge-condition parsing/evaluation)
- `apps/hatch/src/pipeline/fast-route.ts` (path/fast-route telemetry derivation)
- `apps/hatch/src/pipeline/handler/pipeline.ts` (child pipeline composition)
- `apps/hatch/src/pipeline/handler/fan_out_dynamic.ts` (blocking fan-out/fan-in semantics)
- `apps/hatch/src/pipeline/handler/fan_out_detached.ts` (detached fan-out semantics)
- `apps/hatch/src/pipeline/handler/composite-contract.ts` (child failure normalization contract)
- `apps/hatch/src/pipeline/checkpoint.ts` and `apps/hatch/src/pipeline/run.ts` (checkpoint + run-state persistence/recovery)
- `apps/hatch/src/pipeline/decision-artifacts.ts` (decision-output artifact contract)

## Determinism classes and disposal ownership

Hatch follows the platform invariant: **LLM nodes propose, deterministic nodes dispose**.

- **Deterministic nodes (`D`)**: tool/conditional/composition/routing handlers produce deterministic side effects and route decisions.
- **Stochastic nodes (`S`)**: `codergen`, `stack.manager_loop`, `agent.worktree`, `agent.kw` produce candidate outputs.
- **Gate behavior (`G`)**: gate semantics are implemented deterministically via edge conditions and selection in `Engine.selectNextEdge()`.

Handler registration and handler-type ownership is declared in `apps/hatch/src/pipeline/handler/register.ts`.

## Transition primitives

### 1) Node output vs route decision

A node completion can produce:

- **Output artifacts/context** (`output`, `output_key`, `outputs`) for downstream dataflow.
- **Route hints** (`preferredLabel`, `suggestedNextNodes`) used only by edge selection.

Decision outputs can also be materialized as decision artifacts through `decision-artifacts.ts`; these are durable records and are separate from edge-routing mechanics.

### 2) Canonical edge selection order

`Engine.selectNextEdge()` applies this deterministic precedence:

1. Filter by edge `condition` (from `condition.ts`).
2. If provided, apply `outcome.preferredLabel` against edge labels.
3. If provided, apply `outcome.suggestedNextNodes` against target nodes.
4. Highest edge `weight` wins.
5. Lexical tiebreak on target node id.

If no edges match after condition filtering/fallback, execution fails closed (`no matching edges`).

### 3) Fast-route telemetry is additive, not alternate routing logic

`fast-route.ts` derives telemetry fields like `path_taken`/`fast_route.*` from selected edge metadata. It does not replace core edge selection.

## Fan-out / fan-in convergence semantics

### Blocking fan-out (`fan_out.dynamic`) + fan-in (`fan_in.dynamic`)

`apps/hatch/src/pipeline/handler/fan_out_dynamic.ts` defines the canonical blocking fan-out contract:

- Parent context is snapshotted once (immutable snapshot) and copied to each child.
- Each child runs a pipeline with per-item context (`item_key`, `__fan_out_index`).
- Child exports remain isolated until aggregation.
- Aggregated exports are indexed as `${key}__${index}` and validated for canonical ordering (index, then key lexical).
- If any child fails, parent fan-out fails and publishes normalized failure keys (`__composite_reason`, child ids, export writeback status).

`fan_in.dynamic` itself is a pass-through handler; convergence gating is graph-owned. The join node fires when traversal reaches it on the selected successful edge path.

### Detached fan-out (`fan_out.detached`)

`apps/hatch/src/pipeline/handler/fan_out_detached.ts` spawns child `hatch run` processes and returns immediately with spawn metadata.

- Parent does **not** wait for child completion.
- Child lifecycle/recovery is owned by run-state + recovery sweep (`run.ts`, ops recovery flows).
- Use this for dispatch/spawn semantics, not blocking merge-style convergence.

### Composite failure normalization

`handler/composite-contract.ts` normalizes child failures to:

- `child_failed`
- `child_timeout`
- `child_aborted`

These reason codes are the cross-handler contract for composition/fan-out failure routing.

## Retry semantics

### Node-level bounded retries

`engine-execution.ts` executes each node with bounded attempts:

- Effective attempts come from node `max_retries` (`graph.ts::nodeMaxRetries`), with default single attempt when unset.
- Every attempt emits stage records; retries emit `stage.retry` telemetry.
- Exhaustion throws deterministic `after N attempts` failure.

### Fail-open conversion and fail-closed defaults

In `engine.ts`, thrown execution errors are converted to failed outcomes only when node attr `fail_open=true`; otherwise the pipeline fails.

Composite and irreversible paths are fail-closed by default when no explicit failure route exists:

- `pipeline`, `fan_out.dynamic`, `fan_out.detached`
- `tool` nodes marked `governance="irreversible"`

### Guard-controlled retry/re-entry throttling

`guard.ts`/`guard-core.ts` enforce guard counters and circuit states for retry-heavy paths (including review re-entry transitions), with deterministic open/terminal behavior.

### Checkpoint + run-state persistence

- `checkpoint.ts`: explicit checkpoint save/load for resume flows.
- `run.ts`: durable `state.json` + `metadata.json`, stale-run detection/recovery (`recoverStaleRuns`) and child-run tracking.

## Terminal handling and composition

### Terminal node class

`exit` handler type is terminal. In `engine.ts`, reaching an exit node marks run `completed` and emits `pipeline.finish`.

### Terminal status normalization for child pipelines

`pipeline.ts` maps child failures into normalized composite failure context updates and propagates them to parent routing decisions.

### Parent/child context and exports

`pipeline` handler contract (`pipeline.ts`):

- `inherit_context=true` clones parent context into child.
- `export_keys` controls which child keys write back on success.
- Export writeback is explicitly marked as `applied` or `skipped` via composite context keys.

## Annotated graph examples

## Example A: Goal decomposition contract (`goal_run.dot`)

Graph: `packages/capability-goal-decomposition/graphs/goal_run.dot` (the shared `goal_run` contract used by mothership supervisor flows).

Transition/convergence highlights:

- Admission routing convergence: `resolve_execution_path -> resolve_hard_goal_state -> admission_check -> admission_gate`.
- Execution-mode split:
  - `goal_execution_path=easy` routes to direct pipeline execution (`execute_easy_goal`) and converges through `direct_execution_result_gate`.
  - `goal_execution_path=medium` routes through bounded decomposition retry gate (`decompose_retry_gate`) and converges through `mark_dispatched|keep_open|exhaust_decompose_retries`.
  - `goal_execution_path=hard` routes through planning/materialization branches and converges at durable completion edges.
- Retry semantics are explicit in graph structure (`check_decompose_retries -> decompose_retry_gate`) plus node-level retry attempts.

Handler classes used in this topology include `tool`, `pipeline`, and `conditional`/diamond gates with deterministic edge conditions.

## Example B: Wave execution contract (`wave_execute.dot`)

Graph: `factories/mothership/graphs/wave_execute.dot`.

Transition/convergence highlights:

- Main issue loop: `next_issue -> issue_loop_gate`, then either
  - `execute_issue_in_wave -> accumulate -> postmortem_gate -> next_issue` (loop), or
  - `split_results` (fan-in point for loop completion).
- Merge conflict recovery path demonstrates deterministic convergence after stochastic repair attempts:
  - deterministic path (`rebase_shared_branch -> merge_shared_branch`) and LLM repair path (`resolve_conflict` / `resolve_post_merge`) both rejoin merge/push gates.
- Terminal convergence is explicit: close/no-merge/fail paths all converge through `release_merge_lock -> assert_main_after_merge -> final_review_gate` before `done`.

This graph combines deterministic tool nodes, stochastic resolver/judge nodes, and deterministic disposal gates.

## Contract test map

| Semantic area | Current contract tests | What is pinned |
|---|---|---|
| Edge selection precedence | `apps/hatch/src/pipeline/engine-transition-convergence.contract.test.ts` | 5-step precedence, no-match failure behavior |
| Fast-route branch visibility | `apps/hatch/src/pipeline/engine-fast-route-telemetry.test.ts`, `apps/hatch/src/pipeline/supervisor-fast-route-contract.test.ts` | `bug_fast_gate` branch routing and telemetry invariants |
| Fan-out/fan-in ordering and child failure normalization | `apps/hatch/src/pipeline/engine-transition-convergence.contract.test.ts` | Indexed export ordering, fan-in skip on failure, normalized child reasons |
| Topology-level convergence ownership | `apps/hatch/src/pipeline/supervisor-wave-topology-contract.test.ts` | Required/forbidden nodes/edges, convergence chain ownership in supervisor |
| Retry exhaustion behavior | `apps/hatch/src/pipeline/engine-transition-convergence.contract.test.ts` | Bounded retries, attempt metadata, retry events |
| Recovery invariants and terminal sinks | `apps/hatch/src/pipeline/graph-recovery-invariants.test.ts` | Dead-end detection, runaway loop detection, explicit terminal/recovery ownership |
| Guard/circuit throttling | `apps/hatch/src/pipeline/guard.test.ts` | Open/terminal transitions, deterministic backoff, reset ownership |

Known follow-up gap areas (not addressed in this issue): richer explicit join-node diagnostics and additional detached fan-out convergence visibility contracts.

---

When this document and an implementation differ, treat tests + runtime code as source of truth and open a contract-doc follow-up immediately.
