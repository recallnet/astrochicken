---
id: "factory-ops.supervisor.tick"
title: "Supervisor Tick Orchestration Contract"
owner_package: "@hatch/factory-ops"
subsystem: "supervisor"
status: "active"
---

# Supervisor Tick Orchestration Contract

## Scope

Defines the required control flow for `factory_supervisor_tick.dot`, including
bug fast-routing, goal fan-out, lifecycle convergence, and supervisor review
handoff.

## Inputs

- `factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs`
- supervisor state snapshot inputs
- release manifest and executable goal selection inputs

## Outputs

- deterministic supervisor graph topology
- goal execution fan-out decisions
- release-report and supervisor-review routing

## Required Invariants

- open-bug fast routing happens before normal tick work
- goal decomposition remains backpressure-gated
- ready goals are execution-path gated before `goal_run` fan-out (`goal_execution_path` packet required)
- detached goal execution is the only active execution fan-out
- rejected-upstream lifecycle handling converges back into tick-idle accounting
- supervisor review uses the persistent supervisor session surface

## Failure Modes

- missing or reordered fast-route gates change supervisor semantics
- execution-path ensure gate is bypassed before `fan_out_goal_run`
- legacy wave-dispatch nodes or edges reappear
- lifecycle branches bypass idle accounting or review routing
- mixed DOT and contract expectations ship in the same commit

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs`

## Test Surfaces

- `packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts`
- `apps/hatch/src/pipeline/supervisor-fast-route-contract.test.ts`

## Merge Blockers

- Do not change supervisor control flow without updating this spec and its test
  surfaces in the same change.
- Do not ship mixed supervisor routing semantics across DOT and executable
  contracts.
