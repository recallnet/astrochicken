# Mothership — Builder Agent Guidance

You are a coding agent implementing issues for the mothership factory
inside `recallnet/astrochicken`.

## Monorepo Layout

- `apps/hatch/` — Hatch CLI/runtime (DOT parser, graph engine, handlers, server)
- `packages/tsconfig/` — shared TS config
- `factories/` — factory instances (`graphs/`, `skills/`, `scripts/`, `contexts/`)
- `docs/` — architecture / vision / roadmap docs

## Key Commands

- Build all: `turbo run build`
- Test (fast local path): `pnpm test`
- Strict local proof: `pnpm test:strict`
- Repo contract suites only: `pnpm test:repo`
- Docs governance gate: `pnpm docs:check`
- Validate a pipeline: `hatch validate <file.dot>`
- Duplication scan: `pnpm cpd:ci --silent`

## Conventions

- TypeScript + ESM throughout.
- Prefer explicit interfaces at module boundaries.
- Pass dependencies explicitly; avoid hidden global state.
- Keep workflow steps rerunnable and idempotent where practical.
- Issue blocking relationships use GitHub's native blocked-by metadata, not labels.
- For codecontext policy, annotation workflow, and the split between inline
  `@context` and `factories/*/contexts/`, follow the repo-level guidance in
  `AGENTS.md`. Keep this file as a factory-local pointer, not a second source
  of truth.

## Execution Rules

- Always commit your work when you change files. If hooks fail, fix the failure
  and recommit.
- Never use `SKIP_TESTS`.
- If a test fails — whether on code you wrote or not — fix the code so the test
  passes. Tests are the QA safety net; green suite is a hard requirement.
- Finish the job end to end. After identifying root cause, add a failing gate,
  implement the fix, or run validation.
- Report outcomes, not activity. A running node is not progress; a merged PR or
  closed issue is.
- Do not introduce new direct external-system transport in app/package runtime
  code when a shared adapter is the intended owner. GitHub transport belongs in
  `packages/github-adapter`; factory mutation/boundary enforcement belongs in
  `packages/factory-runtime-guard`.

## Design Principles

- Add the gate first, then fix the bug. Every regression should become a test,
  contract, or invariant.
- Fail closed. If setup or recovery cannot prove state is valid, abort instead
  of limping forward.
- Optimize for the target design now. Delete obsolete paths in the same change
  instead of carrying compatibility debt.
- Prefer first-principles fixes over cleanup loops.

## Docs Freshness

Governed docs carry `written`, `reviewed`, `review_policy`, and `status`
frontmatter. When you touch a governed doc, update `reviewed` to today. Stale-doc
enforcement is a strict pre-commit gate.
