---
id: "hatch.runtime.lock-lease-heartbeat"
title: "Lock Lease Heartbeat Contract"
owner_package: "hatch"
subsystem: "runtime"
status: "active"
---

# Lock Lease Heartbeat Contract

## Scope

Defines heartbeat, stale reclaim, and contention behavior for runtime lock
leases.

## Inputs

- lease acquisition requests
- persisted lease artifacts and event logs
- stale heartbeat and dead-PID observations

## Outputs

- refreshed heartbeats for active leases
- deterministic reclaim of stale leases
- structured reclaim artifacts and events

## Required Invariants

- live lease owners keep ownership while contenders fail closed
- stale or dead leases are reclaimed deterministically
- reclaim activity emits durable artifacts and structured events

## Failure Modes

- heartbeat refresh stops and live leases expire incorrectly
- stale leases remain unreclaimed
- reclaim events drift away from durable lease artifacts

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `apps/hatch/src/pipeline/lock.ts`

## Test Surfaces

- `apps/hatch/src/pipeline/leases/lock-lease-heartbeat.unit.test.ts`

## Merge Blockers

- Active leases must refresh, stale leases must be reclaimed deterministically,
  and reclaim artifacts must remain structured.
- Lease lifecycle changes must land with heartbeat and reclaim proofs in the
  same change.
