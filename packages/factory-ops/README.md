# @hatch/factory-ops

Deterministic action owners and shared library for factory operations. This is the largest package in the monorepo (~77k lines) — it contains every command the supervisor, wave dispatcher, and goal executor call during pipeline execution.

## Structure

```
src/
├── commands/     # Action owners — one exported function per pipeline action_id
├── lib/          # Shared pure logic — error catalog, packet core, repo identity,
│                 #   verdict envelope, control-plane blocker, wave claim lifecycle,
│                 #   sanitize rules, insight contract, dashboard filters, etc.
└── cli/          # hatch-ops CLI command handlers
test/
└── commands/     # Unit tests (node:test framework)
```

## Key Subsystems

| Subsystem | Key modules | Purpose |
|-----------|-------------|---------|
| Wave lifecycle | `wave-sanitize-rules`, `wave-close-merged`, `wave-claim-lifecycle`, `wave-throughput-invariants` | Wave dispatch, execution, orphan cleanup, throughput analysis |
| Goal lifecycle | `goal-queue-ops`, `goal-sub-issues`, `goal-sweep-completed`, `goal-final-state-review` | Goal admission, decomposition, sub-issue management, close conditions |
| Supervisor | `supervisor-ownership-routing`, `supervisor-managed-*`, `supervisor-tick-idle-check`, `supervisor-diagnose-stalled-waves` | Managed supervisor decision-making, health classification, intake selection |
| Guard system | Used via `apps/hatch/src/pipeline/guard-*.ts` | Budget enforcement, circuit breakers, backoff |
| Release | `release-rollout-controller-health`, `release-rollout-controller-state`, `control-plane-release-asset` | Canary health checks, rollout state, release asset management |
| Shared lib | `error-catalog`, `packet-core`, `factory-repo-identity`, `verdict-envelope`, `control-plane-blocker`, `managed-observability-boundary` | Error handling, durable packets, repo resolution, review verdicts, blocker contracts, telemetry sanitization |

## Testing

```bash
# Run all factory-ops tests
node --test packages/factory-ops/test/commands/*.mjs

# Run a specific test
node --test packages/factory-ops/test/commands/<module>.unit.test.mjs

# Run pre-commit wave claim gates
pnpm --filter @hatch/factory-ops test:wave-claim-gates
```

Tests use `node:test` with `assert/strict`. External dependencies (GitHub API, filesystem) are stubbed via dependency injection — no mocking of production code.
