---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed CloudEvents registry for domain and reactor event surfaces."
tags: [cloudevents, contracts, events]
written: "2026-03-21"
---
# CloudEvents Registry

- Registered surfaces: 3
- Diagnostics: 0

## Registered Surfaces

- `docs/contracts/hatch-run-lifecycle.asyncapi.v1.json`
  - source: `packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts`
  - payload schema version: `hatch_run_lifecycle_event/v1`
  - producers: `apps/hatch/src/pipeline/run-lifecycle.ts`
  - consumers: `packages/factory-ops/src/commands/factory-subscribe.ts`
- `docs/contracts/release-rollout-events.asyncapi.v1.json`
  - source: `packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts`
  - payload schema version: `release_rollout_event/v1`
  - producers: `packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts`
  - consumers: `packages/factory-ops/src/commands/release-rollout-controller-state.ts`
- `docs/contracts/wave-ready-lease.asyncapi.v1.json`
  - source: `packages/factory-ops/src/lib/wave-ready-lease-cloudevents.ts`
  - payload schema version: `wave_ready_lease_event/v1`
  - producers: `packages/factory-ops/src/lib/wave-ready-claim-ops.ts`, `packages/factory-ops/src/lib/wave-ready-lease.ts`
  - consumers: `packages/factory-ops/src/commands/wave-claim.ts`, `packages/factory-ops/src/lib/wave-ready-lease.ts`

## Diagnostics

- none

