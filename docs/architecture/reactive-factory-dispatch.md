---
doc_type: "architecture"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Target-state master architecture for the dark-factory platform: standardized contracts, CloudEvents eventing, OpenTelemetry observability, OCI-native artifact management, and reusable capability composition for multi-factory scale."
tags: [architecture, artifacts, capabilities, contracts, events, factories, hatch, observability, protocols, reactor]
written: "2026-03-20"
---
# Architecture: Dark Factory Platform Target State

Start here: [Documentation Index](../INDEX.md)

Related:
- [Architecture: Typed Action Ratchet Checklist](./typed-action-ratchet-checklist.md)
- [Architecture: Pre-Commit Gates](./pre-commit-gates.md)

## Executive Summary

This document defines the **target-state master plan** for the dark-factory platform.

It is not a description of the temporary migration shape. It is the design we are deliberately converging toward: the platform that should be operating after a year of servicing roughly **50 internal dark factories** with high reliability, clean upgrades, reusable capabilities, fast dispatch, and steady feature velocity.

The core principle is:

**The dark-factory platform should be boring at the seams and powerful in the middle.**

That means:

- standard contracts instead of private envelopes
- standard event formats instead of custom bus payloads
- standard observability instead of bespoke logging conventions
- standard artifact packaging and provenance instead of file-and-folder folklore
- reusable capabilities instead of factory-specific glue
- a small deterministic control plane instead of one giant overloaded supervisor

## What Success Looks Like

Assume AstroChicken plus mothership has been operating for a year across **50 internal dark factories**.

Success means:

- no chronic control-plane outages
- no repeated merge/dirt/manual-recovery incidents
- new factories stand up through composition, not graph surgery
- capability improvements land once and propagate across factories
- operators debug from traces, events, artifacts, and run state, not shell archaeology
- dispatch latency is measured in seconds
- long-running execution is isolated from dispatch and maintenance concerns
- artifact history, evidence, signatures, and provenance are durable and inspectable
- the platform interoperates with external tooling without protocol rewrites later

That is the design target for every decision in this document.

## Architectural Thesis

The platform has seven permanent planes:

1. **Contract plane**
   - typed schemas and public interfaces
2. **Execution plane**
   - typed deterministic actions and workflow execution
3. **Control plane**
   - fast deterministic dispatch, leasing, scheduling, reaction
4. **Event plane**
   - standard semantic event emission and consumption
5. **Artifact plane**
   - durable artifact storage, attachment, signing, provenance
6. **Observability plane**
   - traces, metrics, logs, and correlation
7. **Lineage and governance plane**
   - downstream visibility, lineage, cataloging, compliance, analytics

The key design move is to keep these planes separate.

The earlier architecture work was directionally correct but still too willing to tolerate:

- private envelopes
- temporary local conventions
- too much logic in DOT
- too much responsibility in the supervisor

The final design here is stricter. Standard seams are mandatory, not optional.

## Hard Standards Decisions

### 1. OpenTelemetry is the observability substrate

OpenTelemetry is the standard observability layer for the platform.

This means:

- every action emits spans
- every workflow emits structured logs through the same telemetry system
- every reactor decision emits metrics and semantic events
- every artifact publication and verification step is trace-correlated
- every failure is observable through the same context propagation path
- the OTel Collector is the standard ingest, process, and export pipeline

No custom logging substrate should be introduced anywhere in the hot path.

### 2. Zod is the schema authoring layer

Zod is the developer-facing schema system.

This means:

- engineers author schemas in Zod
- Zod is the source of truth in code
- generated JSON Schema is the source of truth at machine boundaries
- we do not maintain a second handwritten schema language
- external docs and contract artifacts are generated, not manually drifted

### 3. CloudEvents is the event envelope

CloudEvents is the standard envelope for all domain events, reactor events, workflow lifecycle events, and capability events.

This is not a temporary internal choice. It is the portability layer that prevents a future event-model rewrite.

This means:

- every semantic event uses CloudEvents
- event payloads live in `data`
- payload schemas are versioned and generated
- trace propagation is mandatory over event boundaries
- event channels can be documented through AsyncAPI

### 4. OpenAPI and AsyncAPI are the public contract surfaces

OpenAPI is the standard contract format for synchronous HTTP capability surfaces.
AsyncAPI is the standard contract format for event-driven capability surfaces.

This means:

- sync capability entrypoints generate OpenAPI
- event channels and message contracts generate AsyncAPI
- both reuse JSON Schema emitted from Zod
- capability integration docs are generated, versioned, linted, and inspectable

We do not maintain a parallel private public-interface format unless something remains genuinely outside what these standards can express.

### 5. OCI is the durable artifact plane

Durable artifacts are stored and distributed as OCI artifacts in an OCI-compatible registry.

This means:

- artifacts are content-addressed and portable
- relationships are modeled through subject/referrer semantics
- ORAS is the practical push/attach/discover/copy tool
- evidence, IR, reports, manifests, and bundles use the same artifact substrate

We should not build a custom artifact storage dialect if the real need is:

- durable storage
- standard attachment relationships
- signing and attestation
- cross-environment portability

### 6. Cosign, in-toto, and SLSA are the provenance stack

Important artifacts must be signable, attestable, and verifiable.

This means:

- Cosign is the signing and verification path
- in-toto / DSSE is the attestation structure
- SLSA provenance is used where build or generation provenance matters

This applies to:

- release artifacts
- workflow compilation artifacts
- review evidence bundles
- generated specs
- promotion manifests

### 7. OpenLineage-compatible output starts now, but governance systems stay downstream

We should emit enough structured run and artifact metadata **now** to project directly into OpenLineage-compatible views without later redesign.

That means:

- stable run/job/input/output lineage facts are part of the emitted metadata model
- lineage-compatible projections are a first-class output of the platform
- Marquez may later consume that data
- Atlas or similar systems may later consume that data

But:

- Marquez is not part of the hot path
- Atlas is not part of the hot path
- lineage and governance systems are consumers of the platform, not prerequisites for it

## Final Platform Layers

### Layer 1: Contract Plane

The contract plane defines what may cross a boundary.

Core rules:

- schemas are authored in Zod
- JSON Schema is generated from Zod
- OpenAPI is generated for synchronous interfaces
- AsyncAPI is generated for event interfaces
- versioning is explicit at capability boundaries

This is where interoperability begins. It prevents collapse into undocumented object shapes, implicit side effects, and accidental schema drift.

### Layer 2: Execution Plane

Deterministic work happens in typed action owners with explicit contracts.

Examples:

- `merge.finalize_commit`
- `release.publish_report`
- `coding.write_review_evidence`
- `wave.lock_ready`

Properties:

- typed inputs and outputs
- explicit side-effect owner
- no hidden dependence on `cwd`
- no internal CLI transport
- artifact outputs are first-class
- telemetry is emitted as part of execution, not bolted on after

CLI remains only for:

- humans
- external automation
- true subprocess boundaries

### Layer 3: Control Plane

The control plane is a small deterministic reactor.

It owns:

- eligibility evaluation
- leasing and concurrency control
- dispatch decisions
- completion reaction
- retry and backoff policy
- fleet-level coordination signals
- admission control

It does **not** own:

- long-running execution semantics
- artifact storage
- governance cataloging
- reporting fan-out
- anything else that does not belong on the hot path

This separation is one of the most important differences from earlier plans. The control plane must stay fast, narrow, and boring.

Preferred substrate:

- **Hatch DOT engine** for deterministic control-state modeling and dispatch
- **CloudEvents + OTel** for event composition, telemetry, and observability

### Layer 4: Event Plane

Every significant domain event is a CloudEvent.

Examples:

- `factory.run.created`
- `factory.run.leased`
- `workflow.started`
- `workflow.completed`
- `workflow.failed`
- `artifact.published`
- `artifact.verified`
- `review.completed`
- `lease.expired`
- `dispatch.skipped`

Each event:

- uses CloudEvents envelope fields
- carries domain payload in `data`
- references a versioned JSON Schema
- carries trace correlation
- can be documented in AsyncAPI

This gives the platform a real event fabric instead of a pile of custom notifications.

### Layer 5: Artifact Plane

Artifacts are OCI-native.

Artifact examples:

- compiled workflow IR
- run snapshots
- review evidence bundles
- judge outputs
- release reports
- benchmark results
- generated documentation
- provenance attestations
- signed release payloads

Relationships are modeled through OCI subject/referrer semantics.

### Layer 6: Observability Plane

The observability plane is OpenTelemetry end to end.

Requirements:

- traces for every action and workflow edge
- metrics for dispatch, lease behavior, queue depth, retries, failure classes, and latency
- logs routed through the same OTel pipeline
- consistent attributes for `factory_id`, `run_id`, `workflow_id`, `capability_id`, `owner`, `failure_code`, and `artifact_ref`
- the OTel Collector as the single ingestion and export plane

### Layer 7: Lineage and Governance Plane

The lineage and governance plane is downstream.

It consumes:

- CloudEvents
- run metadata
- artifact metadata
- telemetry-derived facts
- capability manifests
- release metadata

It may project those into:

- OpenLineage-compatible entities and facets
- Marquez-backed lineage views
- internal operational dashboards
- compliance and audit tooling
- governance systems such as Atlas, if ever justified

This is where heavy metadata systems belong. Not in the hot path.

## What a Factory Becomes

A factory becomes mostly:

- capability composition
- routing policy
- concurrency and leasing policy
- judge and review policy
- artifact publication policy
- identity and environment configuration
- operator affordances

It must not become:

- handwritten workflow spaghetti
- private event formats
- private artifact formats
- one-off observability conventions
- business logic hidden inside the control plane

Conceptually:

```ts
factory("mothership", {
  capabilities: [
    goalDecomposition,
    coding,
    merge,
    review,
    releaseReporting,
    artifactPublication,
  ],
  workflows: {
    goalRun,
    goalExecute,
    maintenanceTick,
  },
  policies: {
    dispatch: {...},
    leasing: {...},
    review: {...},
    merge: {...},
    artifactRetention: {...},
  },
  contracts: {
    sync: openApiBundle,
    async: asyncApiBundle,
    schemas: jsonSchemaBundle,
  },
  telemetry: {
    otel: true,
    cloudevents: true,
  },
  artifacts: {
    registry: "oci",
    signing: "cosign",
    provenance: "slsa",
  }
});
```

## Why This Design Is Better Than What We Discussed Earlier

The earlier discussions improved the system, but still centered too much on:

- typed actions
- reactive dispatch
- generated DOT later

Those were necessary, but not sufficient.

This design is stronger because it locks in the real seams:

1. **Contracts are standard**
   - Zod in code, JSON Schema at the wire, OpenAPI and AsyncAPI at public boundaries
2. **Events are standard**
   - CloudEvents everywhere, not custom event envelopes
3. **Observability is standard**
   - OpenTelemetry everywhere, not local conventions
4. **Artifacts are standard**
   - OCI, ORAS, Cosign, provenance, not custom artifact stores
5. **Lineage starts now but governance stays downstream**
   - OpenLineage-compatible output is part of the model, but Marquez/Atlas are consumers, not dependencies
6. **The control plane stays small**
   - dispatch and reaction only, not everything else
7. **Factories become composable**
   - policy plus capability composition, not one private implementation per factory

That is the difference between a cleanup plan and a platform plan.

## Invariants

The final platform enforces these invariants:

1. Internal deterministic logic never depends on repo-internal CLI transport.
2. Every boundary payload is defined by a Zod-authored schema and exportable as JSON Schema.
3. Every domain event uses CloudEvents.
4. Every sync capability surface can generate OpenAPI.
5. Every async capability surface can generate AsyncAPI.
6. Every durable artifact is OCI-addressable.
7. Every important artifact can be signed and attested.
8. Every action, workflow, and control-plane decision is observable through OpenTelemetry.
9. The control plane is hot-path and narrow.
10. Heavy metadata and governance systems are downstream only.
11. Capability logic is reusable across factories.
12. DOT is runtime IR and visualization, not long-term handwritten truth.

## Target-State Roadmap

This roadmap is ordered by what most directly converges to the correct final system, not by what feels easiest locally.

Every phase below must end with:

- a hard QA gate or gate family that prevents drift
- no dual-tooling path for the same boundary
- a checked-off phase sign-off in the final landing commit

### Phase 0: Active Surface Declaration

Goal:

- define the canonical machine-readable scope for “active deterministic execution” before any repo-wide completion claims are allowed

Why this exists:

- the current repository contains active graphs, templates, tests, historical paths, and partial ratchet slices
- repo-wide enforcement is not honest until the platform has one canonical declaration of which files and families are in-scope for the global flip
- without this phase, later completion claims either overreach into non-active surfaces or under-enforce and falsely mark the phase complete

Deliverables:

- machine-readable active-surface manifest
- graph-family classification
  - active runtime
  - active factory
  - migratable template
  - historical or test-only
- runtime-code classification
  - hot path
  - execution path
  - operator-only
  - test-only
- command-module classification
  - active deterministic owner
  - external/operator CLI
  - legacy or deletion candidate
- explicit `packages/factory-ops/src/**` boundary declaration
  - `src/lib/**` plus runtime entrypoints such as `src/host-runtime.mjs` are active control-plane/runtime surface
  - `src/commands/**` is command-owner surface and must stay governed by command-layer gates
  - `src/cli/**` is operator-facing CLI surface and must not be used to hide active deterministic execution
- gate wiring so later repo-wide checks read from the manifest instead of ad hoc path guesses

Required QA gates:

- hard gate blocking any repo-wide completion claim without an active-surface manifest
- hard gate requiring every in-scope graph/runtime/command surface to have a declared classification
- hard gate blocking new graph/runtime/command files from landing without classification

Definition of done:

- [x] A canonical active-surface manifest exists and is versioned.
- [x] Active graph families are explicitly enumerated.
- [x] Runtime and app/package/factory code surfaces are explicitly enumerated.
- [x] Command surfaces are explicitly enumerated.
- [x] Templates, tests, and historical surfaces are explicitly excluded or separately classified.
- [x] Later repo-wide gates read from the manifest instead of ad hoc path selection.

### Phase 0.1: Command Surface Refinement

Goal:

- refine the command-owner boundary until Phase 1 command enforcement has a truthful canonical scope

Why this exists:

- the initial active-surface manifest can still be too coarse on the command side
- repo-wide command-thinness enforcement is not honest if active deterministic owners, legacy/deletion candidates, and operator/support surfaces are still lumped together
- without this phase, Phase 1 either becomes an unbounded refactor or quietly weakens its own acceptance criteria through ad hoc reclassification

Deliverables:

- refined command-surface manifest entries with no coarse catch-all owner bucket
- explicit split between:
  - active deterministic owners
  - legacy or deletion candidates
  - external operator CLI surfaces
  - operator/support surfaces if needed to keep non-owner helpers out of owner enforcement
- command classification rule:
  - `active_deterministic_owner` is reserved for modules already reachable from active hot-path or execution-path runtime surfaces
  - command modules that are only reachable from operator/CLI surfaces stay out of owner enforcement until a later phase promotes them
- documentation of the command-surface split and why each class exists
- command-surface gate wiring that consumes only the refined canonical classes

Required QA gates:

- hard gate blocking catch-all command-owner classifications that hide multiple ownership modes in one bucket
- hard gate blocking unknown command classifications
- hard gate blocking repo-wide command-thinness claims unless every in-scope command file resolves to exactly one canonical class

Definition of done:

- [x] The manifest no longer uses a coarse command-owner bucket where active owners, legacy candidates, and operator/support code are mixed together.
- [x] Every in-scope command file resolves to exactly one canonical command classification.
- [x] Command-layer gates consume the refined manifest classes directly.
- [x] The plan doc explicitly defines the command-surface split as a prerequisite for Phase 1.
- [x] No Phase 1 repo-wide completion claim can bypass this refined command scope.

### Phase 0.2: Active Graph and Runtime Surface Convergence

Goal:

- finish the remaining active-surface scope cleanup so Phase 1 targets only the true live deterministic surface

Why this exists:

- the repo still contains active graphs, factory wrappers, templates, historical paths, and partial migrations
- Phase 1 should migrate and enforce against the real live execution surface, not a fuzzy mix of live and non-live families
- without this phase, later fail-closed flips still depend on local tribal knowledge about what is “actually active”

Deliverables:

- graph-family manifest refinement for the remaining active factory/runtime families
- runtime-surface refinement for any remaining active hot-path or execution-path files that are still coarsely bucketed
- explicit classification of remaining live factory-wrapper graphs versus templates/historical surfaces
- inventory outputs checked into the review trail so the declared active set can be audited
- fail-closed inventory validation that active graph/runtime command reachability cannot hide behind operator/support or legacy command classes

Required QA gates:

- hard gate blocking unclassified active graph families
- hard gate blocking unclassified hot-path or execution-path runtime files
- hard gate blocking ambiguous active-surface matches for graphs and runtime files
- hard gate blocking checked-in active-surface inventory drift
- hard gate blocking active graph/runtime command reachability from resolving to non-owner command classifications

Definition of done:

- [x] Remaining live graph families are explicitly classified as active runtime, active factory, template, or historical/test-only.
- [x] Remaining live runtime files are explicitly classified as hot path, execution path, operator-only, or test-only.
- [x] No active graph or runtime file is left relying on a fuzzy or implied classification boundary.
- [x] Manifest-driven inventory output is sufficient to audit the live execution surface before Phase 1 begins.
- [x] The declared active graph/runtime surface matches the enforcement target for the next phase.

### Phase 0.3: Repo-Wide Gate Readiness

Goal:

- prove that the canonical active surface is narrow enough and precise enough for Phase 1 fail-closed flips

Why this exists:

- even with a manifest, Phase 1 is not ready until the gates, inventories, and hook paths all consume the same active-surface truth
- this phase exists to remove the last excuse for “the gate was technically repo-wide but not actually scoped to the same surface as the plan”

Deliverables:

- gate audit showing the graph transport, runtime internal-CLI, and command-thinness gates all consume the same canonical manifest classes
- hook/CI audit showing the intended Phase 1 gates run on the same scope in local and CI paths
- explicit list of remaining active-surface violations that Phase 1 must burn down
- no-op dry-run or report-only mode demonstrating that the future Phase 1 flip is pointed at the correct surface

Required QA gates:

- hard gate blocking divergence between manifest scope and gate scope
- hard gate blocking hook/CI routing that omits a declared active-surface gate
- hard gate blocking Phase 1 start unless the remaining violation inventory is attributable to declared active-surface files

Definition of done:

- [x] Graph transport, runtime internal-CLI, and command-thinness gates all consume the same canonical manifest scope.
- [x] Local hook paths and CI paths agree on the active-surface enforcement target.
- [x] The remaining Phase 1 violation list is explicit, audited, and attributable to declared active-surface files.
- [x] No report-only or staging path can silently under-scope the future Phase 1 flip.
- [x] Phase 1 can start without first redefining scope.

### Phase 0.4: Ownership Mapping

Goal:

- map every remaining Phase 1 violation to one explicit owner so the migration backlog is partitioned cleanly before execution begins

Why this exists:

- repo-wide flips still fail in practice if the remaining work is “shared by convention” or implicitly owned by whoever touches it next
- legacy surfaces also need an explicit deletion owner, not just a label
- without this phase, Phase 1 burns time rediscovering accountability instead of eliminating transport debt

Deliverables:

- checked-in owner mapping for every remaining active graph, runtime, and command violation
- explicit owner package or module for each remaining migration target
- explicit deletion owner for every remaining legacy or deletion-candidate surface still in the Phase 1 blast radius
- backlog partitioning that allows Phase 1 work to be grouped by owner instead of by discovery order

Required QA gates:

- hard gate blocking unowned remaining active-surface violations
- hard gate blocking multiply-owned remaining violations without an explicit single execution owner
- hard gate blocking legacy or deletion-candidate surfaces from remaining in the Phase 1 blast radius without a deletion owner

Definition of done:

- [x] Every remaining active-surface violation has exactly one explicit owner.
- [x] Every legacy or deletion-candidate surface still relevant to Phase 1 has an explicit deletion owner.
- [x] No remaining Phase 1 work is implicitly owned by convention or discovery order.
- [x] The Phase 1 backlog can be partitioned cleanly by owner before migration starts.
- [x] Ownership data is checked in and auditable.

### Phase 0.5: Determinism and Wrapper Boundary Finalization

Goal:

- freeze exactly what Phase 1 must eliminate and exactly what is out of scope, so the migration starts from a locked burn-down list instead of another round of debate

Why this exists:

- some remaining nodes and files mix deterministic transport with prompt-driven judgment or true external boundaries
- factory-wrapper graphs can still muddy the distinction between real owners and simple delegators
- without this phase, Phase 1 can still devolve into arguments about whether a given surface “really counts”

Deliverables:

- classification of every remaining active node/file as one of:
  - deterministic internal transport to eliminate in Phase 1
  - non-deterministic judgment path outside Phase 1
  - true external boundary allowed to remain
- explicit wrapper/delegator versus real-owner classification for remaining factory-wrapper graphs
- checked-in final Phase 1 burn-down inventory derived from the locked classifications
- no-rescope rule for Phase 1 once this phase is complete

Required QA gates:

- hard gate blocking remaining active-surface violations without determinism/boundary classification
- hard gate blocking wrapper graphs from remaining ambiguously classified as both owner and delegator
- hard gate blocking Phase 1 start unless the final burn-down inventory is checked in and derived from the locked classifications

Definition of done:

- [x] Every remaining active violation is classified as deterministic transport to eliminate, non-deterministic judgment path, or true external boundary.
- [x] Remaining factory-wrapper graphs are explicitly classified as real owners or wrappers/delegators.
- [x] The final Phase 1 burn-down list is checked in and derived from the locked classifications.
- [x] Phase 1 can begin without reclassification, rescoping, or scope debate.
- [x] The Phase 1 target set is frozen at the end of this phase.

### Phase 1.1: Active Graph Migration Completion

Goal:

- eliminate repo-internal CLI transport from the remaining active execution graphs

Deliverables:

- complete the remaining graph migrations on the Phase 0 active surface
- keep checklist state in [typed-action-ratchet-checklist.md](./typed-action-ratchet-checklist.md)
- graph transport enforcement is fail closed for all active graphs
- Phase 1.1 scope is limited to the frozen Phase 0.5 burn-down contract for active graph `graph_transport` targets; deterministic non-CLI shell nodes stay out of scope unless they are explicitly added to that checked-in contract and the burn-down inventory is regenerated in the same change

Definition of done:

- [x] No active execution graph uses repo-internal CLI transport for deterministic work.
- [x] All remaining active graph nodes that currently use repo-internal CLI transport for deterministic work route that work through typed in-process owners.
- [x] Active graph transport enforcement fails closed on reintroduction.
- [x] The typed-action ratchet checklist is updated to match the landed active graph state.

### Phase 1.2: Runtime Internal-CLI Elimination

Goal:

- eliminate repo-internal CLI transport from active hot-path and execution-path runtime code

Deliverables:

- runtime internal-CLI transport is fail closed
- allowlisted external boundaries are explicit and audited
- remaining runtime shell-outs are either external boundaries or removed

Definition of done:

- [x] Runtime code cannot shell into repo-internal CLIs outside allowlisted external boundaries.
- [x] Active hot-path and execution-path runtime files are covered by the runtime internal-CLI gate.
- [x] Runtime allowlists are explicit, narrow, and reviewed.
- [x] CI and hook paths fail closed on runtime internal-CLI regressions.

Signoff note:

- checked-in Phase 1 gate-readiness artifacts report `runtime_internal_cli_violations: 0`
- checked-in runtime internal-CLI allowlist is explicit and empty (`allowlisted_external_boundaries: []`)

### Phase 1.3: Command Ownership Enforcement and Phase 1 Global Flip

Goal:

- finish Phase 1 by making command ownership enforcement repo-real and fail closed on the declared active surface

Deliverables:

- command thinness is fail closed for active deterministic owners
- obsolete compatibility paths deleted where the migration makes them unnecessary
- Phase 0 refined command classes remain the scope source for enforcement

Definition of done:

- [x] Command-layer ownership gates prevent thick command logic from landing on active deterministic owners.
- [x] All active deterministic internal work runs through typed in-process owners.
- [x] CI and hook paths fail closed on any Phase 1 transport reintroduction.
- [x] No shadow transport or compatibility path remains for the migrated active surface.

### Phase 2.1: OpenTelemetry Contract and Taxonomy

Goal:

- define the canonical OpenTelemetry contract before broad instrumentation begins

Deliverables:

- OTel instrumentation conventions
- standard span, log, and metric attribute taxonomy
- mandatory correlation field definitions across actions, workflows, and reactor decisions
- checked-in OTel taxonomy contract and governed emitter inventory

Required QA gates:

- hard gate blocking missing required correlation attributes on instrumented surfaces
- hard gate blocking new telemetry dimensions outside the canonical taxonomy

Definition of done:

- [x] Required attributes (`factory_id`, `run_id`, `workflow_id`, `capability_id`, `owner`) are defined and enforced.
- [x] Canonical span/log/metric naming and attribute rules are documented and code-backed.
- [x] No new telemetry surface can land outside the canonical taxonomy.

### Phase 2.2: Instrumentation Helpers and Execution Coverage

Goal:

- make standard instrumentation the default path for actions and workflows

Deliverables:

- platform helpers so developers do not hand-roll telemetry plumbing
- action and workflow instrumentation through the standard helper path

Required QA gates:

- hard gate blocking new non-helper telemetry wiring for actions and workflows

Definition of done:

- [x] Actions emit spans through the standard platform helper.
- [x] Workflows emit logs and metrics through the OTel path.
- [x] New action/workflow instrumentation lands through platform helpers only.

### Phase 2.3: Reactor Coverage and Collector Rollout

Goal:

- complete observability coverage by wiring the control plane and collector path
- scope for this phase: active Hatch reactor/control-plane runtime entrypoints and the shared collector-backed OTel path they boot

Deliverables:

- reactor decisions trace-correlated to downstream work
- OTel Collector deployment/profile
- explicit ban on custom collector-side routing or bespoke correlation plumbing outside OpenTelemetry conventions
- active Hatch runtime entrypoints boot reactor/lifecycle telemetry through the collector-backed OTel helper path instead of direct Redis/Langfuse sink wiring

Required QA gates:

- hard gate blocking new non-OTel telemetry paths
- hard gate blocking uncorrelated reactor decision events

Definition of done:

- [x] Reactor decisions are trace-correlated to downstream work.
- [x] The OTel Collector is the standard ingest, process, and export plane for active Hatch reactor/control-plane runtime entrypoints.
- [x] No custom control-plane telemetry path can land without failing QA.
- [x] The active Hatch control-plane implementation relies on OpenTelemetry SDK/Collector primitives directly rather than introducing a dark-factory-specific telemetry transport layer.

### Phase 3.1: Zod Registry and JSON Schema Export

Goal:

- standardize schema authoring and interchange before public surface generation

Deliverables:

- Zod schema registry in code
- JSON Schema export pipeline
- explicit boundary versioning rules
- shared platform helpers for validation and export
- explicit removal of parallel handwritten schema sources and bespoke contract DSL experiments from governed boundaries

Required QA gates:

- hard gate blocking handwritten parallel schema sources
- hard gate blocking boundary payloads without registered schemas

Definition of done:

- [x] Zod is the only authoring source for boundary schemas.
- [x] JSON Schema is generated from Zod and committed or published deterministically.
- [x] No boundary has split-brain schema definitions.
- [x] Runtime validation uses the shared Zod/JSON Schema path rather than a parallel custom schema system.

### Phase 3.2: OpenAPI Generation

Goal:

- generate and govern synchronous public contract surfaces

Deliverables:

- generated OpenAPI for sync boundaries
- generation pipeline that consumes the canonical contract layer rather than handwritten spec fragments

Required QA gates:

- hard gate blocking handwritten or drifted sync interface specs

Definition of done:

- [x] Sync surfaces generate OpenAPI from the canonical source.
- [x] OpenAPI output is versioned and governed with no shadow source.
- [x] No sync interface depends on a private manifest dialect where OpenAPI can express the contract.

### Phase 3.3: AsyncAPI Generation

Goal:

- generate and govern asynchronous public contract surfaces

Deliverables:

- generated AsyncAPI for event boundaries
- generation pipeline that consumes CloudEvents channel definitions and canonical payload schemas

Required QA gates:

- hard gate blocking ungenerated AsyncAPI drift

Definition of done:

- [x] Async surfaces generate AsyncAPI from the canonical source.
- [x] Async contract output is versioned and governed with no shadow source.
- [x] No event surface depends on a private channel manifest where AsyncAPI can express the contract.

### Phase 4: CloudEvents Event Fabric

Goal:

- standardize eventing across the system

Deliverables:

- CloudEvents envelope helpers
- canonical event taxonomy
- event versioning rules
- AsyncAPI generation for channels
- trace propagation over event boundaries
- OpenLineage-compatible event outputs where applicable
- elimination of bespoke semantic event envelopes from governed event surfaces

Required QA gates:

- hard gate blocking non-CloudEvents semantic events
- hard gate blocking undocumented event channels
- hard gate blocking event payloads without registered schema versions

Definition of done:

- [x] All domain and reactor events use CloudEvents.
- [x] Event payloads are versioned and schema-backed.
- [x] AsyncAPI coverage exists for supported channels.
- [x] Trace context propagates over event boundaries.
- [x] OpenLineage-compatible outputs are emitted for relevant run/job/input/output events.
- [x] No private `event/v*`-style envelope remains on governed domain or reactor event paths.

### Phase 5.1: OCI Taxonomy and Publication Helpers

Goal:

- make artifact publication use one canonical OCI-native path

Deliverables:

- canonical OCI artifact taxonomy covering at least:
  - workflow IR
  - run snapshots
  - review/judge evidence bundles
  - release reports and release bundles
  - telemetry-derived summaries that must be durable
  - generated contract/spec bundles where publication is required
- canonical media-type and naming/versioning rules for governed artifact classes
- one owning publication helper surface for:
  - publish
  - copy
  - inspect
  - discover
  - attach-ready subject references
- ORAS-based publish workflows behind platform helpers rather than bespoke scripts
- Zod-authored artifact metadata schemas exported as JSON Schema for all governed artifact classes
- explicit artifact identity fields tying every durable artifact back to:
  - factory
  - run
  - capability
  - workflow/source revision
  - trace/correlation context where applicable
- evidence bundle and report packaging through platform helpers

Required QA gates:

- hard gate blocking new custom durable artifact stores
- hard gate blocking untyped artifact publication paths
- hard gate blocking new governed artifact classes without OCI taxonomy registration
- hard gate blocking durable artifact publication that bypasses the owning platform helper
- hard gate blocking governed artifacts without typed metadata contracts and canonical media types

Design invariants:

- every durable artifact is OCI-addressable
- every governed artifact class has one canonical media type and one canonical metadata contract
- publication ownership is centralized; feature code describes artifacts but does not invent storage or registry conventions
- the platform publishes OCI artifacts; it does not leak ORAS command construction into graph nodes, prompts, or one-off scripts
- artifacts that need later signatures, attestations, lineage projection, or lifecycle enforcement already carry stable identity and relationship fields at publication time
- this phase simplifies by deleting custom artifact storage conventions rather than wrapping them in a second helper layer

Definition of done:

- [x] Critical artifact classes are OCI-addressable.
- [x] Artifact publication goes through platform helpers, not ad hoc scripts.
- [x] New durable artifact types cannot land outside the OCI taxonomy.
- [x] Canonical media types, naming/versioning rules, and typed metadata contracts are checked in for governed artifact classes.
- [x] Platform publication helpers exist for publish/copy/inspect flows and are the only supported durable artifact path.
- [x] Durable artifact identity includes factory/run/capability/workflow provenance fields needed by later provenance, lineage, and operator tooling.
- [x] At least one real evidence/report publication path has been migrated to the canonical OCI helper surface.
- [x] No new governed artifact path depends on bespoke blob IDs, attachment folders, or private durable-store semantics.

### Phase 5.2: Subject/Referrer Attachment Model

Goal:

- standardize how durable artifacts relate to each other

Deliverables:

- subject/referrer conventions
- ORAS-based attach/discover workflows
- removal of bespoke artifact-linkage conventions that duplicate OCI relationship semantics

Required QA gates:

- hard gate blocking attachment relationships that bypass OCI conventions

Definition of done:

- [x] Subject/referrer relationships are standardized.
- [ ] Artifact attachment and discovery use the canonical OCI model.
- [ ] No governed attachment model remains outside OCI subject/referrer semantics.

> **Implementation note (2026-03-23):** Subject/referrer helpers and packaging
> metadata are standardized, but repo-wide attachment/discovery rollout is not
> complete yet. Live discovery remains helper-ready rather than universally
> exercised, and legacy `artifact-linkage` command surfaces still exist.

### Phase 5.3: Artifact Retention and Lifecycle Enforcement

Goal:

- make artifact lifecycle policy operational and enforceable

Deliverables:

- artifact retention and lifecycle policy
- one shared lifecycle policy model rather than per-artifact cleanup scripts

Required QA gates:

- hard gate blocking governed artifact classes without lifecycle policy

Definition of done:

- [x] Retention and lifecycle policy exists for supported artifact classes.
- [ ] Governed artifact classes cannot bypass lifecycle enforcement.
- [ ] Lifecycle enforcement does not depend on bespoke artifact-family scripts where the shared policy engine can govern the class.

> **Implementation note (2026-03-23):** Lifecycle policy models and evaluation
> helpers are landed, but repo-wide scheduled cleanup and shared enforcement are
> not yet operational.

### Phase 6: Signing and Provenance

Goal:

- make artifact trust first-class

Deliverables:

- Cosign signing flows
- attestation flows
- provenance policy
- verification checks in release and promotion paths
- standardized provenance artifact classes
- explicit replacement of bespoke trust/provenance conventions with Cosign, in-toto/DSSE, and SLSA-aligned flows

Required QA gates:

- hard gate blocking unsigned required artifact classes
- hard gate blocking promotion/release without required verification
- hard gate blocking provenance drift for governed artifact classes

Definition of done:

- [ ] Required artifact classes are signed.
- [ ] Required artifact classes carry attestations and provenance.
- [ ] Verification is enforced at promotion/release boundaries.
- [x] Provenance format is standardized and reproducible.
- [x] No parallel bespoke trust model exists for governed artifacts.
- [x] New governed trust flows use the standard signing/attestation stack instead of a custom provenance dialect.

> **Implementation note (2026-03-23):** The canonical trust bundle surface is
> real, and host-runtime/release-report paths use it, but the rollout is not
> complete enough to claim that all required governed artifact classes are
> signed, attested, and enforced at release/promotion boundaries.

### Phase 7.1: Reactor Ownership and Dispatch Extraction

Goal:

- move hot-path dispatch ownership into the reactor with a strict boundary

Deliverables:

- eligibility evaluation in the reactor
- explicit exclusions for non-hot-path concerns
- explicit control-plane boundary showing which behavior is modeled with shared reactor primitives versus deleted from legacy supervisor ownership

Required QA gates:

- hard gate blocking hot-path dispatch logic in maintenance/supervisor graphs
- hard gate enforcing reactor ownership for dispatch decisions

Definition of done:

- [x] Dispatch no longer depends on the giant supervisor tick.
- [x] Reactor ownership for dispatch decisions is explicit and enforced.
- [x] Non-hot-path concerns are excluded from dispatch ownership.
- [x] The reactor uses shared state-machine/reactive primitives instead of a new bespoke orchestration substrate.

### Phase 7.2: Leasing, Concurrency, and Completion Reaction

Goal:

- move the core control-plane coordination loops into the reactor

Deliverables:

- leasing and concurrency control
- completion reaction
- retry and backoff policy
- consolidation of duplicated lease/retry logic into one reactor-owned implementation

Required QA gates:

- hard gate blocking leasing/concurrency decisions outside the control plane

Definition of done:

- [x] Leasing, concurrency, and completion reaction live in the control plane.
- [x] Retry and backoff policy is reactor-owned and explicit.
- [x] Maintenance and review work cannot stall dispatch.
- [x] No parallel lease/retry policy implementation remains in supervisor, graph, and command layers.

> **Implementation note (2026-03-23):** Two lease implementations coexist by
> design. `apps/hatch/src/pipeline/lock.ts` provides local-filesystem
> heartbeat-based locking for intra-pipeline concurrency (guard, recovery,
> runs). `packages/factory-ops/src/lib/daemon-lease.ts` provides distributed
> HTTP leasing for inter-process daemon coordination. These are complementary
> concerns — pipeline-local vs cross-process — and intentionally separate.

### Phase 7.3: Supervisor Demotion and Dispatch SLO Enforcement

Goal:

- finish the control-plane narrowing by demoting legacy supervisor hot-path behavior

Deliverables:

- maintenance tick demotion
- bounded dispatch latency SLO checks
- deletion or confinement of legacy supervisor behavior that no longer belongs on the hot path

Required QA gates:

- hard gate enforcing bounded dispatch latency SLO checks
- hard gate blocking supervisor hot-path regressions

Definition of done:

- [x] Reactor scope is narrow and explicitly enforced.
- [x] Hot-path dispatch regressions fail closed in QA.
- [x] Supervisor maintenance behavior no longer owns dispatch-critical work.
- [x] Legacy supervisor logic is deleted or demoted rather than preserved behind compatibility wrappers.

### Phase 8.1: Capability Contract Surfaces

Goal:

- make capabilities expose standard reusable contract entrypoints

Deliverables:

- reusable entrypoints
- standard contracts
- explicit removal of private capability entrypoint dialects that duplicate the shared contract stack

Required QA gates:

- hard gate blocking capability entrypoints without standard contracts

Definition of done:

- [x] Capabilities expose standard sync and/or async surfaces.
- [x] Capability contracts are generated and versioned.
- [x] Capabilities are reusable across multiple factories without private glue.
- [x] No capability requires a bespoke manifest or private contract envelope where the shared contract stack can express the surface.

### Phase 8.2: Capability Event and Artifact Surfaces

Goal:

- make capability outputs operationally standard and inspectable

Deliverables:

- event surfaces
- artifact outputs
- telemetry expectations
- normalization of capability outputs onto CloudEvents, OCI artifacts, and OTel expectations instead of capability-local conventions

Required QA gates:

- hard gate blocking undocumented capability event/artifact surfaces
- `capability_output_contract`
- `governed_output_path_only`
- `capability_output_producer_discovery_fail_closed`
- `capability_output_contract_runtime_parity`

Definition of done:

- [x] Capability events and artifact outputs are documented and validated. Gates: `capability_output_contract`, `capability_output_contract_runtime_parity`
- [x] Capability telemetry expectations are explicit and enforceable. Gates: `capability_output_contract`, `capability_output_contract_runtime_parity`
- [ ] No private capability output surface remains undocumented. Gates: `governed_output_path_only`, `capability_output_producer_discovery_fail_closed`
- [x] Capability outputs do not invent private event, artifact, or telemetry conventions parallel to the platform standards. Gates: `governed_output_path_only`, `capability_output_contract_runtime_parity`

Remaining gap:

- producer discovery is still enforced through explicit source-file coverage plus import/ref/write contradiction detection, not a single mandatory shared governed output path; keep this item open until every governed capability output flows through one required shared emission owner and the discovery gate can prove totality without heuristics

### Phase 8.3: Generated Capability Manifests

Goal:

- make capability metadata generated and drift-resistant

Deliverables:

- capability manifests derived from code and generated specs
- deletion of handwritten shadow capability manifests once generated manifests are authoritative

Required QA gates:

- hard gate blocking capability drift from manifest/spec generation

Definition of done:

- [x] Capability manifests are generated from source, not handwritten shadow docs.
- [x] Capability manifests stay aligned with contracts, events, and artifacts.
- [x] No dual manifest maintenance path survives for governed capabilities.

### Phase 9.1: Typed Workflow Source Model

Goal:

- define the typed workflow authoring model above handwritten DOT

Deliverables:

- typed workflow source AST covering:
  - workflow/module identity
  - nodes
  - edges
  - action bindings
  - sub-workflow composition
  - conditions/guards
  - retries/timeouts/concurrency policy hooks
  - artifact/event declarations
  - governance metadata that belongs in source rather than generated IR only
- Zod-authored source schemas and exported JSON Schema for the authoring model
- explicit separation between:
  - source-only authoring semantics
  - generated DOT runtime IR
  - runtime execution metadata
- a canonical source-module layout and ownership model for workflow families
- source-level composition rules so capabilities and factories can reuse workflow modules without cloning DOT structure
- source-to-IR invariants describing what must survive compilation exactly and what may be normalized
- source-mapping/debuggability rules so operators can relate runtime IR and failures back to typed source

Required QA gates:

- hard gate blocking workflow source without schema validation
- hard gate blocking new migrated workflow families from introducing a second handwritten source of truth
- hard gate blocking source features that cannot round-trip into declared IR semantics
- hard gate blocking workflow authoring metadata that is duplicated between source and generated IR without an owning source declaration

Design invariants:

- typed workflow source is the canonical authoring surface for migrated families
- DOT is generated runtime IR and visualization, not the long-term human-authored truth
- source semantics must model the real execution platform, not re-skin the old DOT quirks
- shared workflow concerns such as retries, guards, artifact declarations, and action bindings live in typed source primitives, not copied graph snippets
- authoring must support reusable capability modules and factory-level composition without requiring per-factory graph surgery
- the typed source model should stay minimal and semantic; do not rebuild DOT syntax in TypeScript with more ceremony

Definition of done:

- [x] Typed workflow source exists and is schema-validated.
- [x] Workflow authoring semantics are defined above DOT.
- [x] The authoring AST covers nodes, edges, bindings, composition, guards, artifact/event declarations, and policy hooks needed by active workflow families.
- [x] Source versus generated-IR responsibilities are explicitly defined so migrated families have one canonical authoring surface.
- [x] Typed source contracts are exportable as JSON Schema for validation, tooling, and later generated specs.
- [x] Source-mapping/debuggability rules are documented so operator tooling can trace runtime failures back to source modules.
- [x] The model is strong enough to migrate the first active workflow family without inventing family-specific source semantics.
- [x] The source model relies on shared schema/tooling primitives rather than a second bespoke contract or compiler-front-end stack.

### Phase 9.2: DOT Generation and Parity Enforcement

Goal:

- make DOT generated runtime IR with enforceable parity

Deliverables:

- generated DOT runtime IR
- validation and parity checks
- governed artifact-class declaration plus publication-ready metadata for compiled IR
- narrow generation pipeline focused on deterministic IR emission and parity, not a general-purpose compiler framework

Required QA gates:

- hard gate enforcing parity between source and generated IR
- hard gate banning handwritten factory execution DOT inputs
- `governed_execution_dot_input_forbidden`
- `workflow_ir_parity_contract`
- `workflow_ir_claim_truth`
- `workflow_ir_publish_or_plan_exclusive`
- `workflow_ir_runtime_parity_e2e`

Definition of done:

- [x] DOT is treated as runtime IR, not canonical source, for governed execution families. Gates: `generated_governed_dot_only`, `governed_execution_dot_input_forbidden`, `workflow_ir_parity_contract`, `no_handwritten_dot_for_migrated_families`
- [x] Generated IR parity is enforced in CI. Gates: `workflow_ir_parity_contract`, `workflow_ir_runtime_parity_e2e`
- [x] Compiled IR is packaged as a governed artifact class with publication-ready metadata where required. Gates: `workflow_ir_claim_truth`, `workflow_ir_publish_or_plan_exclusive`
- [x] The generator remains a boring deterministic translation layer rather than a second orchestration runtime. Gates: `workflow_ir_runtime_parity_e2e`

### Phase 9.3: Active Workflow Family Migration

Goal:

- migrate active workflow families onto typed source and generated IR

Deliverables:

- migration path for active workflow families
- deletion of dual-authoring and family-local compatibility layers as each migrated family lands

Required QA gates:

- hard gate blocking handwritten DOT edits for migrated families
- hard gate banning handwritten factory execution DOT inputs once a family has crossed to generated IR
- `governed_execution_dot_input_forbidden`
- `workflow_source_contract`
- `no_handwritten_dot_for_migrated_families`

Definition of done:

- [x] Active migrated workflow families are source-authored and DOT-generated. Gates: `generated_governed_dot_only`, `workflow_source_contract`, `no_handwritten_dot_for_migrated_families`
- [x] No dual authoring path exists for migrated workflow families. Gates: `generated_governed_dot_only`, `workflow_source_contract`, `no_handwritten_dot_for_migrated_families`
- [ ] Compatibility shims do not accumulate after migration of a family.

### Phase 9.4: Governed DOT Elimination

Goal:

- eliminate handwritten governed execution DOT completely

Deliverables:

- typed source owner for every remaining governed DOT graph family
- generated DOT only across factory and package execution graphs
- deletion of the governed DOT exemption inventory

Required QA gates:

- hard gate banning any governed execution DOT that is not generated from typed source
- `generated_governed_dot_only`
- `workflow_source_contract`
- `workflow_ir_parity_contract`

Definition of done:

- [x] No handwritten governed DOT remains in `factories/*/graphs`.
- [x] No handwritten governed DOT remains in `packages/*/graphs`.
- [x] `docs/contracts/governed-execution-dot-exemptions.json` is empty or deleted; it is debt inventory only, not completion proof.
- [x] `generated_governed_dot_only` passes repo-wide.

### Phase 10: Factory Composition Model

Goal:

- define factories as capability composition plus policy

Deliverables:

- factory schema
- capability binding model
- routing and concurrency policy model
- operator model
- artifact and telemetry defaults
- generated factory manifests
- explicit simplification of factory authoring onto composition plus policy, with deletion of bespoke factory-private glue where the shared model can express the same behavior

Required QA gates:

- hard gate blocking new factories built by bespoke private glue when composition is possible
- hard gate blocking factories without generated contract/telemetry/artifact declarations
- `factory_composition_contract`
- `governed_execution_dot_input_forbidden`
- `factory_local_dot_scope_guard`
- `factory_execution_glue_forbidden`
- `factory_composition_binding_truth`
- `thin_factory_end_state_guard`

Definition of done:

- [ ] New factories are mostly composition and configuration. Gates: `generated_governed_dot_only`, `factory_local_dot_scope_guard`, `thin_factory_end_state_guard`
- [x] Factory policy surfaces are explicit and typed. Gates: `factory_composition_contract`
- [x] Factory manifests are generated and inspectable. Gates: `factory_composition_contract`
- [ ] Shared capabilities can be reused with minimal factory-specific glue. Gates: `generated_governed_dot_only`, `factory_composition_binding_truth`, `factory_execution_glue_forbidden`
- [x] Factory bootstrap and onboarding are productized. Gates: `factory_composition_contract`
- [ ] New factories do not require a factory-local DSL or private composition substrate beyond the shared model. Gates: `generated_governed_dot_only`, `thin_factory_end_state_guard`, `factory_local_dot_scope_guard`

### Phase 11: Downstream Lineage and Governance

Goal:

- project operational metadata into richer visibility systems without contaminating the hot path

Deliverables:

- OpenLineage-compatible projections
- optional Marquez integration if lineage UI becomes valuable
- governance and catalog hooks only when justified
- downstream metadata model for audit, analytics, and visibility
- explicit rule that heavy governance/catalog systems remain consumers of emitted metadata rather than control-plane dependencies

Required QA gates:

- hard gate preventing lineage/governance systems from entering the hot path
- hard gate enforcing lineage projection completeness for governed run/artifact classes
- `lineage_governance_contract`
- `lineage_supported_class_truth`
- `lineage_projection_presence`
- `lineage_hot_path_isolation`

Definition of done:

- [x] OpenLineage-compatible outputs exist for supported run and artifact classes. Gates: `lineage_supported_class_truth`, `lineage_projection_presence`
- [x] Downstream lineage consumers can attach without execution-plane changes. Gates: `lineage_supported_class_truth`, `lineage_projection_presence`
- [x] Governance/catalog integrations remain consumers, not dependencies. Gates: `lineage_governance_contract`, `lineage_hot_path_isolation`
- [x] No hot-path control decision requires Marquez, Atlas, or similar systems. Gates: `lineage_hot_path_isolation`
- [x] No governance integration introduces a second execution-path metadata substrate parallel to the platform contracts/events/artifacts. Gates: `lineage_hot_path_isolation`, `governed_surface_totality`

Current supported artifact-class note:

- `workflow_ir_bundle` remains publication-intent metadata only and is intentionally excluded from supported downstream lineage artifact classes until a real governed publish/projection path exists

## Concrete Next Follow-On Specs

This master plan should be followed immediately by two narrower design docs:

1. **Canonical event taxonomy**
   - event names
   - ownership
   - versioning
   - payload schemas
   - AsyncAPI channel structure
2. **Canonical artifact taxonomy**
   - artifact classes
   - OCI media types
   - subject/referrer rules
   - signing requirements
   - provenance requirements

Those two specs will force the cleanest near-term decisions.

## Decision

The correct long-term architecture is:

- typed deterministic actions for internal work
- OpenTelemetry for all observability
- Zod-authored schemas exported as JSON Schema
- OpenAPI for synchronous capability surfaces
- AsyncAPI for asynchronous capability surfaces
- CloudEvents for all domain events
- OCI plus ORAS for durable artifacts
- Cosign plus provenance standards for signing and attestation
- a small deterministic reactor for dispatch and control
- reusable capabilities as the product boundary
- immediate OpenLineage-compatible output
- downstream lineage and governance systems only after the operational substrate is already strong

This is the architecture we should build toward, even if we arrive there incrementally.

The migration path must always converge toward this shape, never away from it.
