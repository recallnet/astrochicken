---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Deterministic complexity estimator contract: signal heuristics, CLI output, DOT propagation, validation provenance, and telemetry dimensions."
tags: [complexity, docs, estimator, hatch, routing]
written: "2026-03-07"
---
# Complexity Estimator Contract

Hatch complexity estimation is deterministic and heuristic-only (no network calls, no LLM inference). The contract is designed so pipelines can branch safely on `complexity_class` while preserving telemetry provenance.

See also:
- [Complexity Floor Convention](./complexity-floor.md)
- [Complexity Floor Estimator Convention](./complexity-floor-estimator.md)
- [Hatch Validation Contract](./validation.md)

## 1) CLI contract (`hatch complexity estimate`)

```bash
hatch complexity estimate [--input <json|file>] [--issue-title <text>] [--issue-body <text>] \
  [--changed-files <json-array|csv>] [--estimated-lines-added <n>] [--estimated-lines-deleted <n>] \
  [--estimated-file-count <n>] [--dependency-count <n>] [--blocked-by-count <n>] [--blocks-count <n>] \
  [--qa-command <cmd>]
```

Output is strict JSON and always includes exactly:
- `complexity_class` (`low|medium|high`)
- `signals` (deterministic signal map where each `signals.<signal>` object includes `value`, `reason`, `score`, `_reason`, `_score`, `_unknown`)
- `reason` (`class=...;score=...;top=...`)
- `score` (aggregate deterministic score)
- `otel_dimension_key` (currently `hatch.complexity.class`)

Unknown/ambiguous signal inputs fail closed to `high`.

## 2) Deterministic signal families

The estimator scores these families from issue metadata:

- `diff_size` (line-change magnitude)
- `file_count` (files touched)
- `sensitive_paths` (auth/security/infra/lockfiles, etc.)
- `side_effect_keywords` (deploy/migration/production/external API, etc.)
- `qa_signal` (explicit QA/test command)
- `dependency_pressure` (dependency + blocked-by + blocks pressure)

If any signal is `unknown`, routing escalates to `high`.
If multiple high-risk signals conflict (for example `sensitive_paths=true` and `side_effect_keywords=true`), routing escalates to `high` even when aggregate score would otherwise be `medium`.

## 3) DOT propagation: estimator -> output_key -> edge condition

Use a tool node to preserve the full estimator JSON via `output_key` and promote scalar routing keys via `outputs`.

```dot
estimate_complexity [
  type="tool"
  output_key="complexity_estimate"
  output_format="json"
  outputs="complexity_class,signals,reason,otel_dimension_key"
  prompt="hatch complexity estimate --input '${complexity_input_json}'"
]

complexity_gate [shape=diamond label="Complexity route"]
complexity_gate -> fast_lane [condition="complexity_class=low" label="fast"]
complexity_gate -> full_lane [condition="complexity_class!=low" label="full"]
```

Notes:
- Canonical key is `complexity_class` for new graphs.
- Legacy alias `complexity` is still recognized by validator provenance checks.

Legacy-compatible alias example (when an existing graph still routes on `complexity`):

```dot
estimate_complexity_legacy [
  type="tool"
  output_key="complexity_estimate"
  output_format="json"
  outputs="complexity_class"
  prompt="hatch complexity estimate --input '${complexity_input_json}'"
]

set_complexity_alias [
  type="tool"
  output_key="complexity"
  prompt="printf '${complexity_class}'"
]

estimate_complexity_legacy -> set_complexity_alias -> complexity_gate
complexity_gate -> fast_lane [condition="complexity=low" label="fast"]
complexity_gate -> full_lane [condition="complexity!=low" label="full"]
```

## 4) Validation provenance warning

Hatch warns when a graph branches on complexity without an upstream estimator node that emits the routing key:

- Rule: `complexity_estimator_provenance`
- Surface: `hatch validate`

This protects against dangling `condition="complexity_class=..."`/`condition="complexity=..."` edges that have no deterministic producer.

## 5) Telemetry contract

Estimator payloads are expected to propagate these fields into `stage.finish` event data:

- `complexity_class`
- `complexity_signals`
- `complexity_reason`
- `complexity_otel_key`
- dimension: `hatch.complexity.class=<low|medium|high|unknown>` (using `complexity_otel_key`)

This enables deterministic dashboards/queries for route distribution and signal drift analysis.
