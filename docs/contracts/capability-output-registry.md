---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed registry for capability event, artifact, and telemetry output surfaces."
tags: [capability, contracts, generated, outputs, registry]
written: "2026-03-21"
---

# Capability Output Registry

- Registered capabilities: 10
- Diagnostics: 0

## Capability Outputs

- `@hatch/capability-artifact-ingestion`
  - events: `0`
  - artifacts: `0`
  - telemetry expectations: `1`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
- `@hatch/capability-brainstorming`
  - events: `0`
  - artifacts: `0`
  - telemetry expectations: `1`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
- `@hatch/capability-coding`
  - events: `0`
  - artifacts: `2`
  - telemetry expectations: `2`
  - artifact `review_evidence/v1` via `platform_contract_artifact`
  - artifact `reviewer_context/v1` via `platform_contract_artifact`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
  - telemetry `hatch.review_verdict` via `otel_event`
- `@hatch/capability-foreman`
  - events: `0`
  - artifacts: `1`
  - telemetry expectations: `0`
  - artifact `foreman_cycle_artifact/v1` via `platform_contract_artifact`
- `@hatch/capability-goal-decomposition`
  - events: `0`
  - artifacts: `2`
  - telemetry expectations: `2`
  - artifact `goal_decomposition_packet/v1` via `platform_contract_artifact`
  - artifact `hard_plan_packet/v1` via `platform_contract_artifact`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
  - telemetry `hatch.fallback_defect` via `otel_event`
- `@hatch/capability-merge`
  - events: `0`
  - artifacts: `2`
  - telemetry expectations: `2`
  - artifact `merge_conflict_packet/v1` via `platform_contract_artifact`
  - artifact `merge_report/v1` via `platform_contract_artifact`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
  - telemetry `hatch.merge_resolution_failure` via `otel_event`
- `@hatch/capability-product-judge`
  - events: `0`
  - artifacts: `4`
  - telemetry expectations: `1`
  - artifact `judge_context/v1` via `platform_contract_artifact`
  - artifact `judge_evidence/v1` via `platform_contract_artifact`
  - artifact `judge_recovery_packet/v1` via `platform_contract_artifact`
  - artifact `judge_followup_bug_issue/v1` via `platform_contract_artifact`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
- `@hatch/capability-release-reporting`
  - events: `0`
  - artifacts: `1`
  - telemetry expectations: `1`
  - artifact `release_report_bundle` via `oci_artifact_class`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
- `@hatch/capability-software-development`
  - events: `0`
  - artifacts: `0`
  - telemetry expectations: `1`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`
- `@hatch/capability-wave-dispatch`
  - events: `1`
  - artifacts: `1`
  - telemetry expectations: `1`
  - event `https://recallnet.dev/contracts/cloudevents/wave-ready-lease.v1.json` via `cloudevents`
  - artifact `judge_followup_bug_issue/v1` via `platform_contract_artifact`
  - telemetry `hatch.workflow.lifecycle` via `otel_runtime`

## Diagnostics

- none
