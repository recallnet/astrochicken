---
id: "hatch.runtime.codergen-timeout-abort"
title: "Codergen Timeout And Abort Contract"
owner_package: "hatch"
subsystem: "runtime"
status: "active"
---

# Codergen Timeout And Abort Contract

## Scope

Defines timeout resolution and abort semantics for codergen-backed runtime
nodes, including cached-session recovery behavior.

## Inputs

- graph node timeout attributes
- codergen handler abort signals
- cached session state

## Outputs

- deterministic timeout resolution for codergen nodes
- fail-closed abort handling when prompt execution never resolves
- cached-session eviction when a session is poisoned by abort

## Required Invariants

- configured node timeouts resolve into runtime enforcement
- aborted codergen prompts reject instead of hanging forever
- poisoned cached sessions are disposed and evicted before reuse
- telemetry-capable execution paths remain compatible with timeout handling

## Failure Modes

- codergen prompt execution wedges after guard admission
- cached sessions survive an abort and poison later runs
- timeout resolution drifts from graph configuration

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `apps/hatch/src/pipeline/handler/codergen.ts`

## Test Surfaces

- `apps/hatch/src/pipeline/handler/codergen-abort-cached-session.unit.test.ts`
- `apps/hatch/src/pipeline/runtime/engine-node-timeout.contract.test.ts`
- `apps/hatch/src/pipeline/runtime/graph-timeout-resolution.unit.test.ts`

## Merge Blockers

- Codergen nodes must abort deterministically and evict poisoned cached
  sessions.
- Configured node timeouts must remain enforceable through graph resolution and
  handler execution.
