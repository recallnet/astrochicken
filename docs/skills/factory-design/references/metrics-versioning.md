---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Canonical telemetry keys and role/prompt/model versioning contract for factory graphs."
tags: [docs, factory-design, reference, skill, skills, telemetry, versioning]
written: "2026-03-07"
---
# Factory Metrics and Versioning Reference

Use this reference as the single source of truth for telemetry keys and version labels across factory graphs, role contracts, and ops aggregation.

## Required Metrics

| Metric | Capture scope | Required output keys | Sample value |
|---|---|---|---|
| Retries per node attempt | Per node attempt (`build`, `review`, `merge`, etc.) | `retry_count` | `2` |
| Review cycle count | Per work item across reviewer loop | `review_cycle_count` | `3` |
| Failure rates by category | Per failed node attempt and aggregated per role | `failure_category` | `"review_reject"` |
| Judge pass/fail outcome | Judge nodes (or `not_applicable` elsewhere) | `judge_result` | `"pass"` |
| Model choice per node/role | Every LLM-driven node output | `model_id` | `"openai/gpt-5.3-codex"` |
| Role/prompt version labels | Every LLM-driven node output | `role_version`, `prompt_version` | `"2.3.0"`, `"2026-03-07.r1"` |

## Telemetry Contract (Sample Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "FactoryNodeTelemetryEnvelope",
  "type": "object",
  "required": [
    "run_id",
    "graph_id",
    "node_id",
    "node_type",
    "role",
    "attempt",
    "output",
    "metadata"
  ],
  "properties": {
    "run_id": { "type": "string" },
    "graph_id": { "type": "string" },
    "node_id": { "type": "string" },
    "node_type": { "type": "string" },
    "role": { "type": "string" },
    "attempt": { "type": "integer", "minimum": 1 },
    "output": {
      "type": "object",
      "required": [
        "status",
        "retry_count",
        "review_cycle_count",
        "model_id",
        "role_version",
        "prompt_version"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": ["success", "failure", "skipped"]
        },
        "retry_count": { "type": "integer", "minimum": 0 },
        "review_cycle_count": { "type": "integer", "minimum": 0 },
        "failure_category": {
          "type": "string",
          "description": "Optional; required when status='failure'."
        },
        "judge_result": {
          "type": "string",
          "enum": ["pass", "fail", "not_applicable"],
          "description": "Optional for non-judge nodes."
        },
        "model_id": { "type": "string" },
        "role_version": {
          "type": "string",
          "description": "Semantic tag, for example 2.3.0"
        },
        "prompt_version": {
          "type": "string",
          "description": "Prompt release tag, for example 2026-03-07.r1"
        }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["captured_at", "telemetry_version"],
      "properties": {
        "captured_at": { "type": "string", "format": "date-time" },
        "telemetry_version": { "type": "string" },
        "latency_ms": { "type": "integer", "minimum": 0 },
        "token_input": { "type": "integer", "minimum": 0 },
        "token_output": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

**Required output keys (all LLM-driven nodes):** `retry_count`, `review_cycle_count`, `model_id`, `role_version`, `prompt_version`.

**Optional output keys (conditional):** `failure_category` (required on failure), `judge_result` (required on judge nodes; use `not_applicable` otherwise).

## Versioning Contract for Roles, Prompts, and Models

Use one or more of these storage options (pick a default and document it in your runbook):

1. **Config keys** (`factory.config.json`): centralized version map and model overrides.
2. **Role definition front matter** (`skills/<role>/SKILL.md`): closest to prompt source.
3. **Dedicated `versions.yaml` or state file**: version history owned by infra/ops.

Example role definition front matter:

```markdown
---
role_id: coder
model_id: openai/gpt-5.3-codex
role_version: 2.3.0
prompt_version: 2026-03-07.r1
---
```

Example downstream node output carrying version and model metadata:

```json
{
  "node_id": "build_item",
  "role": "coder",
  "output": {
    "status": "success",
    "retry_count": 1,
    "review_cycle_count": 2,
    "judge_result": "not_applicable",
    "model_id": "openai/gpt-5.3-codex",
    "role_version": "2.3.0",
    "prompt_version": "2026-03-07.r1"
  }
}
```

## Data Flow Through Graph Nodes

1. **Dispatcher/intake nodes** seed run-level defaults (`model_id`, `role_version`, `prompt_version`, counters at `0`) into context.
2. **Builder/reviewer nodes** increment `retry_count` and `review_cycle_count` deterministically and forward version/model fields unchanged unless an explicit override occurs.
3. **Reviewer note nodes** emit `failure_category` on revise/fail outcomes so downstream aggregation can compute failure-rate slices by role and node.
4. **Judge nodes** emit `judge_result` (`pass`/`fail`) and still carry `model_id`, `role_version`, and `prompt_version` so evaluation outcomes are attributable to exact prompt/model revisions.
5. **Terminal/merge nodes** persist the final telemetry envelope (or batch of envelopes) without dropping the version keys; aggregation should never infer versions from node IDs.

## Implementation Notes for Factory Authors

- Keep names canonical: use exactly `role_version` and `prompt_version` (no aliases like `role_ver` or `prompt_rev`).
- Treat `role_version` as a semantic tag (`MAJOR.MINOR.PATCH`) and bump:
  - **MAJOR** for contract-breaking output/prompt changes,
  - **MINOR** for behavior changes that keep contract shape,
  - **PATCH** for clarifications/non-behavioral edits.
- Bump `prompt_version` on every prompt text change, even if role contract is unchanged.
- Document per-node model overrides next to the node definition and in config/state so telemetry comparisons are reproducible.
- If a node does not run a judge, emit `judge_result: "not_applicable"` instead of omitting the key in downstream aggregates.
