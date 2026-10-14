# Astrochicken

Astrochicken is an experimental software-factory reference implementation. It is preserved for study, not offered as a maintained hosted service. Its tests and recorded operation do not establish reliable autonomous delivery or reduced engineering cost.

Astrochicken runs software factories. A factory is a control loop that reads goals from GitHub issues, decomposes them into implementation issues, dispatches coding agents into isolated git worktrees, reviews the results, and merges what passes. Hatch, the runtime at the center of the repo, executes workflow graphs written in DOT. LLM nodes propose changes. Deterministic nodes run the tests and decide what moves forward.

State lives in GitHub (issues, labels, milestones, pull requests) and in a Postgres event store, so a crashed process picks up where it left off on the next tick.

## Layout

| Path | Contents |
|------|----------|
| `apps/hatch/` | Hatch runtime: DOT parser, graph engine, node handlers, CLI (`hatch`), HTTP server, conformance harness |
| `packages/factory-ops/` | Operator CLI (`hatch-ops`) and the deterministic action owners that graphs call during a run |
| `packages/factory-core/` | Shared contracts, schemas, and registries used by the runtime and ops packages |
| `packages/factory-runtime/` | Shared managed-supervisor workflows and scenarios for managed factories |
| `packages/factory-runtime-guard/` | Mutation and boundary enforcement for factory runtime paths |
| `packages/factory-telemetry/` | Event bus, Langfuse integration, and quality scoring |
| `packages/github-adapter/` | The one place that talks to GitHub |
| `packages/capability-*/` | Reusable capability packages: goal decomposition, coding, merge, wave dispatch, release reporting, brainstorming, product judge, artifact ingestion, software development, foreman |
| `packages/factory-prompts/`, `packages/factory-skills/` | Prompt templates and skill contracts attached to LLM nodes |
| `factories/` | Factory instances. Each one is config plus intent plus optional local graphs and skills. See [`factories/README.md`](factories/README.md) |
| `examples/external-factories/` | A minimal external factory (`acme-support`) that shows the public install contract |
| `docs/` | Architecture, contracts, runbooks, and skill references. Start at [`docs/INDEX.md`](docs/INDEX.md) |
| `scripts/` | Repo quality gates, docs governance checks, and the pre-commit gate runner |
| `config/testing/` | Test manifests, suite routing, and ownership maps consumed by the gates |
| `factory-registry.json` | Registry of factory instances and the graphs they dispatch |

## Requirements

- Node `>=22.18.0` (see `engines` in `package.json`)
- pnpm `10.32.1` (see `packageManager`)
- git and the GitHub CLI (`gh`) for anything that touches a repo
- Postgres for the canonical event store when running a factory. A compose file lives at `packages/factory-ops/config/postgres/canonical-event-store.compose.yml`. The runtime reads `HATCH_CANONICAL_EVENT_STORE_URL`; `.envrc` shows the local wiring.
- LLM provider credentials in the environment. Each factory publishes the variables it reads in `factories/<id>/.env.example`, generated from `factories/<id>/env.contract.json` and `config/testing/factory-env/shared-env.contract.json`.

## Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` runs `turbo run build` across the workspace. `pnpm typecheck` and `pnpm lint` run the TypeScript and ESLint gates.

## Test

Package suites run through Turbo. Filter to the packages you are working on:

```bash
pnpm exec turbo run test --filter=@hatch/factory-core --filter=@hatch/github-adapter
```

Repo-level contract tests live under `scripts/` and run with `node --test`. The full local gate set is described in [`docs/architecture/pre-commit-gates.md`](docs/architecture/pre-commit-gates.md).

Docs are governed like code. `pnpm docs:check` validates the docs policy, frontmatter, link graph, and regenerates `docs/INDEX.md`.

## Run a graph

Validate a workflow graph:

```bash
node apps/hatch/dist/cli.js validate apps/hatch/examples/hello.dot
```

`node apps/hatch/dist/cli.js --help` lists the run, resume, trace, and inspection commands. Running a graph with LLM nodes needs provider credentials in the environment.

Operator commands live in `hatch-ops`:

```bash
node packages/factory-ops/src/cli.ts factory status -h
```

## Operating boundaries

Factory graphs can run shell commands and coding agents, push code, merge pull requests, and mutate GitHub issues. Run only graphs and repositories you trust, using isolated development infrastructure and credentials scoped to those repositories. The supplied `mothership` configuration records Recall's original deployment; review and replace its repository, host, and telemetry settings before running a factory. Do not start it against the original organization as part of setup.

The HTTP server and operator tools are privileged control surfaces. Hostless server addresses bind to loopback by default. Explicit remote bindings remain unauthenticated; place them behind authenticated private networking. The included local Postgres credentials are development defaults, not credentials for a hosted service.

Historical failures included broken observability, split GitHub/database lifecycle state, and unbounded merge-resolution sessions. The implementation is useful to study those tradeoffs; it is not a security boundary for untrusted agents.

## How a factory works

One cycle of the loop is a supervisor tick:

```
read GitHub state (goals, issues, milestones, waves)
  -> queue ready goals
  -> decompose goals into implementation issues
  -> dispatch waves of issue executions
  -> for each issue: code in a worktree -> review -> merge
  -> write results back to GitHub
```

Builders and judges run in separate execution contexts with different information access. The builder sees the spec. The judge sees the scenarios. A deterministic gate parses the verdict.

Every factory bundles the same parts:

| Part | What it is |
|------|-----------|
| Config | `factory.config.json`: identity, target repo, capacity, model and provider settings, policy version |
| Intent | `INTENT.md`: mission, ownership boundaries, escalation and recovery posture |
| Graphs | Workflow definitions. Most factories reuse the shared runtime graphs in `packages/factory-runtime/` |
| Skills | Prompt and interface contracts for LLM nodes |
| Scenarios | Test and validation registries for the target domain |
| Policies | Supervision, review, model selection, release gating, escalation, and retry rules |

The `mothership` factory targets this repository and acts as the control plane. Managed factories run from their own checkouts, target other repositories, and escalate platform defects back to mothership through labeled issues.

## Key docs

| Doc | What it covers |
|-----|----------------|
| [Vision](docs/vision.md) | The thesis behind deterministic factories and the kernel/userland split |
| [Factory Design Principles](docs/factory-design-principles.md) | Root-cause elimination, gates before fixes, crash resilience |
| [Factory Supervisor Tick](docs/factory-supervisor-tick.md) | The tick, phase by phase |
| [Factory Operator Guide](docs/runbooks/factory-operator-guide.md) | Create, run, monitor, recover, and upgrade a factory |
| [Host Lifecycle](docs/host-lifecycle.md) | Running several factories on one machine |
| [Factory Internals](docs/architecture/factory-internals.md) | How the runtime, ops, and factory definitions fit together |
| [Policy Pack Contract](docs/skills/factory-authoring/policy-pack.md) | Platform-owned versus factory-owned policy keys |
| [Langfuse KPI Queries](docs/langfuse-kpis.md) | Telemetry metadata and query recipes |
| [Pre-Commit Gates](docs/architecture/pre-commit-gates.md) | The commit, push, and merge gate contract |

Agent-facing conventions for working in this repo are in [`AGENTS.md`](AGENTS.md).

## License

MIT. See [`LICENSE`](LICENSE).
