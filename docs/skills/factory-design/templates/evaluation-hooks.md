---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Copy-pastable evaluation hooks for supervisor, dispatch, review, and judge instrumentation."
tags: [docs, evaluation, factory-design, metrics, templates]
written: "2026-03-07"
---
# Evaluation hooks template

Derived from:
- `factories/mothership/graphs/factory_supervisor_tick.dot`
- `factories/mothership/graphs/wave_execute.dot`
- `factories/mothership/graphs/issue_execute_item.dot`
- `hatch-ops` (or `npx hatch-ops`)

Use these hooks without adding runtime code first.

## 1) Core command hooks (copy/paste)

```bash
# Supervisor health signal (outer loop)
hatch-ops supervisor run --op health-check \
  --repo '{{target_repo}}' \
  --run-id '${__run_id}' \
  --pipeline '{{entry_graph}}'

# Ready-goal inventory
hatch-ops goal run --op list-ready \
  --repo '{{target_repo}}'

# Capacity signal for dispatch decisions
hatch-ops wave run --op enumerate-slots \
  --max-concurrent '{{capacity_limits.max_concurrent_waves}}' \
  --ready-count '{{metrics.ready_goal_count}}' \
  --in-flight-count '{{metrics.in_flight_waves}}'
```

Reference these commands directly in DOT tool nodes (with comments back to source graphs/CLI commands).

## 2) Required metrics to capture per run and per node

Capture and persist at least:
- `retry_count` (per work item and per role loop)
- `review_cycle_count`
- `judge_pass` / `judge_fail`
- `judge_context_gate_code` (watch for `judge_context_scenarios_missing`)
- `model_id` / `llm_provider` per LLM node
- `role_version` and `prompt_version`
- outcome counters (`merged_count`, `closed_issue_count`, `infra_bug_count`)

Recommended envelope:

```json
{
  "run_id": "${__run_id}",
  "node_id": "{{node.id}}",
  "role": "{{role.name}}",
  "retry_count": 0,
  "review_cycle_count": 0,
  "judge_pass": false,
  "judge_context_gate_code": "ok",
  "model_id": "{{model.id}}",
  "llm_provider": "{{model.provider}}",
  "role_version": "{{role.version}}",
  "prompt_version": "{{prompt.version}}",
  "timestamp": "{{timestamp.iso8601}}"
}
```

## 3) Judge context scenarios (required)

To avoid `judge_context_scenarios_missing`, define scenario context before judge execution.

### Minimum scenario file

Create a judge context artifact (example path: `{{judge.scenario_registry_root}}/judge_context/{{factory.id}}.json`):

```json
{
  "schema_version": "judge_context/v1",
  "factory": "{{factory.id}}",
  "judge_kind": "{{judge.kind}}",
  "scenarios": [
    {
      "id": "success_path",
      "description": "Expected pass state when acceptance criteria + evidence are complete.",
      "expected_judge_pass": true,
      "required_evidence_keys": ["review_evidence_path", "review_context_path", "merge_status"]
    },
    {
      "id": "failure_path",
      "description": "Expected fail state when evidence/context are missing or contradictory.",
      "expected_judge_pass": false,
      "required_evidence_keys": ["judge_context_gate_code", "review_reason_codes"]
    }
  ]
}
```

Then validate in flow using:

```bash
hatch-ops judge run --op build-context-contract ...
hatch-ops judge run --op validate-context-contract ...
```

If `judge_context_gate_code` reports `judge_context_scenarios_missing`, treat that as a hard config defect and route to infra bug handling.

## 4) Retry/review cycle wiring

- Initialize `review_attempt=0` with deterministic tool op.
- Increment via `goal-issue run --op next-review-attempt`.
- Gate with a fixed `{{retry.max_review_cycles}}`.
- Emit `review_cycle_count` on each loop edge.

## 5) Model usage attribution by node

For each LLM node, record:
- node id
- role name
- `llm_model`
- `llm_provider`
- optional `reasoning_effort`

Never infer model usage only at run-level; collect it per node to support drift analysis and review.
