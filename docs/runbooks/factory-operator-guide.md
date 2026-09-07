---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Canonical operator guide for factory lifecycle, monitoring, recovery, and upgrade decisions."
tags: [docs, factory, multi-factory, operator, runbook]
written: "2026-03-11"
name: "Factory Operator Guide"
description: "Canonical operator reference for standing up and running Astrochicken-managed factories without ad-hoc shell workflows."
---
# Factory Operator Guide

This guide is for **human operators** running factories end-to-end (not coding-agent prompt authors). It provides one coherent lifecycle path from new-factory setup to healthy production operation, and links to deeper references instead of duplicating internals.

Mode orientation first:
- Use `hatch help modes` for CLI mode selection and command applicability.
- Canonical matrix: [Factory Mode Applicability (v1)](../reference/factory-mode-applicability.md).

| Mode | Scope in this guide | Core commands |
| --- | --- | --- |
| `standalone` | Factory creation + shared monitoring/recovery surfaces. | `hatch validate`, `hatch run`, `hatch-ops factory fleet-status`, `hatch-ops factory attention`, `hatch-ops factory status`, `hatch-ops factory tick-status`, `hatch-ops factory subscribe` |
| `managed` | Everything in standalone plus host lifecycle, provisioning drift, release-targeting/resume gates. | `hatch-ops factory fleet-status`, `hatch-ops factory attention`, `hatch-ops factory host-*`, `hatch-ops factory provisioning-drift`, `hatch-ops factory resume-gate` |

## 1) Factory creation (mode: both)

Use `hatch factory init` to scaffold a factory.

```bash
hatch factory init --id <factory-id> --repo <owner/repo> --control-plane <owner/repo>
```

Some planning docs may describe `--factory-id`; in the current CLI, the canonical flag is `--id`.

Required `factory.config.json` identity fields:
- `factory_id`
- `repo` (or `target_repo`)
- `control_plane_repo`

After scaffolding, run the scaffold conformance check:

```bash
node scripts/verify-scaffolded-factory-conformance.mjs
```

That script runs the shared conformance harness (`runFactoryConformanceHarness`) implemented in `apps/hatch/src/factory/conformance-harness.ts`.

Creation/evolution deep references:
- [Factory Create/Evolve Skill](../skills/factory-create-evolve/SKILL.md)
- [External factory examples](../examples/external-factories.md)
- [`examples/external-factories/acme-support/`](../../examples/external-factories/acme-support/)

## 2) Daemon operation (managed-only)

Use the supported host lifecycle commands:

```bash
hatch-ops factory host-install --factory-id <factory-id>
hatch-ops factory host-start --factory-id <factory-id>
hatch-ops factory host-health --factory-id <factory-id>
```

Stop or restart through the same surface:

```bash
hatch-ops factory host-stop --factory-id <factory-id>
hatch-ops factory host-restart --factory-id <factory-id>
```

Logs:
- `.hatch/hosts/<factory-id>/logs/daemon.log` (or your configured host base dir)
- `.hatch/hosts/<factory-id>/logs/tick-*.log`

Important:
- Do not restart the daemon just to pick up code changes. The daemon pulls latest at the start of each tick.
- For the mothership on this host, the launchd wrapper remains the entrypoint; for general factory operation, prefer the `host-*` commands.

For the complete path contract, daemon env contract, and multi-factory example, see [Host lifecycle reference](../host-lifecycle.md).
For rollout gate evidence requirements, see [Host lifecycle reference — Certification gate](../host-lifecycle.md#certification-gate).

## 3) Monitoring cadence (mode: both)

Start with a fleet snapshot:

```bash
hatch-ops factory fleet-status --json
```

See which factories need immediate drill-down:

```bash
hatch-ops factory attention --json
```

Then snapshot the specific factory you are investigating:

```bash
hatch-ops factory status --factory-id <factory-id> --json
```

Inspect current tick stage:

```bash
hatch-ops factory tick-status --factory-id <factory-id>
```

Wait for the next meaningful factory change and get a recent summary first:

```bash
hatch-ops factory subscribe
```

Read mirrored managed-factory summaries from control-plane metadata:

```bash
hatch-ops factory-mirror snapshots --factory-id <factory-id>
hatch-ops factory-mirror events --factory-id <factory-id> --limit 20
```

Inspect append-only cross-repo mutation audit records:

```bash
hatch-ops factory audit-records --instance-id <instance-id> --since <iso8601> --to <iso8601> --json
```

Additional filtering examples:

```bash
# Host-scoped view during incident review
hatch-ops factory audit-records --host-id <host-id> --since <iso8601> --to <iso8601> --json

# Action-scoped view
hatch-ops factory audit-records --action issue_label --since <iso8601> --to <iso8601> --json

# Run + capability slices (post-filter JSON)
hatch-ops factory audit-records --instance-id <instance-id> --json \
  | jq '.records[] | select(.run_id == "<run-id>")'

hatch-ops factory audit-records --instance-id <instance-id> --json \
  | jq '.records[] | select(.capability_version == "<capability-version>")'
```

Audit log location:
- `~/.hatch-hosts/<host-id>/audit/audit.v1.log`

Audit schema (`audit.v1`) fields:
- `schema`
- `instance_id`, `installation_id`, `host_id`
- `run_id`, `tick_id`
- `action` (`issue_create|issue_close|issue_label|comment_create`)
- `target_repo`, `target_ref`, `destination_name`
- `capability_version`, `policy_profile`, `runtime_version`
- `timestamp`

Attribution guarantee:
- every audited write record includes `instance_id`, `installation_id`, `host_id`, `run_id`, `tick_id`, `destination_name`, `capability_version`, `policy_profile`, and `runtime_version`.
- authoritative records are append-only on host-local audit logs; summarized attribution signals are mirrored for fleet/snapshot incident workflows.

If `factory audit-records` returns a context-missing error for a mutation path, treat it as fail-closed by design: repair mutation context wiring before retrying the operation.

When your mirror store is outside the default path, pass `--mirror-dir <path>`.

Use this loop instead of ad-hoc polling:

1. Snapshot now with `factory fleet-status --json` and `factory attention --json`.
2. Drill into the specific factory with `factory status --factory-id <id> --json` and `factory tick-status --factory-id <id>`.
3. Open `factory fleet-tui` when you need the interactive operator board. The
   first tab is intentionally the stable overview: posture, live
   supervisor/goal/issue hierarchy, recent host activity, and attention.
4. Run `factory subscribe` and let it block until the next meaningful event.
5. Re-check `factory fleet-status`, `factory attention`, `factory status`, `factory tick-status`, and `factory outcomes`.
6. Use `--target next-review` or `--target next-merge` when you care about a specific handoff.
7. If repeated windows show no shipped outcomes, treat that as an incident.

### Live Run Board & Event Debug Workflow (canonical)

This is the operator-grade run-debug loop. It is backed by deterministic CLI/TUI contracts, not chat memory: `packages/factory-ops/src/commands/factory-status.ts`, `packages/factory-ops/src/commands/factory-tick-status.ts`, `packages/factory-ops/src/commands/factory-subscribe.ts`, `packages/factory-ops/src/cli/factory-session-browser-tui.mjs`, and renderer contracts in `apps/hatch/src/factory/status-presenter.ts`. The run-inspection contract (active run + current node + blocker + recent transitions + key artifacts) is exposed through `factory dashboard` JSON rows (`runIdentity`, `summary.filters`, row `detail`) and semantic subscribe events.

Important TUI contract:
- the first `fleet-tui` tab is the operator overview, not a pure active-row table
- the nested live hierarchy remains at the top when active work exists
- if the hierarchy is empty, the same screen still shows recent host activity and attention context

#### Recipe: What is this run doing?

1. Snapshot the fleet, then the factory and current tick:

```bash
hatch-ops factory fleet-status --json
hatch-ops factory attention --json
hatch-ops factory status --json
hatch-ops factory tick-status
```

Expected shape:
- `factory fleet-status --json`: `rows[]`, `kpis`, per-factory `attention`
- `factory attention --json`: actionable `factories[]` plus fleet `kpis`
- `factory status --json`: `active[]`, `blocked_control_plane[]`, `open_packets[]`
- `factory tick-status`: current stage plus active child runs and nodes

2. Narrow to the run board slice you care about:

```bash
hatch-ops factory dashboard --json --run-id <run-id>
# or graph/node/issue slice
hatch-ops factory dashboard --json --graph goal_issue_execute.dot --node build --issue <n>
```

Expected shape:
- `summary.filters` reflects applied `run_id/graph/node/issue`
- matching rows carry `runIdentity.run_id`, `runIdentity.graph`, `runIdentity.node`, `runIdentity.issue_number`

3. Keep a semantic wait active for that run:

```bash
hatch-ops factory subscribe --run-id <run-id> --target next-goal-progress
```

If the wait resolves, re-run `factory dashboard --json` for the same filters. If it times out repeatedly, treat as potential stall and use the stuck recipe below.

#### Recipe: Why is it stuck?

1. Reconfirm state and blockers:

```bash
hatch-ops factory status --json
hatch-ops factory tick-status
hatch-ops factory dashboard --json --run-id <run-id>
```

Look for:
- `blocked_control_plane[]` entries (blocker kind/ref/unblock condition)
- dashboard blocker rows (`kind=blocker`) and selected-row `detail`
- unchanged `runIdentity.node` across repeated snapshots

2. Watch semantic progress/retry signals for the same run:

```bash
# semantic wait for any meaningful run progress
hatch-ops factory subscribe --run-id <run-id> --target next-goal-progress --timeout 900

# optional focused stream for transitions/artifacts/review retries
hatch-ops factory subscribe --run-id <run-id> --event node-change,artifact,fail --stream
```

Look for repeated review/route signals (for example retry attempt fields on review-family events), missing node movement, or no new artifact events.

3. Drill down only when the board is insufficient:

```bash
# from dashboard-tui, press i on the selected row; or launch directly:
hatch-ops factory session-browser --lookback-hours 24
```

Use `factory session-browser`/`factory session-tail` for transcript-level inspection only after the run board + subscribe loop has identified the suspect run/node.

#### Abstraction map (keep this contract stable)

- **Active run**
  - `factory status --json` → `active[]`
  - `factory dashboard --json` → `tabs[].rows[].runIdentity.run_id`
- **Current node / stage**
  - `factory tick-status` (presented via `status-presenter.ts`)
  - `factory dashboard --json` → `runIdentity.node`, row `progress_label`
- **Blocker reason**
  - `factory status --json` → `blocked_control_plane[]`
  - `factory dashboard --json` → blocker rows + row `detail`
- **Recent transitions**
  - `factory subscribe` semantic events (`next-goal-progress`, `next-review`, etc.)
  - `factory subscribe --event node-change,... --stream` for raw transition flow
- **Important artifacts**
  - `factory subscribe --event artifact --stream` (`artifactUrl`)
  - `factory session-browser` transcript/log drill-in

Use this loop: **status/tick-status → dashboard slice → subscribe wait → dashboard refresh**. Escalate to `session-browser`/`session-tail` only for deep transcript analysis. Do not replace this with packet spelunking or ad-hoc log tail loops.

Assumption note: examples above assume F-1/F-2/F-3 contracts are present (dashboard run inspection fields + subscribe semantic schema + filter flags). If command flags or output fields change, update this section and the linked command/presenter contracts in the same change.

Rules:
- Start with `factory fleet-status` and `factory attention`, then drill down with `factory status`, `factory tick-status`, `factory subscribe`, and `factory outcomes`; if they are insufficient, improve the CLI.
- `factory subscribe` is the default developer monitor: one-shot, semantic, 30 minute timeout, recent summary first. Use raw `--event ... --stream` only for transport debugging.
- Judge progress by merges, closed issues, and completed outcomes, not node churn.
- Never claim monitoring is active unless a foreground subscription command is actually running.

For tick internals and phase-level interpretation, see [Factory Supervisor Tick Reference](../factory-supervisor-tick.md).

## 4) Provisioning drift detection and response (managed-only)

Detect provisioning drift for one factory instance:

```bash
hatch-ops factory provisioning-drift --instance-id <id> --json
```

Detect drift across every registered managed instance:

```bash
hatch-ops factory provisioning-drift --all --json
```

Supervisor state snapshots now emit `kind: "provisioning_drift"` action items when drift exists. Each action includes:
- `instance_id`
- `repo`
- `drift_details` (`missing_labels`, `label_mismatches`, `template_errors`, `manifest_drift`)
- `host_id`
- `installation_id`
- `manifest_identity_hash`

Operator response:
1. Inspect drift details and confirm expected contract state for that kind.
2. Re-run provisioning for the affected instance:
   ```bash
   hatch-ops factory provision-repo --instance-id <id>
   ```
3. Re-run drift check to confirm resolution:
   ```bash
   hatch-ops factory provisioning-drift --instance-id <id> --json
   ```
4. Re-run supervisor snapshot and verify the `provisioning_drift` action clears.

For onboarding-specific sequencing, use [Managed factory onboarding](./managed-factory-onboarding.md).

## 5) Cross-host validation and migration contracts (managed-only)

Use the multi-host test suite whenever host lease behavior, migration logic, or assignment ownership changes.

Core invariants:

- lease exclusivity: two hosts cannot hold the same active instance lease
- passive observation safety: status/inspection reads are read-only and do not mutate registry or lease state
- migration continuity: draining host A and acquiring on host B preserves `instance_id` continuity and lease attribution
- stale source rejection: migration fails closed when source lease is stale
- stale/decommissioned host isolation: conflicting or stale assignment state is rejected via `ambiguous_host_assignment`

Contract/smoke entrypoints:

```bash
node --test packages/factory-ops/test/commands/factory-host-assignment.migration.contract.test.mjs
node --test packages/factory-ops/test/commands/factory-host-assignment.cli.test.mjs
node --test packages/factory-ops/test/leases/factory-distributed-lease.test.mjs
node --test packages/factory-ops/test/supervisor/factory-host-lifecycle-same-machine.integration.test.mjs
```

Success criteria:

- migration/drain commands return `ok: true` and deterministic `status` values (`migrated`, `drained`)
- old/new lease records keep the same `instance_id` while host ownership changes
- contention paths deterministically defer or fail closed (no split-brain success)
- same-machine multi-host integration keeps per-factory daemon/runtime paths isolated

## 6) Recovery (mode: both)

Sweep stale/failed runs:

```bash
hatch-ops factory recovery-sweep --factory-id <id> --runs-dir .hatch/<id>/runs --stale-minutes 20 --apply true
```

Create a ready wave marker when work is unscheduled:

```bash
hatch-ops wave create-ready --repo <owner/repo> --selected-waves '["<milestone>"]' --cooldown-minutes 0
```

When the factory stalls:

1. Classify the cause first: `factory_design_defect`, `missing_context_or_instruction`, `assignment_or_change_defect`, or `infra_or_transient_failure`.
2. Route recovery through supported ops commands and supervisor action items instead of editing run-state files.
3. File design defects with symptom, evidence, missing gate, and proposed fix.

Do not:
- edit `.hatch/<factory_id>/runs/*/state.json`
- manually complete work a crashed pipeline was performing
- manually merge or close around the factory

## 7) Upgrade and resume (managed overlays)

Build/publish host-runtime release manifests (runtime artifact contract + published control-plane asset):

```bash
hatch-ops host runtime-release build \
  --version <id> \
  --channel stable \
  --supported-kinds <kind-a,kind-b> \
  --supported-platforms <platform-a,platform-b> \
  --artifact-url <runtime-asset-url>

hatch-ops host runtime-release publish \
  --repo <owner/repo> \
  --version <id> \
  --channel stable \
  --supported-kinds <kind-a,kind-b> \
  --supported-platforms <platform-a,platform-b> \
  --artifact-url <runtime-asset-url>
```

`publish` uses the control-plane release-asset primitive to publish the manifest as a release asset and records the published asset metadata in the host-runtime release manifest.

Check resume gate status:

```bash
hatch-ops factory resume-gate
```

Check release targeting posture:

```bash
hatch-ops factory release-targeting-status --json
```

Fleet analytics views (CLI-first reporting):

```bash
# Human-readable summary
hatch-ops fleet report --view throughput

# Structured schema payload for automation
hatch-ops fleet report --view failure-rates --json

# Filter by instance and deterministic time window
hatch-ops fleet report --view backlog-age --instance <instance-id> --from <iso8601> --to <iso8601> --json

# Cost profile slice (falls back to unknown/0 when estimates are absent)
hatch-ops fleet report --view model-cost --profile <policy-profile> --json
```

Window syntax note:
- planning docs may describe `hatch-ops fleet report --view <view> --instance <id> --window <duration>`.
- the current CLI uses deterministic `--from <iso8601> --to <iso8601>` bounds for the same window intent.

Expected analytics inputs:
- mirrored event stream payloads (`factory-mirror events` backing data)
- mirrored snapshot payloads (`factory-mirror snapshots` backing data)
- release targeting status (`factory release-targeting-status`) for drift views
- host runtime status signals for host-pressure views

Supported `--view` names:
- `throughput`
- `failure-rates`
- `backlog-age`
- `model-cost`
- `version-drift`
- `host-pressure`
- `time-to-resolution`

How to interpret each view:

- `throughput`
  - key columns: `payload.completed_total`, `payload.by_instance[].completed_count`, `payload.by_kind[].completed_count`
  - indicator mapping: work items completed per instance/kind over the selected window
- `failure-rates`
  - key columns: `payload.totals.failed_events`, `payload.totals.total_events`, `payload.totals.failure_rate`, plus per-runtime and per-capability rows
  - indicator mapping: failure rates by kind, capability version, and runtime version
- `backlog-age`
  - key columns: `payload.totals.queue_depth_total`, `payload.totals.max_oldest_work_age_seconds`, `payload.by_instance[].oldest_work_age_seconds`
  - indicator mapping: backlog health by queue depth and oldest pending work
- `model-cost`
  - key columns: `payload.totals.total_tokens`, `payload.totals.total_cost_usd`, `payload.totals.missing_estimate_events`, per-profile/per-instance totals
  - indicator mapping: token/cost estimates by instance and service/policy profile
- `version-drift`
  - key columns: `payload.by_instance[].current_runtime_version`, `target_runtime_version`, `drift_state`, `version_delta`
  - indicator mapping: runtime/kind drift posture vs rollout policy
- `host-pressure`
  - key columns: `payload.by_host[].active_installations`, `pending_installations`, `capacity_utilization`, `lease_saturation`
  - indicator mapping: host pressure, capacity utilization, and lease saturation
- `time-to-resolution`
  - key columns: `payload.sample_count`, `payload.mean_seconds`, `payload.p95_seconds`, `payload.unresolved_incident_count`
  - indicator mapping: mean/p95 blocked-factory recovery and unresolved incident load

Use these before resuming paused/quarantined factories so resume decisions follow control-plane release gates.

Implementation/test anchors to keep this section in sync:
- `packages/factory-ops/src/commands/fleet-report.ts`
- `packages/factory-ops/test/commands/fleet-report.unit.test.mjs`
- `packages/factory-ops/test/commands/fleet.cli.test.mjs`
- `packages/factory-ops/test/commands/factory-host-assignment.migration.contract.test.mjs`
- `packages/factory-ops/test/leases/factory-distributed-lease.test.mjs`
- `packages/factory-ops/src/lib/audit-trail.ts`
- `packages/factory-ops/test/commands/factory-audit-records.cli.test.mjs`

## 8) External-factory specifics

This guide is intentionally general (any-factory lifecycle). External-factory bootstrap specifics (Claude skill install, cross-factory release loop, managed-factory onboarding flow) are documented in [External factory operator onboarding runbook](./external-factory-operator-onboarding.md).
