---
doc_type: "reference"
owner: "mothership-factory"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Supported hatch-ops and hatch-host lifecycle contract for host-runtime installation plus same-machine factory installs."
tags: [factory, host, lifecycle, operations]
written: "2026-03-09"
---
# Host Lifecycle for Same-Machine Multi-Factory Runtime

Use `hatch-ops host *` to manage the shared host runtime and `hatch-ops factory host-*` to manage per-installation compatibility flows without path or daemon collisions.

Mode applicability contract:
- `hatch-ops factory host-*` commands are **managed-only** per `docs/contracts/factory-public-contract.v1.json#mode_applicability`.
- Canonical matrix reference: `docs/reference/factory-mode-applicability.md`.
- CLI mode orientation topic: `hatch help modes`.

## Mode applicability quick table

| Lifecycle action | Mode | Notes |
| --- | --- | --- |
| `hatch-host *` | `standalone` | Standalone local runtime entrypoint contract. |
| `hatch-ops host *` | `managed` | Shared host runtime install/status/doctor/remove. |
| `hatch-ops factory host-*` | `managed` | Per-factory daemon + path lifecycle controls. |
| `hatch-ops factory host-assign` | `managed` | Host assignment mutation. |
| `hatch-ops factory host-assignment-status` | `managed` | Read-only assignment inspection. |
| `hatch-ops factory status` | `both` | Shared status surface used with lifecycle checks. |
| `hatch-ops factory tick-status` | `both` | Shared tick posture surface. |

## Shared host runtime

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id host_devrel_mac_01
hatch-ops host status --host-base-dir ~/.hatch-hosts
hatch-ops host doctor --host-base-dir ~/.hatch-hosts --required-env LANGFUSE_PUBLIC_KEY,LANGFUSE_SECRET_KEY
hatch-ops host remove-runtime --host-base-dir ~/.hatch-hosts
```

Installed host runtime contract:
- host manifest: `<base>/runtime/host-runtime.json`
- runtime logs: `<base>/runtime/logs`
- standalone entrypoint: `hatch-host`

`hatch-host` is the first-class runtime artifact/entrypoint for host-scoped execution:

```bash
hatch-host status --host-base-dir ~/.hatch-hosts
hatch-host doctor --host-base-dir ~/.hatch-hosts
hatch-host run --host-base-dir ~/.hatch-hosts --once
hatch-host version
```

Scheduler + wakeup runtime behavior:
- `hatch-host run` performs a scheduler cycle across all installed `installation.json` records in one host runtime.
- Concurrency is bounded by `HATCH_HOST_MAX_ACTIVE` (default `1`) and can be further reduced by per-instance registry `max_concurrent_installations` when present.
- Fairness is deterministic and anti-starvation:
  - `base_priority` defaults to `1000` (or registry `base_priority` when provided)
  - age bonus grows by one per deferred capacity cycle (`age_bonus` / persisted `age_bonus_counter`)
  - `effective_priority = base_priority - age_bonus` (lower value wins)
  - `HATCH_HOST_MAX_AGE_BONUS_CYCLES` caps age bonus growth (default `5`)
  - `HATCH_HOST_STARVATION_THRESHOLD` triggers `low_priority_nudge` selection reason (default `3` cycles)
- Scheduler decisions expose audit fields on each installation/state row:
  - `selection_reason` (`priority_order`, `low_priority_nudge`, `deferred_capacity`, `ineligible`)
  - `selection_score`
  - `effective_priority`
  - `age_bonus`
  - `capacity_reject_reason` (for example `max_active_reached`)
- Event-driven wakeup polling tracks mirror deltas plus reconcile backstop:
  - `HATCH_HOST_RECONCILE_INTERVAL_SEC` (default `60`)
  - wake source classes: `intake_activity`, `incident_blocker`, `policy_registry_delta`, `reconcile_timer`
- Runtime state files:
  - scheduler state: `<base>/runtime/scheduler-state.json`
  - wakeup state: `<base>/runtime/wakeup-state.json`

## Supported commands

```bash
hatch-ops factory host-install --factory-id <id>
hatch-ops factory host-start --factory-id <id>
hatch-ops factory host-stop --factory-id <id>
hatch-ops factory host-restart --factory-id <id>
hatch-ops factory host-health --factory-id <id>
hatch-ops factory host-version --factory-id <id>
hatch-ops factory host-logs --factory-id <id> [--tail 100] [--since-duration 1h]
```

## Factory enable/disable (operator intent)

```bash
hatch-ops factory disable --factory-id <id> --reason "maintenance window"
hatch-ops factory enable --factory-id <id>
```

Enable/disable controls whether the daemon ticks a factory on this host. This is operator intent, not an automated system pause.

- **Default**: all factories are enabled (missing intent file = enabled).
- **Storage**: host-local at `<base>/<factory_id>/intent.json` (not git-tracked).
- **Daemon behavior**: disabled factories stay in the daemon loop but skip all ticking, lease acquisition, and git operations. Re-enabling takes effect on the next loop iteration without daemon restart.
- **Separation from pause/quarantine**: `factory pause` and `factory quarantine` are automated control-state mutations in the target repo. `factory disable` is operator-level fleet scheduling stored locally on the host.

Debugging:
- Check intent state: `cat ~/.hatch-hosts/<factory_id>/intent.json`
- Check daemon log for `host_intent_disabled` entries: `grep host_intent_disabled ~/.hatch-hosts/<factory_id>/logs/daemon.log`
- Fleet TUI shows disabled factories as `disabled` (distinct from `blocked` or `unhealthy`).

All commands emit JSON with stable keys:
- `ok`
- `factory_id`
- `status`
- `message`
- `pid`
- `log_dir`
- `runs_dir`
- `pid_file`
- `version`

`host-logs` also returns `files` and `lines`.

Host-assignment commands:

```bash
hatch-ops factory host-assign --factory-id <id> --host-id <host> --installation-manifest-path <path>
hatch-ops factory host-assignment-status --factory-id <id> --installation-manifest-path <path>
hatch-ops factory host migrate --factory-id <id> --from-host-id <old> --to-host-id <new> --installation-manifest-path <new-host-manifest>
hatch-ops factory host drain --factory-id <id> --host-id <host> --installation-manifest-path <path>
```

Host-assignment invariants:
- exactly one active host assignment per instance (`ambiguous_host_assignment` on conflicts)
- passive observers must use `host-assignment-status`; it is read-only and does not rewrite registry or lease records
- migration preserves `instance_id` continuity while moving lease ownership from `from-host-id` to `to-host-id`
- stale source leases fail closed with `lease_stale`; missing source leases fail with `lease_missing`
- drain keeps registry assignment unchanged and rewrites the active lease with a short TTL (default 15s)

The shared host-runtime commands also emit:
- `host_id`
- `runtime_version`
- `host_manifest_path`
- `installation_count`
- `checks` (`host doctor`)
- `scheduler` (`host status`, `hatch-host status`, `hatch-host run`)
- `wakeup` (`host status`, `hatch-host status`, `hatch-host run`)
- `host_queue_depth`
- `host_active_slots`
- `host_max_active_slots`
- `host_capacity_pressure`
- `host_pending_installations`
- `wake_sources`

## Path contract (per factory id)

Default root:
- `HATCH_HOST_BASE_DIR` (if unset: `.hatch/hosts` for ops helper path resolution)

Per-factory layout:
- `<base>/<factory_id>/logs`
- `<base>/<factory_id>/runs`
- `<base>/<factory_id>/tmp`
- `<base>/<factory_id>/sockets`
- `<base>/<factory_id>/pid/factory-daemon.pid`
- `<base>/<factory_id>/pid/factory-daemon.lock`
- `<base>/<factory_id>/artifacts`
- `<base>/<factory_id>/installation.json`
- `<base>/<factory_id>/intent.json`

You can override roots with CLI flags:
- `--host-base-dir`
- `--logs-root`
- `--runs-dir`
- `--tmp-dir`
- `--socket-dir`
- `--pid-dir`

Override semantics are deterministic: each override is treated as a root, and `factory_id` is appended as an explicit path segment (`<override>/<factory_id>`).

Guardrails:
- host path resolution fails closed when resolved paths do not contain the target `factory_id` as a real path segment;
- ambiguous substring-only paths (example: `.../alpha-beta-runs` for `factory_id=alpha`) are rejected.

## Daemon env contract

`host-start`/`host-restart` inject deterministic daemon env:
- `HATCH_FACTORY_ID`
- `HATCH_RUNS_DIR`
- `HATCH_HOST_BASE_DIR`
- `FACTORY_DAEMON_LOG_DIR`
- `FACTORY_DAEMON_PID_DIR`
- `FACTORY_DAEMON_PID_FILE`
- `FACTORY_DAEMON_LOCK_DIR`
- `FACTORY_DAEMON_TMP_DIR`
- `FACTORY_DAEMON_SOCKET_DIR`

Factory daemon implementations must validate that `FACTORY_DAEMON_PID_FILE` matches the expected per-factory pid path before running.

## Log retention policy

Hatch does not rotate daemon logs automatically. The supported retention boundary is **30 days**.

- Use `hatch-ops factory host-logs --since-duration 30d` to query within the retention window.
- For long-running factories, periodically prune `<logsDir>/daemon.log` manually (for example `truncate -s 0 daemon.log`) or rotate the file out-of-band.
- The `hostLogs` function returns a `logsPolicyHint` field on every response (including error paths) with `retention_policy`, `recommended_max_age`, and `prune_command` so CLI surfaces can relay the policy to operators.

### Simulated cross-host validation on one machine

Use distinct host ids with separate installation manifests to validate migration/drain contracts without provisioning another machine:

```bash
# host_a owns the instance
hatch-ops factory host-assign --factory-id mothership --host-id host_a --installation-manifest-path ~/.hatch-hosts/host_a/installation.json

# host_b migrates ownership from host_a
hatch-ops factory host migrate --factory-id mothership --from-host-id host_a --to-host-id host_b --installation-manifest-path ~/.hatch-hosts/host_b/installation.json

# non-owning observer checks status read-only
hatch-ops factory host-assignment-status --factory-id mothership --installation-manifest-path ~/.hatch-hosts/host_b/installation.json

# drain active host lease before maintenance
hatch-ops factory host drain --factory-id mothership --host-id host_b --installation-manifest-path ~/.hatch-hosts/host_b/installation.json --lease-ttl 15
```

## Example: alpha + beta on one host

```bash
# Install isolated host dirs
hatch-ops factory host-install --factory-id alpha --host-base-dir /srv/hatch-host
hatch-ops factory host-install --factory-id beta  --host-base-dir /srv/hatch-host

# Start both
hatch-ops factory host-start --factory-id alpha --host-base-dir /srv/hatch-host
hatch-ops factory host-start --factory-id beta  --host-base-dir /srv/hatch-host

# Probe independently
hatch-ops factory host-health --factory-id alpha --host-base-dir /srv/hatch-host
hatch-ops factory host-health --factory-id beta  --host-base-dir /srv/hatch-host

# Tail only beta logs
hatch-ops factory host-logs --factory-id beta --host-base-dir /srv/hatch-host --tail 200 --since-duration 30m
```

## Example Notes recovery runbook (`factory_id=brainstorm`, `workspace_mode=api_only`)

Use this deterministic sequence for pause/resume recovery and blocked lease cleanup:

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-ops factory host-install --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-health --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory recovery-sweep --factory-id brainstorm --runs-dir ~/.hatch-hosts/brainstorm/runs --stale-minutes 20 --apply true
hatch-ops factory host-start --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-logs --factory-id brainstorm --host-base-dir ~/.hatch-hosts --tail 200 --since-duration 1h
```

Expected JSON signals:
- `host-start`: `status: "started"`, `message: "factory_host_started"`, `ok: true`
- `host-health`: `status: "running"`, `running: true`, `ok: true`
- blocked start/health: `status: "lease_mismatch"`, `error_code: "ambiguous_host_assignment"`
- `recovery-sweep`: `schema_version: "runtime_recovery_sweep/v1"`, `ok: true`

Contract proof test:
- file: `packages/factory-ops/test/supervisor/factory-host-lifecycle-cli.test.mjs`
- command: `node packages/factory-ops/test/supervisor/factory-host-lifecycle-cli.test.mjs --grep recovery`

## Notes

- `host-start` refuses to launch when `pid_file` already references a live process.
- `host-stop` and `host-restart` are scoped to the target `factory_id` pid file only.
- Use `--daemon-script` to point at a factory-specific daemon implementation.

## Certification gate

Host lifecycle same-machine behavior is a required rollout surface in the external-factory certification contract
(`packages/factory-ops/src/contracts/external-factory-certification.json`, surface id `host_lifecycle_same_machine`).

Before an external factory can be promoted to rollout, operators must produce evidence satisfying both requirements:

1. **host lifecycle command evidence for start/restart/health paths** — captured output from `hatch-ops factory host-start`, `host-restart`, and `host-health` showing clean state transitions on the target host.
2. **recovery sweep evidence proving stale ownership and dead-process cleanup** — captured output from `hatch-ops factory recovery-sweep` showing that stale pids and orphaned processes are cleaned without manual state surgery.

See the certification contract for the full `host_lifecycle_same_machine` entry and `failure_message`.

## Related

- [Daemon Operations Runbook](agent-runbooks/daemon-operations.md) — practical guide for starting, stopping, enabling/disabling, and debugging factory daemons.
