---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-26"
status: "active"
summary: "Index and extension guidance for machine-readable contracts under docs/contracts."
tags: [contracts, docs, factory, reference]
written: "2026-03-15"
---
# Contracts

This directory stores machine-readable contracts consumed by deterministic gates.

## Active Surface Inventory

- Inventory JSON: [docs/contracts/active-surface-inventory.json](active-surface-inventory.json)
- Inventory markdown: [docs/contracts/active-surface-inventory.md](active-surface-inventory.md)
- Drift gate: `node scripts/check-active-surface-inventory.ts`

### Purpose

Provides the checked-in audit trail for the live graph/runtime surface derived
from [docs/contracts/active-surface-manifest.json](active-surface-manifest.json), including active
graph/runtime command reachability that must stay inside active owner
classifications.

## Phase 1 Gate Readiness

- Report JSON: [docs/contracts/phase1-gate-readiness-report.json](phase1-gate-readiness-report.json)
- Report markdown: [docs/contracts/phase1-gate-readiness-report.md](phase1-gate-readiness-report.md)
- Drift gate: `node scripts/check-phase1-gate-readiness.ts`

### Purpose

Provides the checked-in audit trail proving the future Phase 1 graph-transport,
runtime internal-CLI, and command-thinness flips all read the same canonical
active-surface scope and that the remaining violations are attributable to that
declared surface.

## Phase 1 Ownership Map

- Map JSON: [docs/contracts/phase1-ownership-map.json](phase1-ownership-map.json)
- Map markdown: [docs/contracts/phase1-ownership-map.md](phase1-ownership-map.md)
- Drift gate: `node scripts/check-phase1-ownership-map.ts`

### Purpose

Provides the checked-in ownership map for the remaining Phase 1 active-surface
backlog, including:

- one explicit execution owner for every remaining active graph, runtime, and
  command violation
- one explicit deletion owner for every legacy or deletion-candidate command
  surface still inside the current Phase 1 blast radius
- a fail-closed audit proving the checked-in map matches the current
  active-surface inventory and remaining-violation report

## Phase 1 Scope Finalization

- Classification contract JSON: [docs/contracts/phase1-scope-finalization.json](phase1-scope-finalization.json)
- Burn-down inventory JSON: [docs/contracts/phase1-burndown-inventory.json](phase1-burndown-inventory.json)
- Burn-down inventory markdown: [docs/contracts/phase1-burndown-inventory.md](phase1-burndown-inventory.md)
- Drift gate: `node scripts/check-phase1-burndown-finalization.ts`

### Purpose

Locks the exact remaining Phase 1 target set after ownership mapping by:

- classifying every remaining active violation as deterministic internal
  transport, nondeterministic judgment, or a true external boundary
- classifying remaining active graph-transport entries as `real_owner` or
  `wrapper_delegator`
- deriving the final checked-in Phase 1 burn-down inventory from those locked
  classifications
- failing closed if any current active target is unclassified, stale, or
  removed from the burn-down inventory without updating the checked-in contract

## OTel Taxonomy

- Contract JSON: [docs/contracts/otel-taxonomy.json](otel-taxonomy.json)
- Inventory markdown: [docs/contracts/otel-taxonomy.md](otel-taxonomy.md)
- Source taxonomy: `packages/factory-telemetry/src/otel-contract.json`
- Drift gate: `node scripts/check-otel-taxonomy-contract.ts`

### Purpose

Defines the canonical OpenTelemetry naming and attribute taxonomy for governed
platform emitters, including:

- required correlation keys for every governed emitter
- allowed custom attribute keys for span/log/metric parity
- fail-closed inventory of every governed emitter call in tracked runtime code
- hard failure on direct raw emitter bypasses outside the telemetry package and
  tests

## Workflow Instrumentation Coverage

- Coverage JSON: [docs/contracts/workflow-instrumentation-coverage.json](workflow-instrumentation-coverage.json)
- Coverage markdown: [docs/contracts/workflow-instrumentation-coverage.md](workflow-instrumentation-coverage.md)
- Drift gate: `node scripts/check-workflow-instrumentation-helper-contract.mjs`

### Purpose

Defines the fail-closed helper-routing proof for Hatch workflow/action
instrumentation, including:

- the canonical helper entrypoint for lifecycle instrumentation
- the tracked Hatch pipeline files currently consuming that helper
- hard failure on direct lifecycle `EventBus.emit(...)` bypasses for workflow and
  action events
- hard failure on direct governed OTel emitter usage outside the helper surface

## GitHub Truth-Read Boundary

- Inventory JSON: [docs/contracts/github-truth-read-inventory.json](github-truth-read-inventory.json)
- Inventory markdown: [docs/contracts/github-truth-read-inventory.md](github-truth-read-inventory.md)
- Drift gate: `node scripts/check-github-truth-read-boundary.ts`

### Purpose

Defines the fail-closed permanent boundary for execution-critical GitHub truth
reads outside `packages/github-adapter`, including:

- the checked-in inventory derived from tracked runtime source files
- hard failure on new execution-critical GitHub truth reads appearing outside
  the adapter owner
- hard failure on any non-adapter execution-critical truth read or drifted
  inventory artifacts

## Reactor Collector Coverage

- Coverage JSON: [docs/contracts/reactor-collector-coverage.json](reactor-collector-coverage.json)
- Coverage markdown: [docs/contracts/reactor-collector-coverage.md](reactor-collector-coverage.md)
- Collector profile: `packages/factory-telemetry/config/otel-collector.yaml`
- Drift gate: `node scripts/check-reactor-collector-contract.ts`

### Purpose

Defines the fail-closed Phase 2.3 proof for active Hatch control-plane
telemetry, including:

- the checked-in OTel Collector profile path for runtime ingest/process/export
- the canonical reactor instrumentation helper entrypoint
- the active Hatch runtime entrypoints currently consuming that helper
- hard failure on direct Redis/Langfuse custom telemetry wiring reappearing in
  active control-plane entrypoints
- hard failure on hand-rolled OTLP transport reappearing in the shared OTel
  runtime surface

## Boundary Schema Registry

- Registry report: [boundary-schema-registry.json](./boundary-schema-registry.json)
- Human-readable registry: [boundary-schema-registry.md](./boundary-schema-registry.md)
- Generator/checker: [check-boundary-schema-contract.mjs](../../scripts/check-boundary-schema-contract.ts)
- Shared schema/export helper: [schema-registry.mjs](../../packages/factory-core/src/schema-registry.mjs)

### Purpose

Defines the fail-closed Phase 3.1 proof for governed boundary schemas:

- every governed boundary is authored from a checked-in Zod source
- repo discovery fails closed if a new boundary authoring module appears outside the governed registry
- every governed JSON Schema output is generated deterministically from that
  source
- runtime validators route through the shared Zod helper path instead of a
  parallel handwritten schema system
- handwritten drift in generated boundary artifacts fails QA immediately

### Governed outputs

- `docs/contracts/hatch-intent.json`
- `docs/contracts/backend-selection-config.json`
- `docs/contracts/release-resume-policy.json`
- `docs/contracts/factory-config.json`
- `docs/contracts/factory-kind-definition.json`
- `docs/contracts/factory-instance-manifest.json`
- `docs/contracts/factory-service-registry.json`
- `docs/contracts/factory-installation-manifest.json`
- `docs/contracts/host-runtime-release.json`
- `docs/contracts/hatch-run-lifecycle-event.v1.schema.json`
- `docs/contracts/release-rollout-event.v1.schema.json`
- `docs/contracts/wave-ready-lease-event.v1.schema.json`

## Sync OpenAPI Registry

- OpenAPI output: [hatch-server-openapi.v1.json](./hatch-server-openapi.v1.json)
- Registry report: [sync-openapi-registry.json](./sync-openapi-registry.json)
- Human-readable registry: [sync-openapi-registry.md](./sync-openapi-registry.md)
- Generator/checker: [check-sync-openapi-contract.mjs](../../scripts/check-sync-openapi-contract.ts)
- Shared OpenAPI helper: [openapi-registry.mjs](../../packages/factory-core/src/openapi-registry.mjs)

### Purpose

Defines the fail-closed Phase 3.2 proof for governed synchronous HTTP capability
surfaces:

- sync HTTP contract output is generated from a checked-in canonical route/schema source
- repo discovery fails closed if a new sync OpenAPI authoring module appears outside the governed registry
- generated OpenAPI drift fails QA immediately
- runtime consumers must import the canonical route contract instead of carrying a parallel private manifest
- versioned OpenAPI artifacts are checked in under `docs/contracts/`

## AsyncAPI Registry

- AsyncAPI outputs:
  - [hatch-run-lifecycle.asyncapi.v1.json](./hatch-run-lifecycle.asyncapi.v1.json)
  - [release-rollout-events.asyncapi.v1.json](./release-rollout-events.asyncapi.v1.json)
  - [wave-ready-lease.asyncapi.v1.json](./wave-ready-lease.asyncapi.v1.json)
- Registry report: [asyncapi-registry.json](./asyncapi-registry.json)
- Human-readable registry: [asyncapi-registry.md](./asyncapi-registry.md)
- Generator/checker: [check-asyncapi-contract.mjs](../../scripts/check-asyncapi-contract.ts)
- Shared AsyncAPI helper: [asyncapi-registry.mjs](../../packages/factory-core/src/asyncapi-registry.mjs)

### Purpose

Defines the fail-closed Phase 3.3 proof for governed asynchronous event
surfaces:

- async event contract output is generated from checked-in canonical channel/schema sources
- repo discovery fails closed if a new AsyncAPI authoring module appears outside the governed registry
- generated AsyncAPI drift fails QA immediately
- runtime producers and consumers must import the canonical async contract module instead of carrying a private channel manifest

## Capability Contract Registry

- Registry report: [capability-contract-registry.json](./capability-contract-registry.json)
- Human-readable registry: [capability-contract-registry.md](./capability-contract-registry.md)
- Generator/checker: [check-capability-contract.mjs](../../scripts/check-capability-contract.ts)
- Shared capability helper: [capability-contract-registry.mjs](../../packages/factory-core/src/capability-contract-registry.mjs)

### Purpose

Defines the fail-closed Phase 8.1 proof for reusable capability surfaces:

- every governed capability entrypoint is authored from a checked-in canonical capability contract source
- repo discovery fails closed if a new governed capability package appears without a registered contract source
- generated capability contract outputs are versioned and checked in
- package exports must point at the standard contract output instead of a private `capability.json` dialect
- graph and skill entrypoints declared in the contract must exist on disk and every governed graph under a capability package must be declared

## Capability Output Registry

- Registry report: [capability-output-registry.json](./capability-output-registry.json)
- Human-readable registry: [capability-output-registry.md](./capability-output-registry.md)
- Generator/checker: [check-capability-output-contract.mjs](../../scripts/check-capability-output-contract.ts)
- Shared capability helper: [capability-contract-registry.mjs](../../packages/factory-core/src/capability-contract-registry.mjs)

### Purpose

Defines the fail-closed Phase 8.2 proof for governed capability outputs:

- every governed capability event, artifact, and telemetry surface is declared in the canonical capability contract source
- graph capabilities declare explicit runtime telemetry expectations
- governed capability output refs must resolve onto standard CloudEvents, OCI artifact classes, or shared platform contract artifacts instead of private capability-local dialects
- fail-closed discovery rejects newly introduced governed output producer files, shared output-owner imports, direct output-ref emitters, or local capability artifact writers that are not registered in the output registry

## Capability Manifest Registry

- Registry report: [capability-manifest-registry.json](./capability-manifest-registry.json)
- Human-readable registry: [capability-manifest-registry.md](./capability-manifest-registry.md)
- Generator/checker: [check-capability-manifest-contract.mjs](../../scripts/check-capability-manifest-contract.ts)
- Shared capability helper: [capability-contract-registry.mjs](../../packages/factory-core/src/capability-contract-registry.mjs)

### Purpose

Defines the fail-closed Phase 8.3 proof for generated capability manifests:

- every governed capability publishes a generated `capability-manifest.v1.json` derived from the canonical capability contract source and checked-in package surfaces
- generated manifests stay aligned with governed contracts, event/artifact outputs, and package exports/files
- governed capability packages export the standard manifest surface instead of relying on a handwritten or private manifest dialect
- fail-closed discovery rejects manifest drift and rejects legacy handwritten manifest paths for governed capability packages

## Workflow Source Registry

- Registry report: [workflow-source-registry.json](./workflow-source-registry.json)
- Human-readable registry: [workflow-source-registry.md](./workflow-source-registry.md)
- JSON Schema: [workflow-source-module.v1.schema.json](./workflow-source-module.v1.schema.json)
- Governed handwritten-DOT debt inventory: [governed-execution-dot-exemptions.json](./governed-execution-dot-exemptions.json)
- Generator/checker: [check-workflow-source-contract.mjs](../../scripts/check-workflow-source-contract.mjs)
- Shared workflow-source helper: [workflow-source-registry.mjs](../../packages/factory-core/src/workflow-source-registry.mjs)

### Purpose

Defines the fail-closed Phase 9.1 proof for typed workflow source:

- migrated workflow families declare a schema-validated typed source module above generated runtime DOT IR
- active mothership execution graphs cannot remain handwritten once the migration ratchet claims them inside the governed active surface
- governed execution graphs under `factories/*/graphs/*.dot` and `packages/*/graphs/*.dot` must either declare `workflow_source` ownership or be explicitly listed in the exemption contract as temporary handwritten template surfaces
- typed workflow source contracts export deterministic JSON Schema for validation and generated-IR tooling
- source modules declare explicit source-mapping/debuggability rules back to runtime graph/node ids
- runtime graphs in migrated families must declare their canonical typed source through the `workflow_source` graph attribute instead of drifting behind parallel handwritten metadata

## Workflow IR Registry

- Registry report: [workflow-ir-registry.json](./workflow-ir-registry.json)
- Human-readable registry: [workflow-ir-registry.md](./workflow-ir-registry.md)
- JSON Schema: [workflow-ir-document.v1.schema.json](./workflow-ir-document.v1.schema.json)
- Generated IR documents: `docs/contracts/<factory_id>.<workflow_id>.workflow-ir.json`
- Current generated document set is enumerated by [workflow-ir-registry.json](./workflow-ir-registry.json) and [workflow-ir-registry.md](./workflow-ir-registry.md)
- Generator/checker: [check-workflow-ir-parity-contract.mjs](../../scripts/check-workflow-ir-parity-contract.mjs)
- Shared workflow-IR helper: [workflow-ir-registry.mjs](../../packages/factory-core/src/workflow-ir-registry.mjs)

### Purpose

Defines the fail-closed Phase 9.2 proof for deterministic generated runtime IR:

- governed factory execution DOT is generated runtime IR, not handwritten authoring input
- migrated workflow families treat checked-in DOT as generated runtime IR derived from typed workflow source
- active mothership execution families generate governed workflow IR documents plus publication-intent metadata instead of preserving a parallel handwritten-DOT authoring path
- generated runtime DOT and checked-in workflow IR documents stay in exact parity with the source modules
- compiled workflow IR declares the governed `workflow_ir_bundle` artifact class and publication-intent metadata instead of a private runtime-IR envelope; it is not yet a real governed publish/verify path and is therefore excluded from supported downstream lineage artifact classes
- the generation stack is intentionally narrow: deterministic source-to-DOT translation plus governed IR packaging, not a second orchestration runtime
- claim-truth and publication-state gates are explicit: `check-workflow-ir-claim-truth.mjs`, `check-workflow-ir-publish-or-plan-exclusive.mjs`, and `check-workflow-ir-runtime-parity-e2e.mjs`

## Factory Composition Registry

- Registry report: [factory-composition-registry.json](./factory-composition-registry.json)
- Human-readable registry: [factory-composition-registry.md](./factory-composition-registry.md)
- Generated factory manifests:
  - `factories/brainstorm/inventory/factory-composition-manifest.v1.json`
  - `factories/mothership/inventory/factory-composition-manifest.v1.json`
  - `factories/example-web/inventory/factory-composition-manifest.v1.json`
  - `factories/example-trading/inventory/factory-composition-manifest.v1.json`
- Generator/checker: [check-factory-composition-contract.mjs](../../scripts/check-factory-composition-contract.ts)
- Shared factory helper: [factory-composition-registry.mjs](../../packages/factory-core/src/factory-composition-registry.mjs)

### Purpose

Defines the fail-closed Phase 10 proof for factory authoring as composition plus
policy:

- every governed factory publishes a generated inspectable composition manifest
- factory bootstrap, policy, artifact-default, and telemetry-default surfaces stay explicit and typed
- thin-composition factories fail QA if private execution-graph glue reappears where shared capability composition should own the runtime path
- registry and per-factory manifest outputs drift deterministically when factory config or graph ownership changes
- planning stubs that do not ship a real factory bundle must say so explicitly instead of claiming nonexistent owned surfaces

## Reopened Phase Governance

- Audit report: [reopened-phase-governance.json](./reopened-phase-governance.json)
- Human-readable report: [reopened-phase-governance.md](./reopened-phase-governance.md)
- Generator/checkers: [check-legacy-pattern-zero-inventory.mjs](../../scripts/check-legacy-pattern-zero-inventory.ts), [check-governed-surface-totality.mjs](../../scripts/check-governed-surface-totality.ts), [check-claim-to-gate-mapping.mjs](../../scripts/check-claim-to-gate-mapping.ts)

## OpenLineage Registry

- Registry report: [openlineage-registry.json](./openlineage-registry.json)
- Human-readable registry: [openlineage-registry.md](./openlineage-registry.md)
- Sample projections: [openlineage-samples.json](./openlineage-samples.json)
- Sample projection notes: [openlineage-samples.md](./openlineage-samples.md)
- Generator/checker: [check-lineage-governance-contract.mjs](../../scripts/check-lineage-governance-contract.ts)
- Shared lineage helper: [openlineage-registry.mjs](../../packages/factory-core/src/openlineage-registry.mjs)

### Purpose

Defines the fail-closed Phase 11 proof for downstream lineage and governance:

- supported run classes publish canonical OpenLineage-compatible projections through the governed CloudEvents surfaces already on the execution plane
- supported governed OCI artifact classes expose stable projection ownership so downstream lineage, catalog, and audit consumers can attach without changing execution-plane behavior
- Marquez, Atlas, and similar governance systems remain downstream consumers rather than hot-path dependencies
- the lineage gate rejects duplicate projection-owner helpers outside the shared lineage surface and rejects hot-path governance dependencies in runtime code or control graphs
- supported classes also carry checked-in sample projections through `check-lineage-projection-presence.mjs`

## CloudEvents Registry

- Registry report: [cloudevents-registry.json](./cloudevents-registry.json)
- Human-readable registry: [cloudevents-registry.md](./cloudevents-registry.md)
- Governed payload schemas:
  - [hatch-run-lifecycle-event.v1.schema.json](./hatch-run-lifecycle-event.v1.schema.json)
  - [release-rollout-event.v1.schema.json](./release-rollout-event.v1.schema.json)
  - [wave-ready-lease-event.v1.schema.json](./wave-ready-lease-event.v1.schema.json)
- Governed AsyncAPI channels:
  - [hatch-run-lifecycle.asyncapi.v1.json](./hatch-run-lifecycle.asyncapi.v1.json)
  - [release-rollout-events.asyncapi.v1.json](./release-rollout-events.asyncapi.v1.json)
  - [wave-ready-lease.asyncapi.v1.json](./wave-ready-lease.asyncapi.v1.json)
- Generator/checker: [check-cloudevents-contract.mjs](../../scripts/check-cloudevents-contract.ts)
- Shared CloudEvents helper: [cloudevents-registry.mjs](../../packages/factory-core/src/cloudevents-registry.mjs)

### Purpose

Defines the fail-closed Phase 4 proof for governed domain and reactor event
surfaces:

- governed event producers emit CloudEvents instead of bespoke semantic envelopes
- governed payloads stay versioned and schema-backed through registered boundary outputs
- supported event channels stay covered by checked-in AsyncAPI documents
- repo discovery fails closed if a new CloudEvents authoring module appears outside the governed registry
- runtime producers and consumers must import the canonical CloudEvents contract module instead of carrying a private event envelope path

## OCI Artifact Taxonomy

- Taxonomy JSON: [oci-artifact-taxonomy.json](./oci-artifact-taxonomy.json)
- Human-readable taxonomy: [oci-artifact-taxonomy.md](./oci-artifact-taxonomy.md)
- Governed metadata schemas:
  - [workflow-ir-artifact-metadata.v1.schema.json](./workflow-ir-artifact-metadata.v1.schema.json)
  - [run-snapshot-artifact-metadata.v1.schema.json](./run-snapshot-artifact-metadata.v1.schema.json)
  - [judge-evidence-artifact-metadata.v1.schema.json](./judge-evidence-artifact-metadata.v1.schema.json)
  - [release-report-artifact-metadata.v1.schema.json](./release-report-artifact-metadata.v1.schema.json)
  - [release-bundle-artifact-metadata.v1.schema.json](./release-bundle-artifact-metadata.v1.schema.json)
  - [telemetry-summary-artifact-metadata.v1.schema.json](./telemetry-summary-artifact-metadata.v1.schema.json)
  - [contract-spec-artifact-metadata.v1.schema.json](./contract-spec-artifact-metadata.v1.schema.json)
- Generator/checker: [check-oci-artifact-contract.mjs](../../scripts/check-oci-artifact-contract.ts)
- Shared OCI helper: [oci-artifact-registry.mjs](../../packages/factory-core/src/oci-artifact-registry.mjs)

### Purpose

Defines the fail-closed Phase 5.x taxonomy and owner-surface proof for governed
durable artifact publication helpers, OCI-native attachment metadata, and
lifecycle policy modeling. This contract proves the canonical helper path,
schema/taxonomy registration, and ownership wiring; it does not by itself prove
repo-wide live publication, discovery, or lifecycle enforcement rollout:

- governed durable artifact classes are registered in one canonical OCI taxonomy
- canonical media types, naming/versioning rules, and typed metadata contracts
  are checked in for governed artifact classes
- repo discovery fails closed if a new governed OCI artifact class module
  appears outside the taxonomy
- repo discovery fails closed if a new governed OCI publication callsite appears
  outside the registered publisher set
- governed publication paths must route through the shared OCI helper surface
  instead of bespoke ORAS or private durable-store logic
- governed attachment relationships must use canonical OCI subject/referrer
  semantics instead of private `subject_id` or raw URL attachment models
- every governed durable artifact class carries one canonical lifecycle policy in
  the taxonomy
- governed lifecycle evaluation flows through the shared OCI helper surface
  instead of per-artifact retention scripts
- bespoke lifecycle fields on governed publisher paths fail QA unless they are
  derived from the shared lifecycle helper
- generated taxonomy and metadata-schema drift fails QA immediately

## Artifact Trust Registry

- Trust registry JSON: [artifact-trust-registry.json](./artifact-trust-registry.json)
- Human-readable registry: [artifact-trust-registry.md](./artifact-trust-registry.md)
- Generator/checker: [check-artifact-trust-contract.mjs](../../scripts/check-artifact-trust-contract.ts)
- Shared trust helper: [artifact-trust-registry.mjs](../../packages/factory-core/src/artifact-trust-registry.mjs)

### Purpose

Defines the fail-closed Phase 6 trust-surface proof for governed signing,
attestation, and provenance ownership. This contract proves the canonical trust
bundle surface and required trust-policy wiring; it does not by itself prove
that every required governed artifact class is already signed and verified in
live release/promotion flows:

- required governed artifact classes carry one canonical trust policy
- required governed artifact publishers must route through the shared trust
  helper surface instead of bespoke signature/provenance fields
- promotion/release verification boundaries are explicit and checked in for
  required governed artifact classes
- trust outputs standardize on Cosign-aligned signatures, in-toto/DSSE
  attestations, and SLSA provenance predicates
- repo governance fails closed if required governed trust flows stop importing
  the canonical trust helper or drift away from the standardized stack
- host runtime release boundaries use the same shared trust bundle surface
  instead of a parallel release-manifest signature dialect

## Reactor Dispatch Contract

- Contract JSON: [reactor-dispatch-contract.json](./reactor-dispatch-contract.json)
- Human-readable report: [reactor-dispatch-contract.md](./reactor-dispatch-contract.md)
- Generator/checker: [check-reactor-dispatch-contract.mjs](../../scripts/check-reactor-dispatch-contract.ts)
- Governed dispatch graph: `factories/mothership/graphs/factory_dispatch_reactor.dot`

### Purpose

Defines the fail-closed Phase 7.3 proof for narrow reactor-owned control-plane dispatch:

- mothership dispatch ownership is split from the maintenance supervisor tick
- governed completion reaction and dispatch retry/backoff live in the dedicated
  dispatch reactor graph
- the maintenance supervisor graph must not retain hot-path dispatch ownership
  or reclaim leasing/concurrency decisions
- legacy mothership `wave_dispatch.dot` is no longer an active governed
  surface, so the reactor is the only governed dispatch control-plane owner
- maintenance/review work remains outside the narrow dispatch reactor surface

## Dispatch Latency SLO Contract

- Contract JSON: [dispatch-latency-slo-contract.json](./dispatch-latency-slo-contract.json)
- Human-readable report: [dispatch-latency-slo-contract.md](./dispatch-latency-slo-contract.md)
- Generator/checker: [check-dispatch-latency-slo-contract.mjs](../../scripts/check-dispatch-latency-slo-contract.ts)
- Shared policy owner: `packages/factory-ops/src/lib/dispatch-slo-policy.ts`

### Purpose

Defines the fail-closed Phase 7.3 proof for bounded dispatch latency and
supervisor demotion:

- mothership declares an explicit dispatch latency budget in config
- maintenance runs on an explicit demoted cadence instead of every dispatch tick
- daemon runtime must route dispatch SLO checks and maintenance demotion through
  the shared policy owner instead of bespoke inline logic

## Host Runtime Release Contract

- Contract: `docs/contracts/host-runtime-release.json`
- Zod source: `packages/factory-ops/src/lib/host-runtime-release-schema.ts`
- Loader/validator: `packages/factory-ops/src/lib/host-runtime-release-contract.ts`
- Manifest command: `hatch-ops host runtime-release build|publish`

### Purpose

Defines the canonical host-runtime release artifact consumed by `hatch-host` and
managed factory kinds. This contract is distinct from
`docs/contracts/runtime-release-manifest.json`:

- `host-runtime-release.json` governs **runtime artifacts** (version,
  provenance, compatibility, installable artifact reference, channel metadata).
- `runtime-release-manifest.json` governs **package surface/version inventory**
  for external operators, including `externalSurface.packages`
  (`name|version|ownership|packageRepo|binEntrypoints`) and
  `externalSurface.stableEntryPoints` (documented CLI quickstarts + smoke checks).

### Required fields

Top-level required fields:

- `schema_version` (`host_runtime_release/v1`)
- `version`
- `channel` (`stable|canary|pinned`)
- `provenance`
- `compatibility`
- `artifactRef`
- `trust`
- `metadata`

Nested required fields include:

- `provenance.git_sha`, `provenance.build_timestamp`
- `compatibility.supported_kinds`, `compatibility.supported_platforms`
- `artifactRef.url`
- `trust.signature`, `trust.attestations`, `trust.verifications`
- `metadata.timestamp`

Guards must fail closed when any required field is missing.

## Managed Factory Mutation Policy

- Contract: `docs/contracts/managed-factory-mutation-policy.json`
- Loader/evaluator: `packages/factory-ops/src/lib/mutation-policy-contract.ts`
- Guard integration: `packages/factory-ops/src/lib/git-mutation-guard.ts`

### Purpose

Defines the deterministic mutation boundary matrix for managed factories across:

- `target_repo`
- `destination_repo`
- `control_plane_repo`
- `local_filesystem`

Each boundary declares:

- `allowed_operations`
- `forbidden_operations`
- explicit deny reasons (`reason`, `default_denied_reason`)

### Required context keys

The policy requires these mutation context keys:

- `target_repo`
- `destinations`
- `control_plane_repo`
- `instance_id`

Optional identity metadata:

- `kind_id`
- `host_id`

Guards must fail closed when required identity keys are missing or cannot be canonicalized.

### Canonicalization and boundary resolution

`evaluateManagedFactoryMutationPolicy()` canonicalizes repository identities using
`factory-repo-roles` (`buildFactoryRepoRoleContext`) before boundary matching.

Helper predicates are exported for reuse:

- `isHomeRepo()`
- `isDestination()`
- `isControlPlane()`
- `isLocalFilesystemPath()`

### Extending the policy

When adding operations or boundaries:

1. Update `managed-factory-mutation-policy.json` first.
2. Add/adjust evaluator tests in
   `packages/factory-ops/test/supervisor/mutation-policy-contract.unit.test.mjs`.
3. Add/adjust guard tests in
   `packages/factory-ops/test/supervisor/git-mutation-guard-role-boundary.unit.test.mjs`.
4. Keep deny reasons deterministic and stable (automation consumes them).

Do not add ad-hoc allow/deny logic in callers that bypasses this contract.

## Factory Label Contract

- Contract: `docs/contracts/factory-label-contract.json`
- Source of truth: `packages/factory-ops/src/lib/factory-label-contract.ts`
- Provision command: `hatch-ops label-provision`

### Managed-factory label scopes

Managed kinds publish deterministic label sets split by mutation boundary:

- `control_plane_labels`: includes `managed-factory-bug` and `kind:<kind_id>`
- `home_labels`: includes the managed `hatch:*` baseline for home repos

The snapshot includes these under `managed_factory_labels` with schema
`managed_factory_label_contract/v1`.

### Provisioning and validation flow

Use dry-run during onboarding or conformity checks:

```bash
hatch-ops label-provision \
  --factory-kind example-notes \
  --home-repo example-org/example-notes \
  --control-plane-repo recallnet/astrochicken \
  --dry-run
```

This command is fail-closed on:

- unknown/unsupported factory kinds
- repo boundary mismatches
- missing GitHub auth (`gh auth status`)

For live provisioning, remove `--dry-run`.
