---
id: "factory-ops.scenarios.validation"
title: "Scenario Validation Contract"
owner_package: "@hatch/factory-ops"
subsystem: "scenarios"
status: "active"
---

# Scenario Validation Contract

## Scope

Defines the allowed scenario scoping output, registry path contract, retry
behavior, and fail-closed validation semantics for scenario authoring.

## Inputs

- scenario-author scoping JSON
- scenario payload JSON
- scenario registry paths under `registry/astrochicken/`

## Outputs

- validated sparse recommendation payloads
- deterministic retry prompts for malformed scoping output
- fail-closed outcome when repeated invalid scope output persists

## Required Invariants

- recommended scenarios use canonical `registry/astrochicken/<domain>/<slug>/SCENARIO.md` paths
- at most two recommendations are accepted
- malformed scope output returns retry guidance instead of partial success
- scenario author scoping stays bound to the validated output schema

## Failure Modes

- malformed registry paths are accepted
- recommendation counts exceed the configured maximum
- scenario-author prompt or DOT contracts drift from the validator

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `packages/factory-ops/src/commands/scenario-validate-scope.ts`
- `packages/factory-ops/src/commands/scenario-validate-payload.ts`

## Test Surfaces

- `packages/factory-ops/test/scenarios/scenario-validate-scope.unit.test.ts`
- `packages/factory-ops/test/scenarios/write-scenarios.contract.test.ts`
- `packages/factory-ops/test/scenarios/write-scenario-item.contract.test.ts`

## Merge Blockers

- Scenario scoping must fail closed on malformed registry paths or invalid JSON.
- Do not change scenario-author outputs without updating validation proofs.
