---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Playbook for running hatch complexity estimate, wiring estimator output into DOT routing, and validating/observing complexity_class telemetry."
tags: [complexity, docs, estimator, hatch, routing]
written: "2026-03-07"
---
# Complexity Floor Estimator Convention

- Goal reference: this convention was introduced for goal **#324** so the factory can route issues by measured complexity instead of always paying full ceremony cost.
- Why this exists: deterministic complexity routing reduces unnecessary ceremony on low-risk changes while preserving strict review/telemetry on medium/high-risk work.
- Outcome: graph authors can run one estimator command, promote `complexity_class` into context, and route lanes predictably.

See also:
- [Complexity Estimator Contract](./complexity-estimator.md)
- [Complexity Floor Convention](./complexity-floor.md)
- [Hatch Validation Contract](./validation.md)

## 1) Run the estimator CLI

Hatch provides a deterministic local command:

```bash
hatch complexity estimate [--input <json|file>] [--issue-title <text>] [--issue-body <text>] \
  [--changed-files <json-array|csv>] [--estimated-lines-added <n>] [--estimated-lines-deleted <n>] \
  [--estimated-file-count <n>] [--dependency-count <n>] [--blocked-by-count <n>] [--blocks-count <n>] \
  [--qa-command <cmd>]
```

Canonical arg parsing/usage source: `apps/hatch/src/cli/complexity-estimate-args.ts` (`COMPLEXITY_ESTIMATE_USAGE`).

### Deterministic signal heuristics

Estimator logic is pure/deterministic (no network calls). Current signal families:

- `diff_size`
- `file_count`
- `sensitive_paths`
- `side_effect_keywords`
- `dependency_pressure`
- `qa_signal`

Each signal contributes a deterministic object under `signals[<signal_key>]` with fields:

- `value`
- `reason`
- `score`
- `_unknown`

Missing metadata is treated as `unknown` and biases toward `high` for safe routing.

### Example output

```json
{
  "complexity_class": "high",
  "otel_dimension_key": "hatch.complexity.class",
  "signals": {
    "diff_size": {
      "value": "unknown",
      "reason": "missing_line_estimate",
      "score": 2,
      "_unknown": true
    },
    "file_count": {
      "value": "small",
      "reason": "files=0",
      "score": 0,
      "_unknown": false
    },
    "sensitive_paths": {
      "value": "unknown",
      "reason": "missing_changed_files",
      "score": 1,
      "_unknown": true
    },
    "side_effect_keywords": {
      "value": "false",
      "reason": "no_side_effect_keywords",
      "score": 0,
      "_unknown": false
    },
    "dependency_pressure": {
      "value": "unknown",
      "reason": "missing_dependency_metadata",
      "score": 1,
      "_unknown": true
    },
    "qa_signal": {
      "value": "missing",
      "reason": "missing_qa_command",
      "score": 1,
      "_unknown": true
    }
  },
  "reason": "class=high;score=5;top=diff_size:unknown(missing_line_estimate)|dependency_pressure:unknown(missing_dependency_metadata)|qa_signal:missing(missing_qa_command)",
  "score": 5
}
```

Interpretation:
- `complexity_class` is the routing key.
- `signals` provides deterministic provenance for dashboards/review.
- `reason` is a compact dominant-signal explanation for logs/comments.

## 2) DOT wiring convention

Use an estimator tool node, preserve full payload with `output_key`, and promote routing keys via `outputs`.

```dot
estimate_complexity [
  type="tool"
  output_key="complexity_estimate"
  output_format="json"
  outputs="complexity_class,signals,reason,otel_dimension_key"
  prompt="hatch complexity estimate --input '${complexity_input_json}'"
]

complexity_gate [shape=diamond label="Complexity class route"]
complexity_gate -> fast_lane [condition="complexity_class=low"]
complexity_gate -> full_lane [condition="complexity_class!=low"]
```

Minimum contract for routing-only graphs:
- emit `complexity_class` (and commonly `complexity_reason`) via `outputs`;
- route with `complexity_class=...` conditions.

Legacy compatibility note:
- provenance validation also recognizes `complexity` as an alias key in edge conditions / estimator outputs;
- for older fast/full lanes you may still see conditions like `complexity=low` / `complexity=high`, but prefer `complexity_class` for new graphs.

Example (legacy fast/full alias form):

```dot
complexity_gate -> fast_lane [condition="complexity=low" label="fast"]
complexity_gate -> full_lane [condition="complexity=high" label="full"]
```

## 3) Real factory example (`wave_issue_execute.dot`)

From `factories/mothership/graphs/wave_issue_execute.dot`, the factory routes after `estimate_complexity`:

```dot
estimate_complexity [type="tool"
                     output_key="complexity_estimate"
                     output_format="json"
                     outputs="complexity_class,complexity_signals,complexity_reason,complexity_otel_key"
                     prompt="hatch-ops goal-issue run --op estimate-complexity ..."]

complexity_gate [shape=diamond label="Complexity class route"]

start -> ... -> estimate_complexity -> complexity_gate
complexity_gate -> route_high_complexity [condition="complexity_class=high"]
complexity_gate -> route_non_high_complexity [condition="complexity_class!=high"]
```

How `output_key` flows:
- `complexity_estimate` keeps the full estimator JSON blob for audit/debug.
- `outputs=...` promotes scalar keys into context so `complexity_gate` edge conditions can read them directly.

Note:
- Direct `hatch complexity estimate` output uses top-level keys `signals`, `reason`, and `otel_dimension_key`.
- The `goal-issue run --op estimate-complexity` ops wrapper normalizes these into `complexity_signals`, `complexity_reason`, and `complexity_otel_key` for downstream factory telemetry/routing compatibility.

## 4) Validation warning when provenance is missing

Validator contract source: `apps/hatch/src/pipeline/validate.ts`.

When an edge condition references complexity routing keys but no upstream estimator emits the key, `hatch validate` emits warning rule:

- `complexity_estimator_provenance`

This catches DOT graphs that branch on complexity without an estimator producer path.

## 5) Telemetry contract (`stage.finish` + OTEL)

Telemetry sources:
- `apps/hatch/src/pipeline/events.ts`
- `apps/hatch/src/complexity/telemetry.ts`
- `apps/hatch/src/pipeline/telemetry/langfuse.ts`

On estimator-driven execution, `stage.finish` data includes:
- `complexity_class`
- `complexity_signals`
- `complexity_reason`
- `complexity_otel_key`

OTEL/class dimension is populated as:
- `hatch.complexity.class=<low|medium|high|unknown>`

This lets dashboards correlate selected edge paths with estimator signals and reason text.

## 6) Guidance for factory owners

1. Add an estimator node before any complexity-based branch.
2. Store full output in `output_key` for post-run debugging.
3. Promote at least `complexity_class` (plus signals/reason recommended) with `outputs`.
4. Route lanes with deterministic edge conditions (`complexity_class=...`).
5. Run `hatch validate` and `node scripts/lint-dot.mjs` before merge.
6. Add dashboard grouping by `hatch.complexity.class` and inspect `complexity_signals` for drift.
7. Ship convention changes on a shared `wave/<issue>` branch and complete one builder/reviewer loop so CLI, validator, telemetry, tests, and docs land together.

If estimator payload keys or warning rule IDs change, update this doc in the same PR to prevent stale operator guidance.
