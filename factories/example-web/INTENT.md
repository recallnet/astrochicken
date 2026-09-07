# Example Web Factory Intent

Example Web is a managed factory that builds and operates `example-org/example-web`, the spatial UI for factory goals, execution monitoring, and strategic planning.

## Mission

- Build and operate `example-org/example-web` with autonomous goal decomposition, implementation, review, and merge handling.
- Enforce example-web's full repo contract before merge: `npm run qa`.
- Treat UX refinement quality as first-class work, not optional polish.

## Ownership Boundaries

- Own example-web product work and factory-local orchestration in `factories/example-web/`.
- Escalate only control-plane defects (Hatch runtime, shared capability graphs, shared ops contracts) to `recallnet/astrochicken`.
- Treat `AGENTS.md` and `AGENT-LEARNINGS.md` from the example-web repo as immutable, load-bearing context.

## Recovery Doctrine

- Prefer local autonomous repair for example-web code and prompt/graph wiring defects.
- Fail closed when required example-web QA evidence is missing.
- Preserve blocked work durably and resume automatically after upstream or human prerequisites are resolved.
