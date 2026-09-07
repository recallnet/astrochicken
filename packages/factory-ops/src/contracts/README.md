# External Factory Certification Contract

`external-factory-certification.json` is the executable source of truth for
"external-factory rollout ready".

Downstream gates must load this file through
`loadCertificationContract()` and fail closed when required evidence is
missing.

## Versioning policy

- `schema_version` increments for structural format changes (field names,
  required field types, top-level layout).
- `certification_version` increments when the required surface set changes
  (added/removed/renamed surface IDs) or when a surface meaning changes in a
  way that alters rollout expectations.

Tests enforce both the required surface IDs and certification-version discipline.

## Required surface IDs

The contract currently requires exactly these nine IDs:

1. `host_lifecycle_same_machine`
2. `env_auth_isolation`
3. `fleet_visibility`
4. `release_targeting_resume_visibility`
5. `policy_template_completeness`
6. `model_policy_benchmark_readiness`
7. `incident_packet_quality`
8. `pause_quarantine_retry_ergonomics`
9. `operator_onboarding_runbook_completeness`

Any missing ID, unknown ID, duplicate ID, missing metadata field, or invalid
field type is a hard loader failure.

## Import path

Use the shared loader:

- `packages/factory-ops/src/lib/external-factory-certification-contract.mjs`

Do not parse the JSON directly in downstream gate code.
