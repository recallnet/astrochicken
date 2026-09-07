---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Canonical entrypoint playbook for creating/evolving/repairing Hatch factories; use docs/skills/factory-design/SKILL.md as the follow-up deep reference layer."
tags: [docs, factory-create-evolve, skill, skills]
written: "2026-03-08"
name: "factory-create-evolve"
description: "Start here first for bootstrap/evolve/repair execution flow, then use docs/skills/factory-design/SKILL.md for deeper invariant and contract reference details."
compatibility: "Claude Code or Cowork with hatch CLI, hatch-ops, and docs state checks."
---
# Factory Create/Evolve Skill

Use this as the **single executable playbook** for factory bootstrap, safe evolution, and deterministic repair.

Do not manually clone/copy another factory as the primary path. Start from `hatch factory init`, then evolve with explicit contracts.

## Backlog context (why this exists)

- **Goal #1566 (recovery from #1415):** prior decomposition closed early; this restores the missing factory-creation guidance slice.
- **Feature F-1:** this document must be executable and tied to live modules/functions (not stale manual scaffolding paths).

## When to use this skill

Use this skill when the request is to:
- bootstrap a new factory instance,
- evolve an existing factory's topology/config/contracts,
- repair drifted or broken factory scaffold outputs,
- re-run factory init with deterministic overwrite (`--force`) and revalidate contracts.

If the request is "create/evolve/repair a factory," use this skill first.

> **Immutable baseline (goal #1415 — do not reimplement).** The following deliverables were already shipped and must not be reimplemented or regressed:
> - `docs/skills/factory-create-evolve/SKILL.md` — this skill file as the canonical entrypoint.
> - `factories/_templates/factory/docs/factory-create-evolve.md.template` — scaffold template that references this skill.
> - `apps/hatch/src/factory/init.ts` + `apps/hatch/src/factory/scaffold.ts` — `hatch factory init` / `scaffoldFactory` pipeline.
> - `apps/hatch/src/factory/config-schema.ts` — typed factory config schema (`FACTORY_CONFIG_SCHEMA_VERSION`).
> - `apps/hatch/src/factory/conformance-harness.ts` — multi-phase conformance harness (`runFactoryConformanceHarness`).
>
> When extending this skill, build on these files — do not duplicate or replace them.

## Scope guard for this issue slice

This doc is intentionally self-contained for the current implementation slice. Keep this pass confined to this file unless a referenced command exposes a real contract break requiring a separate issue.

## Required inputs (CLI + module-consumed contract inputs)

`hatch factory init` parses CLI args first (`parseFactoryInitArgs`), then `initFactory` fans them into tracking issue resolution, scaffold rendering, policy-pack validation, and registry mutation.

| Input | Type / constraint | Primary consumer(s) | How the value is used |
|---|---|---|---|
| `--id <factory_id>` | required, `^[a-z0-9-]+$` | `parseFactoryInitArgs` (`apps/hatch/src/factory/init.ts`) | Drives factory root (`factories/<factory_id>`), trust domain defaults, runs path defaults, and registry id. |
| `--repo <owner/repo>` | required, must include `/` | `parseFactoryInitArgs`, `ensureFactoryTrackingIssue` (`tracking-issue.ts`), `updateFactoryRegistry` (`registry-update.ts`) | Used for tracking issue creation/listing, scaffolded `factory.config.json.target_repo`, and legacy registry factory repo mapping. |
| `--control-plane <owner/repo>` | required, must include `/` | `parseFactoryInitArgs`, `ensureFactoryTrackingIssue` (`tracking-issue.ts`) | Passed into tracking issue body/context and scaffolded `control_plane_repo`. |
| `--runs-dir <path>` | optional | `parseFactoryInitArgs`, `initFactory`, `scaffoldFactory` (`scaffold.ts`) | Materializes `runs_dir` in generated `factory.config.json`; defaults to `.hatch/<factory_id>/runs` when omitted. |
| `--root-dir <path>` | optional absolute-resolved path | `parseFactoryInitArgs`, `initFactory`, `scaffoldFactory`, `updateFactoryRegistry` | Sets repository root that contains `_templates`, output `factories/<id>`, and `factory-registry.json`. |
| `--force` | optional flag | `parseFactoryInitArgs`, `scaffoldFactory` | Allows overwrite of existing `factories/<factory_id>` tree when intentional. |
| tracking issue context (derived) | URL + number | `ensureFactoryTrackingIssue` (`tracking-issue.ts`) | Injected into scaffold template values (`tracking_issue_url`) before writing docs/config/skill files. |
| policy-pack documents (derived) | metadata + policy JSON | `loadPolicyPackDocuments` + `validatePolicyPackContract` (`policy-pack.ts`, re-exported via `config-schema.ts`) | Enforces required `shared.*` keys and valid `policyPack.overrides` before registry update. |

### Config contract expectation

Generated/edited `factories/<factory_id>/factory.config.json` must satisfy `FactoryConfigDocument` and parse via:
- `parseFactoryConfigDocument` in `apps/hatch/src/factory/config-schema.ts`
- (`validateFactoryConfigDocument` is the underlying validator)

`initFactory` also requires `policyPack` to be present and valid before final registry update.

## Canonical execution flow (bootstrap/evolve/repair)

### 1) Run init

```bash
hatch factory init \
  --id <factory_id> \
  --repo <owner/repo> \
  --control-plane <owner/repo> \
  [--runs-dir <runs_dir>] \
  [--root-dir <repo-root>] \
  [--force]
```

### 2) What `initFactory` writes and validates

`initFactory` in `apps/hatch/src/factory/init.ts` orchestrates this sequence:

1. Resolve/create tracking issue URL via `ensureFactoryTrackingIssue` (`apps/hatch/src/factory/tracking-issue.ts`).
2. Render/copy scaffold templates via `scaffoldFactory` (`apps/hatch/src/factory/scaffold.ts`).
3. Parse generated config via `parseFactoryConfigDocument` (`config-schema.ts`).
4. Load and validate policy pack via `loadPolicyPackDocuments` + `validatePolicyPackContract` (`apps/hatch/src/factory/policy-pack.ts`, re-exported in `config-schema.ts`).
5. Upsert `factory-registry.json` via `updateFactoryRegistry` (`apps/hatch/src/factory/registry-update.ts`).
   Managed cross-repo factories write `factories[].target_repo` and `instances[].control_plane_repo` + `instances[].target_repo`.

## Expected outputs (exact module contracts)

`initFactory` executes in this guaranteed order:
1. `ensureFactoryTrackingIssue` (`apps/hatch/src/factory/tracking-issue.ts`)
2. `scaffoldFactory` (`apps/hatch/src/factory/scaffold.ts`)
3. `parseFactoryConfigDocument` + `loadPolicyPackDocuments` + `validatePolicyPackContract` (`config-schema.ts` / `policy-pack.ts`)
4. `updateFactoryRegistry` (`apps/hatch/src/factory/registry-update.ts`)

### Files from `ScaffoldFactoryResult.writtenFiles`

`scaffoldFactory` returns a deterministic `writtenFiles` list containing the generated scaffold paths, including:
- `factories/<factory_id>/factory.config.json`
- `factories/<factory_id>/INTENT.md`
- `factories/<factory_id>/roles.stylesheet`
- `factories/<factory_id>/docs/factory-create-evolve.md`
- `factories/<factory_id>/graphs/factory_supervisor_tick.dot`
- `factories/<factory_id>/graphs/.gitkeep`
- `packages/factory-skills/skills/runtime/supervisor_review/SKILL.md`
- `factories/<factory_id>/scripts/factory_daemon.sh`
- `factories/<factory_id>/scenarios/<factory_id>/.gitkeep`
- `factories/<factory_id>/policy-pack/v1/metadata.json`
- `factories/<factory_id>/policy-pack/v1/supervisor-policy.json`
- `factories/<factory_id>/policy-pack/v1/reviewer-policy.json`
- `factories/<factory_id>/policy-pack/v1/model-policy.json`
- `factories/<factory_id>/policy-pack/v1/release-policy.json`
- `factories/<factory_id>/policy-pack/v1/escalation-policy.json`
- `factories/<factory_id>/policy-pack/v1/block-wait-retry-policy.json`

### Outputs from `FactoryInitResult`

- `factoryRoot` (resolved output root for `factories/<factory_id>`)
- `trackingIssue` (URL + number + created/reused status from `ensureFactoryTrackingIssue`)
- `registryPath` (`factory-registry.json` path updated by `updateFactoryRegistry`)
- `writtenFiles` (full scaffold artifact list above)

## Validation and check commands (required groups)

### 1) Init/scaffold tests

```bash
# Targeted factory init/scaffold coverage
pnpm test -- apps/hatch/src/factory/scaffold.test.ts apps/hatch/src/factory/init.test.ts apps/hatch/src/factory/conformance-harness.test.ts
```

Coverage includes: `parseFactoryInitArgs`, `initFactory`, `scaffoldFactory`, `parseFactoryConfigDocument`, `validatePolicyPackContract`, and `updateFactoryRegistry`.

### 2) Policy-pack contract test

```bash
pnpm test -- apps/hatch/src/factory/policy-pack-template.contract.test.ts
```

Coverage includes policy-pack template/schema alignment, including `config-schema.ts` policy-pack validation boundaries.

### 3) Docs governance checks

```bash
pnpm docs:check
pnpm docs:state:check
```

### 4) Graph validation/lint for scaffolded graph changes

```bash
hatch validate factories/<factory_id>/graphs/<graph>.dot
node scripts/lint-dot.mjs factories/<factory_id>/graphs/<graph>.dot
```

### Conformance harness

After `hatch factory init` and unit tests, run the conformance harness from `apps/hatch/src/factory/conformance-harness.ts`. This is the programmatic multi-phase correctness layer for scaffolded/evolved factories.

```ts
import { runFactoryConformanceHarness } from 'apps/hatch/src/factory/conformance-harness.js';
// or from the hatch package index:
// import { runFactoryConformanceHarness } from '<hatch-package>';

const result = await runFactoryConformanceHarness({
  factoryRoot: 'factories/<factory_id>',
  repoRoot: '.',
  // optionally target specific phases:
  // phases: ['config_schema', 'graph_validate'],
});

if (!result.ok) {
  console.error(result.first_failure);
}
```

Conformance phases (`FACTORY_CONFORMANCE_PHASES`):
- `config_schema` — validates generated `factory.config.json` against typed schema.
- `graph_validate` — parses/validates supervisor graph contract.
- `dot_lint` — enforces DOT lint/policy requirements on the supervisor graph.
- `recovery_ownership` — verifies reachable non-start nodes have valid recovery ownership metadata.
- `run_dir_isolation` — validates factory-scoped runtime path isolation for runs.
- `supervisor_tick_smoke` — executes the deterministic conformance smoke graph and verifies run artifacts.
- `operational_e2e` — proves the emitted smoke run is visible through `hatch-ops factory status` and `hatch-ops factory tick-status`.
- `ops_contract` — probes `hatch-ops`/`hatch runs` command contract surfaces for the factory.

## Common failure modes and deterministic repair patterns

| Symptom | Module + file | Deterministic repair command |
|---|---|---|
| `missing required --id`, `--repo must be owner/repo`, `unknown factory init flag` | `parseFactoryInitArgs` — `apps/hatch/src/factory/init.ts` | `hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo>` |
| `factory already exists: factories/<factory_id>` | `scaffoldFactory` — `apps/hatch/src/factory/scaffold.ts` | `hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo> --force` |
| `generated factory config is invalid (...)` | `parseFactoryConfigDocument` via `initFactory` — `apps/hatch/src/factory/config-schema.ts`, `apps/hatch/src/factory/init.ts` | `hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo> --force && pnpm test -- apps/hatch/src/factory/scaffold.test.ts apps/hatch/src/factory/init.test.ts` |
| `generated policy pack is invalid (...)`, `required key missing`, `overrides forbidden key` | `loadPolicyPackDocuments` + `validatePolicyPackContract` — `apps/hatch/src/factory/policy-pack.ts` | `hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo> --force && pnpm test -- apps/hatch/src/factory/policy-pack-template.contract.test.ts` |
| tracking issue query/create failure (`failed to query/create tracking issues via gh`) | `ensureFactoryTrackingIssue` — `apps/hatch/src/factory/tracking-issue.ts` | `gh auth status && hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo> --force` |
| `invalid factory registry document at <path>` | `updateFactoryRegistry` — `apps/hatch/src/factory/registry-update.ts` | `hatch factory init --id <factory_id> --repo <owner/repo> --control-plane <owner/repo> --force` |
| docs/frontmatter/link/state-machine contract failures | docs governance scripts (`scripts/docs-*`) | `pnpm docs:check && pnpm docs:state:check` |

### Conformance harness phase failures (symptom → repair)

| Phase | Symptom | Repair action |
|---|---|---|
| `config_schema` | Generated `factory.config.json` fails schema validation | Fix template values/placeholders, rerun `hatch factory init --force ...`, then rerun validation checks. |
| `graph_validate` | `factory_supervisor_tick.dot` fails `hatch validate`/graph parse contract | Fix DOT graph structure/contracts, rerun `hatch validate` + `node scripts/lint-dot.mjs`. |
| `dot_lint` | DOT lint emits blocking errors/warnings treated as failure | Fix DOT metadata/markup/lint violations, rerun `node scripts/lint-dot.mjs`. |
| `recovery_ownership` | Recovery ownership check reports reachable non-start nodes missing ownership metadata | Add/fix `# hatch:recovery-owner=supervisor` annotations (or approved recovery sink metadata) on affected nodes, rerun harness. |
| `run_dir_isolation` | Runs dir overlaps/violates factory isolation contract | Change `runs_dir` config to a factory-scoped path and re-init (`hatch factory init --force ...`). |
| `supervisor_tick_smoke` | Checkpointed supervisor smoke tick fails or no run artifacts emitted | Fix pipeline handler wiring, node outputs/contracts, then rerun smoke/harness. |
| `operational_e2e` | Smoke run is not visible through `hatch-ops factory status` / `tick-status` | Fix factory context wiring, runs-dir isolation, or operator surface projection until the emitted run is observable. |
| `ops_contract` | `hatch-ops`/`hatch runs` probe command contract fails | Fix ops CLI contract surface or factory config/runtime path wiring, then rerun harness. |

## Required response structure when using this skill

Return results in this exact order, with concrete data (not placeholders):

1. **Plan**
   - Include the actual execution sequence (`ensureFactoryTrackingIssue` → `scaffoldFactory` → config/policy-pack validation → `updateFactoryRegistry`).
2. **Commands**
   - Include full copy-pastable `hatch factory init ...` command plus the exact validation command sequence.
3. **Files touched / generated**
   - Include the concrete `FactoryInitResult.writtenFiles` artifact list and registry mutation path.
4. **Validation evidence**
   - Report which checks were run and passed (`scaffold/init tests`, `policy-pack-template.contract.test.ts`, `docs:check`, `docs:state:check`, and any `hatch validate`/`lint-dot` runs).
5. **Repair follow-ups (if anything failed)**
   - Map failures to the symptom→module→repair table above and include the next rerun command.

## Output structure required from this skill

When responding with this skill, return:

1. **Plan** — exact scaffold/evolution actions
2. **Commands** — copy-pastable `hatch factory init` + validation sequence
3. **Files touched** — expected generated/edited paths
4. **Validation evidence** — which checks passed/failed
5. **Repair follow-ups** — deterministic next steps for any failing gate

## Relationship to adjacent docs

- This skill is the **execution path** (bootstrap/evolve/repair/validate).
- [`docs/skills/factory-design/SKILL.md`](../factory-design/SKILL.md) is the **deep reference** for graph/role/invariant architecture details.
- [`docs/skills/factory-authoring/policy-pack.md`](../factory-authoring/policy-pack.md) remains the policy-pack schema/contract reference; do not duplicate that schema here.

## Relationship to factory-design skill

- Use this skill for execution flow (create/evolve/repair).
- Use [`docs/skills/factory-design/SKILL.md`](../factory-design/SKILL.md) as deep reference material for graph, role, and contract details.
