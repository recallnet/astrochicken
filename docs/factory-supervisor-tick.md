---
doc_type: "reference"
owner: "mothership-factory"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "End-to-end reference for the factory supervisor tick: phases, node flow, run state, config loading, daemon loop, and inspection commands."
tags: [architecture, factory, reference, supervisor, tick]
written: "2026-03-06"
---
# Factory Supervisor Tick Reference

Related docs:
- [Factory Operator Guide](./runbooks/factory-operator-guide.md)
- [Goal Lifecycle Walkthrough](./goal-lifecycle-walkthrough.md) (end-to-end trace of a single goal through the factory)
- [Host Lifecycle for Same-Machine Multi-Factory Runtime](./host-lifecycle.md)
- [Hatch Transition/Convergence Contract](./transition-convergence-contract.md) (canonical routing/fan-in/retry/terminal semantics)
- [Architecture: Reactive Factory Dispatch](./architecture/reactive-factory-dispatch.md) (target-state plan for moving hot-path dispatch out of the tick)

The supervisor tick (`factory_supervisor_tick.dot`) is the top-level pipeline that runs once per daemon cycle. It orchestrates shared software-development capability flows (goal decomposition + goal execution adapters), release/reporting handoff, and issue hygiene in a single linear pass with conditional branches and fan-out expansion.

## Tick Phases

The tick has ~50 nodes organized into 10 phases. The flow is primarily linear with conditional gates that skip phases when there's nothing to do.

### Phase 1: Config Resolution (6 nodes)

Resolves runtime parameters from factory config and defaults.

| Node | Output key | Purpose |
|------|-----------|---------|
| `set_gh_repo` | `gh_repo` | GitHub repo identifier (e.g., `recallnet/astrochicken`) |
| `set_target_repo` | `target_repo` | Repo this factory executes against (fallback from `gh_repo`) |
| `set_control_plane_repo` | `control_plane_repo` | Repo that owns factory-design defect bugs (fallback from `target_repo`) |
| `set_supervisor_factory_identity` | `factory_id` | Stable factory identity injected into supervisor snapshot + prompts |
| `set_source_repos` | `source_repos` | Repos to ingest artifacts from, defaults to `gh_repo` |
| `set_max_artifacts` | `max_artifacts` | Max artifacts to process per tick (default 20) |

### Phase 2: Bug Fast Route (12 nodes)

Loads supervisor prompts, checks for open bugs, and attempts to fix them before proceeding. If bugs remain after the LLM fix attempt, the tick halts early.

1. `load_supervisor_skill` — loads `packages/factory-skills/skills/runtime/supervisor_review/SKILL.md`
2. `load_supervisor_rules` — loads `factories/mothership/skills/supervisor_rules.md`
3. `load_supervisor_system_prompt` — loads `packages/factory-prompts/prompts/supervisor/system.md`
4. `load_intent_stack` — loads factory intent stack
5. `snapshot_state_fast` — runs `supervisor state-snapshot`
6. `evaluate_open_bug_gate_fast` — checks for open bugs, outputs `has_open_bugs`
7. `bug_fast_gate` — **GATE**: if `has_open_bugs=true`, enters bug route; otherwise skips to recovery sweep
8. `load_supervisor_bug_fast_task_prompt` + `supervisor_review_bug_fast` — LLM session (class `supervisor`, 60m timeout). Processes bugs with FIX_ON_MAIN / CONVERT_TO_GOAL / CONVERT_TO_GOAL_WITH_DEPENDENCIES dispositions
9. `evaluate_open_bug_gate_after_fast` — re-evaluate bug state (queries GitHub directly, no snapshot needed)
10. `bug_fast_resolution_gate` — **GATE**: if bugs remain after fix attempt, goes to `done` (halts entire tick)

### Phase 3: Recovery Sweep (1 node)

`recovery_sweep_runtime` — runs `factory recovery-sweep --stale-minutes 20 --apply true`. Cleans stale runs and orphan worktrees.

### Phase 4: Artifact Ingest (1 node)

`artifact_ingest` — child pipeline (`@hatch/capability-artifact-ingestion/graphs/artifact_ingest.dot`). Scans for new artifacts and creates goals from them.

### Phase 5: Goal Queue + Decomposition (~17 nodes)

Issue hygiene, deduplication, and goal decomposition fan-out.

1. `auto_ready_artifact_goals` — auto-readies artifact goals
2. `sanitize_goal_duplicates` — deterministic dedup
3. `sweep_completed_goals` — closes goals whose sub-issues are all done
4. `release_quarantine` — releases expired quarantined issues
5. `list_ready_goals` → `count_ready_goals` — lists unblocked ready goals, counts them
6. `goal_gate` — **GATE**: if `goal_count=0`, skips to release + executable-goal evaluation
7. `set_max_concurrent_goals_pre` — reads `max_concurrent_goals` from config
8. `goal_decompose_backpressure` — checks if decomposition is allowed given current executable ready goals
9. `goal_decompose_gate` — **GATE**: if `decompose_allowed!=true`, skips to release + executable-goal evaluation
10. `keep_all_goals` → `set_max_goal_runs_per_tick` → `limit_kept_goals` — passes through goals, reads config limit, caps list
11. `ensure_goal_execution_path` — fails closed unless every selected ready goal has a valid persisted `goal_execution_path` packet
12. `set_capability_goal_decomposition_skills` — resolve capability skill paths
13. `fan_out_goal_run` — fans out to `goal_run.dot` per goal (max concurrency 2)
14. `fan_in_goal_run` — collects results

### Phase 6: Release + Executable Goal Spawn (~8 nodes)

1. `set_release_sha` — resolves release SHA from `main`
2. `release_manifest` → `sync_release_manifest` → `emit_disposition_feedback` — emits and publishes release/disposition artifacts
3. `set_max_concurrent_waves_for_goal_execute` — reads `max_concurrent_waves` from config for execution slot cap
4. `list_executable_goals` — computes executable goals with active-run dedupe
5. `goal_execute_gate` — **GATE**: if none, skip spawn path
6. `stamp_factory_contract_hash` — stamps factory contract hash for drift detection
7. `spawn_goal_execute` — detached fan-out (`fan_out.detached`) to `factories/mothership/graphs/goal_execute.dot`

### Phase 7: Lifecycle + Tick-idle gating (5 nodes)

1. `emit_review_metrics_summary` — emits review metrics snapshot
2. `evaluate_external_factory_lifecycle` — checks upstream lifecycle rejection state
3. `external_lifecycle_gate` — **GATE**: applies rejected-upstream closure when needed
4. `evaluate_tick_idle` — determines if tick can end without supervisor/release work
5. `tick_idle_gate` — **GATE**: either cursor-update-and-exit or continue to supervisor/release path

### Phase 8: Supervisor health + semantic review (4 nodes)

1. `supervisor_health` — deterministic health check
2. `snapshot_state` + `set_date` — review context setup
3. `evaluate_action_item_gate` — **GATE**: route only when action items exist
4. `load_supervisor_review_task_prompt` + `supervisor_review` — LLM session (class `supervisor`, 10m timeout)

### Phase 9: Shared release reporting handoff (1 node)

1. `run_release_report_flow` — child pipeline (`@hatch/capability-release-reporting/graphs/release_report_flow.dot`)

### Phase 10: Tick completion

1. `update_tick_idle_cursor` — deterministic terminal path when tick is idle
2. `done` — terminal node after either cursor-only completion or release-reporting completion

## Key Gates Summary

| Gate | Condition | Effect |
|------|-----------|--------|
| `bug_fast_gate` | `has_open_bugs=true` | Enter bug fix route |
| `bug_fast_resolution_gate` | `has_open_bugs=true` (after fix) | **HALT TICK** |
| `goal_gate` | `goal_count=0` | Skip goal decomposition |
| `goal_decompose_gate` | `decompose_allowed!=true` | Skip goals (backpressure) |
| `goal_execute_gate` | `count=0` | Skip detached goal execution spawn |
| `external_lifecycle_gate` | `lifecycle_state=rejected_upstream` | Apply rejected-upstream closure path |
| `tick_idle_gate` | `tick_idle=true` | End tick after cursor update |
| `action_item_gate` | `has_action_items!=true` | Skip supervisor semantic review |

## Daemon Loop

**Script**: `scripts/factory-daemon.sh <factory-id>`

The daemon is a bash loop that runs one tick per cycle for a single factory:

```bash
# Start mothership daemon
nohup scripts/factory-daemon.sh mothership > /dev/null 2>&1 &

```

Operators should prefer `hatch-ops factory host-start|host-stop|host-restart`
for normal lifecycle management; the script details below explain what the
daemon does each tick.

Each tick cycle:

1. **Clean git state** — `git reset HEAD -- .` if previous tick left staged changes
2. **Pull latest** — `git -c core.hooksPath=/dev/null pull --ff-only --quiet`
3. **Reap orphan processes** — kills any `hatch run` processes for this factory's graph not parented to the daemon
4. **Recovery sweep** — `hatch-ops factory recovery-sweep --factory-id <id> --runs-dir <runs-dir> --stale-minutes 20 --apply true`
5. **Launch tick** — `hatch run <supervisor-graph> --context {...} --live` (background)
6. **Wait** — waits for tick process to exit
7. **Log** — records run ID, status, current node
8. **Sleep 60s** — then repeat

**Paths**:
- Host lifecycle commands resolve per-factory paths under `HATCH_HOST_BASE_DIR/<factory_id>/...`
- Daemon consumes `FACTORY_DAEMON_LOG_DIR`, `FACTORY_DAEMON_PID_DIR`, `FACTORY_DAEMON_PID_FILE`, `FACTORY_DAEMON_LOCK_DIR`, `FACTORY_DAEMON_TMP_DIR`, and `FACTORY_DAEMON_SOCKET_DIR`
- See [Host lifecycle for same-machine multi-factory runtime](./host-lifecycle.md) for full layout + commands

**Environment**: sources secrets, loads `.env.d/` files, exports `HATCH_PROVIDER=openrouter`, `HATCH_MODEL=openai/gpt-5.3-codex`, `FACTORY_TRACKING_ISSUE_NUMBER=407`.

## Run State Files

Each run gets a directory at `.hatch/<factory_id>/runs/<run-id>/` with:

### metadata.json

Lightweight heartbeat/recovery metadata. Updated on every node transition.

| Field | Type | Description |
|-------|------|-------------|
| `runId` | string | 8-char hex ID |
| `status` | string | `running`, `completed`, `failed`, `suspended`, `guarded`, `guarded_terminal` |
| `pid` | number/null | OS process ID, null when not running |
| `heartbeatAt` | ISO string | Last heartbeat timestamp |
| `updatedAt` | ISO string | Last metadata write |
| `requeueAttempted` | boolean | Whether stale-run recovery tried to requeue |

### state.json

Full engine state. Written on node transitions and every 15s via heartbeat.

| Field | Description |
|-------|-------------|
| `context` | `Record<string, string>` — all pipeline variables and outputs |
| `currentNode` | Node ID currently being executed |
| `nodeStartedAt` | When current node started |
| `completedNodes` | Array of `{id, completedAt, outputHash}` |
| `activeChildren` | Child pipeline runs (from fan-out or pipeline nodes) |
| `records` | Execution history (StageRecord array) |
| `guard` | Circuit breaker state, counters |

### Stale Detection

A run is stale-orphaned when: `status=running` AND freshest timestamp (max of heartbeat, updatedAt) > 20 minutes old AND the PID is dead.

## Config Loading

**File**: `factories/mothership/factory.config.json`

Read by ops command `common resolve-factory-config --key <key> --fallback <default>`.
For key `K`, resolution precedence is:

1. `HATCH_<K_UPPER>` env var (for example `HATCH_CONTROL_PLANE_REPO`)
2. `factory.config.json` value
3. `--fallback` value

| Key | Where read | Purpose |
|-----|-----------|---------|
| `factory_id` | `set_supervisor_factory_identity` | Stable factory identity injected into supervisor snapshot + prompts |
| `target_repo` | `set_target_repo` (fallback from `gh_repo`) | Repo this factory executes against |
| `control_plane_repo` | `set_control_plane_repo` (fallback from `target_repo`) | Repo that owns factory-design defect bugs |
| `max_concurrent_goals` | `set_max_concurrent_goals_pre` | Goal-run backpressure capacity cap |
| `max_concurrent_waves` | `set_max_concurrent_waves_for_goal_execute` | Execution slot cap for `list_executable_goals` |
| `max_goal_runs_per_tick` | `set_max_goal_runs_per_tick` → `limit_kept_goals` | Max goals decomposed per tick |

Config is read from disk each tick — changes take effect on the next tick after
the daemon pulls latest. Env overrides apply on ticks where those vars are set.

### Managed identity surfaces (kind → instance → registry → installation)

For managed factories (for example `brainstorm`), keep these four surfaces aligned:

1. **Kind manifest** (`factories/<kind>/kind.json`)
   - `kind_id`, `execution_mode`, `shared_supervisor_shell`, `domain_graph`
2. **Instance manifest/template** (`factories/<kind>/instance.template.json` or home-repo `.hatch/instance.json`)
   - `kind_id`, `instance_id`, `target_repo.full_name`, `workspace_mode`
3. **Service registry** (`factory-registry.json` `instances[]`)
   - `kind_id`, `instance_id`, `control_plane_repo`, `target_repo`, lifecycle fields, installation-manifest linkage
4. **Host installation manifest** (`.hatch/hosts/<instance>/installation.json`)
   - `instance_id`, `workspace_mode`, `host_id`, runtime metadata

Validation command:

```bash
hatch-ops supervisor managed-load-context \
  --factory-id brainstorm \
  --factory-root factories/brainstorm \
  --kind-path factories/brainstorm/kind.json \
  --instance-path factories/brainstorm/instance.template.json \
  --kind-id brainstorm \
  --instance-id brainstorm \
  --home-repo example-org/example-notes \
  --target-repo example-org/example-notes \
  --control-plane-repo recallnet/astrochicken
```

Expect `manifest_ok=true`. If false, fix identity mismatches before running managed ticks.

### Goal-decomposition timeout budgets (issue-writing + triage)

Timeout defaults for goal-decomposition semantic stages are capability-owned in:

- `packages/capability-goal-decomposition/timeouts.defaults.json`
- resolved by `apps/hatch/src/factory/goal-decomposition-timeouts.ts`

Factory-level overrides are set in `factory.config.json` under:

- `capabilities.goal_decomposition.timeouts.issue_draft`
- `capabilities.goal_decomposition.timeouts.issue_repair`
- `capabilities.goal_decomposition.timeouts.issue_judge`
- `capabilities.goal_decomposition.timeouts.issue_revise`
- `capabilities.goal_decomposition.timeouts.triage_plan`
- `capabilities.goal_decomposition.timeouts.triage_repair`

For mothership, inspect effective resolved values (defaults + overrides) at:

- `factories/mothership/inventory/goal-decomposition-timeouts.json`
- `factories/mothership/inventory/goal-decomposition-timeouts.md`

Regenerate these artifacts after changing timeout defaults/overrides:

- `pnpm goal-decomposition-timeout-inventory:generate`

> External factory note: when `control_plane_repo` differs from `target_repo`, the GitHub token used by the factory must have write permission to `control_plane_repo` so cross-repo `bug.v1` escalation issues can be filed.

## Child Pipeline Flows

### Shared software-development capability flows

- `@hatch/capability-goal-decomposition/graphs/goal_run.dot`  
  Per goal: load persisted execution-path metadata (`goal_execution_path`, routing state/version) → resolve deterministic hard-goal re-entry state (`needs_planning`, `awaiting_post_plan_review`, `approved_plan_resume`) → run fail-closed admission gate (deny when decomposition packet already exists or planning state is lock-like unless the hard-goal state is `approved_plan_resume`) → **intake_decompose** → **write_issues** → **triage** → close/keep decision.
- `@hatch/capability-coding/graphs/issue_execute_item.dot`  
  Shared issue build/review contract surface (factory adapters provide branch/session wiring).
- `@hatch/capability-merge/graphs/merge_item.dot`  
  Shared merge/conflict-resolution contract surface.
- `@hatch/capability-release-reporting/graphs/release_report_flow.dot`  
  Shared release narration + dedup + tick-idle cursor handoff.

### Mothership adapter flows (factory-local)

#### goal_execute.dot

Per goal: resolve goal-scoped config → list executable sub-issues → execute issues sequentially on a shared `goal/<n>` branch via adapter wiring → split results → handle failures → merge/push/judge orchestration → cleanup

#### goal_issue_execute.dot

Per issue adapter: set context → fetch issue + goal issue → init goal branch worktree/session state → inspect/reuse path → **build** + **review** loop (max 3 attempts) → report per-issue result for goal-end split/merge handling

## Inspection Commands

| What | Command |
|------|---------|
| Current tick stage + progress | `hatch-ops factory tick-status` |
| Active runs as tree | `hatch-ops factory status` |
| Wait for the next meaningful factory event | `hatch-ops factory subscribe [--target next-goal-progress|next-issue|next-review|next-merge|next-release-report] [--timeout N]` |
| Recent outcomes | `hatch-ops factory outcomes --repo recallnet/astrochicken --lookback-hours 1` |

`factory status --json` includes a `control_plane` block for release-gate visibility. Operators should inspect:
- `selected_channel` + `resume_reason`/`resume_when` to understand why work is paused
- `required_release_floor` for the minimum release needed to resume
- `manifest.source/path/ref` to verify the exact controlling manifest
- `publish.asset_id/asset_url/manifest_path` to audit the GitHub release asset that published the control-plane manifest

### Goal admission reset semantics (decomposition/planning)

`goal_run.dot` now fails closed when either of these are true for a goal:

- an active durable `goal_decomposition_packet` already exists (duplicate decomposition attempt), or
- `goal_execution_path` sticky routing state reports a planning lock (`planning_state != not_required`).

Hard-goal re-entry is resolved deterministically before admission using `hatch-ops goal hard-state`:

- `needs_planning` — no hard-plan packet attached yet.
- `awaiting_post_plan_review` — hard-plan packet exists but `ready` has not been re-applied.
- `approved_plan_resume` — hard-plan packet exists and `ready` has been re-applied.

When admission sees `approved_plan_resume`, it intentionally bypasses planning/decomposition lock checks and resumes execution from the approved plan contract rather than recreating the plan packet.

Routing classification is also ratcheted at the packet layer: once a durable
`goal_execution_path_packet` exists, `hatch-ops goal execution-path classify`
fails closed with `E_GOAL_EXEC_PATH_RECLASSIFIED` (including the existing
packet id) instead of rewriting the route. Supervisor/operator reaction should
be: treat this as an intentional-stop signal, inspect the existing packet, and
use `goal admission-reset` only when deliberate reclassification is required.

For stage-1 hard routing visibility, `goal execution-path inspect|ensure|resolve`
responses now include `provisional_hard=true` (`provisional=true`) when
`goal_execution_path=hard` with `decomposition_state=required` and
`planning_state=not_required`.

Operator reset path (explicit + audited):

```bash
hatch-ops goal admission-reset \
  --repo-root . \
  --goal-issue-number <goal-number> \
  --reason <operator_reason> \
  --factory-id mothership
```

What reset does:

- supersedes active `goal_decomposition_packet` records for that goal;
- supersedes active `goal_execution_path_packet` records for that goal;
- writes `status_reason=goal_run_admission_reset:<reason>` into superseded packets.

After reset, the supervisor can reclassify/re-run decomposition on the next tick. Use this only for intentional operator-directed rerouting/re-decomposition.

Operator visibility:

- `hatch-ops goal hard-state --repo <owner/repo> --repo-root . --goal-issue-number <n>` returns the deterministic hard-goal resolver decision plus canonical hard-plan packet/comment/artifact references.
- `hatch-ops factory status --json`, `hatch-ops supervisor status`, and `hatch-ops factory dashboard` now include an `awaiting hard-plan review` count/list so parked post-plan goals are visible without custom spelunking.

### External factory managed controls

Operator intent for external-factory pause/quarantine/retry/unblock/resume is persisted durably at:

- `.hatch/factories/<factory_id>/control-state.json`

Commands:

- `hatch-ops factory pause --factory-id <id> --reason <text>`
- `hatch-ops factory quarantine --factory-id <id> --reason <text>`
- `hatch-ops factory retry --factory-id <id> --reason <text> [--retry-target <run-or-issue>]`
- `hatch-ops factory unblock --factory-id <id> --reason <text>`
- `hatch-ops factory resume --factory-id <id> --reason <text>`
- `hatch-ops factory control-state --factory-id <id>`

`factory status --json` and `factory fleet-status --json` surface this contract under `managed_state` (`state_action`, `reason`, `retry_target`, `health_classification`) so operators can read *why* a factory is paused/quarantined/blocked without shell spelunking.

For onboarding/runbook sequencing around these controls, see [External factory operator onboarding runbook](runbooks/external-factory-operator-onboarding.md) (goal #1494 scope).

### Key Context Keys by Phase

| Phase | Keys to inspect |
|-------|----------------|
| Config | `gh_repo`, `target_repo`, `control_plane_repo`, `factory_id`, `source_repos`, `max_artifacts` |
| Bug route | `has_open_bugs`, `open_bug_count`, `state_snapshot` |
| Goals | `goal_issues`, `goal_count`, `kept_goals`, `kept_goals_limited`, `decompose_allowed` |
| Goal spawn/lifecycle | `executable_goals`, `count`, `spawned_goal_runs`, `lifecycle_state`, `tick_idle` |
| Goal execute | `goal_number`, `goal_issue_number`, `merge_candidates`, `max_review_attempts` |
| Supervisor review | `state_snapshot` (contains `action_items` array) |
| Release/reporting | `release_report_context`, `release_narrative`, `release_slack_delivery` |

### Child Run Tracing

The engine stores child run IDs in context as `__child_run_id_<node_name>`. To trace into a child run, read that key from the parent's state.json, then inspect the child's state.json directly.

### Handler Types

| Type | Implementation | Description |
|------|---------------|-------------|
| `tool` | `apps/hatch/src/pipeline/handler/tool.ts` | Deterministic shell commands |
| `pipeline` | `apps/hatch/src/pipeline/handler/pipeline.ts` | Child pipeline composition |
| `fan_out.dynamic` | `apps/hatch/src/pipeline/handler/fan_out_dynamic.ts` | Dynamic fan-out from JSON array |
| `fan_out.detached` | `apps/hatch/src/pipeline/handler/fan_out_detached.ts` | Fire-and-forget fan-out (spawns background processes) |
| `fan_in.dynamic` | `apps/hatch/src/pipeline/handler/fan_in_dynamic.ts` | Collects fan-out results |
| `stack.manager_loop` | `apps/hatch/src/pipeline/handler/manager.ts` | In-process LLM session |
| `agent.worktree` | `apps/hatch/src/pipeline/handler/worktree.ts` | Coding agent in isolated git worktree (60m timeout) |
| `codergen` | `apps/hatch/src/pipeline/handler/codergen.ts` | Single-turn LLM generation |

## Related Runbooks

- [External factory operator onboarding runbook](runbooks/external-factory-operator-onboarding.md) — bootstrap/day-2 operator flow, local-vs-control-plane triage, recovery, and upgrade/resume sequencing.
- [Daily Analysis Runbook](agent-runbooks/daily-analysis.md) — recompute `analysis daily-report` artifacts and interpret missing-source coverage flags.
- Canonical docs guard: `pnpm docs:check` blocks unqualified legacy command/path references in this doc, `README.md`, and `docs/state-machines.md`.
