---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-26"
status: "active"
summary: "Deterministic bootstrap and host-runtime onboarding commands for a managed brainstorm home repo."
tags: [bootstrap, example-notes, managed-factory, onboarding]
written: "2026-03-15"
---
# Managed factory onboarding (home-repo bootstrap)

Use the deterministic bootstrap command to provision a brainstorm-managed home repo (for example `example-org/example-notes`) with:

- `.hatch/instance.json` from `factories/brainstorm/instance.template.json`
- intake issue templates from `factories/brainstorm/issue_templates/`
- required home-repo labels (`goal`, `source:brainstorm`, `hatch:intake`)

## Command

```bash
hatch-ops factory home-repo bootstrap \
  --home-repo /absolute/path/to/example-notes \
  --instance-path .hatch/instance.json
```

Dry-run preview:

```bash
hatch-ops factory home-repo bootstrap \
  --home-repo /absolute/path/to/example-notes \
  --instance-path .hatch/instance.json \
  --dry-run
```

## Expected output signals

- `ok: true`
- `instance_path` points to `<home-repo>/.hatch/instance.json`
- `kind_id: "brainstorm"`
- `workspace_mode: "api_only"`
- `operations` show `instance_manifest` and `issue_template` changes
- `label_operations` show label provisioning calls for the home repo
- `idempotent: true` on rerun when no file changes are needed

## Verification checklist

1. Confirm `.hatch/instance.json` exists in the home repo and includes:
   - `kind_id: "brainstorm"`
   - deterministic `instance_id`
   - `target_repo.full_name` resolved to the target repo
   - `workspace_mode: "api_only"`
   - intake selector labels set to `hatch:intake`
   - destination labels set to `goal` and `source:brainstorm`
2. Confirm `.github/ISSUE_TEMPLATE/brainstorm-incoming.md` exists in the home repo.
3. Re-run the command and verify `idempotent: true` with no file writes.

## Managed instance provisioning checklist (fleet contract path)

Use this checklist for the managed-factory contract path (`factory-registry.json` + kind contract), including non-brainstorm instances.

Managed factory bundles in this repo (for example `factories/example-web`) follow a config-only pattern: shared runtime graphs are referenced from `factory.config.json`, and factory-local surfaces stay limited to identity/env manifests plus optional repo-specific skills.

1. Register/verify the instance in `factory-registry.json` with correct `instance_id`, `kind_id`, `control_plane_repo`, and `target_repo`.
2. Provision the home repo from the registered instance:

   ```bash
   hatch-ops factory provision-repo --instance-id <id>
   ```

3. Verify expected state:
   - `.hatch/instance.json` exists and matches identity
   - required labels exist (shared labels + kind-specific labels)
   - required issue templates exist under `.github/issue_template/`
4. Verify drift is clear for the instance:

   ```bash
   hatch-ops factory provisioning-drift --instance-id <id> --json
   ```

5. Optional fleet check after multiple onboardings:

   ```bash
   hatch-ops factory provisioning-drift --all --json
   node scripts/check-provisioning-drift.ts --all --json
   ```

## Shared host runtime install/start (no per-factory plist)

Example Notes runs under the shared `hatch-host` scheduler in `api_only` mode. Install/start with first-party host commands:

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-host status --host-base-dir ~/.hatch-hosts
hatch-ops factory host-install --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-start --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-host run --host-base-dir ~/.hatch-hosts --once
```

If startup is blocked by stale ownership or stale runs, execute recovery then restart:

```bash
hatch-ops factory host-health --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory recovery-sweep --factory-id brainstorm --runs-dir ~/.hatch-hosts/brainstorm/runs --stale-minutes 20 --apply true
hatch-ops factory host-start --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-logs --factory-id brainstorm --host-base-dir ~/.hatch-hosts --tail 200 --since-duration 1h
```

Recovery contract proof:

```bash
node packages/factory-ops/test/supervisor/factory-host-lifecycle-cli.test.mjs --grep recovery
```

## Host runtime intake certification

Use this deterministic command to prove a `hatch-host --once` cycle processed one Example Notes intake issue end to end (goal creation, backlink comment, and source closure):

```bash
hatch-ops host runtime-intake-certify \
  --repo example-org/example-notes \
  --issue-number <intake-issue-number> \
  --instance-id brainstorm \
  --home-repo example-org/example-notes \
  --workspace-mode api_only \
  --host-base-dir ~/.hatch-hosts
```

Success signals:

- `status: "certified"`
- `run_metadata.run_id` and `run_metadata.tick_id` populated
- `markers.goal_created = "pass"`
- `markers.source_backlink = "pass"`
- `markers.source_closed = "pass"`

Failure semantics (non-zero exit):

- `status: "host_runtime_run_failed"` when the host runtime run fails
- `status: "certification_failed"` when any invariant fails
- `invariants[]` includes expected vs actual values for machine-readable diagnosis

## Onboarding troubleshooting (provisioning/audit/analytics)

| Symptom | First command | Likely cause | Deterministic remediation | Analytics follow-up |
| --- | --- | --- | --- | --- |
| `provisioning_drift` action appears for the new instance | `hatch-ops factory provisioning-drift --instance-id <id> --json` | Missing label/template or `.hatch/instance.json` mismatch | Run `hatch-ops factory provision-repo --instance-id <id>`; re-run drift check until `ok: true` | `hatch-ops fleet report --view failure-rates --instance <id> --from <iso8601> --to <iso8601> --json` |
| Intake issues are present but queue age climbs after onboarding | `hatch-ops fleet report --view backlog-age --instance <id> --from <iso8601> --to <iso8601> --json` | Intake contract provisioned, but processing blocked/drained | Verify host assignment/migration status and lease ownership, then recover blocked run path | `hatch-ops fleet report --view throughput --instance <id> --from <iso8601> --to <iso8601> --json` |
| Unexpected onboarding token/cost spike | `hatch-ops fleet report --view model-cost --instance <id> --from <iso8601> --to <iso8601> --json` | Retry churn or high-cost policy profile during initial processing | Confirm policy profile + retry causes; reduce churn before adding capacity | `hatch-ops fleet report --view time-to-resolution --instance <id> --from <iso8601> --to <iso8601> --json` |
| Cross-repo writes are disputed during onboarding incident review | `hatch-ops factory audit-records --instance-id <id> --since <iso8601> --to <iso8601> --json` | Missing attribution review, or wrong host/run suspected | Filter audit records by `host_id`, `run_id`, `action`; validate destination + policy/profile attribution | `hatch-ops fleet report --view host-pressure --from <iso8601> --to <iso8601> --json` |

Cross-reference runbooks:
- [Factory operator guide](./factory-operator-guide.md) for audit schema, host migration contracts, and analytics interpretation.
- [Fleet ops reference](../fleet-ops.md) for provisioning drift contract details and implementation anchors.

Implementation/test anchors to keep this runbook synced:
- `packages/factory-ops/src/commands/factory-provision-repo.ts`
- `scripts/check-provisioning-drift.ts`
- `packages/factory-ops/src/lib/audit-trail.ts`
- `packages/factory-ops/src/commands/fleet-report.ts`
- `packages/factory-ops/test/commands/factory-host-assignment.migration.contract.test.mjs`
- `packages/factory-ops/test/commands/fleet-report.unit.test.mjs`
