---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Deterministic distributed lease contract for cross-host factory exclusivity."
tags: [distributed, docs, factory]
written: "2026-02-28"
---
# Distributed Factory Lease Ownership (Issue #389)

## Goal

Guarantee cross-host exclusivity for factory wave/job lanes (`wave_dispatch`, `wave_execute`) with a durable distributed lease.

Local process locks remain for same-host re-entrancy safety, but **distributed lease ownership is authoritative** for cross-host arbitration.

## Storage Backend

- Backend: GitHub issue comments on the factory tracking issue.
- Primary tracking issue for `recallnet/astrochicken`: **#407**.
- Representation: dedicated machine-readable comment block (`hatch:factory-distributed-lease`).
- Key: `(factory_id, lease_name)`.
- Canonical record: lowest comment id matching the key.
- Operational invariant: **do not close issue #407** — supervisor distributed lease coordination depends on it.

## Lease Payload (`factory_distributed_lease/v1`)

Required fields:
- `factory_id`
- `lease_name`
- `holder_id`
- `run_id`
- `expires_at`

Missing required owner fields (`holder_id`, `run_id`) are treated as invalid payload and reclaimed via deterministic CAS-guarded overwrite.

Optional deterministic stale/idempotency fields:
- `heartbeat_at`
- `idempotency_key`

Deterministic metadata:
- `version`
- `version_token`
- `last_seen_comment_etag`
- `clock_skew_tolerance_ms`
- `reclaim_grace_ms`

## Clock + Expiry Policy

- All timestamps normalized to ISO-8601 UTC (`Date#toISOString()`).
- Lease is reclaimable only when:

`now >= expires_at + clock_skew_tolerance_ms + reclaim_grace_ms`

Default values:
- `clock_skew_tolerance_ms = 5000`
- `reclaim_grace_ms = 15000`
- `lease_seconds = 600` (applied when unset/empty/invalid/non-positive)

## Concurrency / Atomicity Assumptions

- Read path paginates full comment history (`gh api --paginate .../comments`) before canonical lease selection.
- Write path is read-modify-write with `If-Match: <etag>` guard.
- `412 precondition failed` => bounded deterministic retry/backoff.
- Create races may temporarily create duplicate comments; canonical comment-id ordering ensures a single authoritative holder and deterministic loser defer.
- Active refresh is allowed only when both `holder_id` and `run_id` match current owner.
- Non-forced release is allowed only when both `holder_id` and `run_id` match current owner.

## Managed Host Installation Lease Contract (`hatch.host.instance_lease.v1`)

Managed host installations persist an on-disk lease artifact at the installation
root (`<host-base>/<instance-id>/lease.json`) and load it through
`host-instance-lease` helpers. This record is the deterministic host-assignment
lease contract used by `hatch-host status` and host runtime status APIs.

Required fields:
- `instance_id`
- `installation_id`
- `host_id`
- `lease_owner`
- `lease_acquired_at`
- `lease_expires_at`
- `lease_ttl_sec`
- `runtime_version`

Operator visibility:
- `hatch-host status --json` and `hatch-ops host status --json` surface
  per-installation `lease` payloads when present.
- Missing lease files emit `missing_lease_record:<installation_manifest_path>`
  diagnostics without failing status.
- Top-level `lease_summary` mirrors active lease owner/ttl fields:
  `assigned_host_id`, `lease_owner`, `lease_expires_at`, `lease_ttl_sec`,
  `runtime_version`.

Consumers should only treat a lease as active when `lease_owner`,
`lease_acquired_at`, and `lease_expires_at` are populated and parseable.

## Entry-Point Integration

- `wave_dispatch.dot`
  - acquires `lease_name=wave_dispatch`
  - branches to defer path on `lease_acquired!=true`
  - releases on terminal paths
- `wave_execute.dot`
  - acquires `lease_name=wave_execute`
  - branches to defer path on `lease_acquired!=true`
  - releases on done/success, no-ready, lock-denied defer, no-merge, judge-fail terminal paths

## Failure Behavior

- Backend unavailable / missing tracking issue returns deterministic machine-readable defer result (`lease_acquired=false`, reason code).
- Stale lease reclaim is deterministic and bounded by expiry policy and retry budget.
- Ambiguous ownership fails closed: when more than one active lease candidate exists for the same `(factory_id, lease_name)` key, acquire returns `reason=lease_ambiguous`, no write/create occurs, and the runtime must stop.

## Ambiguity Guard, Incident, and Pause Workflow

`loadLeaseSnapshot` now exposes `candidates` and `ambiguous` metadata so callers can inspect all matching lease comments, not just canonical comment id ordering.

Candidate fields include:
- `comment_id`
- `holder_id`
- `run_id`
- `expires_at`
- `status`
- `active`
- `released`
- `reclaimable`
- `payload_invalid`

When ambiguity is detected, lease safety handling:
1. Builds + persists an `incident_packet` (`classification=platform`, `crash_type=lease_split_brain`) with candidate-owner evidence.
2. Applies `factory control action pause` (`reason=lease_split_brain`, `actor=lease-safety`) for the affected factory instance.
3. Returns machine-readable evidence in acquire output (`incident_fingerprint`, packet refs, candidate evidence) for operator triage.

Operator response: resolve duplicate active lease comments first, then explicitly resume the paused factory via first-party control-state commands.
