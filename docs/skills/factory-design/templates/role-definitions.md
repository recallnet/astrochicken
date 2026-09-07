---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-22"
status: "active"
summary: "Default six-role contract template for Hatch factory scaffolding."
tags: [docs, factory-design, roles, skills, templates]
written: "2026-03-07"
---
# Factory role definitions template bundle

Derived from role behavior in:
- `factories/mothership/graphs/factory_supervisor_tick.dot`
- `packages/capability-goal-decomposition/graphs/goal_run.dot`
- `factories/mothership/graphs/wave_execute.dot`
- `factories/mothership/graphs/issue_execute_item.dot`
- `hatch-ops` command families

Use these as baseline contracts, then fill in repo-specific details (`{{...}}`).

## Freeform vs Packet Boundary

| Category | Allowed Freeform | Must Packetize |
|----------|------------------|----------------|
| Agent messaging | Ephemeral agent-to-agent collaboration | Any durable automation-consumed exchange |
| Notes/context | Local reasoning notes, prompt text | Any handoff that must survive restart/retry/tick |
| Summaries | Conversational summaries not consumed by automation | Any ownership transfer or escalation contract |
| Recovery | — | Any recovery/remediation artifact another operator/LLM depends on |
| Crash/retry | — | Any artifact required to continue safely after cleanup, retry, or crash |

## 1) Supervisor

**Responsibility**
- Own the outer-loop tick: health, bug gating, block handling, capacity gating, and dispatch decisions.

**Input contract**
- `state_snapshot` (`ready_goals`, `blocked_waves`, `infra_failures`, active runs)
- `health_result` from `hatch-ops supervisor run --op health-check`
- `capacity_limits` and `model_overrides`
- infra/target routing metadata: `factory_repo`, `target_repo`, `infra_issue_repo`

**Output contract**
- `dispatch_decision` (run/skip/defer + reason)
- deterministic `action_items` with owner + command + expected postconditions
- optional named escalation or recovery packet to `infra_issue_repo`

**Durable handoff rule**
- Any durable, replay-required, automation-consumed handoff must use a named packet family with `packet_type`, `schema_version`, validator, and canonical persistence.
- Freeform agent-to-agent messaging remains allowed only for ephemeral, non-durable coordination.
- Durable recovery handoffs should include packet refs, expected postconditions, and enough repo/worktree map data for a cold-start supervisor or simulator to continue safely.

**Retry / review behavior**
- Retries only for transient infra/runtime errors (`{{retry.supervisor_transient_max}}`).
- Escalate design/system failures to infra bug routing when retries are exhausted.

**Measurable success criteria**
- Tick finishes with explicit outcome state.
- No unowned blocked wave state.
- `action_items` are deterministic and command-backed.

**Prompt / skill integration**
- Keep supervisor prompt in `skills/supervisor/SKILL.md`.
- If iterating behavior, follow `~/.claude/skills/skill-creator/SKILL.md`.

---

## 2) Issue / Triage Writer

**Responsibility**
- Convert goals into executable issues with dependencies, acceptance criteria, and wave-ready routing metadata.

**Input contract**
- goal issue metadata (`issue_number`, body, milestone, labels)
- prior decomposition and retry counters
- repo standards and non-functional constraints

**Output contract**
- issue set (`issue_urls` or IDs), dependency map, triage plan, milestone assignment
- machine-readable decomposition summary
- durable decomposition ledger packet (`goal_decomposition_packet`) when issues are created

**Retry / review behavior**
- Retry if decomposition output is incomplete/ambiguous (`{{retry.triage_max_attempts}}`).
- Escalate to supervisor if repeated ambiguity blocks deterministic decomposition.

**Durable handoff rule**
- Goal decomposition that creates durable child work must persist a named `goal_decomposition_packet` before downstream triage/cleanup.
- Treat that packet as the durable decomposition ledger for dedupe, takeover, and recurrence control.
- Freeform planning notes may remain ephemeral, but child-work creation cannot rely only on milestone or label inference.

**Measurable success criteria**
- Downstream coder has no missing scope fields.
- Duplicate goal/work-item creation remains at 0.
- Triage turnaround under `{{metrics.triage_turnaround_target}}`.

**Prompt / skill integration**
- Keep role prompt/skill in `skills/issue-writer/SKILL.md` and `skills/triage/SKILL.md`.

---

## 3) Coder

**Responsibility**
- Implement scoped issue changes in the approved worktree/branch strategy.

**Input contract**
- issue spec, acceptance criteria, branch/worktree context
- repo path (`{{local_repo_path}}`) and commands (`{{commands.integration}}`, `{{commands.review_qa}}`)
- reviewer notes from prior loops (if any)

**Output contract**
- commit(s) referencing issue
- implementation summary and verification evidence path

**Retry / review behavior**
- bounded implementation retries (`{{retry.coder_max_attempts}}`) when review returns revise
- no unbounded loops; pass back to supervisor on terminal failure

**Measurable success criteria**
- acceptance criteria pass rate
- average review revisions per issue
- deterministic command evidence included per attempt

**Prompt / skill integration**
- Prompt lives at `skills/coder/SKILL.md` (or equivalent).
- Keep model override explicit (`{{model.coder}}`).

---

## 4) Reviewer

**Responsibility**
- Validate correctness, scope alignment, and contract compliance for the coder output.

**Input contract**
- issue context + changed scope
- `review_evidence_path`
- reviewer context contract artifact + sha

**Output contract**
- `review_verdict` (`approve|revise`)
- `review_reason_codes` (machine-readable)
- actionable `review_notes`

**Retry / review behavior**
- bounded loops (`{{retry.max_review_cycles}}`) with deterministic route command
- when rejecting, return concrete fixes tied to reason codes

**Measurable success criteria**
- false-reject rate below `{{metrics.reviewer_false_reject_target}}`
- average review cycle depth
- percent of revise outputs with actionable notes

**Prompt / skill integration**
- Prompt/skill in `skills/code_review/SKILL.md` plus repo overlay doc.
- Keep model override explicit (`{{model.reviewer}}`).

---

## 5) Merger

**Responsibility**
- Merge approved work safely and perform final state transitions (issue closure, marker updates).

**Input contract**
- approved review/judge outputs
- branch/worktree context and merge policy
- required evidence artifacts and route metadata

**Output contract**
- merge status (`merged|already_merged|failed`)
- post-merge closure actions and comments
- failure packet when merge cannot proceed

**Failure contract**
- If deterministic recovery still fails, emit a named durable recovery packet before cleanup.
- The packet must preserve branch/worktree/evidence refs and declare expected postconditions for the supervisor.
- Failure edges should converge to a supervisor-owned packet recovery sink rather than a raw diagnostic terminal.

**Retry / review behavior**
- deterministic retry for transient push/rebase failures (`{{retry.merge_transient_max}}`)
- escalate policy conflicts, do not silently skip merges

**Measurable success criteria**
- merge success rate
- zero orphan wave markers after merge
- mean time from approval to merged outcome

**Prompt / skill integration**
- Prefer deterministic CLI operations (`merge run --op ...`) over LLM prompts.
- If LLM conflict resolution is needed, keep in dedicated merge skill path.

---

## 6) Judge

**Responsibility**
- Provide scenario-scoped pass/fail judgment independent from implementation and review roles.

**Input contract**
- `judge_context` contract (path + sha + scenario identity)
- `judge_evidence` contract
- scenario definitions including success/fail expectations

**Output contract**
- `judge_pass` (`true|false`)
- `judge_notes`
- diagnostics code (especially context/evidence validation failures)

**Durable artifact rule**
- `judge_context` and `judge_evidence` are packet-shaped durable contracts and must remain discoverable to supervisors for recovery.
- Judge failure remediation should route through a named recovery packet whenever context/evidence validation or final judgment cannot be healed locally.

**Retry / review behavior**
- bounded retry loop (`{{retry.judge_max_attempts}}`) only when context/evidence are remediable
- fail closed if scenario context is missing (`judge_context_scenarios_missing`)

**Measurable success criteria**
- judge pass/fail signal correlates with post-merge quality outcomes
- `judge_context` completeness > `{{metrics.judge_context_completeness_target}}`
- low ambiguous verdict rate

**Prompt / skill integration**
- Prompt in `skills/judge/SKILL.md`.
- Scenario files should live under `{{judge.scenario_registry_root}}` and be versioned.
- Keep model override explicit (`{{model.judge}}`).
