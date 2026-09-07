# AstroChicken

Hatch is a DOT-based pipeline runner for AI workflows, plus software-factory
graphs built on top of it.

## Monorepo Layout

- `apps/hatch/` — Hatch CLI/runtime (DOT parser, graph engine, handlers,
  server)
- `packages/tsconfig/` — shared TS config
- `factories/` — factory instances (`graphs/`, `skills/`, `scripts/`,
  `contexts/`)
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
- Duplication scan (prod + tests): `pnpm cpd:ci --silent`
- Duplication scan (prod only): `pnpm cpd --silent`
- Duplication scan (tests only): `pnpm cpd:tests --silent`
- Run a pipeline: `hatch run <file.dot>`
- Validate a pipeline: `hatch validate <file.dot>`

Factory-focused checks:

- Ops/spec tests: `node --test packages/factory-ops/test/*.test.mjs`
- Validate mothership graphs:
  `for f in factories/mothership/graphs/*.dot; do hatch validate "$f" && node scripts/lint-dot.mjs "$f"; done`

Docs CI safety net:

- Workflow: `.github/workflows/docs-quality.yml`
- Deterministic command sequence: `pnpm docs:check` then
  `pnpm docs:state:check`
- Runbook: `docs/governance/docs-quality-runbook.md`

Docs freshness policy:

- Governed docs carry `written`, `reviewed`, `review_policy`, and `status`
  frontmatter.
- Active docs default to weekly review (`review_policy: "periodic-7"`).
- Generated, codebound, and historical docs are the explicit exceptions.
- Stale-doc enforcement is a strict pre-commit gate, not a pre-push backstop.
- When refreshing many docs, stagger `reviewed` dates unless you intentionally
  want them to expire together later.

If an agent changes files, it must commit those changes before ending the task
unless the user explicitly says not to commit.

## Codecontext

Use `@context` tags to capture non-obvious local decisions directly in code.
This repo ships the Codecontext CLI and ESLint plugin, so annotation hygiene is
part of normal engineering work, not optional commentary.

Use inline `@context` when:

- the decision is local to the code you are touching
- the code looks simpler than the real constraint
- a regression, invariant, or integration quirk would be easy to miss later

Preferred forms:

- `@context:decision`
- `@context:security`
- `@context:integration`
- `@context:learning`
- `@context:regression`

Guidelines:

- Keep annotations short and specific: what is true, why it matters, and what
  would break if changed.
- Mark truly load-bearing notes with `!critical`.
- Do not use `@context` for obvious narration or generic comments.
- `refs` are optional unconstrained pointers, not a required schema.

Use `factories/*/contexts/` when:

- the guidance is broader than one file or one line of code
- the context is durable factory operating guidance or narrative background
- multiple workflows or modules need the same explanation

Codecontext workflow:

- Before editing critical files: `pnpm exec codecontext --scope <file>`
- After editing: `pnpm exec codecontext --diff HEAD <file>`
- For repo or factory orientation: `pnpm exec codecontext --report`

Treat `0 entries` from `--scope` on non-obvious code as a signal to consider
whether the file is under-annotated.

## Hatch Runtime

- Pipeline flow: DOT parse → graph model → `Engine` dispatches node handlers.
- Handlers live in `apps/hatch/src/pipeline/handler/`.
- `agent.worktree` spawns coding agents in isolated git worktrees.
- `pipeline` handler composes subgraphs.
- `tool` handler runs deterministic shell/python tasks.

### Adding a Handler

1. Implement `Handler` from `apps/hatch/src/pipeline/engine.ts`
2. Register in `apps/hatch/src/pipeline/handler/register.ts`

## Factory Overview

Primary mothership references:

- Full supervisor tick reference:
  `docs/factory-supervisor-tick.md`
- Main orchestration graphs:
  - `factory_supervisor_tick.dot`
  - `goal_queue.dot`
  - `goal_run.dot`
  - `wave_dispatch.dot`
  - `wave_execute.dot`

Primary ops commands:

- `hatch-ops factory fleet-status [--json]`
- `hatch-ops factory attention [--json]`
- `hatch-ops factory status [--factory-id <id>]`
- `hatch-ops factory tick-status [--factory-id <id>]`
- `hatch-ops factory subscribe [--target <next-goal-progress|next-issue|next-review|next-merge|next-release-report>] [--timeout N] [--summary-window-minutes N]`
- `hatch-ops factory inspect-canonical [--json]`
- `hatch-ops wave split-results`
- `hatch-ops wave handle-review-failures`
- `hatch-ops goal build-milestone-comment`
- `hatch-ops packet list [--state <state>] [--type <type>] [--limit N] [--json]`

## Monitoring Protocol

The factory daemon and event subscription are the primary monitoring tools.
Always keep them running when the factory is active.

### Running the Daemon

Factory daemons run through the shared host runtime. Use the `hatch-ops`
host lifecycle commands rather than ad-hoc process wrappers:

```bash
hatch-ops host install-runtime --host-base-dir ~/.hatch-hosts --host-id <host-id>
hatch-ops factory host-install --factory-id <id> --host-base-dir ~/.hatch-hosts
hatch-ops factory host-start --factory-id <id> --host-base-dir ~/.hatch-hosts
hatch-ops factory host-health --factory-id <id> --host-base-dir ~/.hatch-hosts
```

Logs live under `~/.hatch-hosts/<factory-id>/logs/` (`daemon.log` for tick
summaries, `tick-*.log` per tick).

Do not start the daemon with ad-hoc `nohup` commands, and do not restart it
just to pick up code changes. The daemon pulls new commits at the start of
each tick. See `docs/host-lifecycle.md` for the full layout.

### Event Store: Live vs Test

The canonical event store uses Postgres. Keep two separate databases:

- **Live** — the daemon reads `HATCH_CANONICAL_EVENT_STORE_URL` from its
  environment (see `.envrc` and the factory env contracts). Never point tests
  at it.
- **Test** — tests use their own connection strings via test fixtures. The
  test harness creates isolated databases per test.

If you're debugging a live issue, read from the live database but do not
write test data to it. If you need to test event store behavior, use the
test fixtures which create disposable databases.

### Monitoring Workflow

Use this fleet-summary-plus-semantic-subscription loop. Do not replace it with
ad-hoc shell polling, registry parsing, or raw event spam.

1. Snapshot fleet state now:
   ```bash
   hatch-ops factory fleet-status --json
   hatch-ops factory attention --json
   ```
2. Drill into a specific factory only when the fleet summary says it needs attention:
   ```bash
   hatch-ops factory status --factory-id <id> --json
   hatch-ops factory tick-status --factory-id <id>
   ```
3. Wait for the next meaningful change:
   ```bash
   hatch-ops factory subscribe
   ```
4. Snapshot fleet and outcomes again:
   ```bash
   hatch-ops factory fleet-status --json
   hatch-ops factory attention --json
   hatch-ops factory outcomes --repo recallnet/astrochicken --lookback-hours 1 --json
   ```
5. Wait for a specific target when needed:
   ```bash
   hatch-ops factory subscribe --target next-review
   hatch-ops factory subscribe --target next-merge
   ```
6. Repeat from step 1.

Monitoring rules:

- Start with `factory fleet-status` and `factory attention`, then use
  `factory status`, `factory tick-status`, `factory subscribe`, and
  `factory outcomes` for drill-down; if those are insufficient, improve the
  CLI instead of scripting around it.
- `hatch-ops factory fleet-tui` is the interactive operator surface. Its first
  tab is the stable primary view: posture, the live supervisor/goal/issue
  hierarchy when present, recent host activity, and attention context.
- `factory subscribe` defaults to a 30 minute one-shot semantic wait with a recent summary window; use raw `--event` streaming only for low-level debugging.
- Never claim monitoring is running unless a foreground subscription command is
  actually active.
- Judge progress by shipped outcomes: merges, closed issues, and completed work,
  not stage churn.
- If repeated windows show no shipped outcomes, treat that as an incident and
  root-cause it.

## Design Principles

- Prefer first-principles fixes over cleanup loops. Repeated cleanup is a design
  defect until proven otherwise.
- Repeated transport, boundary, normalization, or contract logic belongs in the
  owning shared surface, not in one more local helper.
- Add the gate first, then fix the bug. Every regression should become a test,
  contract, or invariant.
- Fail closed. If setup or recovery cannot prove state is valid, abort instead
  of limping forward.
- Keep ownership explicit. Each state transition should have one owner and
  deterministic failure handling.
- Build for crash recovery. Durable state belongs in GitHub or checked-in
  artifacts, not transient process memory.
- Treat review failure as a system failure. Debug prompts, reviewers, routing,
  and interpretation before blaming the model.
- Optimize for the target design now. Delete obsolete paths in the same change
  instead of carrying compatibility debt.
- Productize repeated operator spelunking into CLI commands or guardrails.

## Execution Rules

- Finish the job end to end. After identifying root cause, the next action is
  to add a failing gate, implement the fix, or run validation.
- If you hit a second implementation of a shared concern, do not add a third.
  Route through the owning shared package or extract that owner in the same
  change.
- Do not introduce new direct external-system transport in app/package runtime
  code when a shared adapter is the intended owner. GitHub transport belongs in
  `packages/github-adapter`; factory mutation/boundary enforcement belongs in
  `packages/factory-runtime-guard`.
- Structural ownership gates take precedence over duplication scans. Passing
  `jscpd` does not justify new copies of a shared concern.
- Fix known blockers immediately; do not hide them behind more observation.
- Report outcomes, not activity. A running node is not progress; a merged PR or
  closed issue is.
- Use first-party CLI commands instead of ad-hoc shell introspection whenever a
  supported command exists.
- Always commit your work when you changed files. If hooks fail, fix the
  failure and recommit.
- Never resolve merge conflicts or conflict markers by blindly taking `HEAD`, `--ours`, or `--theirs`; inspect both sides and keep the correct code from each before removing the markers.
- If your task leaves `main` dirty, that is your problem to resolve before you
  stop. Commit the intended change, land the required generated artifacts, or
  restore the checkout to its prior clean baseline. Do not use a dirty `main`
  as a reason to skip landing work. If unrelated preexisting edits are already
  present, call that out once and keep your own change from adding more drift.
- Never use `SKIP_TESTS`.
- Never manually edit run-state files or manually complete work a crashed
  pipeline was responsible for.
- If the system keeps requiring the same manual action, turn that into a
  productized fix.
- Do not rely on root-level marker files such as `.cwd-restore`, `.keep`, or
  `.placeholder` as worktree/bootstrap state. If those appear, treat them as
  workaround residue: remove them and fix the real bootstrap path
  (`postinstall`, checked-in bootstrap scripts, or tool config) instead of
  ignoring or preserving the marker files.

## QA Gates

Pre-commit:

- Pre-commit intentionally runs the full QA set selected by the hook runner.
- Read the failure, fix the underlying problem, and rerun; do not bypass it.
- Agents must never use `SKIP_TESTS`.
- ESLint runs as a staged-scope preflight gate through `node scripts/eslint-gate.mjs`.
- `docs_freshness` runs in the strict pre-commit profile against governed docs
  repo-wide; stale docs must be updated, re-reviewed, reclassified, or deleted
  before commit.
- `phase1_gate_readiness` runs repo-wide in fast/strict/full and is the
  fail-closed audit that keeps the future Phase 1 graph transport, runtime
  internal-CLI, and command-thinness flips aligned to the same canonical active
  surface and checked-in violation inventory.
- `phase1_ownership_mapping` runs repo-wide in fast/strict/full and is the
  fail-closed audit that keeps the remaining Phase 1 active violations and
  legacy blast-radius deletions explicitly assigned to one checked-in owner.
- `phase1_burndown_finalization` runs repo-wide in fast/strict/full and is the
  fail-closed audit that freezes the exact remaining Phase 1 elimination set,
  determinism classification, and graph wrapper-role split before migration.
- `workflow_instrumentation_helper_contract` runs repo-wide in fast/strict/full
  and fail-closes on direct Hatch workflow/action lifecycle telemetry wiring
  outside the standard helper path.
- `dead_code` (`pnpm knip --silent`) runs in the mandatory fast/full quality path.
- `duplication_scan` is excluded from the pre-commit fast profile by design;
  duplication enforcement happens in pre-merge full profile.
- Full contract and routing details live in `docs/architecture/pre-commit-gates.md`.
- If hook behavior changes, update the hook, its tests, and the docs in the
  same change.

Pre-push:

- Pushes to `main` run a lighter transport-time safety net before landing.
- That fast-profile safety net includes `dead_code` (`pnpm knip --silent`)
  but not `duplication_scan`.
- That fast-profile safety net also includes the repo-wide
  `phase1_gate_readiness` audit, so pushes cannot land when the Phase 1 gate
  scope, hook/CI routing, or checked-in violation report drift apart.
- That fast-profile safety net also includes the repo-wide
  `phase1_ownership_mapping` audit, so pushes cannot land when the checked-in
  owner map drifts from the current remaining backlog.
- That fast-profile safety net also includes the repo-wide
  `phase1_burndown_finalization` audit, so pushes cannot land when the locked
  Phase 1 burn-down inventory drifts from the checked-in scope-finalization
  contract.
- That fast-profile safety net also includes the repo-wide
  `workflow_instrumentation_helper_contract` audit, so pushes cannot land when
  Hatch workflow/action instrumentation bypasses the standard helper surface.
- Docs freshness is intentionally not enforced in pre-push; authors should trip
  it at commit time, not during merge/push cleanup.
- `wave/*` branches are blocked.
- Non-main pushes are blocked unless explicitly allowed with
  `ALLOW_NON_MAIN_PUSH=true` or `ALLOW_PUSH_BRANCH=<branch>`.
- Full behavior lives in `docs/architecture/pre-commit-gates.md` and the hook
  sources.

Pre-merge:

- PR CI runs `pnpm qa:pre-merge` plus `pnpm factory:health:ci -- --strict`.
- `qa:pre-merge` runs the `full` run-gates profile and includes the
  `dead_code` quality gate (`pnpm knip --silent`) and the
  `duplication_scan` quality gate (`pnpm cpd:ci --silent`).
- Duplication enforcement is fail-closed in pre-merge: if either production or
  test duplication exceeds threshold, pre-merge fails deterministically.
- `release_quality` remains a conditional quality gate inside run-gates and is
  still enforced before merge when its trigger paths are staged.
- Troubleshooting signal: `first_failure phase=quality_gate target=release_quality`
- Troubleshooting command: `node scripts/run-platform-invariant-gates.mjs --gate release_quality`
- Treat pre-merge as the whole-repo backstop, stronger than path-based hook
  routing.

## Conventions

- Keep workflow steps rerunnable and idempotent where practical.
- Issue blocking relationships use GitHub's native blocked-by metadata, not
  labels or sub-issues.
- Put durable operational behavior in typed commands and tested modules, not in
  prompt-only glue.

## Related Systems

- Scenarios registry: resolve from factory config `scenarios.root`
- Replay target repo: <https://github.com/example/external-factory>
