# @hatch/capability-software-development

Shared software-development capability contract for managed factories.

This capability is the reusable boundary for coding/review/merge/failure-routing flows.
Managed factories (including Example Trading) should pass configuration/context into these entrypoints instead of defining local delivery graphs.

## Capability-owned stages

Capability ownership is declared in `capability-contract.v1.json > ownedStages` and implemented by these entrypoints:

| Stage | Entrypoint | Owns |
| --- | --- | --- |
| `goal_intake_handoff` | `graphs/goal_intake_to_execution_handoff.dot` | Decomposition handoff + executable-goal contract exports |
| `goal_execution_handoff` | `graphs/goal_execution_handoff.dot` | Execution/review/merge config normalization |
| `coding_worktree_execution` | `graphs/goal_issue_execute.dot` | Worktree setup + coder execution + issue evidence |
| `judge_review` | `graphs/goal_issue_execute.dot` | Reviewer context contracts, verdict routing, bounded retries |
| `merge_preparation_and_execution` | `graphs/goal_execute.dot` | Merge candidate split, judge gates, merge/rebase/push ceremony |
| `failure_routing` | `graphs/goal_execute.dot` | Postmortem/recovery packets + review/merge failure handling |

## Entrypoints

### `graphs/goal_intake_to_execution_handoff.dot`
Use when a ready goal issue should be decomposed and prepared for execution consumers.

### `graphs/goal_execution_handoff.dot`
Use when downstream execution/review/merge/reporting graphs need canonical execution contract keys.

### `graphs/goal_execute.dot`
Use to execute a goal’s issue set through the shared issue-execution loop, merge preparation, merge ceremony, and post-merge reporting outputs.

### `graphs/goal_issue_execute.dot`
Use to execute one goal issue on the shared goal branch with coder/reviewer sessions and deterministic retry routing.

## Required context

See `capability-contract.v1.json` for the fail-closed contract. Core portable requirements include:
- trust routing: `trust_domain`, `trust_role`
- repository/factory identity: `gh_repo`, `repo`, `factory_id`, `target_repo`, `control_plane_repo`
- goal identity: `issue_number` and/or `goal_issue_number`
- decomposition/execution support: `factory_root`, `scenarios_root`, `integration_command`, `review_qa_command`

## Ownership boundary (non-goals)

This capability does **not** own supervisor/runtime concerns:
- supervisor tick cadence
- detached-run spawning
- lease/lifecycle management
- bug-fast/open-bug routing policy

Those stay with the shared managed-supervisor shell/runtime (`packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs` + daemon/runtime surfaces).

This capability also does **not** own direct external transport/boundary adapters:
- direct GitHub transport belongs in shared adapters (for example `packages/github-adapter`)
- mutation/boundary enforcement belongs in shared guards (for example `packages/factory-runtime-guard`)

## Managed-factory usage contract

Example Trading should consume this capability through the shared managed domain graph `packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs` and should not define local coding/review/merge graphs.

Deterministic guards:
- `apps/hatch/src/pipeline/capability-software-development-factory-migration.contract.test.ts`
- `apps/hatch/src/pipeline/capability-software-development-manifest.contract.test.ts`
- `apps/hatch/src/pipeline/capability-software-development-execution.contract.test.ts`
