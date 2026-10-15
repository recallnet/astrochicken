---
id: "hatch.runtime.wave-execution-topology"
title: "Wave Execution Topology Contract"
owner_package: "hatch"
subsystem: "runtime"
status: "active"
---

# Wave Execution Topology Contract

## Scope

Defines the required wave-execution topology exposed through the supervisor
graph and Hatch graph parser/runtime contracts.

## Inputs

- `factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs`
- Hatch graph parser and topology assertions
- wave split-results command surface

## Outputs

- detached goal execution topology rooted at `spawn_goal_execute`
- forbidden legacy node and edge list enforcement
- stable wave execution post-processing surfaces

## Required Invariants

- detached goal execution remains the sole execution fan-out path
- required chain nodes and edges remain present
- legacy wave-dispatch topology stays absent
- downstream wave result handling remains available to control-plane tooling

## Failure Modes

- legacy wave-dispatch nodes or edges reappear
- detached execution topology is partially removed or renamed without proof
- wave tooling drifts away from the active topology contract

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs`

## Test Surfaces

- `apps/hatch/src/pipeline/supervisor-wave-topology-contract.test.ts`
- `packages/factory-ops/test/wave/wave-split-results.test.ts`

## Merge Blockers

- Do not reintroduce legacy wave-dispatch topology without updating this spec
  and its proving suites in the same change.
- Wave execution ownership changes must land with executable proof updates.
