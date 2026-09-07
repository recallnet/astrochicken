---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Operator-first onboarding and day-2 runbook for managed external factories, from bootstrap through upgrade/resume."
tags: [external-factory, onboarding, operations, runbook]
written: "2026-03-09"
name: "External factory operator onboarding runbook"
description: "Linear operator workflow for bootstrap, daemon health, triage, recovery, and control-plane upgrade/resume decisions."
---
# External factory operator onboarding runbook

This is the canonical operator path for a first external factory: bootstrap -> daemon -> health checks -> triage -> recovery -> upgrade/resume.

Factory boundary contract (required reading before bootstrap):
- [Factory Public Contract (v1)](../reference/factory-public-contract.md)
- [Factory mode applicability matrix](../reference/factory-mode-applicability.md)
- Machine-readable form: [`docs/contracts/factory-public-contract.v1.json`](../contracts/factory-public-contract.v1.json)
- Mode matrix reference: [Factory Mode Applicability (v1)](../reference/factory-mode-applicability.md)
- CLI mode orientation: `hatch help modes`

Mode source-of-truth:
- this runbook’s mode labels are derived from `docs/contracts/factory-public-contract.v1.json#mode_applicability`

## 0) Mode choice first: standalone or managed

Pick mode before running lifecycle commands.

| Mode | Operator responsibilities | Prerequisites | First commands |
| --- | --- | --- | --- |
| `standalone` | Run pipelines/conformance directly in one repo/workspace. | `hatch` installed, repo-local `factory.config.json` contract fields, DOT graph validates. | `hatch validate <graph.dot>` -> `hatch run <graph.dot>` |
| `managed` | Everything in standalone **plus** host lifecycle, control-plane routing, resume/release gates. | `hatch` + `@hatch/factory-ops`, GitHub auth for target+control-plane repos, managed identity fields (`instance_id`, `kind_id`, destinations/host wiring). | `hatch-ops factory fleet-status --json` -> `hatch-ops factory attention --json` -> `hatch-ops factory host-install --factory-id <id>` -> `hatch-ops factory host-start --factory-id <id>` |

Mode source of truth note:
- Use `mode_applicability` in `factory-public-contract.v1.json` as the canonical classification for config/env/command applicability.

Boundary classification for this runbook:
- **Required public:** bootstrap config prerequisites, supervisor graph validation, conformance/state checks, and factory-scoped run artifact handling.
- **Optional public:** local wrappers/automation around `hatch validate`, `hatch run`, and shared conformance flows.
- **Managed-only:** daemon lifecycle controls and host orchestration commands (`hatch-ops factory host-*`, release-targeting/resume gates).

The canonical public install contract is maintained in `docs/reference/snippets/external-install-contract.md`. Keep the section below synchronized verbatim with that snippet.

<!-- public-contract -->
<!-- external-install-contract:copied-from=docs/reference/snippets/external-install-contract.md -->

## Public install contract

Required packages:
- `hatch` — required package; provides the `hatch` binary for runtime/conformance commands.
- `@hatch/factory-ops` — required package; provides the `hatch-ops` binary for operator/runtime status and recovery commands.
- `@hatch/replay` — optional package for replay/lab workflows; not required for baseline external factory installs.
- Internal-only surfaces: `apps/*` and private `packages/*` implementation tooling are not part of the external install contract.

| Stable entrypoint | Owning binary/package | Intended persona | Install smoke check |
| --- | --- | --- | --- |
| `hatch run <file.dot>` | `hatch` (`hatch`) | External adopter | `hatch run --help` |
| `hatch validate <file.dot>` | `hatch` (`hatch`) | External adopter | `hatch validate --help` |
| `hatch factory conformance` | `hatch` (`hatch`) | External adopter | `hatch factory conformance --help` |
| `hatch-ops factory status` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory status --help` |
| `hatch-ops factory tick-status` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory tick-status --help` |
| `hatch-ops factory recovery-sweep` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory recovery-sweep --help` |

This block is the public install contract for docs and generated quickstarts. Include tooling is not available in this docs stack, so update `docs/reference/snippets/external-install-contract.md` first, then copy this block verbatim into each consumer document/template.

For deep implementation background, use (do not duplicate):
- External-factory rollout/onboarding references from goal [#1523](https://github.com/recallnet/astrochicken/issues/1523) and [external factory examples](../examples/external-factories.md)
- Release-manifest lifecycle references from goal [#1511](https://github.com/recallnet/astrochicken/issues/1511) and [Factory Supervisor Tick Reference](../factory-supervisor-tick.md)
- Certification/readiness criteria from goal [#1495](https://github.com/recallnet/astrochicken/issues/1495)
- Managed home-repo deterministic provisioning command: [Managed factory onboarding (home-repo bootstrap)](./managed-factory-onboarding.md)

## 1) Bootstrap

1. **Prerequisites**
   - From the external factory repo root, install runtime packages: `pnpm install hatch @hatch/factory-ops`
   - `gh auth status` passes for both target repo + control-plane repo access
   - Factory config exists (`factory.config.json`) and satisfies the public contract (`factory_id`, `control_plane_repo`, and `target_repo`)

2. **Verify installation**
   - Run a zero-exit smoke command:
     ```bash
     hatch-ops --help
     ```
   - Expected: help text printed, exit 0. If this fails, verify `node_modules/.bin/hatch-ops` exists after `pnpm install`.

3. **Validate the supervisor graph before first run**
   - Run:
     ```bash
     hatch validate <path-to-factory-supervisor-tick.dot>
     ```
   - CLI entry and validator dispatch live in [`apps/hatch/src/cli.ts`](../../apps/hatch/src/cli.ts) (`cmdValidate` -> `validate(...)`).

4. **Confirm resolved factory context (factory_id + repo wiring)**
   - Run:
     ```bash
     hatch-ops factory status --json
     ```
   - Check `context.factory_id`, `context.target_repo`, `context.control_plane_repo`, and `context.runs_dir`.
   - Context precedence/normalization is implemented in [`packages/factory-ops/src/lib/factory-context-resolver.ts`](../../packages/factory-ops/src/lib/factory-context-resolver.ts).

## 2) Daemon lifecycle (managed-only)

Use the supported host lifecycle commands:

```bash
hatch-ops factory host-install --factory-id <factory-id>
hatch-ops factory host-start --factory-id <factory-id>
hatch-ops factory host-health --factory-id <factory-id>
hatch-ops factory host-stop --factory-id <factory-id>
```

Expected log/liveness paths:
- `.hatch/hosts/<factory-id>/logs/daemon.log` (or your configured host base dir)
- `.hatch/hosts/<factory-id>/logs/tick-*.log`

Expected run-state paths (repo-local factory scope):
- `mothership` -> `.hatch/mothership/runs`
- `example-trading` -> `.hatch/example-trading/runs`

Healthy daemon signals:
- `hatch-ops factory fleet-status --json` shows both `mothership` and `example-trading`
- `hatch-ops factory attention --json` isolates only the factories that need immediate operator action
- `hatch-ops factory tick-status --factory-id mothership` and `--factory-id example-trading` show current/recent tick movement
- `hatch-ops factory status --factory-id example-trading --json` resolves example-trading context/runs independently
- `hatch-ops factory subscribe --factory-id example-trading` waits for the next meaningful event and summarizes recent activity first

Target worktree expectation:
- managed tick contexts must execute `agent.worktree` activity against the factory `work_dir` from `factory.config.json` (not the astrochicken repo root).

## 3) Status and health checks (mode: both)

Start every operator pass with the fleet summary, then drill down.

Use these commands together (implementation files included for traceability):

- `hatch-ops factory fleet-status [--json]`
  - CLI: [`packages/factory-ops/src/cli/commands/factory-status-cmds.mjs`](../../packages/factory-ops/src/cli/commands/factory-status-cmds.mjs) (`FactoryFleetStatusCommand`)
  - Logic: [`packages/factory-ops/src/commands/factory-fleet-status.ts`](../../packages/factory-ops/src/commands/factory-fleet-status.ts)
  - Use for: enabled/disabled fleet inventory, top-level KPIs, per-factory health rows, recent outcome totals

- `hatch-ops factory attention [--json]`
  - CLI: [`packages/factory-ops/src/cli/commands/factory-status-cmds.mjs`](../../packages/factory-ops/src/cli/commands/factory-status-cmds.mjs) (`FactoryAttentionCommand`)
  - Logic: [`packages/factory-ops/src/commands/factory-attention.ts`](../../packages/factory-ops/src/commands/factory-attention.ts)
  - Use for: actionable factories only, with summarized attention reasons and the same fleet KPI window

- `hatch-ops factory status [--json]`
  - CLI: [`packages/factory-ops/src/cli/commands/factory.mjs`](../../packages/factory-ops/src/cli/commands/factory.mjs) (`FactoryStatusCommand`)
  - Logic: [`packages/factory-ops/src/commands/factory-status.ts`](../../packages/factory-ops/src/commands/factory-status.ts)
  - Use for: active/completed/failed runs, managed state classification, control-plane resume gate, blocked control-plane items

- `hatch-ops factory tick-status [--json]`
  - CLI: [`packages/factory-ops/src/cli/commands/factory.mjs`](../../packages/factory-ops/src/cli/commands/factory.mjs) (`FactoryTickStatusCommand`)
  - Logic: [`packages/factory-ops/src/commands/factory-tick-status.ts`](../../packages/factory-ops/src/commands/factory-tick-status.ts)
  - Use for: current supervisor stage (`[N/total]`), elapsed time, active child run context

- `hatch-ops factory subscribe [--target <next-goal-progress|next-issue|next-review|next-merge|next-release-report>] [--timeout N] [--summary-window-minutes N]`
  - CLI: [`packages/factory-ops/src/cli/commands/factory.mjs`](../../packages/factory-ops/src/cli/commands/factory.mjs) (`FactorySubscribeCommand`)
  - Logic + semantic event taxonomy (`next-goal-progress|next-issue|next-review|next-merge|next-release-report`, plus raw lifecycle filters when explicitly requested): [`packages/factory-ops/src/commands/factory-subscribe.ts`](../../packages/factory-ops/src/commands/factory-subscribe.ts)
  - Use for: developer/operator monitoring with recent summary + one-shot wait for the next meaningful event

- `hatch-ops factory outcomes --repo <owner/repo> --lookback-hours <n>`
  - CLI: [`packages/factory-ops/src/cli/commands/factory.mjs`](../../packages/factory-ops/src/cli/commands/factory.mjs) (`FactoryOutcomesCommand`)
  - Logic: [`packages/factory-ops/src/commands/factory-outcomes.ts`](../../packages/factory-ops/src/commands/factory-outcomes.ts)
  - Use for: shipped outcomes (merged PRs, closed issues), not stage activity

`hatch validate`/`hatch run` command surfaces are also registered in [`apps/hatch/src/cli.ts`](../../apps/hatch/src/cli.ts).

## 4) Triage: local vs control-plane

Use this decision tree from observable signals only:

1. **Control-plane blocked?** (`hatch-ops factory status --json`)
   - If `managed_state.health_classification=control_plane_blocked` **or** `control_plane.can_resume=false` with reasons like:
     - `release_not_promoted_to_general`
     - `release_rollout_blocked`
   - Then: **wait/escalate to mothership control plane**, do not local-patch product code first.

2. **Local runtime unhealthy?** (`factory status` + `factory subscribe`)
   - If `failed` rises and status emits `failed|guarded|guarded_terminal|blocked|terminal`, or subscribe shows repeated `next-issue`/`next-review` failures without control-plane blocker:
   - Then: **fix locally** (graph/config/test/runtime for your factory).

3. **Factory making progress?** (`factory subscribe` + `factory outcomes`)
   - If `factory subscribe` keeps timing out or only surfaces low-signal churn while `factory outcomes` shows no merged/closed work: treat as local incident until proven otherwise.

Graph-level invariant references used above:
- [`factories/mothership/graphs/goal_execute.dot`](../../factories/mothership/graphs/goal_execute.dot) exports goal-scoped execution control.
- [`factories/mothership/graphs/factory_supervisor_tick.dot`](../../factories/mothership/graphs/factory_supervisor_tick.dot) carries wait/recovery ownership via supervisor-controlled sinks and action-item routing.

Context docs for interpreting state transitions:
- [`docs/state-machines.md`](../state-machines.md)
- [`docs/factory-supervisor-tick.md`](../factory-supervisor-tick.md)
- [`docs/runbooks/factory-operator-guide.md`](./factory-operator-guide.md)

## 5) Recovery controls

Supported operator controls (safe surface area):
- `hatch validate <file.dot>`
- `hatch run <file.dot>`
- `hatch-ops factory status --json`
- `hatch-ops factory tick-status`
- `hatch-ops factory subscribe [--target ...]`
- `hatch-ops wave create-ready --repo <owner/repo> --selected-waves '["<milestone>"]' --cooldown-minutes 0`

**Forbidden:** manual edits to `.hatch/<factory_id>/runs/*/state.json`.
This is explicitly prohibited in [`AGENTS.md`](../../AGENTS.md) (operator protocol and monitoring rules).

When ticks look stuck:
1. Open a short subscription window first:
   ```bash
   hatch-ops factory subscribe --timeout 600
   ```
2. Re-check snapshots:
   ```bash
   hatch-ops factory status --json
   hatch-ops factory tick-status
   ```
3. If wave marker scheduling is missing, recreate ready marker deterministically with `wave create-ready`.

## 6) Upgrade and resume (managed overlays)

Use release-manifest gating, not manual resume guesses.

1. **Inspect manifest gate state**
   - `hatch-ops factory status --json` -> `control_plane.manifest`, `control_plane.resume_reason`, `control_plane.resume_when`

2. **Evaluate resume eligibility against release manifest policy**
   - Command surface: `hatch-ops factory resume-gate ...`
   - CLI path: [`packages/factory-ops/src/cli/commands/factory.mjs`](../../packages/factory-ops/src/cli/commands/factory.mjs) (`FactoryResumeGateCommand`)
   - Logic: [`packages/factory-ops/src/commands/factory-resume-gate.ts`](../../packages/factory-ops/src/commands/factory-resume-gate.ts)

3. **Apply operator lifecycle actions only after gate is ready**
   - `hatch-ops factory resume --factory-id <id> --reason "resume after manifest gate ready"`
   - Control-state mutations (`pause|quarantine|retry|unblock|resume`) are defined in the same CLI module and backed by `factory-control-state` logic.

4. **Track rollout channel health during upgrades**
   - `hatch-ops factory release-targeting-status --json`
   - Use this to confirm canary/general channel posture before broad resume.

Deep dives (source-of-truth references):
- Goal [#1511](https://github.com/recallnet/astrochicken/issues/1511) release-manifest lifecycle contract
- Goal [#1495](https://github.com/recallnet/astrochicken/issues/1495) certification/readiness gate
- Goal [#1523](https://github.com/recallnet/astrochicken/issues/1523) rollout/onboarding references
