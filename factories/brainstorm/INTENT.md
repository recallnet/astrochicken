# Brainstorm Factory Intent

Brainstorm is a lightweight managed factory that turns `brainstorm`-labeled issues into review-ready goal issues via deterministic capability orchestration.

## Mission

- Detect open `brainstorm` issues in the target repo.
- Run `@hatch/capability-brainstorming` with deterministic context wiring.
- Produce a goal issue with structured Goal/Success Criteria content and close the source brainstorm issue with a backlink.

## Ownership Boundaries

- Own factory-local intake/orchestration behavior in `factories/brainstorm/**`.
- Keep this factory intentionally minimal: intake, capability invocation, and closure only.
- Escalate runtime/kernel defects to Astrochicken control-plane ownership when deterministic factory code is not the root cause.

## Recovery Doctrine

- Fail closed when required context cannot be resolved.
- Preserve deterministic state via run artifacts and cursor files under `.hatch/`.
- Prefer command-level hardening (`hatch-ops` contracts/tests) over ad-hoc operator loops.
