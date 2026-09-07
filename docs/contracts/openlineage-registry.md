---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed OpenLineage-compatible run and artifact projection registry for downstream lineage and governance consumers."
tags: [contracts, governance, lineage, openlineage, registry]
written: "2026-03-21"
---

# OpenLineage Registry

- Governance mode: `downstream_only`
- Supported run classes: 2
- Supported artifact classes: 1
- Diagnostics: 0

## Run Classes

- `hatch_run_lifecycle`
  - cloud event surface: `https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json`
  - source: `packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts`
  - producers: `1`
- `release_rollout`
  - cloud event surface: `https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json`
  - source: `packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts`
  - producers: `1`

## Artifact Classes

- `release_report_bundle`
  - source: `packages/factory-ops/src/lib/oci-artifact-taxonomy.ts`
  - publishers: `1`

## Diagnostics

- none

