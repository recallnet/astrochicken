---
id: "hatch.runtime.run-recovery"
title: "Run Recovery Contract"
owner_package: "hatch"
subsystem: "runtime"
status: "active"
---

# Run Recovery Contract

## Scope

Defines stale-run recovery behavior for persisted Hatch runs, including
requeue, fail-closed fallback, and recovery validation surfaces.

## Inputs

- persisted run-state and metadata files
- stale heartbeat and PID observations
- recovery validation and invariant checks

## Outputs

- deterministic requeue of eligible stale runs
- fail-closed failure of irrecoverable runs
- explicit validation proof for recovery invariants

## Required Invariants

- stale running runs requeue only when recovery is safe to continue
- irrecoverable stale runs fail with a deterministic reason code
- completed siblings remain untouched during parent recovery
- recovery proof surfaces stay aligned with persisted run semantics

## Failure Modes

- stale runs remain `running` indefinitely
- recovery requeues completed or unrelated child runs
- recovery validators drift away from persisted run semantics

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `apps/hatch/src/pipeline/recovery-contract.ts`

## Test Surfaces

- `apps/hatch/src/pipeline/regressions/run-stale-heartbeat-requeue.regression.test.ts`
- `apps/hatch/src/pipeline/validate-recovery.test.ts`
- `apps/hatch/src/pipeline/graph-recovery-invariants.test.ts`

## Merge Blockers

- Stale running runs must fail closed into deterministic recovery outcomes.
- Recovery guardrails and regression proofs must be updated together when
  stale-run handling changes.
