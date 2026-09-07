# Example Web Factory

Managed factory bundle in `recallnet/astrochicken`, targeting `example-org/example-web`.

This factory follows the config-only managed pattern (shared runtime graphs, no factory-local graph/workflow/policy-pack/script wrappers).

## Core bundle surfaces

- Factory config: `factories/example-web/factory.config.json`
- Entry graph: `packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs`
- Domain graph: `packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs`
- Managed identity manifests: `factories/example-web/kind.json`, `factories/example-web/instance.template.json`
- Env contract: `factories/example-web/env.contract.json`

## Required env contract

Factory env is governed by `factories/example-web/env.contract.json` (plus shared env contract fields).

At minimum, configure:

- `HATCH_CANONICAL_CHECKOUT_PATH` (required)

Bootstrap from:

```bash
cp factories/example-web/.env.example .env
# fill required values
```

## Required QA contract

Example Web execution/review paths must run:

```bash
npm run qa
```

The command is exported by `managed_software_delivery_domain.dot` as both `integration_command` and `review_qa_command`.

## AGENTS guidance ingestion contract

`managed_software_delivery_domain.dot` loads example-web repo governance context on every tick:

- `AGENTS.md`
- `AGENT-LEARNINGS.md`

Supervisor and coding/review prompts must treat these as immutable guidance inputs.

## Host readiness (managed runtime)

Canonical host lifecycle references:

- [`docs/host-lifecycle.md`](../../docs/host-lifecycle.md)
- [`docs/runbooks/external-factory-operator-onboarding.md`](../../docs/runbooks/external-factory-operator-onboarding.md)

Readiness command sequence:

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-ops factory host-install --factory-id example-web --host-base-dir ~/.hatch-hosts
hatch-ops factory host-start --factory-id example-web --host-base-dir ~/.hatch-hosts
hatch-ops factory host-health --factory-id example-web --host-base-dir ~/.hatch-hosts
```

Expected readiness signals:

- `workspace_mode: "checkout"`
- target work dir from config: `/path/to/example-web`
- host-start returns `status: "started"` with `message: "factory_host_started"`
- host-health returns `status: "running"` with `running: true`

## Supervisor tick proof command

Use the factory-scoped tick-status command to verify supervisor tick execution:

```bash
hatch-ops factory tick-status --factory-id example-web
```

## Monitoring workflow (snapshot → subscription → snapshot)

Use the managed monitoring loop:

1. Snapshot now:

```bash
hatch-ops factory status --factory-id example-web --json
hatch-ops factory tick-status --factory-id example-web
```

2. Wait for next meaningful change:

```bash
hatch-ops factory subscribe --factory-id example-web
```

3. Snapshot + outcomes check:

```bash
hatch-ops factory status --factory-id example-web --json
hatch-ops factory tick-status --factory-id example-web
hatch-ops factory outcomes --repo example-org/example-web --lookback-hours 1 --json
```

4. Use targeted waits as needed:

```bash
hatch-ops factory subscribe --factory-id example-web --target next-review
hatch-ops factory subscribe --factory-id example-web --target next-merge
```

Repeat from step 1.

## Validation commands

Core factory validation flow:

```bash
hatch-ops factory validate --factory-root factories/example-web
node scripts/run-conformance-harness.mjs --factory-root factories/example-web --repo-root /path/to/astrochicken --runs-dir .hatch/example-web/runs
```

Additional contract checks:

```bash
pnpm factory:health --factory-root factories/example-web
node scripts/check-managed-factory-config-surfaces.mjs --require-instances
node --test packages/factory-ops/test/commands/example-web-factory-bundle.contract.test.mjs
```

Use the `pnpm factory:health --factory-root ...` form exactly (no extra `--` separator).
