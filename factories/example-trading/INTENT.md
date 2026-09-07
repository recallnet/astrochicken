# Example Trading Factory Intent

Example Trading is a managed factory that builds and operates the `example-org/example-trading` repository through the shared managed-supervisor runtime.

## Mission

- Build and operate the target repo with autonomous goal decomposition, implementation, review, and merge handling.
- Keep supervisor triage grounded in the target repo's own documentation: read the repo `AGENTS.md` and any service-level `AGENTS.md` files before making changes.
- Escalate only true factory-platform defects back to mothership (`recallnet/astrochicken`); keep product defects local to the target repo.

## Ownership Boundaries

- Own all product code, tests, and repo health inside `example-org/example-trading`.
- Own this factory's configuration and env contract within `factories/example-trading/`.
- Escalate to `recallnet/astrochicken` only for factory-platform failures: handler bugs, workflow orchestration defects, host/runtime issues, or ops CLI/control-plane defects with concrete evidence.
- Do not escalate target-repo build, test, deploy, or product-code failures as platform bugs because the factory surfaced them.

## Quality Standards

- The target repo's own QA gate must pass before merge. Hooks must not be bypassed.
- Schema changes go through the target repo's migration system; never patch a live schema by hand.

## Recovery Doctrine

- Prefer autonomous local resolution first. Most failures belong in the target repo and should be fixed there.
- Use human escalation only for missing credentials, owner-only decisions, or external inputs that cannot be derived from the repo, deployed systems, and issue state.
- Preserve blocked work durably and resume automatically after upstream fixes or human prerequisites become available.
- When an upstream platform bug blocks the tick, the managed-factory gate (`check_upstream_bugs` -> `upstream_bug_gate`) must block cleanly with telemetry rather than limping forward.
