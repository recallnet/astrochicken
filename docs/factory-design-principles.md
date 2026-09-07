---
doc_type: "reference"
owner: "mothership-factory"
review_policy: "periodic-7"
reviewed: "2026-03-24"
status: "active"
summary: "Canonical first-principles design rules for factory behavior, recovery, and change management."
tags: [architecture, design, factory, principles]
written: "2026-03-11"
---
## First-Principles Factory Design (Non-Negotiable)

We are building a factory that builds and operates factories. Optimize for long-term correctness and autonomy over short-term patching.

- Solve root causes, not symptoms. Recurring cleanup is a design defect until proven otherwise.
- Add the gate first, then fix the bug. Every regression should become a test, contract, lint rule, or invariant.
- Prefer deterministic typed ops commands over prompt-only glue. If operators repeat the same shell spelunking, productize it.
- Every workflow needs explicit invariants, one owner per state transition, deterministic failure handling, regression coverage, and telemetry.
- Review failure is a system failure. Diagnose coder prompt, reviewer prompt, outputs, and pipeline interpretation before blaming the model.
- Shared wave branches must scope review evidence to the current issue commits (`snapshot_sha..HEAD`), not the whole branch diff.
- Success means repeated ticks do not recreate the same drift.
- Apply at least three layers of "why" before proposing a fix: why the symptom happened, why the system allowed it, and why it was not prevented.
- Build for crash recovery. Durable state belongs in GitHub or named artifacts, and the next tick must be able to resume from it.
- Never manually complete work that a crashed pipeline was handling. Fix the crash and prove self-healing instead.

## V0 Over Backward Compatibility

- We are allowed to break old paths if they conflict with a cleaner, first-principles design.
- Prefer ripping out brittle legacy behavior now rather than carrying compatibility debt.
- If forced to choose: choose correctness, autonomy, and operability of the target design.

### No Legacy, No Gradualism (Non-Negotiable)

This project has **zero external users and zero downstream consumers**. We are the only caller of every interface. This means:

- Never use feature flags, dark launches, staged rollouts, legacy aliases, or compatibility shims.
- Replace the old path atomically: update all callers, delete the obsolete implementation, and ship the coherent new design.

The correct migration pattern is:
1. Write the new implementation.
2. Update all callers (DOT graphs, tests, scripts) to use the new interface.
3. Delete the old implementation.
4. Ship as one commit (or minimal commit chain where each commit is self-consistent).

If you find yourself writing `if (legacyMode)`, `// deprecated`, `// TODO: remove after migration`, or maintaining two code paths for the same behavior — stop. You are violating this policy. Rip out the old path now.
