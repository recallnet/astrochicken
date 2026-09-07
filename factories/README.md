# Factories

Each subdirectory is a factory instance: configuration, intent, and any local graphs, skills, and policies that Hatch executes as a software factory.

## Structure

```
factories/
  <id>/
    factory.config.json   # identity, target repo, capacity, model, dispatch graph
    INTENT.md             # mission, ownership boundaries, recovery doctrine
    kind.json             # factory kind definition
    instance.template.json
    env.contract.json     # env variables this factory reads
    .env.example          # generated from the env contracts
    inventory/            # composition manifest
    graphs/, workflows/   # local graphs (only when the shared runtime graphs are not enough)
    skills/               # local skill prompts and repo-specific review addenda
    scenarios/            # scenario registry for the target domain
    policy-pack/v1/       # policy overrides
  _shared/                # shared graph templates, prompts, and the roles stylesheet
  _templates/             # scaffold for new factories and the shared policy pack
  _runtime/               # runtime-shared skills
```

Most managed factories are config-only. They point `factory.config.json` at the shared managed-supervisor workflows in `packages/factory-runtime/` and keep nothing local beyond identity, intent, and env contracts.

## Validating and running a factory

Validate the shared managed-supervisor workflow that config-only factories dispatch:

```bash
node apps/hatch/dist/cli.js validate packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs
```

Resolve the intent stack (platform intent plus factory `INTENT.md`) that graph prompts consume:

```bash
node packages/factory-ops/src/cli.ts common resolve-intent-stack --factory-root factories/mothership
```

The conformance harness (`scripts/run-conformance-harness.mjs`) is the certification gate for a factory root: config schema, intent stack, graph validity, recovery ownership, policy pack structure, run-dir isolation, and a supervisor tick smoke run. `hatch run <workflow> --factory-root factories/<id>` executes a graph with that factory's identity and runtime paths. Long-running operation goes through the host runtime (`hatch-ops host *` and `hatch-ops factory host-*`). See [`docs/host-lifecycle.md`](../docs/host-lifecycle.md) and the [Factory Operator Guide](../docs/runbooks/factory-operator-guide.md).

## Creating a factory

```bash
node apps/hatch/dist/cli.js factory init --id <factory-id> --repo <owner/repo> --control-plane <owner/repo>
```

This generates `factories/<factory-id>/` from `factories/_templates/factory/` and registers the instance in `factory-registry.json`. The architect skill contract that scaffolds are expected to carry is described in [`docs/reference/factory-native-subagent-contract.md`](../docs/reference/factory-native-subagent-contract.md).

Regenerate a factory's `.env.example` after changing its env contract:

```bash
node scripts/check-factory-env-contracts.ts --write
```

## Factories in this repo

| Factory | Target | Role |
|---------|--------|------|
| `mothership/` | `recallnet/astrochicken` | Control-plane factory. Builds and operates the platform itself and reviews managed-factory proposals. |
| `example-trading/` | `example-org/example-trading` | Managed, config-only. Uses the shared managed-supervisor and software-delivery workflows. |
| `example-scanner/` | `example-org/example-scanner` | Managed, config-only. |
| `example-web/` | `example-org/example-web` | Managed, config-only, with a repo-specific code review addendum under `skills/`. |
| `brainstorm/` | `example-org/example-notes` | Managed. Turns `brainstorm`-labeled issues into review-ready goal issues. |

A minimal external example lives at [`examples/external-factories/acme-support/`](../examples/external-factories/acme-support/README.md).
