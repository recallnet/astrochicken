---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Mode applicability matrix for standalone vs managed factory contract surfaces."
tags: [contract, factory, modes, reference]
written: "2026-03-19"
---
# Factory Mode Applicability (v1)

Canonical source:
- `docs/contracts/factory-public-contract.v1.json` (`mode_applicability`)

Mode values:
- `standalone` — standalone-only
- `managed` — managed control-plane only
- `both` — shared across standalone and managed

## Command families

Synchronized with `mode_applicability.commands`.

| Command | Mode | Notes |
| --- | --- | --- |
| `hatch run` | `both` | Deterministic pipeline execution in either mode. |
| `hatch validate` | `both` | DOT validation in either mode. |
| `hatch factory conformance` | `both` | Shared conformance harness contract. |
| `hatch-ops factory status` | `both` | Status inspection for both modes. |
| `hatch-ops factory tick-status` | `both` | Tick progress inspection for both modes. |
| `hatch-ops factory subscribe` | `both` | Semantic subscription surface in both modes. |
| `hatch-ops factory host-*` | `managed` | Managed-only host lifecycle family. |
| `hatch-ops factory host-install` | `managed` | Managed host install. |
| `hatch-ops factory host-start` | `managed` | Managed daemon start. |
| `hatch-ops factory host-stop` | `managed` | Managed daemon stop. |
| `hatch-ops factory host-restart` | `managed` | Managed daemon restart. |
| `hatch-ops factory host-health` | `managed` | Managed daemon health. |
| `hatch-ops factory host-version` | `managed` | Managed host runtime version inspection. |
| `hatch-ops factory host-logs` | `managed` | Managed daemon logs and retention policy surface. |
| `hatch-ops factory host-assign` | `managed` | Managed host assignment for an installation. |
| `hatch-ops factory host-migrate` | `managed` | Managed host assignment migration workflow. |
| `hatch-ops factory host-drain` | `managed` | Managed host drain workflow for temporary lease contraction. |
| `hatch-ops factory host-assignment-status` | `managed` | Managed read-only host assignment inspection. |

## Maintenance rule

1. Update `docs/contracts/factory-public-contract.v1.json` first.
2. Keep CLI help strings aligned with contract labels (`mode: both`, `managed-only`, `standalone-only`).
3. Keep onboarding and host lifecycle docs linked to this matrix.

## Related docs

- [Factory Public Contract (v1)](./factory-public-contract.md)
- [External factory operator onboarding runbook](../runbooks/external-factory-operator-onboarding.md)
- [Host Lifecycle for Same-Machine Multi-Factory Runtime](../host-lifecycle.md)
