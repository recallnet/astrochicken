---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Governed artifact trust registry and verification boundary ownership map."
tags: [artifacts, cosign, provenance, trust]
written: "2026-03-21"
---
# Artifact Trust Registry

- Required governed classes: 5
- Diagnostics: 0

## Required Classes

- `contract_spec_bundle`
  - signing: `cosign`
  - attestations: `in_toto_dsse`
  - provenance: `slsa_provenance/v1`
  - verification boundaries: `promotion`, `release`
  - governed publishers: none
- `judge_evidence_bundle`
  - signing: `cosign`
  - attestations: `in_toto_dsse`
  - provenance: `slsa_provenance/v1`
  - verification boundaries: `promotion`, `release`
  - governed publishers: none
- `release_bundle`
  - signing: `cosign`
  - attestations: `in_toto_dsse`
  - provenance: `slsa_provenance/v1`
  - verification boundaries: `promotion`, `release`
  - governed publishers: none
- `release_report_bundle`
  - signing: `cosign`
  - attestations: `in_toto_dsse`
  - provenance: `slsa_provenance/v1`
  - verification boundaries: `promotion`, `release`
  - governed publishers: `packages/factory-ops/src/commands/release-emit-narrative-document.ts`
- `workflow_ir_bundle`
  - signing: `cosign`
  - attestations: `in_toto_dsse`
  - provenance: `slsa_provenance/v1`
  - verification boundaries: `promotion`, `release`
  - governed publishers: none

## Diagnostics

- none
