---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed OCI artifact taxonomy and publication ownership registry."
tags: [artifacts, contracts, oci, oras]
written: "2026-03-21"
---
# OCI Artifact Taxonomy

- Registered classes: 7
- Diagnostics: 0

## Registered Classes

- `contract_spec_bundle`
  - media type: `application/vnd.recallnet.factory.contract-spec.bundle.v1`
  - metadata schema: `docs/contracts/contract-spec-artifact-metadata.v1.schema.json`
  - lifecycle policy: `365d / review_delete / shared_policy_engine`
  - trust policy: `cosign / in_toto_dsse / slsa_provenance/v1`
  - governed publishers: none
- `judge_evidence_bundle`
  - media type: `application/vnd.recallnet.factory.judge-evidence.bundle.v1`
  - metadata schema: `docs/contracts/judge-evidence-artifact-metadata.v1.schema.json`
  - lifecycle policy: `180d / review_delete / shared_policy_engine`
  - trust policy: `cosign / in_toto_dsse / slsa_provenance/v1`
  - governed publishers: none
- `release_bundle`
  - media type: `application/vnd.recallnet.factory.release.bundle.v1`
  - metadata schema: `docs/contracts/release-bundle-artifact-metadata.v1.schema.json`
  - lifecycle policy: `365d / review_delete / shared_policy_engine`
  - trust policy: `cosign / in_toto_dsse / slsa_provenance/v1`
  - governed publishers: none
- `release_report_bundle`
  - media type: `application/vnd.recallnet.factory.release-report.bundle.v1`
  - metadata schema: `docs/contracts/release-report-artifact-metadata.v1.schema.json`
  - lifecycle policy: `365d / review_delete / shared_policy_engine`
  - trust policy: `cosign / in_toto_dsse / slsa_provenance/v1`
  - governed publishers: `packages/factory-ops/src/commands/release-emit-narrative-document.ts`
- `run_snapshot_bundle`
  - media type: `application/vnd.recallnet.factory.run-snapshot.bundle.v1`
  - metadata schema: `docs/contracts/run-snapshot-artifact-metadata.v1.schema.json`
  - lifecycle policy: `30d / review_delete / shared_policy_engine`
  - trust policy: `optional`
  - governed publishers: none
- `telemetry_summary_bundle`
  - media type: `application/vnd.recallnet.factory.telemetry-summary.bundle.v1`
  - metadata schema: `docs/contracts/telemetry-summary-artifact-metadata.v1.schema.json`
  - lifecycle policy: `90d / review_delete / shared_policy_engine`
  - trust policy: `optional`
  - governed publishers: none
- `workflow_ir_bundle`
  - media type: `application/vnd.recallnet.factory.workflow-ir.bundle.v1`
  - metadata schema: `docs/contracts/workflow-ir-artifact-metadata.v1.schema.json`
  - lifecycle policy: `30d / review_delete / shared_policy_engine`
  - trust policy: `cosign / in_toto_dsse / slsa_provenance/v1`
  - governed publishers: none

## Diagnostics

- none

