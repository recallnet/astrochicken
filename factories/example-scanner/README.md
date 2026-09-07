# Example Scanner Factory

This factory intentionally owns config and intent only.

Factory-local owned surfaces:

- `INTENT.md`
- `README.md`
- `factory.config.json`
- `kind.json`
- `instance.template.json`
- `.env.example`
- `env.contract.json`

Shared execution surfaces:

- `packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs`
- `packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs`
- `packages/factory-runtime/scenarios/managed_software_delivery`
- `packages/factory-skills/skills/runtime/supervisor_review/SKILL.md`

Deliberately absent:

- `factories/example-scanner/graphs/`
- `factories/example-scanner/workflows/`
- `factories/example-scanner/scripts/`
- `factories/example-scanner/skills/`
- `factories/example-scanner/scenarios/`
- `factories/example-scanner/policy-pack/`
- `factories/example-scanner/roles.stylesheet`

## Required env

- Factory env contract: `factories/example-scanner/env.contract.json`
- Generated example: `factories/example-scanner/.env.example`

`factories/example-scanner/.env.example` is the canonical operator bootstrap surface
for Example Scanner-specific and shared runtime env.

## Host runtime lifecycle

Example Scanner is operated through the shared host runtime with an explicit `checkout`
workspace contract.

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-ops factory host-install --factory-id example-scanner --host-base-dir ~/.hatch-hosts
hatch-ops factory host-start --factory-id example-scanner --host-base-dir ~/.hatch-hosts
hatch-ops factory host-health --factory-id example-scanner --host-base-dir ~/.hatch-hosts
```

Expected installation contract:
- `workspace_mode: "checkout"`
- `work_dir: "/path/to/example-scanner"`
- installation manifest path: `.hatch/hosts/example-scanner/installation.json`

Do not run ad-hoc `nohup` loops or factory-specific daemon wrappers. The shared
host runtime owns lease tracking and lifecycle policy.

For monitoring and operator procedures, use:
- [`docs/runbooks/external-factory-operator-onboarding.md`](../../docs/runbooks/external-factory-operator-onboarding.md)

## Runtime boundaries

- Host repo (factory assets + run state): `recallnet/astrochicken`
- Target repo (agent worktrees + git operations): `/path/to/example-scanner`
- Run state dir (host repo): `.hatch/example-scanner/runs`

Ownership split:
- Shared managed runtime owns lifecycle, lease, blocker gates, run-summary telemetry, and software-delivery orchestration.
- Example Scanner owns only identity, target-repo config, destinations, env contract, and schedule/config knobs.

Run the managed supervisor directly through the shared graph:

```bash
hatch run packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs --factory-root factories/example-scanner
```

Validate the shared runtime surfaces:

```bash
hatch validate packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs
hatch validate packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs
node scripts/lint-dot.mjs packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs
node scripts/lint-dot.mjs packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs
```

## E2E operator checklist

1. Create a goal issue in `example-org/example-scanner`:
   ```bash
   gh issue create --repo example-org/example-scanner --title "Goal: <your goal>" --label goal --label ready --body "<goal body>"
   ```
2. Observe tick progress:
   ```bash
   hatch-ops factory tick-status --factory-id example-scanner
   hatch-ops factory status --factory-id example-scanner
   ```
3. Watch for execution and merge outcomes:
   ```bash
   hatch-ops factory subscribe --factory-id example-scanner --target next-goal-progress --timeout 1800
   ```
4. Verify fleet visibility:
   ```bash
   hatch-ops factory status
   ```

## Upstream escalation smoke procedure

1. Create a simulated infra bug in `recallnet/astrochicken`:
   ```bash
   gh issue create --repo recallnet/astrochicken \
     --title "Simulated infra bug for example-scanner escalation test" \
     --label managed-factory-bug --label "factory:example-scanner" \
     --body "Simulated upstream bug to test managed factory blocking behavior."
   ```
2. Confirm block behavior:
   ```bash
   hatch-ops factory tick-status --factory-id example-scanner
   ```
3. Close the simulated bug:
   ```bash
   gh issue close <issue-number> --repo recallnet/astrochicken
   ```
4. Confirm resume behavior on next tick:
   ```bash
   hatch-ops factory tick-status --factory-id example-scanner
   ```
