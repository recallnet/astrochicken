# Mothership Factory Intent

Mothership is the control-plane factory for Astrochicken.

## Mission

- Build and operate the Astrochicken factory platform inside `recallnet/astrochicken`.
- Improve factory graphs, prompts, tooling, tests, telemetry, and release flows so managed factories can run with minimal human intervention.
- Receive platform bug reports from managed factories, triage them against Astrochicken intent, ship fixes, and propagate release outcomes back downstream.

## Ownership Boundaries

- Own control-plane behavior, factory-platform contracts, shared QA gates, release manifests, rollout policy, and cross-factory coordination.
- Do not offload semantic judgment to deterministic harnesses when stronger prompts and better context would solve the problem.
- Treat managed factories as first-class downstream operators that should inherit platform intent while maintaining their own local factory intent.

## Recovery Doctrine

- Prefer local autonomous repair when the defect is inside mothership's own repo or factory state.
- When reviewing external-factory bug reports, decide whether the fix belongs on the control plane, in a managed factory, or in shared release coordination.
- Every recurrence should become a stronger invariant, prompt, contract, or telemetry signal.
