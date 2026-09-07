# Goal-Decomposition Timeout Inventory

Generated from the goal-decomposition timeout resolver plus graph/node ownership contract checks.

Machine-readable source: `factories/mothership/inventory/goal-decomposition-timeouts.json`
Capability defaults source: `packages/capability-goal-decomposition/timeouts.defaults.json`
Factory root: `factories/mothership`
Factory override root: `capabilities.goal_decomposition.timeouts`
Factory config: `factories/mothership/factory.config.json`
Stages: 4

## Effective Budgets

| Stage | Graph | Node | Timeout | Timeout (ms) | Source | Source key | Default | Override |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `issue_draft` | `packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs` | `draft_issue_spec` | `30m` | 1800000 | `override` | `capabilities.goal_decomposition.timeouts.issue_draft` | `30m` | `30m` |
| `issue_judge` | `packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs` | `judge_issue` | `30m` | 1800000 | `override` | `capabilities.goal_decomposition.timeouts.issue_judge` | `30m` | `30m` |
| `issue_repair` | `packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs` | `repair_issue_spec` | `30m` | 1800000 | `override` | `capabilities.goal_decomposition.timeouts.issue_repair` | `30m` | `30m` |
| `issue_revise` | `packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs` | `revise_issue_spec` | `30m` | 1800000 | `override` | `capabilities.goal_decomposition.timeouts.issue_revise` | `30m` | `30m` |
