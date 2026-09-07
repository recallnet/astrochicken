---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-24"
status: "active"
summary: "Canonical contract for the required factory-native architect subagent and scaffold adoption expectations."
tags: [contract, factories, governance, subagents]
written: "2026-03-07"
---
# Factory-native architect subagent contract

This document is the canonical policy for architect subagents in Hatch factories.

## Why this is required

Issue [#1318](https://github.com/recallnet/astrochicken/issues/1318) defines this as a factory-completeness requirement: AstroChicken is not complete if it only has DOT graphs and prompts but no first-principles architectural owner inside the factory itself.

The canonical mothership repository slug is `recallnet/astrochicken`.

A factory-native architect subagent is non-optional because it is the component that:

- keeps DOT workflows, handler capabilities, and ops commands aligned,
- converts recurring operator/manual cleanup into deterministic product behavior,
- enforces the first-principles contract from `AGENTS.md` (invariants, ownership, deterministic recovery, telemetry, and regression gates),
- ensures each new factory starts with the same architecture and validation discipline.

Without this role, scaffolds drift into prompt-only automation without the deterministic controls Hatch requires.

## Required subagent shape

The architect subagent must be installed as a factory artifact under `factories/<factory>/skills/` and must have explicit identity and purpose:

- **Identity**: Hatch factory architect (system designer for DOT + runtime + ops + docs contracts).
- **Purpose**: design, audit, and evolve factories so behavior is deterministic, testable, and restart-safe.

Required capabilities:

1. **DOT graph architecture**: design/modify workflows in `factories/<factory>/graphs/*.dot`, including bounded retries, idempotent routing, and explicit failure paths.
2. **Hatch runtime integration**: reason about handler contracts and graph execution semantics in `apps/hatch/src/pipeline/`.
3. **Ops command productization**: replace repeated shell spelunking with deterministic commands in `factories/<factory>/ops/src/commands/`.
4. **Docs and contract updates**: update policy/runbook docs and keep scaffold docs synced with runtime behavior.
5. **Gate/test ownership**: add or update the deterministic gate that would have caught each discovered failure mode.
6. **First-principles reasoning**: perform root-cause analysis (minimum three layers of why) and design the preventive invariant, not just cleanup steps.

Deterministic behavior requirements:

- never rely on hidden mutable global state,
- never bypass required validation flow,
- always emit concrete artifacts/commands that can be re-run,
- prefer typed ops/CLI contracts over large inline shell/prompt glue.

## Required context sources (deterministic loading)

Before proposing architecture changes, the subagent must load this minimum context set (paths are mandatory and explicit):

1. `AGENTS.md`
2. `apps/hatch/src/cli.ts`
3. `apps/hatch/src/pipeline/engine.ts`
4. `apps/hatch/src/pipeline/parse.ts`
5. `apps/hatch/src/pipeline/validate.ts`
6. `apps/hatch/src/pipeline/graph.ts`
7. `apps/hatch/src/pipeline/handler/register.ts`
8. Representative handlers in `apps/hatch/src/pipeline/handler/` (at minimum: `tool.ts`, `pipeline.ts`, `worktree.ts`, `fan_out_dynamic.ts`, `manager.ts`)
9. `factories/mothership/graphs/*.dot`
10. `packages/factory-ops/src/**/*.mjs`
11. `docs/skills/factory-design/SKILL.md`
12. `docs/skills/factory-design/templates/` (all template/reference files)

If Hatch architecture moves these files, update this contract and the architect artifact in the same change.

## Required playbooks / recipes

### Create a factory

1. Scaffold from `factories/_templates/`.
2. Install architect artifact in the new factory `skills/` directory (copy canonical source `factories/mothership/skills/hatch_factory_architect`).
3. Create/adjust factory graphs under `factories/<factory>/graphs/` and ensure they map to runtime handler capabilities.
4. Add deterministic ops commands under `factories/<factory>/ops/src/commands/` for required introspection/remediation paths.
5. Document factory contracts (README/runbook/skill interface) including required validation commands.

### Add or modify a handler

1. Implement/update handler logic in `apps/hatch/src/pipeline/handler/<name>.ts`.
2. Register handler in `apps/hatch/src/pipeline/handler/register.ts`.
3. Validate graph usage against handler semantics (`apps/hatch/src/pipeline/engine.ts`, `apps/hatch/src/pipeline/validate.ts`).
4. Update factory graph usage and docs when behavior changes.

### Modify a graph safely

1. Edit the target graph in `factories/mothership/graphs/` (or `factories/<factory>/graphs/`).
2. Ensure node outputs/edges are deterministic and idempotent.
3. Validate graph syntax and lint contract for every touched graph.
4. Update related docs/contracts if control flow or ownership changes.

### Redesign a stuck workflow from first principles

1. Capture symptom with run/node evidence.
2. Perform three-layer why analysis.
3. Define the missing invariant + single owner for the state transition.
4. Add the gate/test that fails before the fix.
5. Implement deterministic fix in graph/runtime/ops path.
6. Re-run validation suite and document the new invariant.

### Turn shell spelunking into an ops CLI command

1. Identify repeated manual lookup (logs/state/triage).
2. Implement command in `packages/factory-ops/src/commands/`.
3. Expose command through `packages/factory-ops/src/cli/commands/` and `packages/factory-ops/src/cli.ts`.
4. Add command tests in `packages/factory-ops/test/`.
5. Replace ad-hoc runbook shell snippets with the new command.

## Completion and validation contract

Architect work is complete only when required validations pass for touched scope.

Mandatory command checklist:

1. For each affected DOT graph:
   - `hatch validate <graph.dot>`
   - `node scripts/lint-dot.mjs <graph.dot>`
2. Docs contract:
   - `pnpm docs:check`
   - `pnpm docs:state:check`
3. Repository quality gates:
   - `pnpm build`
   - `pnpm typecheck`
4. Path-routed suites (run when matching paths are touched):
   - `pnpm test:guard-gates`
   - `pnpm test:wave-claim-gates`

Completion is blocked by any failing command above. No manual override path is allowed in this contract.

## Extension boundaries and anti-patterns

The architect subagent must never:

- introduce unchecked inline scripts in DOT prompts where deterministic ops/runtime code is required,
- rely on ad-hoc global mutable state outside explicit artifacts/context/GitHub state,
- bypass documented validation flow (`hatch validate`, DOT lint, docs checks, build/typecheck, routed suites),
- expand scope into unrelated refactors without an explicit invariant/contract reason.

Scope rule: implement the minimum architectural change that closes the identified invariant gap, plus the deterministic gate that prevents recurrence.

## Factory completeness invariant

A Hatch factory is complete only when all of the following exist together:

1. **Workflows/graphs**: runnable DOT control flows (for example supervisor tick, goal queue/run, wave dispatch/execute) under `factories/<factory>/graphs/`.
2. **Ops/introspection commands**: deterministic operator commands under `factories/<factory>/ops/src/commands/` and surfaced by the factory CLI.
3. **Docs/contracts**: maintained operational and architectural contracts (`AGENTS.md`, factory README/runbooks, this architect-subagent contract).
4. **Tests/gates**: enforced validation/test gates (DOT validation + lint, docs checks, build, typecheck, routed suites).
5. **Factory-native architect subagent**: at least one architect skill artifact under `factories/<factory>/skills/` responsible for first-principles system design.

If any component is missing, factory setup is incomplete.

## Adoption plan for scaffolding and templates

Scaffolding policy (applies to `factories/_templates/` now and `factory init` later):

1. `_templates` must include architect skill installation in `skills/`.
2. The installed artifact must be copied/generated from canonical source path `factories/mothership/skills/hatch_factory_architect`.
3. `factory init` must emit the architect artifact by default (no opt-out path).
4. Scaffold docs must include the same required validation checklist from **Completion and validation contract**:
   - `hatch validate <graph.dot>`
   - `node scripts/lint-dot.mjs <graph.dot>`
   - `pnpm docs:check`
   - `pnpm docs:state:check`
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm test:guard-gates` (when touched paths require it)
   - `pnpm test:wave-claim-gates` (when touched paths require it)
5. Add future contract enforcement tests/validation harness so scaffold output fails if the architect artifact is missing or validation checklist documentation is absent.

This adoption plan is mandatory for every new factory copy, including future generator-based flows.
