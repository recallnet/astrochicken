---
doc_type: "reference"
owner: "mothership-factory"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Deterministic fleet triage projection contract used by mothership queue/read-model workflows."
tags: [factory, fleet, operations, triage]
written: "2026-03-16"
---
# Fleet triage projection contract

`buildFleetTriageQueues` in `packages/factory-ops/src/lib/fleet-triage-projection.ts` is the deterministic read model for fleet triage queues.

## Schema

Top-level fields:

- `schema_version` (`fleet_triage_queues.v1`)
- `generated_at` (ISO timestamp)
- `queue_metadata` (per-queue degradation/deprecation warnings)
- `platform_incidents`
- `local_instance_incidents`
- `blocked_instances`
- `repeated_failure_risk`
- `upgrade_drift`
- `host_capacity_pressure`

All six queue keys are always present as arrays.

Each queue item includes:

- `fingerprint` (required)
- `queue_reasons` (required array)
- deterministic queue-specific fields (severity, ownership, durations, etc.)
- `ranking` metadata (`rank`, `priority_score`) after projection ranking

## Dedupe and blast-radius behavior

Platform incidents are deduped by `incident_fingerprint`.

When multiple instances emit the same fingerprint, projection collapses them into one `platform_incidents` item and aggregates:

- `affected_instances`
- `blast_radius.affected_instance_count`
- `blast_radius.services_impacted`
- `blast_radius.support_owner`
- `blast_radius.service_tier`

## Duration semantics

`blocked_instances` emits:

- `blocked_duration_seconds`
- `backlog_age_seconds`

Durations are fail-closed non-negative values:

- computed from lifecycle timestamps when available
- fallback to `0` when timestamps are absent or unparsable
- backlog age uses the max of mirrored `oldest_work_age_seconds` and timestamp-derived age when queue depth indicates backlog

## Upgrade drift mapping

`upgrade_drift` is derived from release targeting status:

- `rollout_status=lagging` → `phase=lagging`
- `rollout_status=blocked` → `phase=blocked_gate`

Rows include deterministic `reason` and `last_successful_release_at` (best-effort from recent completed mirror events).

## Host capacity pressure degradation

`host_capacity_pressure` reads host runtime status signals. If feed is missing/stale, projection emits:

- queue item with `degradation_warning: true`
- queue metadata warnings (`host_pressure_feed_empty` / stale signal warnings)

This keeps queue shape deterministic while surfacing observability degradation explicitly.

## Test coverage

Primary tests:

- `packages/factory-ops/test/lib/fleet-triage-projection.test.mjs`
- aggregator entrypoint: `packages/factory-ops/test/fleet-triage-projection.test.mjs`

Coverage asserts:

- required schema + six queue keys
- platform fingerprint dedupe + blast-radius aggregation
- blocked duration/backlog non-negative defaults
- upgrade drift reason/phase mapping
- host pressure degradation warning behavior

## Fleet provisioning and drift operations

Use these commands when onboarding or repairing a managed instance home repo.

### Provision (idempotent)

```bash
hatch-ops factory provision-repo --instance-id <id>
```

Dry-run preview:

```bash
hatch-ops factory provision-repo --instance-id <id> --dry-run
```

Expected provisioned state:

- `.hatch/instance.json` exists and matches registry/kind identity
- required intake template files exist under `.github/issue_template/`
- required labels from kind contract exist in the home repo (including shared labels such as `hatch:intake`, `hatch:blocked`, `hatch:done`, `hatch:escalated`, plus kind-specific labels)

Idempotency contract:

- rerunning on a compliant repo returns `status: "already_compliant"`
- `report.idempotent` remains `true`
- no file writes or label mutations are applied

### Drift detection (gate + operational check)

Single instance:

```bash
hatch-ops factory provisioning-drift --instance-id <id> --json
```

Whole fleet:

```bash
hatch-ops factory provisioning-drift --all --json
```

Pre-commit/platform invariant script surface:

```bash
node scripts/check-provisioning-drift.ts --all --json
```

When drift exists, supervisor snapshot actions include `kind: "provisioning_drift"` with:

- `instance_id`
- `repo`
- `drift_details.missing_labels`
- `drift_details.label_mismatches`
- `drift_details.template_errors`
- `drift_details.manifest_drift`
- `host_id`
- `installation_id`
- `manifest_identity_hash`

Remediation sequence:

1. Confirm expected kind contract for labels/templates/manifest.
2. Re-run `hatch-ops factory provision-repo --instance-id <id>`.
3. Re-run `hatch-ops factory provisioning-drift --instance-id <id> --json`.
4. Verify the `provisioning_drift` action is cleared in supervisor snapshot output.

See also:

- [Factory Operator Guide](./runbooks/factory-operator-guide.md) for audit trail usage and fleet analytics triage.
- [Managed factory onboarding runbook](./runbooks/managed-factory-onboarding.md) for onboarding checklist + troubleshooting.

Implementation anchors to keep this section synced:

- `packages/factory-ops/src/commands/factory-provision-repo.ts`
- `scripts/check-provisioning-drift.ts`
- `packages/factory-ops/src/commands/factory-provisioning-drift.ts`
- `packages/factory-ops/test/supervisor/factory-provision-repo.contract.test.mjs`
- `packages/factory-ops/test/supervisor/factory-provisioning-drift.contract.test.mjs`
