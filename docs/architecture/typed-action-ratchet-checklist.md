---
doc_type: "architecture"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Graph-by-graph ratchet checklist for replacing internal CLI-string orchestration with typed in-process Hatch actions."
tags: [actions, architecture, graphs, hatch, qa]
written: "2026-03-19"
---
# Architecture: Typed Action Ratchet Checklist

Start here: [Documentation Index](../INDEX.md)

## Goal

Replace internal CLI-string orchestration in Hatch graphs with typed in-process
actions, graph by graph, until internal shell transport is gone from active
factory execution paths.

## Done Criteria

- No opted-in graph uses repo-internal CLI transport for deterministic internal work.
- Deterministic graph nodes dispatch typed registered owners instead of shell strings.
- Internal runtime code no longer shells out to repo-internal CLIs outside approved boundaries.
- Command modules are thin adapters over owning typed modules.
- The structural gates are fail-closed for all active graph families.
- Hand-authored workflow source is typed and composable; DOT is generated execution IR.

## Ratchet Phases

### Phase 0: Inventory

- [x] Add a repo-wide inventory detector for internal CLI transport in DOT graphs.
- [x] Add a repo-wide inventory detector for runtime subprocess calls to repo-internal CLIs.
- [x] Add a repo-wide inventory detector for oversized / high-complexity command modules.
- [x] Publish inventory output in a deterministic machine-readable report.
- [x] Keep all detectors report-only in this phase.

### Phase 1: Substrate

- [x] Add first-class typed action dispatch to Hatch runtime.
- [x] Add a typed action registry with stable `action_id` ownership.
- [x] Add validation for deterministic nodes that opt into typed actions.
- [x] Add tests proving typed actions execute in-process with structured input/output.
- [x] Keep shell `tool` transport working for non-migrated graphs.

### Phase 2: Per-Graph Opt-In

- [x] Add a per-graph enforcement switch for typed-action migration.
- [x] Add a per-graph detector that fails only for opted-in graphs.
- [x] Allow mixed repo state: migrated graphs fail closed, legacy graphs report only.
- [x] Add docs/help text for how a graph opts in.

### Phase 3: First Vertical Slice

- [x] Pick one deterministic graph family.
- [x] Extract command/business logic behind typed owners.
- [x] Replace internal CLI-string nodes in that graph with typed actions.
- [x] Add graph-specific tests proving behavior did not change.
- [x] Turn on fail-closed enforcement for that graph family.

### Phase 4: Command Layer Ratchet

- [x] Add a command-thinness detector for `src/commands/**`.
- [x] Require command modules to delegate to owning typed modules.
- [x] Move business logic out of the first migrated command slice.
- [x] Turn on fail-closed command-thinness enforcement for migrated packages.

### Phase 5: Runtime Boundary Ratchet

- [x] Add a gate that forbids repo-internal CLI subprocess calls in runtime code.
- [x] Allowlist only real boundaries:
- [x] human/operator entrypoints
- [x] external tool transport
- [x] isolated worktree / agent launch
- [x] Migrate violating runtime call sites in the current slice.
- [x] Turn on fail-closed runtime enforcement for migrated packages.

### Phase 6: Structured IO Ratchet

- [x] Add typed input/output contracts for migrated actions.
- [x] Fail nodes that pass large ad hoc internal JSON blobs without a declared contract.
- [x] Add tests for contract validation and normalized outputs.
- [x] Turn on fail-closed structured-IO enforcement for migrated graphs.

### Phase 7: Shared Ownership Ratchet

- [x] Detect repeated parsing/normalization/decision logic across graph, command, and prompt layers.
- [x] Extract one shared owner for each repeated concern found in migrated slices.
- [x] Add fail-closed ownership checks where practical.

### Phase 8: Expand Graph by Graph

- [x] Migrate the next graph family.
- [x] Turn on per-graph fail-closed enforcement for that family.
- [x] Migrate `write_issue_item.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_batch.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_queue.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_intake_decompose.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_hard_plan.dot` to typed in-process deterministic actions.
- [x] Migrate `product_judge.dot` to typed in-process deterministic actions.
- [x] Migrate `artifact_ingest.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_execution_handoff.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_intake_to_execution_handoff.dot` to typed in-process deterministic actions.
- [x] Migrate `issue_execute_item.dot` to typed in-process deterministic actions.
- [x] Migrate `merge_item.dot` to typed in-process deterministic actions.
- [x] Migrate `wave_dispatch.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_issue_execute.dot` to typed in-process deterministic actions.
- [x] Migrate `goal_execute.dot` to typed in-process deterministic actions.
- [x] Migrate `wave_execute.dot` to typed in-process deterministic actions.
- [x] Repeat until all active factory execution graphs are opted in.

Phase 1.1 active `graph_transport` burndown:

- [x] `family.common_wrapper_binding` migrated for:
  `factories/brainstorm/graphs/factory_supervisor_tick.dot`,
  `factories/example-web/graphs/factory_supervisor_tick.dot`,
  `factories/mothership/graphs/daily_release_report.dot`
- [x] `family.common_binding_and_brainstorm_domain` migrated for:
  `factories/brainstorm/graphs/domain_brainstorm.dot`,
  `packages/capability-brainstorming/graphs/brainstorm.dot`
- [x] `family.scenario_registry` migrated for:
  `factories/mothership/graphs/write_scenario_item.dot`,
  `factories/mothership/graphs/write_scenarios.dot`
- [x] `family.daily_lens` migrated for:
  `factories/mothership/graphs/daily_lens_publish.dot`
- [x] `family.goal_run` migrated for:
  `packages/capability-goal-decomposition/graphs/goal_run.dot`
- [x] `family.wave_issue_legacy_bridge` migrated for:
  `factories/mothership/graphs/wave_issue_execute.dot`
- [x] `family.goal_queue_and_execution` migrated for:
  `factories/mothership/graphs/factory_supervisor_tick.dot`,
  `factories/example-web/graphs/domain_example_web.dot`
- [x] `family.supervisor_core_and_factory_control_plane` migrated for:
  `factories/mothership/graphs/factory_supervisor_tick.dot`,
  `factories/example-web/graphs/domain_example_web.dot`,
  `packages/factory-runtime/graphs/managed_supervisor.dot`
- [x] Remaining frozen active `graph_transport` backlog: `0`

### Phase 9: Global Enforcement

- [x] Flip graph transport gate from partial to repo-wide fail-closed enforcement.
- [x] Flip runtime internal CLI transport gate to repo-wide fail-closed enforcement.
- [x] Flip command-thinness gate to repo-wide fail-closed enforcement.
- [x] Remove obsolete legacy normalization / compatibility paths.

### Phase 10: Typed Workflow Source

- [ ] Define a typed workflow authoring model in Hatch source.
- [ ] Use schema-backed node definitions and edge builders instead of hand-authored stringly DOT.
- [ ] Keep the authoring model small and deterministic; do not build a general-purpose meta-framework.
- [ ] Prove one migrated graph can be authored in typed source and compiled without behavior drift.

### Phase 11: DOT As Generated IR

- [ ] Add a deterministic compiler from typed workflow source to DOT.
- [ ] Treat generated DOT as execution/runtime IR and visualization artifact, not primary authoring source.
- [ ] Add a reproducibility gate: generated DOT must round-trip deterministically from typed source.
- [ ] Decide which generated DOT artifacts stay checked in for auditability and review.

### Phase 12: Graph Family Migration To Generated Source

- [ ] Migrate active mothership execution graphs from hand-authored DOT to typed workflow source.
- [ ] Migrate supervisor/control-plane graphs that still matter as durable execution pipelines.
- [ ] Delete handwritten DOT for graphs whose typed source is now canonical.
- [ ] Add graph-family contract tests at the typed-source layer so behavior is verified before DOT emission.

### Phase 13: Generated-Only Enforcement

- [ ] Fail closed if active generated graphs are edited directly instead of through their typed source.
- [ ] Fail closed if generated DOT in the repo is stale relative to the typed source.
- [ ] Remove obsolete DOT-only helpers that existed solely to make handwritten graphs tolerable.
- [ ] Update docs/runbooks so operators understand DOT is runtime IR and typed workflow source is canonical.

## Migration Rule

Each graph family must follow the same order:

1. inventory
2. typed substrate available
3. graph opt-in
4. migrate graph
5. enable graph-local fail-closed gate
6. move outward to the next graph

Do not enable repo-wide fail-closed enforcement before enough graph families
have been migrated to make the result tractable.

After Phase 9, do not keep expanding handwritten DOT sophistication. New
workflow structure should move into typed source and emit DOT deterministically.

## Approved Temporary State

During migration it is acceptable for the repo to contain both:

- legacy `prompt="hatch-ops ..."` graph nodes in non-opted-in graphs
- typed in-process actions in opted-in graphs
- typed workflow source that compiles to DOT while legacy handwritten DOT still exists

That mixed state is temporary and intentional. The ratchet is the enforcement
boundary.

## Anti-Goals

- Do not replace Hatch with a different workflow engine.
- Do not force a single flag-day rewrite of all active graphs.
- Do not keep report-only mode forever after the substrate is ready.
- Do not add new internal CLI transport in graphs that have already opted in.
- Do not keep hand-authoring increasingly schema-heavy DOT once typed source exists.
