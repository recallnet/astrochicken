---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Canonical v1 boundary for standalone and managed Hatch factories."
tags: [contract, external-factory, factory, reference]
written: "2026-03-18"
---
# Factory Public Contract (v1)

<!-- mode-applicability-test -->

This is the canonical public contract for Hatch factories.

Machine-readable source of truth:
- `docs/contracts/factory-public-contract.v1.json`

Use this document to answer three boundary questions:
1. **What a standalone factory must provide**
2. **What Hatch guarantees and validates**
3. **What the managed control plane layers on top**

## Boundary model

- **Standalone public contract (required/optional):** fields and artifacts any external factory can use.
- **Hatch runtime guarantees:** schema validation, conformance phases, graph validation/lint, deterministic run artifacts.
- **Managed extensions:** additional identity, routing, telemetry, and daemon/release contracts used when mothership manages the factory.

## Mode applicability matrix (machine-readable)

The public contract includes a `mode_applicability` object in
`docs/contracts/factory-public-contract.v1.json`.

`mode_applicability` structure:
- `allowed_values`: enum of valid mode tags (`standalone`, `managed`, `both`)
- `config`: mode classification for each contract config key
- `env`: mode classification for environment keys used by factory/runtime surfaces
- `commands`: mode classification for lifecycle command families

Current command-family classification (copied from `mode_applicability.commands`):

| Command family | Mode |
| --- | --- |
| `hatch run` | `both` |
| `hatch validate` | `both` |
| `hatch factory conformance` | `both` |
| `hatch-ops factory status` | `both` |
| `hatch-ops factory tick-status` | `both` |
| `hatch-ops factory subscribe` | `both` |
| `hatch-ops factory host-*` | `managed` |
| `hatch-ops factory host-install` | `managed` |
| `hatch-ops factory host-start` | `managed` |
| `hatch-ops factory host-stop` | `managed` |
| `hatch-ops factory host-restart` | `managed` |
| `hatch-ops factory host-health` | `managed` |
| `hatch-ops factory host-version` | `managed` |
| `hatch-ops factory host-logs` | `managed` |
| `hatch-ops factory host-assign` | `managed` |
| `hatch-ops factory host-migrate` | `managed` |
| `hatch-ops factory host-drain` | `managed` |
| `hatch-ops factory host-assignment-status` | `managed` |

Detailed matrix and operator alignment notes:
- [Factory Mode Applicability (v1)](./factory-mode-applicability.md)
- [External factory operator onboarding runbook](../runbooks/external-factory-operator-onboarding.md)

Authoritative implementation + contract anchors:
- Runtime bootstrap/registry surface: `apps/hatch/src/factory/runtime-init.integration.test.ts`
- Shared harness owner: `apps/hatch/src/factory/conformance-harness.ts`
- CLI surface for harness execution: `apps/hatch/src/factory/conformance-cli.ts`
- Factory context resolution semantics: `packages/factory-ops/src/lib/factory-context-resolver.ts`
- Portability boundary tests: `apps/hatch/src/factory/external-factory-portability.contract.test.ts`
- Supervisor smoke context portability: `apps/hatch/src/factory/supervisor-snapshot-context-portability.contract.test.ts`

## Mode applicability matrix

`docs/contracts/factory-public-contract.v1.json` contains a machine-readable `mode_applicability` map and `mode_applicability_schema` metadata.

Interpretation rules:
- `both`: valid in standalone and managed mode.
- `managed`: valid only for managed control-plane operation.
- `standalone`: valid only for standalone operation.

Key families:
- `config.<key>`: config field mode for `factory.config.json`
- `env.<key>`: environment variable mode
- `command.<family>`: command family mode

Canonical command families currently pinned in the contract:
- `hatch run` -> `command.hatch.run` (`both`)
- `hatch validate` -> `command.hatch.validate` (`both`)
- `hatch factory conformance` -> `command.hatch.factory.conformance` (`both`)
- `hatch-ops factory status` -> `command.hatch_ops.factory.status` (`both`)
- `hatch-ops factory tick-status` -> `command.hatch_ops.factory.tick_status` (`both`)
- `hatch-ops factory subscribe` -> `command.hatch_ops.factory.subscribe` (`both`)
- `hatch-ops factory host-*` -> `command.hatch_ops.factory.host_*` (`managed`)

For the generated matrix and operator view, see:
- `docs/reference/factory-mode-applicability.md`
- `docs/runbooks/external-factory-operator-onboarding.md`

## Config

Contract owner: `apps/hatch/src/factory/config-schema.ts` (`validateFactoryConfigDocument`).

### Required (standalone)

- `schema` (`hatch.factory.config.v1`)
- `factory_id`
- `control_plane_repo`
- `dispatch` and `dispatch.graph`
- `pipeline` and `pipeline.supervisor_tick`
- `skills` and `skills.supervisor`
- `scenarios` and `scenarios.root`
- `runs_dir`
- `trust`, `trust.domain`, and non-empty `trust.roles`

### Optional (standalone)

- Identity input mode: `control_plane_repo` and `target_repo`
- Control-plane latency/cadence policy:
  - `dispatch.latency_slo_seconds`
  - `pipeline.maintenance_interval_seconds`
- Backend selection (defaults to GitHub):
  - `backend.type` (`github` or `local_fs`)
  - `backend.store_root` (required when `backend.type=local_fs`)
  - Env overrides: `HATCH_BACKEND_TYPE`, `HATCH_BACKEND_STORE_ROOT`
- `conformance` (`entrypoint`, `fixtures`, `smoke_graph`, `runs_dir`, benchmark telemetry options)
- `policyPack` (`version`, `overrides`)
- `isolation` (auth/model/provider/path overrides)
- `capabilities.goal_decomposition.timeouts.*`

### Managed-only extensions

These are allowed by schema but are managed-control-plane concerns:

- `managed`
- `kind_id`
- `instance_id`
- `destinations`
- `upstream_repo`
- `work_dir`
- `upstream_bug_labels`
- `slack_webhook_url`
- `canonical_checkout_path`
- `schedules`

### Config invariants

- Must declare both `control_plane_repo` and `target_repo`.
- `control_plane_repo` is the factory's control-plane repo and `target_repo` is the mutation repo; they may differ for cross-repo factories.
- `dispatch.graph` and `pipeline.supervisor_tick` are independent control-plane slots.
- Simple factories may point both fields at the same graph.
- Factories with a split hot path may use `dispatch.graph` for the narrow reactor and `pipeline.supervisor_tick` for maintenance/review ownership.
- When a split hot path is used, `dispatch.latency_slo_seconds` defines the bounded dispatch budget and `pipeline.maintenance_interval_seconds` demotes maintenance cadence away from the hot path.
- If `managed=true`, `upstream_repo` is required.
- Legacy aliases are forbidden: `repo`, `control_plane`, and root `goal_decomposition`.

## Graphs

Primary contract sources:
- `apps/hatch/src/factory/conformance-harness.ts`
- `apps/hatch/src/pipeline/validate.ts`

### Required (standalone)

- A supervisor graph at `pipeline.supervisor_tick`
- A dispatch graph at `dispatch.graph`
- Graph parses and passes `hatch validate`
- Graph passes DOT lint (`scripts/lint-dot.mjs`)
- Reachable non-start nodes expose recovery ownership metadata (conformance `recovery_ownership` phase)

### Optional (standalone)

- Additional deterministic capability subgraphs (invoked by pipeline nodes)

### Managed-only overlays

- Control-plane routing/release/daemon subgraphs used by mothership-managed runtime policies

## Scenarios

Contract owner: `apps/hatch/src/factory/scenario-root-contract.ts`.

### Required (standalone)

- `scenarios.root` points to deterministic scenario files owned by the factory.

### Optional (standalone)

- Any scenario tree layout under `scenarios.root` that remains deterministic and auditable.

### Managed-only overlays

- Managed factories still own scenario roots locally; managed mode does not move scenario ownership to control plane.

### Scenario invariant

- Non-mothership factories must not use reserved leaf `astrochicken` for `scenarios.root`.

## Policy packs

Contract owner: `apps/hatch/src/factory/policy-pack.ts` (loaded via config schema and conformance harness).

### Required (when `policyPack` is configured)

- `policy-pack/<version>/metadata.json`
- Policy files listed in metadata `files`
- Metadata `required_keys` must exist in policy documents

### Optional (standalone)

- `policyPack.overrides` only for metadata-declared `customizable_keys`

### Managed-only overlays

- Control-plane may apply stricter release/escalation expectations, but must still respect the same policy-pack contract surface.

## Conformance

Contract owner: `apps/hatch/src/factory/conformance-harness.ts`.

### Required for public certification paths

Run the shared harness phases:

- `config_schema`
- `intent_stack`
- `policy_pack_conformance`
- `graph_validate`
- `dot_lint`
- `recovery_ownership`
- `benchmark_telemetry`
- `run_dir_isolation`
- `skill_loading`
- `scenario_root`
- `supervisor_tick_smoke`
- `operational_e2e`
- `ops_contract`

### Optional (standalone)

- Factories may run subsets locally during iteration, but certification should run the full phase set.

### Managed-only overlays

- Managed environments may treat selected phase failures as rollout/release blockers.

## Runs and artifacts

Primary contract sources:
- `apps/hatch/src/factory/conformance-harness.ts`
- `scripts/factory-health-check.mjs`

### Required (standalone)

- `runs_dir` resolves to a factory-scoped path.
- Run-dir isolation checks pass (`run_dir_isolation` phase).
- Supervisor smoke tick emits run artifacts (including `state.json`).
- When `conformance.smoke_graph` is declared, conformance smoke phases must use that deterministic graph instead of the live supervisor tick path.

### Optional (standalone)

- `conformance.runs_dir` override
- `isolation.paths.*` overrides

### Managed-only overlays

- Daemon host/tick logs and health telemetry markers emitted by `scripts/factory-health-check.mjs`
- Managed control-plane health interpretation and release gating on top of shared harness results

## Managed extensions

Managed mode extends (does not replace) the standalone contract.

### Adds

- Managed identity (`kind_id`, `instance_id`, `managed`)
- Upstream + destination routing (`upstream_repo`, `destinations`)
- Managed execution surfaces (`work_dir`, `schedules`, notification fields)
- Control-plane operational constraints (release gating, daemon lifecycle, resume policy)

### Does not add

- A separate schema for baseline config, graphs, scenarios, policy packs, or conformance.
- Permission to use legacy config aliases or bypass deterministic validation phases.

## Contract enforcement

Current contract tests and command surfaces that pin this boundary:
- `apps/hatch/src/factory/public-factory-contract.contract.test.ts`
- `apps/hatch/src/factory/external-factory-portability.contract.test.ts`
- `apps/hatch/src/factory/supervisor-snapshot-context-portability.contract.test.ts`
- `apps/hatch/src/factory/runtime-init.integration.test.ts`
- `apps/hatch/src/factory/conformance-cli.ts`

Rule: standalone expectations must remain independent of managed-only behavior. Managed extensions may add stricter rollout/daemon gates, but they must not redefine required standalone config/graph/scenario/conformance contracts.

## Next steps

Use this document as the single source of truth for future onboarding/scaffolding/packaging updates. New surfaces should be added here first, then linked from templates/runbooks/examples and enforced by contract tests.

## Integration points

- Onboarding: `docs/runbooks/external-factory-operator-onboarding.md`
- Scaffolding guide template: `factories/_templates/factory/docs/factory-create-evolve.md.template`
- Conformance template: `factories/_templates/factory/conformance/README.md.template`
- Scaffolded config template: `factories/_templates/factory/factory.config.json.template`
- Examples index: `docs/examples/external-factories.md`
- Example factory README: `examples/external-factories/acme-support/README.md`
