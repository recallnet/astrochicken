---
doc_type: "architecture"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Target test-system architecture for deterministic, spec-first, contract-routed verification with package-owned configs and commit-sized rollout slices."
tags: [architecture, ci, contracts, pre-commit, specs, testing]
written: "2026-03-13"
---
# Test System Architecture

Start here: [Documentation Index](../INDEX.md)

This document is the canonical target architecture for AstroChicken testing.
It is intentionally opinionated: deterministic ownership, deterministic
discovery, deterministic gate routing, and spec-first contracts are preferred
over ad-hoc flexibility.

Related documents:
- [Pre-Commit Gate Contract](./pre-commit-gates.md)
- [Architecture: Astrochicken Multi-Factory Runtime](./factory-internals.md)

## Completion Ledger

Use this ledger as the canonical progress tracker. Future implementation runs
should select the first commit slice marked `pending`, complete exactly that
slice, and update this ledger in the same change.

| Commit Slice | Status | Notes |
| --- | --- | --- |
| Commit 1: Canonical architecture + config contract | complete | `config/testing/` and the initial presence/shape validator are checked in |
| Commit 2: Package test manifests | complete | Package manifests, validator, and manifest-backed package suite entrypoints are checked in |
| Commit 3: Subsystem ownership map | complete | Ownership registry, validator, and fail-closed active-path coverage are checked in |
| Commit 4: Spec registry + first-class specs | complete | Spec registry, initial high-risk subsystem specs, and fail-closed proof-link validator are checked in |
| Commit 5: `packages/factory-ops` topology migration | complete | `packages/factory-ops/test` is subsystem-first, manifest-driven, and guarded against flat-root regressions |
| Commit 6: `apps/hatch` runtime/spec alignment | complete | Runtime handler/timeout/recovery/telemetry seams now land in owned topology with explicit specs |
| Commit 7: Hook routing migration | complete | Package suite routing now reads checked-in config with validator + docs alignment |
| Commit 8: Topology enforcement | complete | Test placement, fixture ownership, required spec coverage, and generic test naming now fail closed through checked-in validators and hook gates |
| Commit 9: Whole-repo quality proof | complete | `qa:pre-merge` now emits deterministic subsystem/spec-aware proof output from the checked-in manifests, ownership map, and spec registry |

Completion rules:

- Mark a commit slice `complete` only when its acceptance criteria in this
  document are fully satisfied and the corresponding commit has been pushed.
- Use `in_progress` only inside a local working tree; do not leave
  `in_progress` on `main`.
- `TESTS_COMPLETE` is valid only when Commit Slices 1-9 are marked `complete`.

## Problem Statement

The current repo has strong test coverage in many areas, but the organization
has grown historically instead of from first principles:

- some suites are organized by convenience rather than system boundary
- flat test directories make ownership and discovery harder than necessary
- contract tests, regressions, and integration tests are not always separated
  by intent
- hook routing is partially path-based, but the package-level test topology is
  not explicit enough
- durable executable specs exist in pockets instead of as a first-class system

The target design is a test architecture where a contributor can answer these
questions deterministically:

1. What is this subsystem supposed to do?
2. Where is its executable spec?
3. Which config governs it?
4. Which test suite proves it?
5. Which hook or CI gate must run before merge?

## Design Goals

- Every test belongs to one owned subsystem.
- Every subsystem has an explicit executable spec surface.
- Every package exposes deterministic test entrypoints.
- Gate routing is based on subsystem ownership, not filename accidents.
- Global policy and classification configs are checked in and authoritative.
- Pre-commit and pre-push are fully runnable on every commit.
- Caching may accelerate execution, but caching must never weaken guarantees.
- Regressions become permanent tests near the failed boundary.
- A human should be able to read a spec and know what behavior is required.

## Non-Goals

- No framework monoculture requirement.
- No forced migration of all Node test files to Vitest.
- No compatibility period where both old and new test locations are treated as
  equally valid for new files.
- No hidden suite selection logic in shell globs without a checked-in routing
  contract.

## Core Principles

### 1. Organize by behavior boundary

Tests should follow stable system seams, not historical package growth.

Primary behavior boundaries:

- `commands`
- `packets`
- `leases`
- `merge`
- `wave`
- `supervisor`
- `scenarios`
- `docs`
- `runtime`
- `telemetry`
- `regressions`

### 2. Separate test intent explicitly

Within each subsystem, tests should be split by why the test exists:

- `unit`
- `contract`
- `integration`
- `regressions`

This is a better scaling boundary than one flat `*.test.*` bucket because it
maps to cost, ownership, and merge risk.

### 3. Specs are first-class artifacts

Each important subsystem should have a checked-in machine-readable or
human-readable spec contract that states:

- scope
- required behavior
- invariants
- failure semantics
- inputs/outputs
- authoritative config locations
- owning package
- executable proof surface

Specs must not be prose-only. Every spec must point to one or more executable
test suites that prove it.

### 4. Config is authoritative and centralized

Global configs should decide classification, routing, and enforcement.
Discovery must never depend on “people usually put tests here.”

Authoritative configs should include:

- test taxonomy registry
- subsystem ownership map
- path-to-suite routing map
- package test manifest
- spec registry
- fixture ownership registry when needed

### 5. Hook guarantees are real guarantees

The design target is that every commit can run the required quality bar locally
and deterministically before landing.

That means:

- pre-commit is runnable every time
- pre-push is runnable every time
- CI runs the stronger whole-repo backstop every time
- caching is allowed only as an acceleration layer
- a cache miss must still be fully runnable from source

## Target Repository Topology

### Package test layout

Each package should organize tests by subsystem first, then by test intent.

Example target shape for `packages/factory-ops`:

```text
packages/factory-ops/
  src/
    commands/
    packets/
    merge/
    wave/
    scenarios/
    supervisor/
    leases/
    shared/
  specs/
    commands/
    packets/
    merge/
    wave/
    scenarios/
    supervisor/
    leases/
  test/
    commands/
      unit/
      contract/
      integration/
      regressions/
      fixtures/
    packets/
      unit/
      contract/
      regressions/
      fixtures/
    merge/
      unit/
      contract/
      regressions/
      fixtures/
    wave/
      unit/
      contract/
      regressions/
      fixtures/
    scenarios/
      unit/
      contract/
      regressions/
      fixtures/
    supervisor/
      unit/
      contract/
      regressions/
      fixtures/
    leases/
      unit/
      contract/
      regressions/
      fixtures/
    shared/
      helpers/
      fixtures/
```

Example target shape for `apps/hatch`:

```text
apps/hatch/
  src/
    pipeline/
    factory/
    telemetry/
  specs/
    pipeline/
    factory/
    telemetry/
  src/pipeline/
    handler/
    runtime/
    leases/
    regressions/
```

The exact filesystem can differ per package, but the ownership model must not:
subsystem first, test intent second.

## Framework and Runner Policy

Runner choice should follow runtime boundary, not fashion.

- `apps/hatch`
  - preferred runner: `vitest`
  - reason: TypeScript-heavy runtime code, mocking, fast package-scoped runs
- `packages/factory-ops`
  - preferred runner: `node --test`
  - reason: CLI-heavy JS modules, minimal runner overhead, direct Node contract
- repo docs/config checks
  - preferred runner: explicit scripts
  - reason: these are enforcement commands, not framework-owned tests

The runner is not the architecture. The architecture is:

- owned subsystem layout
- explicit test intent
- authoritative manifests
- deterministic routing

## First-Class Spec Design

Every non-trivial subsystem should own a spec in a checked-in `specs/` tree.

### Required spec schema

Each spec should declare at minimum:

- `id`
- `title`
- `owner_package`
- `subsystem`
- `status`
- `inputs`
- `outputs`
- `required_invariants`
- `failure_modes`
- `authoritative_configs`
- `test_surfaces`
- `merge_blockers`

Specs may be Markdown with structured frontmatter or JSON/YAML plus human
documentation, but they must be parseable enough to validate mechanically.

### Required test linkage

Each spec must list the suites that prove it, for example:

- unit proof
- contract proof
- integration proof
- regression proof, if applicable

The repo should fail closed if a spec exists without an executable proof
surface, or if a required proof surface disappears.

### Example spec contract

For a subsystem like scenario scope validation, a reader should be able to open
one spec and immediately learn:

- the accepted JSON shape
- the allowed registry path contract
- the maximum recommendation count
- the retry/fail-closed policy
- the exact test suites that prove those requirements

## Configuration Architecture

Global configs should rule everything important.

### Required global config set

```text
config/testing/
  test-taxonomy.json
  subsystem-ownership.json
  suite-routing.json
  spec-registry.json
  hook-profiles.json
  package-test-manifests/
    apps-hatch.json
    packages-factory-ops.json
    packages-factory-telemetry.json
```

### Config responsibilities

- `test-taxonomy.json`
  - allowed categories: `unit`, `contract`, `integration`, `regressions`
  - naming rules
  - forbidden legacy patterns for new files
- `subsystem-ownership.json`
  - maps repo paths to owning subsystem and package
- `suite-routing.json`
  - maps changed subsystems to required suites and hook profiles
- `spec-registry.json`
  - authoritative list of spec ids, owners, paths, and proof surfaces
- `hook-profiles.json`
  - fixed gate order and which suites each profile requires
- `package-test-manifests/*.json`
  - package-local suite definitions and directories

Current rollout note:

- Commit 1 seeds the authoritative config root and validates presence/shape.
- Commit 2 populates `package-test-manifests/` with package-owned suite
  definitions.

### Deterministic rule

When adding a new subsystem or test family, update config first or in the same
change. New behavior must not rely on implicit discovery.

## Test Naming Contract

New tests should be named by subsystem + intent + behavior.

Examples:

- `scenario-validate-scope.contract.test.mjs`
- `merge-packet-supersede.regression.test.mjs`
- `codergen-abort-cached-session.unit.test.ts`

Do not allow new generic buckets like:

- `misc.test.mjs`
- `helpers.test.ts`
- `integration.test.mjs`

The filename should tell the reader what boundary failed.

## Fixture Policy

Fixtures belong with the subsystem they support.

Allowed:

- `test/scenarios/fixtures/...`
- `test/merge/fixtures/...`

Discouraged:

- giant shared fixture drawers
- unrelated fixture reuse across domains

Shared fixtures should exist only for truly shared schemas or reusable
protocol-level contracts.

## Gate Architecture

### Local commit gates

Every commit should be verifiable by local hooks using deterministic profiles.

Target profiles:

- `fast`
  - required for pre-commit
  - targeted suites for changed subsystems
- `strict`
  - required for pre-push
  - stronger targeted suites plus package-wide invariants
- `full`
  - required for pre-merge
  - whole-repo backstop, duplication scan, full contract coverage

### Rule-based routing

Routing must be based on subsystem config, not raw globs embedded in shell
scripts.

Example:

- changes under `packages/factory-ops/src/commands/scenario-*`
  - run scenario `unit + contract + regressions`
- changes under `apps/hatch/src/pipeline/handler/codergen.ts`
  - run runtime handler `unit + timeout + regression + telemetry`
- changes under `config/testing/**`
  - run manifest validation and affected package surfaces

### Perfect-on-commit target

The design target is “every landed commit proves correctness at the required
quality bar.” In practice, this means:

- no hook bypasses
- no hidden unrun suites
- no “CI will probably catch it later” culture
- deterministic, documented selection rules

Pre-merge remains stronger than pre-commit, but pre-commit should still provide
real proof, not a courtesy smoke test.

## Required Validation Scripts

The target system should add deterministic validators for the test architecture
itself:

- `node scripts/check-test-manifest-contract.ts`
  - validates package manifests and suite declarations
- `node scripts/check-spec-registry.mjs`
  - validates spec registry entries, ownership, and proof references
- `node scripts/check-test-topology.mjs`
  - rejects files outside approved subsystem/intent layout
- `node scripts/check-suite-routing-contract.ts`
  - validates path-to-suite routing coverage and no orphan subsystems
- `node scripts/check-fixture-ownership.ts`
  - rejects stray fixtures outside approved owning domains

These checks should become hook gates, not optional hygiene scripts.

## Commit Plan

The migration to this architecture should land in small, deterministic slices.

### Commit 1: Canonical architecture + config contract

Land:

- this architecture doc
- initial `config/testing/` schema definitions
- validator stubs for config presence and shape

Acceptance:

- config directory exists
- schema contracts validate
- docs and hook docs reference the new architecture

### Commit 2: Package test manifests

Land:

- package-level manifests for `apps/hatch`, `packages/factory-ops`,
  `packages/factory-telemetry`
- explicit suite names and entrypoints
- scripts updated to use manifests instead of ad-hoc globs where feasible

Acceptance:

- each package has a single authoritative manifest
- no package relies on undocumented suite discovery

### Commit 3: Subsystem ownership map

Land:

- `subsystem-ownership.json`
- ownership validator
- first fail-closed check for unmapped new test/code paths

Acceptance:

- all active test-bearing paths map to a subsystem
- new unmapped paths fail deterministically

### Commit 4: Spec registry + first-class specs

Land:

- `spec-registry.json`
- initial spec tree for the highest-risk subsystems:
  - supervisor
  - wave execution
  - merge packets
  - scenario validation
  - codergen timeout/abort behavior

Acceptance:

- each listed spec has proof surfaces
- validator rejects missing proof references

### Commit 5: `packages/factory-ops` topology migration

Land:

- reorganize `packages/factory-ops/test` into subsystem-first directories
- move fixtures alongside owned domains
- preserve runner as `node --test`

Acceptance:

- old flat-layout additions are rejected
- package manifest runs the new structure only
- no behavior loss in hook coverage

### Commit 6: `apps/hatch` runtime/spec alignment

Land:

- align runtime handler/timeout/regression tests to subsystem boundaries
- promote incident-driven regressions into explicit domain folders/spec links

Acceptance:

- runtime regressions are colocated with the owning subsystem
- spec registry covers the critical runtime seams

### Commit 7: Hook routing migration

Land:

- replace path heuristics with config-driven suite routing
- add routing contract validator
- update [Pre-Commit Gate Contract](./pre-commit-gates.md) in the same change

Acceptance:

- hook routing reads authoritative config
- no hidden raw shell glob logic remains for package suite selection

### Commit 8: Topology enforcement

Land:

- fail-closed validators for test placement, fixture placement, spec coverage,
  and new generic test naming

Acceptance:

- new tests outside approved topology fail
- missing spec coverage fails
- fixture drift fails

### Commit 9: Whole-repo quality proof

Land:

- whole-repo `qa:pre-merge` alignment to manifests/specs
- deterministic reporting on which specs and subsystems were proven

Acceptance:

- pre-merge emits subsystem/spec-aware proof output
- repo-level quality bar is understandable from logs alone

## Merge Boundary Rules

Each rollout commit must:

- update configs and validators in the same change as new topology rules
- update hook docs in the same change as hook behavior
- avoid partial subsystem moves without manifest updates
- avoid spec files without proof linkage
- avoid new implicit discovery paths

## Success Criteria

The target architecture is achieved when:

- every package has an explicit test manifest
- every major subsystem has an explicit spec
- every new test must declare subsystem and intent
- every hook route is config-driven and documented
- every regression is attached to its failure boundary
- every contributor can find the owning spec, config, suite, and hook path
  deterministically

## Decision Rule

When forced to choose between convenience and determinism:

- choose deterministic ownership
- choose explicit config
- choose fail-closed validation
- choose subsystem-aligned specs
- choose executable proof over prose-only intention

That bias should govern future test-system changes.
