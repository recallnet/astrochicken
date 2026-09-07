---
doc_type: "reference"
owner: "hatch-observability"
review_policy: "periodic-7"
reviewed: "2026-03-24"
status: "active"
summary: "Langfuse KPI query pack for Hatch quality, retry, model-utilization, and cost metadata."
tags: [kpi, langfuse, quality, telemetry]
written: "2026-03-07"
---
# Langfuse KPI Queries

This pack documents the deterministic metadata emitted by Hatch telemetry and query snippets operators can run in Langfuse dashboards/queries.

## UI-first dashboard contract

Langfuse's built-in dashboard UI currently exposes coarse breakdown dimensions such as `Name` and `Tags` before arbitrary metadata fields. Hatch now emits both surfaces deterministically for LLM-oriented traces:

- `Name`
  - generation traces: `llm.generation:<skill>`
  - session traces: `llm.session:<skill>`
  - non-LLM pipeline traces remain `pipeline.graph:<graph-id>`
- `Tags`
  - stable `key:value` strings derived from telemetry identity, including:
    - `factory:<factory>`
    - `factory_id:<factory_id>`
    - `graph:<graph_id>`
    - `node:<node_id>`
    - `handler:<handler_type>`
    - `skill:<skill>`
    - `role:<agent_role>`
    - `model:<model>`
    - `provider:<provider>`
    - `outcome:<outcome>`
    - `retry:<true|false>`
    - `retry_class:<first_pass|retry_pass|first_fail|retry_fail|retry_scheduled>`
    - `failure_class:<failure_class>`
    - `llm_path_id:<llm_path_id>`

Use `Tags` for dashboard grouping when you need role/model/outcome slices without dropping to the Metrics API.

## Emitted metadata keys

These keys are emitted directly on Langfuse span metadata (and also mirrored under `hatch.event_data.*`):

- Quality signals:
  - `langfuse_quality_score`
  - `langfuse_quality_grade`
  - `langfuse_failure_class`
  - `langfuse_skill`
- Cost totals:
  - `langfuse_cost_input`
  - `langfuse_cost_output`
  - `langfuse_cost_total`
- Benchmark identity (semantic comparison contract):
  - `job_id` / `hatch.job_id`
  - `skill_id` / `hatch.skill_id`
  - `prompt_hash` / `hatch.prompt_hash`
  - `prompt_version` / `hatch.prompt_version`
  - `role_version` / `hatch.role_version`
  - plus baseline dimensions: `factory_id`, `graph_id`, `node_id`, `handler_type`, `model`, `provider`
- Retry/pass metadata:
  - `hatch.retry_class` (`first_pass|retry_pass|first_fail|retry_fail|retry_scheduled`)
  - `hatch.first_attempt_pass` (`true|false`)
- KPI grouping tags:
  - `handler`
  - `skill`
  - `hatch.abstraction_level`
  - `hatch.phase`
  - `hatch.phase_node_id`
  - `hatch.work_unit`
  - `hatch.work_unit.goal`
  - `hatch.work_unit.wave`
  - `hatch.work_unit.issue`
  - `hatch.work_unit.hypothesis`
  - `hatch.kpi.cost.skill`
  - `hatch.kpi.cost.handler`
  - `hatch.kpi.cost.work_unit`
- Duration / lineage:
  - `duration_ms` / `hatch.duration_ms`
  - `phase_node_id` / `hatch.phase_node_id`
  - `parent_run_id` / `hatch.parent_run_id`
  - `parent_graph_id` / `hatch.parent_graph_id`
- Transport health:
  - `transport_event`
  - `transport_status`
  - `dropped_count`
  - `queue_size`
  - `max_queue_size`
  - `emit_attempt`
  - `batch_size`
  - `retry_backoff_ms`
  - `failed_batches`

Work-unit metadata (`goal_id`, `issue_id`, `wave_id`, and `hatch.work_unit.*`) is supplemental filter context only. Use semantic benchmark identity (`hatch.job_id`, `hatch.prompt_version`, `hatch.role_version`, `hatch.skill_id`) as the primary comparison key.

## Session → Trace → Span hierarchy

Hatch now enriches EventBus lifecycle events so every attempt can be grouped reliably in Langfuse:

- `session_id` / `hatch.session_id`
  - deterministic per run + handler + node + attempt
- `langfuse_trace_id` / `hatch.trace_id`
  - stable hash trace (`resolveLangfuseTraceId(runId, handlerType, sessionKey)`) reused across that attempt’s lifecycle events
- `span_name`
  - `pipeline.graph:<graph-id>:<node-id>:<event-kind>`

`hatch.phase` is now a semantic phase taxonomy intended for dashboard grouping
and comparison. `hatch.phase_node_id` preserves the raw pipeline node id for
drill-down and debugging.

Event families with explicit mapping:

- Stage lifecycle: `stage.start`, `stage.finish`, `stage.error`, `stage.retry`, `stage.skip`
- Routing: `edge.selected`
- Parallel phases: `parallel.fan_out`, `parallel.fan_in`
- Guard/gates: `guard.decision`, `guard.transition`, `guard.reset`
- Quality: `quality.signal`

Guard + quality spans carry deterministic gate evidence fields:

- `gate_name`
- `gate_outcome`
- `gate_evidence_ref`

## Configuration knobs (transport + resilience)

Required runtime env vars:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- optional `LANGFUSE_BASE_URL` (default cloud URL)

Hatch controls:

- `HATCH_LANGFUSE_ENABLED`
- `HATCH_LANGFUSE_CAPTURE_PROMPTS`
- `HATCH_LANGFUSE_FLUSH_INTERVAL_MS`
- `HATCH_LANGFUSE_BATCH_SIZE`
- `HATCH_LANGFUSE_MAX_QUEUE_SIZE`
- `HATCH_LANGFUSE_EMIT_RETRY_ATTEMPTS`
- `HATCH_LANGFUSE_EMIT_RETRY_BACKOFF_MS`

Behavior contract:

- queue overflow drops newest telemetry (non-fatal, never breaks pipeline execution)
- transport failures are retried and then logged as warnings if exhausted
- shutdown performs a final flush for long-running sessions (for example `agent.worktree`)

## Factory-specific metadata hook

Universal engine metadata stays factory-agnostic (`run_id`, `graph`, `node_id`, `handler_type`, `attempt`, `outcome`, etc.).

Factory-specific keys (for example Intents `goal_id`, `issue_id`, `wave_id`) are merged via telemetry metadata providers and appear as:

- `factory.<key>`
- `hatch.factory_meta.<key>`

## Query recipes

> Use your normal time/project filters first. Snippets below show filter/group logic.

### 1) Cost per skill invocation

**Filter**
- `hatch.event_kind in ("telemetry.langfuse.generation", "telemetry.langfuse.session")`
- `hatch.kpi.cost.skill != ""`

**Group by**
- `hatch.kpi.cost.skill`

**Metrics**
- `count()` as invocations
- `sum(langfuse_cost_total)` as total_cost
- `sum(langfuse_cost_input)` as input_cost
- `sum(langfuse_cost_output)` as output_cost
- `avg(langfuse_cost_total)` as avg_cost_per_invocation

### 2) Cost per work unit (goal/issue/hypothesis)

**Filter**
- `hatch.event_kind in ("telemetry.langfuse.generation", "telemetry.langfuse.session")`
- `hatch.kpi.cost.work_unit != ""`

**Group by**
- `hatch.kpi.cost.work_unit`
- optional: `hatch.work_unit.goal`, `hatch.work_unit.issue`

**Metrics**
- `sum(langfuse_cost_total)`
- `sum(langfuse_tokens_total)`
- `count()`

### 3) First-attempt pass rate by skill

**Filter**
- `hatch.event_kind = "quality.signal"`
- `langfuse_skill != ""`

**Group by**
- `langfuse_skill`

**Metrics**
- `count_if(hatch.first_attempt_pass = "true")` as first_attempt_passes
- `count()` as total_attempts
- `first_attempt_passes / total_attempts` as first_attempt_pass_rate

### 4) Retry rate by failure class

**Filter**
- `hatch.event_kind = "quality.signal"`
- `hatch.retry_class in ("retry_fail", "retry_pass")`

**Group by**
- `langfuse_failure_class`
- `langfuse_skill`

**Metrics**
- `count()` as retry_attempts
- `count_if(hatch.retry_class = "retry_fail")` as failed_retries
- `count_if(hatch.retry_class = "retry_pass")` as recovered_retries

### 5) Model utilization breakdown

**Filter**
- `hatch.event_kind in ("telemetry.langfuse.generation", "quality.signal")`
- `langfuse_model != "" OR hatch.event_data.model != ""`

**Group by**
- `langfuse_provider`
- `langfuse_model`
- optional: `skill`

**Metrics**
- `count()`
- `sum(langfuse_tokens_total)`
- `sum(langfuse_cost_total)`

### 6) Duration per job invocation

Each completed/retried/failed stage span now carries explicit `duration_ms` / `hatch.duration_ms`. Prefer that field over native span duration because Hatch exports point-in-time Langfuse spans rather than long-lived open/close spans.

Langfuse filter: `metadata.hatch.job_id = <job_id>` and `metadata.hatch.duration_ms != ""`, metric: `avg(hatch.duration_ms)` or `p95(hatch.duration_ms)`, group by: `hatch.job_id`.

### 7) Performance by abstraction level

**Filter**
- `hatch.duration_ms != ""`

**Group by**
- `hatch.abstraction_level`
- optional: `hatch.phase`, `hatch.graph_id`, `hatch.phase_node_id`

**Metrics**
- `count()`
- `avg(hatch.duration_ms)`
- `p95(hatch.duration_ms)`
- `sum(langfuse_cost_total)`

### 8) Telemetry transport health

**Filter**
- `hatch.event_kind = "telemetry.langfuse.transport"`

**Group by**
- `transport_event`
- `transport_status`

**Metrics**
- `count()`
- `max(dropped_count)`
- `max(failed_batches)`

## Benchmark identity comparison recipes

These recipes use shipped runtime fields for cross-factory and cross-version comparison of the same logical job.

### A) Same job across factories/models

**Filter**
- `hatch.event_kind in ("stage.finish", "quality.signal")`
- `hatch.job_id = "wave.execute.issue.lifecycle"`
- `hatch.job_id != ""`

**Group by**
- `hatch.factory_id`
- `hatch.model`
- `hatch.provider`

**Metrics**
- `count()`
- `avg(langfuse_quality_score)`
- `sum(langfuse_cost_total)`

### B) Prompt-version comparison within one semantic job

**Filter**
- `hatch.event_kind = "quality.signal"`
- `hatch.job_id = "wave.execute.issue.lifecycle"`
- `hatch.prompt_version != ""`

**Group by**
- `hatch.prompt_version`
- `hatch.role_version`

**Metrics**
- `count()`
- `avg(langfuse_quality_score)`
- `count_if(gate_outcome = "fail")`

### C) Model comparison inside same job + prompt contract

**Filter**
- `hatch.event_kind in ("stage.finish", "quality.signal")`
- `hatch.job_id = "wave.execute.issue.lifecycle"`
- `hatch.prompt_version = "2026-03-09.r1"`
- `hatch.role_version = "1.4.0"`
- optional context filters: `factory.goal_id`, `factory.issue_id`, `factory.wave_id`

**Group by**
- `hatch.model`
- `hatch.provider`

**Metrics**
- `count()`
- `avg(langfuse_quality_score)`
- `sum(langfuse_tokens_total)`
- `sum(langfuse_cost_total)`

## External factory inheritance

External factories now inherit benchmark identity enforcement through the `benchmark_telemetry` conformance phase in the factory harness. The phase parses factory `.dot` graphs, inspects LLM-class nodes (`coder`, `reviewer`, `supervisor`, `judge`, `knowledge_worker`, `scenario_author`, `release_narrator`), and requires benchmark annotation fields (`benchmark_job_id`, `prompt_version`, `role_version`, `skill_id`).

For pre-existing factories during migration:
- `conformance.benchmark_telemetry_warn_only=true` downgrades violations to warnings.
- `conformance.benchmark_telemetry_exemptions=["<node_id>"]` skips specific legacy nodes.

The scaffold template (`factories/_templates/factory/graphs/factory_supervisor_tick.dot.template`) now includes benchmark annotation stubs so newly scaffolded factories start with the contract shape by default.

## Provider coverage notes

Cost extraction is normalized from assistant usage payloads across:

- Anthropic-style keys (`input`, `output`, `totalTokens`, `usage.cost.*`)
- OpenAI-style keys (`prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`)
- Gemini-style keys (`usageMetadata.promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`)

If explicit total cost is missing, Hatch computes `langfuse_cost_total = cost_input + cost_output + cache_costs`.

## Source of truth

- `apps/hatch/src/pipeline/quality.ts`
- `apps/hatch/src/pipeline/langfuse-telemetry.ts`
- `apps/hatch/src/pipeline/telemetry/langfuse.ts`
- `apps/hatch/src/pipeline/langfuse-telemetry.test.ts`
