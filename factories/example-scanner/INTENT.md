# Example Scanner Factory Intent

Example Scanner is a managed factory for the `example-org/example-scanner` repository, operated through the shared managed-supervisor runtime.

## Mission

- Build and operate the target repo with autonomous goal decomposition, implementation, review, and merge handling.
- Keep supervisor triage grounded in the target repo's own documentation (`README.md`, `docs/`), not in generic control-plane assumptions.
- Escalate only true factory-platform defects back to mothership (`recallnet/astrochicken`); keep product defects local to the target repo.

## Deterministic Invariants for Supervisor Triage

1. Configuration must fail closed for required runtime inputs.
2. Durable state lives in the target repo's database, and status/history reads come from that durable state.
3. Release readiness is QA-gated: product changes are not release-ready until the target repo's quality gate passes.

## Ownership Boundaries

### Product-plane (target repo)

- Application behavior, data correctness, dashboard behavior, and repo QA/deploy health.
- Target-repo secrets and data-path configuration.

### Control-plane (mothership)

- Managed factory orchestration and runtime defects in Astrochicken (shared managed-supervisor shell, host runtime lifecycle, `hatch-ops` contract failures, graph-engine/handler defects).
- Control-plane release gating and managed-factory routing/policy behavior shared across factories.

## Escalation Doctrine

- Default: repair locally when evidence points to product code, product config, or product data dependencies.
- Escalate to mothership only with concrete control-plane evidence (for example `hatch validate` or graph dispatch defects, host lifecycle contract failures, shared policy-pack/runtime regressions).
- Do not classify product outages as platform bugs because the supervisor detected them.

## Recovery Doctrine

- Prefer autonomous local recovery first: fix code, config, or tests in the target repo, re-run QA, reattempt the tick.
- Keep decisions artifact-backed (issues, run logs, deterministic command output), not prompt-only.
- Convert recurring failure classes into stronger deterministic checks, tests, or policy constraints so the same failure class does not recur silently.
