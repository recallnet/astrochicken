---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Canonical OpenTelemetry taxonomy and governed emitter inventory for Phase 2.1."
tags: [contracts, observability, opentelemetry, telemetry]
written: "2026-03-20"
---
# OTel Taxonomy

- Required correlation attributes: `factory_id`, `run_id`, `workflow_id`, `capability_id`, `owner`
- Allowed custom attribute keys: 53
- Governed emitter files: 8
- Governed emitter calls: 27
- Direct bypass files: 0

## Naming Rules

- Event names: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$`
- Span names: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$`
- Metric names: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$`
- Attribute keys: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`

## Governed Emitter Inventory

- `apps/hatch/src/pipeline/instrumentation-helpers.ts:108` -> `hatch.workflow.start` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:129` -> `hatch.workflow.finish` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:150` -> `hatch.workflow.error` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:171` -> `hatch.workflow.warning` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:192` -> `hatch.workflow.context_update` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:213` -> `hatch.workflow.quality_signal` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:234` -> `hatch.workflow.parallel_fan_out` (5 attributes)
- `apps/hatch/src/pipeline/instrumentation-helpers.ts:255` -> `hatch.workflow.parallel_fan_in` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:98` -> `hatch.reactor.guard_decision` (6 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:125` -> `hatch.reactor.guard_transition` (6 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:152` -> `hatch.reactor.guard_reset` (6 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:196` -> `hatch.reactor.run_start` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:226` -> `hatch.reactor.complete` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:256` -> `hatch.reactor.fail` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:286` -> `hatch.reactor.node_change` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:316` -> `hatch.reactor.merge` (5 attributes)
- `apps/hatch/src/pipeline/reactor-instrumentation.ts:346` -> `hatch.reactor.artifact` (5 attributes)
- `packages/factory-ops/src/commands/goal-fallback-defect.ts:236` -> `hatch.fallback_defect` (7 attributes)
- `packages/factory-ops/src/commands/supervisor-detect-orphan-features.ts:291` -> `factory.supervisor.fix_orphan_features` (5 attributes)
- `packages/factory-ops/src/commands/supervisor-managed-emit-run-summary.ts:18` -> `factory.managed_supervisor.run_summary` (8 attributes)
- `packages/factory-ops/src/commands/wave-judge-fallback.ts:23` -> `wave.judge.fail_forward` (2 attributes)
- `packages/factory-ops/src/commands/wave-judge-fallback.ts:48` -> `wave.judge.fallback` (2 attributes)
- `packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts:98` -> `factory.supervisor.incident_dedup` (9 attributes)
- `packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts:166` -> `factory.supervisor.telemetry` (6 attributes)
- `packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts:729` -> `factory.supervisor.bug` (13 attributes)
- `packages/factory-ops/src/lib/managed-factory-lifecycle-telemetry.ts:256` -> `factory.lifecycle.tick` (11 attributes)
- `packages/factory-ops/src/lib/managed-factory-lifecycle-telemetry.ts:283` -> `factory.lifecycle.sleep` (11 attributes)

## Diagnostics

- none
