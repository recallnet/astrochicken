---
id: "factory-ops.packets.merge-conflict"
title: "Merge Conflict Packet Contract"
owner_package: "@hatch/factory-ops"
subsystem: "packets"
status: "active"
---

# Merge Conflict Packet Contract

## Scope

Defines durable merge-conflict packet behavior for cold-start takeover,
supervisor visibility, and continuation-sufficient recovery.

## Inputs

- merge-conflict packet payloads
- packet registry metadata
- supervisor state snapshot rendering

## Outputs

- durable takeover packets that can be resumed from persisted state alone
- supervisor-visible packet summaries
- deterministic packet storage and discovery behavior

## Required Invariants

- merge-conflict packets remain continuation-sufficient for cold-start rescue
- packet persistence round-trips without losing takeover metadata
- supervisor state snapshots render merge-conflict packets consistently

## Failure Modes

- packets lose enough context to require hidden transient state
- storage naming or discovery changes hide active merge-conflict packets
- supervisor packet snapshots drift from durable packet reality

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `packages/factory-ops/src/lib/packet-core.ts`

## Test Surfaces

- `packages/factory-ops/test/packets/packet-takeover-cold-start.contract.test.ts`
- `packages/factory-ops/test/supervisor/supervisor-state-snapshot-merge-conflict.unit.test.ts`

## Merge Blockers

- Durable merge-conflict takeover packets must remain continuation-sufficient.
- Do not change merge-conflict packet lifecycle semantics without updating the
  packet proofs in the same change.
