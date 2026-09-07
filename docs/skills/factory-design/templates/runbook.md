---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Operational runbook template for validating, starting, inspecting, and recovering Hatch factories safely."
tags: [docs, factory-design, operations, runbook, templates]
written: "2026-03-07"
---
# Factory runbook template

Derived from real flows in `factories/mothership/graphs/*` and the `hatch-ops` CLI (`@hatch/factory-ops`, runnable via `npx hatch-ops`).

## 1) Validate

```bash
# Validate entry graph and subgraphs
texit=0
for graph in \
  '{{entry_graph}}' \
  '{{graphs.goal_queue}}' \
  '{{graphs.wave_dispatch}}' \
  '{{graphs.production_line}}'
do
  hatch validate "$graph" || texit=$?
done
exit "$texit"
```

## 2) Start

```bash
# One-shot supervisor tick

# Reference: top-level graph entrypoint
hatch run '{{entry_graph}}'

# Run with explicit context file
hatch run --context '{{contexts.supervisor_tick}}' '{{entry_graph}}'

# Continuous dispatch loop (explicit, visible ownership)
hatch dispatch '{{entry_graph}}' --interval '{{dispatch.interval_seconds}}'
```

## 3) Inspect (no guesswork)

```bash
# Snapshot current state payload
hatch-ops supervisor run --op state-snapshot \
  --repo '{{target_repo}}'

# Health status
hatch-ops supervisor run --op health-check \
  --repo '{{target_repo}}' \
  --run-id '{{run_id}}' \
  --pipeline '{{entry_graph}}'

# Ready goals and capacity
hatch-ops goal run --op list-ready --repo '{{target_repo}}'
hatch-ops wave run --op enumerate-slots \
  --max-concurrent '{{capacity_limits.max_concurrent_waves}}' \
  --ready-count '{{metrics.ready_goal_count}}' \
  --in-flight-count '{{metrics.in_flight_waves}}'
```

## 4) Recover

```bash
# Sweep stale run/worktree residue
hatch-ops factory run --op recovery-sweep \
  --runs-dir '{{state_storage_path}}/runs' \
  --stale-minutes '{{capacity_limits.stale_run_minutes}}' \
  --apply 'true'

# Rebuild wave readiness markers after recovery
hatch-ops wave run --op create-ready \
  --repo '{{target_repo}}' \
  --selected-waves '{{recovery.selected_waves_json}}'
```

## 5) Guardrails (non-negotiable)

- Do **not** claim monitoring unless a real foreground command, daemon, or subscription is currently running.
- Do **not** use hidden temp runtime loops or detached ad-hoc scripts (`/tmp` while-loop monitors, orphan nohup wrappers).
- Always start explicit monitoring/dispatch mechanisms before claiming coverage.
- Route fixes through deterministic CLI commands first; avoid manual state file edits.
- Keep infra bug routing explicit to `{{infra_issue_repo}}`.

## 6) Troubleshooting map (symptom → command → action)

| Symptom | Command | Action |
|---|---|---|
| Open infra bugs keep reappearing | `hatch-ops supervisor run --op state-snapshot --repo '{{infra_issue_repo}}'` | Run fast bug route and verify bug disposition (fix or convert) before dispatching new waves. |
| Tick appears active but outcomes flat | `hatch-ops supervisor run --op health-check --repo '{{target_repo}}' --run-id '{{run_id}}' --pipeline '{{entry_graph}}'` | Compare shipped outcomes vs activity; if no outcome deltas, route as incident and fix gating logic. |
| Dispatch not selecting waves | `hatch-ops wave run --op enumerate-slots ...` and `... wave run --op dispatch-select ...` | Validate capacity + ready marker state, then regenerate markers with `wave run --op create-ready`. |
| Judge node failing preconditions | `hatch-ops judge run --op validate-context-contract ...` | If code shows `judge_context_scenarios_missing`, add scenario context file then re-run validation. |
| Docs policy/quality gate fails | `pnpm docs:check` then `pnpm docs:state:check` | Apply docs contract fixes per `docs/governance/docs-quality-runbook.md` and re-run checks. |

## 7) Extension checklist

When adding new roles/nodes:
1. Add deterministic command first (`hatch-ops` command route + implementation + tests).
2. Add graph node with inline reference comment to source command/graph.
3. Add metrics keys for retry/review/judge/model attribution.
4. Update role contract and state/evaluation docs.
5. Re-run validation commands in this runbook.
