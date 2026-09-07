---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed AsyncAPI registry for asynchronous event capability surfaces."
tags: [asyncapi, contracts, events]
written: "2026-03-21"
---
# AsyncAPI Registry

- Registered surfaces: 3
- Diagnostics: 0

## Registered Surfaces

- `docs/contracts/hatch-run-lifecycle.asyncapi.v1.json`
  - source: `packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts`
  - version: `hatch_run_lifecycle_asyncapi/v1`
  - channels: `1`
  - producers: `apps/hatch/src/pipeline/run-lifecycle.ts`
  - consumers: `packages/factory-ops/src/commands/factory-subscribe.ts`
- `docs/contracts/release-rollout-events.asyncapi.v1.json`
  - source: `packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts`
  - version: `release_rollout_events_asyncapi/v1`
  - channels: `1`
  - producers: `packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts`
  - consumers: `packages/factory-ops/src/commands/release-rollout-controller-state.ts`
- `docs/contracts/wave-ready-lease.asyncapi.v1.json`
  - source: `packages/factory-ops/src/lib/wave-ready-lease-cloudevents.ts`
  - version: `wave_ready_lease_asyncapi/v1`
  - channels: `1`
  - producers: `packages/factory-ops/src/lib/wave-ready-claim-ops.ts`, `packages/factory-ops/src/lib/wave-ready-lease.ts`
  - consumers: `packages/factory-ops/src/commands/wave-claim.ts`, `packages/factory-ops/src/lib/wave-ready-lease.ts`

## Diagnostics

- none

