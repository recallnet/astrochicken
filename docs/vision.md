---
doc_type: "vision"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Long-term vision and principles for deterministic software factories on Hatch."
tags: [docs, factory, vision]
written: "2026-02-20"
---
# Vision: Software Factories on Hatch

## The Thesis

A software factory is a deterministic control graph that moves work items (issues, PRs, incidents, milestones) through states, with stochastic "solver cores" (LLMs) bolted to certain stations that propose actions. The graph is the factory floor. The LLMs are machines at stations. Deterministic gates decide what proceeds.

Two maxims keep this from becoming a haunted house:

- **LLM nodes propose. Deterministic nodes dispose.**
- **Chat is not state. Artifacts are state.**

## Why Factories

When an AI agent builds software, it also writes the tests — so it can teach to its own test. Factories break this by imposing an information wall:

- The **builder** sees the spec, not the scenarios
- The **judge** sees the scenarios, not the source code
- Neither can game the other's work

The factory graph enforces this wall structurally. The builder runs in an isolated worktree with no access to scenario definitions. The judge runs in a separate execution context with no access to source code. The graph connects them through redacted signals and an oracle protocol.

## Three Planes

Every factory operates on three planes, all expressed in DOT:

### 1. Control Plane (Deterministic)

Routing, retries, timeouts, caching, idempotency, artifact storage. Hard gates: compile, unit tests, scenario tests, lint, typecheck, security checks. Human gates where needed.

### 2. Skill Plane (Attached to Nodes)

Reusable prompt + tool bundles like `patch_writer`, `triage_router`, `pr_reviewer`. In Hatch terms: node classes plus stylesheets that supply provider, model, temperature, tool allowlist, and prompt template.

### 3. Context Plane (Deterministic Inputs)

Pinned repo snapshot (commit SHA), pinned scenario set version, pinned toolchain versions, pinned secrets scope. Anything non-pinned becomes an explicit input artifact so it's auditable and replayable.

## Node Contracts

Each node has a contract:

- **Inputs**: artifacts + context keys
- **Output**: artifacts + decisions (route labels)
- **Side effects**: allowed or forbidden (merge, deploy, write to prod, etc.)
- **Determinism class**:
  - **D**: deterministic (shell, checks, routing)
  - **S**: stochastic (LLM)
  - **G**: gate (deterministic verdict or human verdict)
- **Failure policy**: retry, fork to research, write issue, escalate to human

That contract turns "graph of vibes" into "factory."

## The Kernel / Userland Split

### Kernel (Small, Stable, Boring)

The kernel is a referee, not a brain:

- Launch a Hatch graph run with a context bundle
- Capture artifacts, logs, and node results into a run ledger
- Enforce capability boundaries (what scripts, repos, secrets, environments a factory may touch)
- Enforce gates and approvals (including special safety gates)
- Provide a stable operator interface

### Userland (Everything That Changes Often)

Factories live in userland:

- DOT graphs
- Skills (prompts + tool contracts)
- Scenario registries
- Scripts for lint/test/deploy/redact/oracle
- Policies (timeouts, concurrency, depth limits)

## The Constitution

Invariants hardcoded in the kernel, not in userland:

- Minimum gate set cannot be removed (lint, typecheck, unit tests, at least one judge suite)
- Scenario selection must be deterministic (no LLM choosing its own exam)
- Judge definitions must be unreadable by builder roles
- All approvals and gate decisions are append-only logged
- Rollback path must exist for any deploy to prod

## The Safety Ratchet

The meta-loop can always propose tightening. Loosening requires a different class of gate:

- **Add** scenarios: normal gate
- **Tighten** thresholds: normal gate
- **Increase** depth limits: normal gate
- **Quarantine** a scenario: normal gate (if minimum coverage preserved)
- **Remove** a scenario or **loosen** a threshold: safety-policy-change gate with longer review window, mandatory justification, canary evaluation

Scenario retirement is quarantine-first: quarantine for N cycles, monitor for regressions, only then propose removal via safety gate.

## Growth Rings

The system grows outward from a simple core:

### Ring 0: The Kernel
`factory run <bundle>:<graph> --context ...` — run ledger, gates, approvals, capabilities.

### Ring 1: One Real Worker Factory
`issue_worker.dot` against a single GitHub issue. Two-loop worker (inner cheap, outer judge). Produces a PR. This is the thesis test.

### Ring 2: Factory Generator
A factory whose job is to create new factories from templates. Inputs: target repo, gate set, scenario strategy. Outputs: a new factory bundle. Hidden judges verify the generated factory includes minimum gates.

### Ring 3: Factory Operator
A meta-factory that monitors all run ledgers, triggers factories, escalates stuck work, enforces milestone split policies, manages merge queues.

### Ring 4: Self-Improver
Proposes changes to scenario registries, skill prompts, timeouts, routing heuristics. Changes must pass deterministic analysis, hidden safety judges, and approval gates with ratchets. Very limited capabilities — can create PRs and proposals, cannot deploy.

### Ring 5: Kernel Maintainer
Touches the kernel repo itself. Held to a higher judge standard: replay tests, invariant checks, adversarial tests, signed promotion.

## Mental Model

- Hatch is the CPU
- The kernel is the OS
- Factories are processes
- Hidden judges are the security subsystem
- Meta-factories are privileged processes with narrowly scoped capabilities

Start with the OS kernel and one process that does real work. Then add privileged processes slowly, with judges that specifically test that privilege is not being abused.
