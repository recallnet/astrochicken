# Brainstorm Factory

Standalone factory bundle for deterministic brainstorm-intake orchestration.

## Purpose

This factory watches for open issues labeled `brainstorm`, invokes `@hatch/capability-brainstorming`, and outputs review-ready goal issues.

## Config

- Factory config: `factories/brainstorm/factory.config.json`
- Supervisor graph (entrypoint): `factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs`
- Shared shell: `packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs`
- Domain graph: `factories/brainstorm/workflows/dispatch-control/domain_brainstorm.workflow-source.mjs`
- Kind manifest: `factories/brainstorm/kind.json`
- Instance manifest template: `factories/brainstorm/instance.template.json`
- Runs dir: `.hatch/brainstorm/runs`

## Environment contract

- Factory env contract: `factories/brainstorm/env.contract.json`
- Generated example: `factories/brainstorm/.env.example`

`factories/brainstorm/.env.example` is the canonical operator bootstrap surface
for Example Notes-specific and shared runtime env.

## Target repo setup

In the target repository (`target_repo`), ensure the `brainstorm` label exists.
This is the intake repo scanned by `common resolve-gh-repo` in the brainstorm
supervisor graph.

```bash
gh label create brainstorm --repo example-org/example-notes --color 5319e7 --description "Brainstorm intake issue"
```

## Configure repo routing

Configure `factories/brainstorm/factory.config.json` (or set env overrides):

- `target_repo` (`HATCH_TARGET_REPO`) controls brainstorm intake.
- `control_plane_repo` (`HATCH_CONTROL_PLANE_REPO`) controls where
  `goal_issues` and `platform_incidents` are filed.

`common resolve-factory-config` also supports `HATCH_<UPPER_KEY>` overrides for
keys resolved through that command path.

Example personal-repo run:

```bash
HATCH_HOME_REPO=dtb/my-research \
HATCH_CONTROL_PLANE_REPO=dtb/my-research \
HATCH_CANONICAL_CHECKOUT_PATH="$(pwd)" \
  node packages/factory-ops/src/lib/daemon.mjs brainstorm
```

## Run on shared hatch-host runtime (`api_only`)

Brainstorm is operated through the shared host runtime (no per-factory plist).

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-ops factory host-install --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-start --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-host run --host-base-dir ~/.hatch-hosts --once
```

## Recovery (pause/resume + blocker cleanup)

Use this deterministic sequence when Example Notes is paused or blocked by stale runtime ownership:

```bash
hatch-ops factory host-health --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory recovery-sweep --factory-id brainstorm --runs-dir ~/.hatch-hosts/brainstorm/runs --stale-minutes 20 --apply true
hatch-ops factory host-start --factory-id brainstorm --host-base-dir ~/.hatch-hosts
hatch-ops factory host-logs --factory-id brainstorm --host-base-dir ~/.hatch-hosts --tail 200 --since-duration 1h
```

Recovery contract proof test:

```bash
node packages/factory-ops/test/supervisor/factory-host-lifecycle-cli.test.mjs --grep recovery
```

## Operator checks

```bash
hatch-ops factory status --factory-id brainstorm --json
hatch-ops factory tick-status --factory-id brainstorm
```

## First-run walkthrough

1. Create an issue with label `brainstorm` in home repo.
2. Wait for supervisor tick to pick it up.
3. Capability graph runs red/blue deliberation.
4. A goal issue is created.
5. Brainstorm issue is closed with backlink to the created goal issue.

## Validate this bundle

```bash
hatch validate factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs
node scripts/lint-dot.mjs factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs
node --test packages/factory-ops/test/brainstorm-factory-bundle.contract.test.mjs
```
