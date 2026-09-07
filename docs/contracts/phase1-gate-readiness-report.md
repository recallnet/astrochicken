---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Checked-in Phase 1 gate-readiness audit showing canonical scope, hook/CI routing, and remaining attributable violations."
tags: [architecture, contracts, gates, generated, readiness, runtime]
written: "2026-03-20"
---

# Phase 1 Gate Readiness Report

Schema: `phase1_gate_readiness/v1`
Diagnostics: 0
Active graph roots: 40
Active graphs: 3
Active runtime files: 367
Active command references: 0
Graph transport violations: 0
Runtime internal CLI violations: 0
Runtime internal CLI allowlisted external boundaries: 0
Command thinness violations: 1

## Gate Scope Contract

| Gate | Surface | Classifications | Profiles |
| --- | --- | --- | --- |
| `typed_action_graph_transport` | `graph` | `active_factory, active_runtime` | `fast, strict, full` |
| `runtime_internal_cli_repo_wide` | `runtime` | `hot_path, execution_path` | `fast, strict, full` |
| `command_thinness_active_owner_surface` | `command` | `active_deterministic_owner` | `fast, strict, full` |

## Hook and CI Routes

| Route | Profile | Source | Gates |
| --- | --- | --- | --- |
| `pre_commit` | `strict` | `.githooks/pre-commit` | `typed_action_graph_transport, runtime_internal_cli_repo_wide, command_thinness_active_owner_surface, phase1_gate_readiness` |
| `pre_push` | `fast` | `.githooks/pre-push` | `typed_action_graph_transport, runtime_internal_cli_repo_wide, command_thinness_active_owner_surface, phase1_gate_readiness` |
| `pre_merge_script` | `full` | `package.json` | `typed_action_graph_transport, runtime_internal_cli_repo_wide, command_thinness_active_owner_surface, phase1_gate_readiness` |
| `pre_merge_workflow` | `full` | `.github/workflows/pre-merge-quality.yml` | `typed_action_graph_transport, runtime_internal_cli_repo_wide, command_thinness_active_owner_surface, phase1_gate_readiness` |

## graph transport

| File | Kind | Detail |
| --- | --- | --- |
| _none_ | _none_ | _none_ |

## runtime internal cli

| File | Kind | Detail |
| --- | --- | --- |

Allowlisted external boundaries: 0
| _none_ | _none_ | _none_ |

## command thinness

| File | Kind | Detail |
| --- | --- | --- |
| `packages/factory-ops/src/commands/goal-final-state-review.ts` | `command_thinness_hotspot` | `lines=403 class=oversized` |

## Diagnostics

- none
