# AstroChicken

Hatch is a DOT-based pipeline runner for AI workflows, plus software-factory graphs built on top of it.

## Monorepo Layout

- `apps/hatch/` — Hatch CLI/runtime (DOT parser, graph engine, handlers, server)
- `packages/tsconfig/` — shared TS config
- `factories/` — factory instances (`graphs/`, `skills/`, `scripts/`, `contexts/`)
- `docs/` — architecture / vision / roadmap docs

## Current Factories

- `factories/mothership/` — active factory targeting `recallnet/astrochicken`
- `factories/_templates/` — scaffolding templates

## Key Commands

From repo root:

- Build all: `turbo run build`
- Dev: `turbo run dev`
- Test (fast local path): `pnpm test`
- Strict local proof: `pnpm test:strict`
- Repo contract suites only: `pnpm test:repo`
- Docs governance gate: `pnpm docs:check`
- State-machine docs contract: `pnpm docs:state:check`
- Run a pipeline: `hatch run <file.dot>`
- Validate a pipeline: `hatch validate <file.dot>`

## Pre-Commit Gate Contract (Operator + Contributor Reference)

Pre-commit runs deterministic DOT/docs preflight, then non-test quality gates (`build`, runtime startup probe, `typecheck`), then conditional test suites.

Canonical full routing matrix, trigger rules, telemetry lines, troubleshooting table, and drift-control checklist:

- `docs/architecture/pre-commit-gates.md`

**Non-negotiable:** if pre-commit tests fail, fix the failing tests/code and re-run; never bypass QA gates.

## Pre-Merge Gate (PR Backstop)

PRs run whole-repo QA (`pnpm qa:pre-merge`) plus strict factory health checks.

Full policy and gate composition:

- `docs/architecture/pre-commit-gates.md`

## Pre-Push Gate (Final Safety Net)

Pushes to `main` run platform invariants (when triggered), `build`, startup probe, and both suites before allowing push.

Full policy and bypass semantics:

- `docs/architecture/pre-commit-gates.md`

## Hatch Runtime Architecture

- Pipeline flow: DOT parse → graph model → `Engine` dispatches node handlers.
- Handlers live in `apps/hatch/src/pipeline/handler/`.
- `agent.worktree` spawns coding agents in isolated git worktrees.
- `pipeline` handler composes subgraphs.
- `tool` handler runs deterministic shell/python tasks.

### Adding a Handler

1. Implement `Handler` from `apps/hatch/src/pipeline/engine.ts`
2. Register in `apps/hatch/src/pipeline/handler/register.ts`

## Mothership Factory Notes (`factories/mothership/`)

Full supervisor tick reference:

- `docs/factory-supervisor-tick.md`

Main orchestration graphs:

- `factory_supervisor_tick.dot`
- `goal_queue.dot`
- `goal_run.dot`
- `wave_dispatch.dot`
- `wave_execute.dot`

Primary ops commands:

- `hatch-ops factory status [--factory-id <id>]`
- `hatch-ops factory tick-status [--factory-id <id>]`
- `hatch-ops factory subscribe [--target <next-goal-progress|next-issue|next-review|next-merge|next-release-report>] [--timeout N] [--summary-window-minutes N]`

## Factory Monitoring

Use first-party ops CLI commands for monitoring, not ad-hoc shell polling:

- `hatch-ops factory status --json`
- `hatch-ops factory tick-status`
- `hatch-ops factory subscribe`

Full daemon setup, subscription workflow, and execution rules:

- `docs/host-lifecycle.md`
- `docs/agent-runbooks/daemon-operations.md`

## Operator Monitoring Protocol

Operator behavior is expectation-driven: snapshot state, form explicit expectations, compare outcomes, and route failures through supervisor-owned repair.

Canonical protocol:

- `docs/factory-supervisor-tick.md`
- `docs/host-lifecycle.md`

## Conventions

- TypeScript + ESM
- Prefer explicit interfaces at module boundaries
- Pass dependencies explicitly; avoid hidden global state
- Keep deterministic logic in scripts/tools/ops runtime, not large inline prompt blobs
- Keep workflows rerunnable/idempotent where practical
- Use GitHub native `blocked-by` / `blocks` issue relationships (not labels)
- **Code decision context:** Use `@context` tags ([codecontext](https://github.com/recallnet/codecontext)) to annotate non-obvious decisions in code. Report tooling issues: `gh issue create -R recallnet/codecontext`
  - Required for:
    - critical decision logic and invariants
    - security-sensitive behavior and hard-won security lessons
    - external integration quirks, undocumented API behavior, and contract mismatches
    - regression guards and valuable debugging learnings that explain why a simpler-looking change would be wrong
  - Preferred forms: `@context:decision`, `@context:security`, `@context:integration`, `@context:learning`, `@context:regression`
  - Mark truly load-bearing notes with `!critical`
  - Keep them short and specific: what is true, why it matters, and what would break if changed
  - Example: `// @context:decision !critical — strict > not >= because equality means no edge remains`
  - Do not use `@context` for obvious code narration or generic comments

## Execution Expectations

- If a run fails, continue with the next diagnostic/fix step automatically.
- Prioritize end-to-end completion over partial analysis.
- Fix known blockers immediately; do not loop on status narration.
- Use first-party ops CLI (`factory status`, `factory tick-status`, `factory subscribe`) for introspection.
- **Always commit your work** after implementation changes.
- **Never skip QA.** If tests fail, fix them.
- **Agents must never use `SKIP_TESTS`.**

## First-Principles Factory Design (Non-Negotiable)

Design for root-cause elimination and durable autonomy: deterministic invariants, clear ownership of state transitions, bounded failure handling, regression gates, and recurrence telemetry.

Canonical doctrine and detailed rules:

- `docs/factory-design-principles.md`

**Inline rules that always apply:** gates before fixes (install the failing gate first), never skip QA, and always commit completed work.

## V0 Over Backward Compatibility / No Legacy

Prefer clean replacement over compatibility debt.

- Never use feature flags, dark launches, compatibility shims, or dual old/new code paths.
- Replace old interfaces atomically, update all callers, and delete legacy code in the same change.
- Full policy: `docs/factory-design-principles.md`

## Related Systems

- Scenarios registry: resolve from factory config `scenarios.root`
- Replay target repo: <https://github.com/example/external-factory>
