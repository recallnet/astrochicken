---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Factory Role Contracts Reference."
tags: [docs, factory-design, reference, role, skill, skills]
written: "2026-03-06"
---
# Factory Role Contracts Reference

Each role in a factory has a defined contract: what it receives, what it produces,
how it retries, and how you measure success. Customize these for your domain.

## Supervisor

### Responsibility
Outer-loop orchestrator. Checks factory health, triages bugs, dispatches work,
runs hygiene passes on state.

### Handler type
`stack.manager_loop` (full agentic session with tools)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `state_snapshot` | JSON | ops command | Full factory state: open goals, waves, bugs, metrics |
| `action_items` | array | ops command | Specific items needing attention |
| `date` | string | tool node | Current UTC date |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `supervisor_result` | string | Summary of actions taken |

### Success criteria
- All action items processed (applied, deferred, or rejected with reason)
- No unhandled bugs older than configured threshold
- State is consistent after pass (no orphan features, no stale markers)

### Retry behavior
- Single pass per tick (no retry — tick will run again)
- Bug fast-route: if bugs exist, fix them before proceeding to normal work

### Model selection
- Primary model (high capability needed for tool use and judgment)
- Reasoning effort: high

### Guardrails
- Never modify factory tracking/lease issues
- Never add/remove lifecycle labels managed by other pipeline stages
- Age guard: avoid destructive mutations on young issues (<1hr)
- Use ops CLI commands over ad-hoc shell when available

---

## Decomposer

### Responsibility
Breaks a goal into actionable work items (features, tasks, research questions).

### Handler type
`codergen` with shared `session_id` (for multi-step analysis)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `goal_issue` | JSON | tool node | Goal issue with number, title, body, labels |
| `existing_issues` | JSON | tool node | Currently open issues in the repo |
| `codebase_scan` | string | tool node | File listing or structure summary |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `proposed_features` | JSON array | List of feature objects with id, name, summary, scope, acceptance criteria |
| `analysis` | JSON | Goal analysis with overlaps, gaps, risks, assumptions |

### Success criteria
- Features cover the full goal scope
- No duplication with existing issues
- Each feature has clear acceptance criteria
- 3-8 features per goal (avoid too granular or too broad)

### Retry behavior
- Shared session: analyze → propose → review cycle
- Max 2-3 decompose attempts before fallback to deterministic split
- Parse resilience: fallback ops command if JSON is malformed

### Model selection
- Can use a lighter model (analysis doesn't need full tool use)
- Reasoning effort: medium

---

## Issue Writer

### Responsibility
Drafts detailed issue specifications from decomposed feature objects.

### Handler type
`codergen` (single-shot LLM with JSON output)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `feature` | JSON | fan_out item | Feature object from decomposer |
| `review_notes` | string | judge feedback | Revision feedback (empty on first pass) |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `issue_title` | string | GitHub issue title |
| `issue_body` | string | Full issue body (markdown) |
| `issue_labels` | string | Comma-separated label list |

### Success criteria
- Title is concise and descriptive
- Body includes: summary, scope, acceptance criteria, non-goals
- Labels match the repo's label taxonomy

### Retry behavior
- Judge loop: write → judge → revise (if judge says revise)
- Max 1-2 revision cycles
- Timeout: 2m per attempt

### Model selection
- Primary model (needs good writing quality)
- Reasoning effort: low (structured output, not deep analysis)

---

## Coder / Builder

### Responsibility
Implements a work item in an isolated git worktree.

### Handler type
`agent.worktree` (persistent coding session in git worktree)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `issue_number` | string | parent context | Issue to implement |
| `issue_title` | string | parent context | Human-readable title |
| `issue_body` | string | tool node | Full issue spec |
| `branch` | string | parent context | Branch to commit on |
| `worktree_dir` | string | parent context | Worktree path |
| `review_notes` | string | reviewer feedback | Revision feedback (empty on first build) |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `commits_created` | number | Number of commits made |
| `files_changed` | string | List of modified files |
| `build_result` | string | Build outcome summary |

### Success criteria
- Commits exist on the branch
- All acceptance criteria from issue are addressed
- Tests pass (integration command)
- No unrelated changes

### Retry behavior
- Review loop: build → review → revise (with reviewer notes)
- `skip_prompt_if_commits_exist="false"` for revision retries
- Snapshot/revert: snapshot HEAD before build, revert on terminal failure
- Max review attempts configurable (typically 3)

### Model selection
- Primary model (needs full coding capability)
- Reasoning effort: high
- Timeout: 30-60m

---

## Reviewer

### Responsibility
Validates that an implementation matches the issue spec. Not QA — focuses on
design integrity, completeness, and contract adherence.

### Handler type
`codergen` (single-shot LLM with structured output)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `review_evidence` | JSON | tool node | Evidence artifact: issue number, branch, changed files, diff summary |
| `skill_doc` | string | tool node | Review skill instructions (loaded deterministically) |
| `issue_title` | string | parent context | What was supposed to be built |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `review_verdict` | string | `"approve"` or `"revise"` |
| `review_notes` | string | Actionable feedback for the coder |
| `review_reason_codes` | string | Machine-readable reason codes |

### Success criteria
- Verdict is decisive (approve or revise, never "maybe")
- If revise: notes contain specific, actionable feedback
- Scope alignment: changes match the issue, no unrelated modifications

### Retry behavior
- Single pass (reviewer doesn't retry itself)
- On revise: feedback sent to coder for revision build
- Fallback: deterministic fallback command if LLM fails

### Model selection
- Primary model (needs code understanding)
- Reasoning effort: medium

---

## Judge

### Responsibility
Scenario-based evaluation gate. Makes pass/fail decisions before irreversible
actions (merging, closing, publishing).

### Handler type
`codergen` with `judge="true"` and `scenarios` attributes

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `evidence` | JSON/string | accumulated context | What was built, review notes, merge diff |
| `scenarios` | hidden | scenario registry | Evaluation criteria (not visible to the subject) |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `judge_pass` | string | `"true"` or `"false"` |
| `judge_notes` | string | Redacted feedback (never reveals scenario content) |

### Success criteria
- Pass/fail is decisive
- Notes are actionable when judge_pass is false
- Never reveals or quotes scenario content

### Retry behavior
- Deterministic fallback: if LLM fails, default behavior (fail-open or fail-closed per factory policy)
- OTel logging on fallback or fail-forward
- Judge runs once per evaluation (no internal retry)

### Model selection
- Can use lighter model (critic role)
- Reasoning effort: low (structured evaluation, not generation)
- Explicit model override recommended: `llm_model="..."` on the node

---

## Merger

### Responsibility
Handles rebase, merge, conflict resolution, and push for completed work.

### Handler type
- Deterministic tool nodes for rebase/merge/push
- `stack.manager_loop` for conflict resolution (needs LLM judgment)

### Input contract
| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `branch` | string | parent context | Branch to merge |
| `repo` | string | parent context | Repo path |
| `merge_candidates` | JSON | accumulated context | Issues to close after merge |

### Output contract
| Key | Type | Description |
|-----|------|-------------|
| `merge_status` | string | `"merged"`, `"already_merged"`, `"conflict"`, `"error"` |
| `merge_stdout` | string | Git merge output (files changed) |
| `closed_count` | number | Issues closed post-merge |

### Success criteria
- Branch merges cleanly (or conflicts are resolved)
- Main branch pushed to remote
- All merged issues closed with comments

### Retry behavior
- Rebase first, then merge
- On rebase conflict: build named conflict packet → LLM resolver → verify resolution
- If resolution still fails: persist durable recovery packet/context before cleanup and route to supervisor-owned recovery
- On unresolvable conflict: fail merge, report
- No infinite retry — one conflict resolution attempt

### Model selection
- Primary model for conflict resolver (needs code understanding)
- Reasoning effort: medium
- Timeout: 25m for conflict resolution

---

## Creating custom roles

For non-coding factories (research, content, data), adapt the pattern:

1. **Define the responsibility** in one sentence
2. **Choose the handler type** based on what the role needs to do:
   - Read-only analysis → `codergen`
   - Multi-step tool use → `stack.manager_loop`
   - Isolated file editing → `agent.worktree`
   - Deterministic ops → `tool`
3. **Define input/output contracts** as typed key-value pairs
4. **Define success criteria** that are measurable
5. **Define retry behavior** with bounded limits
6. **Choose a model** — don't default to the most expensive; match capability to need

Example: Research Synthesizer role
```markdown
## Role: Synthesizer

### Responsibility
Synthesizes findings from multiple research sources into a coherent summary.

### Handler type: codergen
### Input: source_documents (JSON array), research_question (string)
### Output: synthesis (string), confidence (number), gaps (JSON array)
### Success: synthesis addresses the question, cites sources, identifies gaps
### Retry: max 2 attempts, reviewer feedback loop
### Model: primary model, reasoning_effort: high
```
