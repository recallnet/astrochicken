---
doc_type: "reference"
owner: "mothership-factory"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Practical runbook for factory daemon lifecycle: starting, stopping, enabling/disabling, debugging, and restarting."
tags: [daemon, factory, operations, runbook]
written: "2026-03-23"
---
# Factory Daemon Operations Runbook

## Starting a daemon

```bash
# Install host paths (first time only)
hatch-ops factory host-install --factory-id <id>

# Start the daemon
hatch-ops factory host-start --factory-id <id>

# Verify it's running
hatch-ops factory host-health --factory-id <id>
```

Expected output: `"status": "running"`, `"ok": true`.

## Stopping a daemon

```bash
hatch-ops factory host-stop --factory-id <id>
```

This sends SIGTERM and waits for graceful shutdown. The daemon finishes any in-flight tick before exiting.

## Restarting a daemon

```bash
hatch-ops factory host-restart --factory-id <id>
```

Equivalent to stop + start. Use after code changes that affect the daemon runtime (e.g., updated `packages/factory-ops/`).

## Enabling and disabling factories

Enable/disable controls whether the daemon ticks a factory **without restarting the daemon process**.

```bash
# Disable — factory stays in the loop but skips all ticking
hatch-ops factory disable --factory-id <id> --reason "maintenance window"

# Enable — factory resumes ticking on the next loop iteration
hatch-ops factory enable --factory-id <id>
```

- **Intent file**: stored at `~/.hatch-hosts/<factory_id>/intent.json` (host-local, not git-tracked).
- **Default**: all factories are enabled. Missing intent file = enabled.
- **No restart needed**: the daemon re-reads the intent file each loop iteration.

### When to use disable vs pause

| Action | `factory disable` | `factory pause` |
|--------|------------------|-----------------|
| **What** | Operator intent: "don't tick this factory on this host" | Automated control state: "factory is paused" |
| **Storage** | Host-local `intent.json` | Target repo `control-state.json` |
| **Scope** | This host only | All hosts running this factory |
| **Use case** | Maintenance, staging, not-yet-provisioned | Circuit breaker, operator emergency, quarantine |

## Debugging a factory that won't tick

Check these in order:

### 1. Is the factory disabled?

```bash
cat ~/.hatch-hosts/<factory_id>/intent.json
```

If `"enabled": false`, re-enable with `hatch-ops factory enable --factory-id <id>`.

### 2. Is the control state paused/quarantined?

```bash
hatch-ops factory control-state --factory-id <id>
```

Look for `pause.active: true` or `quarantine.active: true`. Resume with:

```bash
hatch-ops factory resume --factory-id <id> --reason "manual resume"
```

### 3. Is the lease held by another process?

```bash
cat ~/.hatch-hosts/<factory_id>/lease.json
```

Check `host_id` and `pid`. If the PID is dead, run a recovery sweep:

```bash
hatch-ops factory recovery-sweep --factory-id <id> --apply true
```

### 4. Is the circuit breaker tripped?

Check the daemon log:

```bash
grep circuit_breaker ~/.hatch-hosts/<factory_id>/logs/daemon.log | tail -5
```

The circuit breaker auto-retries after a 30-minute cooldown. To force immediate retry:

```bash
hatch-ops factory retry --factory-id <id> --reason "manual retry"
```

## Reading daemon logs

```bash
# Recent logs
hatch-ops factory host-logs --factory-id <id> --tail 100

# Logs from the last hour
hatch-ops factory host-logs --factory-id <id> --since-duration 1h

# Raw log file
tail -200 ~/.hatch-hosts/<factory_id>/logs/daemon.log
```

## Common log lines

| Log line | Meaning |
|----------|---------|
| `host_intent_disabled reason=...` | Factory is disabled by operator intent |
| `control_state_check action=pause` | Factory paused by control state |
| `tick_sleep ms=600000 reason=host_intent_disabled` | Sleeping because disabled |
| `tick_sleep ms=600000 reason=control_state_pause` | Sleeping because paused |
| `circuit_breaker_trip threshold=6 failures=6` | Circuit breaker tripped after consecutive failures |
| `circuit_breaker_cooldown_retry` | Auto-retrying after cooldown |
| `daemon_start factory_id=...` | Daemon process started |
| `daemon_stop factory_id=...` | Daemon process stopped |
| `lease_release reason=daemon_stop` | Lease released on shutdown |

## Fleet TUI

```bash
hatch-ops factory fleet-tui
```

The first tab is the primary operator view. Read it as:
- posture
- live supervisor/goal/issue hierarchy
- recent host activity
- attention

If the live hierarchy is empty, do not assume the factory is inert until you
check the recent and attention lines on the same screen.

Health states in the TUI:

| State | Color | Meaning |
|-------|-------|---------|
| `healthy` | green | Ticking normally with active work |
| `idle` | dim | Running but no active work |
| `disabled` | gray | Operator disabled via `factory disable` |
| `blocked` | yellow | Paused/quarantined or blocked by external dependency |
| `unhealthy` | red | Errors or daemon not running |
| `upgrading` | blue | Release upgrade in progress |

## Quick reference

```bash
# Start/stop/restart
hatch-ops factory host-start --factory-id <id>
hatch-ops factory host-stop --factory-id <id>
hatch-ops factory host-restart --factory-id <id>

# Enable/disable (no restart needed)
hatch-ops factory disable --factory-id <id> --reason "..."
hatch-ops factory enable --factory-id <id>

# Health check
hatch-ops factory host-health --factory-id <id>

# Logs
hatch-ops factory host-logs --factory-id <id> --tail 100

# Control state
hatch-ops factory control-state --factory-id <id>
hatch-ops factory pause --factory-id <id> --reason "..."
hatch-ops factory resume --factory-id <id> --reason "..."

# Fleet overview
hatch-ops factory fleet-tui
hatch-ops factory fleet-status --json
```
