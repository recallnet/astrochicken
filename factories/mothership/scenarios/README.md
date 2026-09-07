# Intents Scenario Registry

Post-merge judge contracts read scenarios from the in-repo registry:

- Root: `factories/mothership/scenarios`
- Current selector path: `astrochicken/post-merge/*`
- Current judge filter: `--scenario-context 'post-merge' --scope 'judge'`

## Why this exists

This registry removes reliance on ambient `~/.scenarios` state for post-merge judge decisions. The judge context contract is expected to bind to repo-local scenario files so outputs are deterministic and replayable.

## Execution-time information wall

- Builder/session path (for example `goal_issue_execute.dot` `build` node) does **not** receive scenario artifacts or scenario text.
- Judge context path (for example `goal_execute.dot` / `wave_execute.dot` pre-merge context contract nodes) deterministically resolves scenario selection and persists:
  - `judge_scenario_selection_path`
  - `judge_scenario_selection_sha256`
  - `judge_scenario_selection_signature_sha256`
- Post-merge judge kinds fail closed when configured selectors resolve to zero scenarios:
  - `wave_execution_post_merge`
  - `goal_execution_post_merge`

## Extending scenarios

1. Add a new directory under the selector path (for example `astrochicken/post-merge/<name>/SCENARIO.md`).
2. Include YAML frontmatter keys:
   - `id`
   - `domain`
   - `priority`
   - `created`
   - `scope` (required today for judge filtering)
3. After frontmatter, keep only a concise 1–5 line holdout truth block.
4. Keep frontmatter aligned with judge invocation inputs:
   - `domain` ↔ `--scenario-context`
   - `scope` ↔ `--scope`
   - selector path ↔ `--scenario-selector`
5. Update contract tests if selector/filter expectations change.

## Contract alignment

For post-merge execution-time judge wiring, keep these synchronized:

- DOT invocations:
  - `factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs`
  - `factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs`
- Scenario frontmatter (`domain`, `scope`)
- Context contract assertions:
  - `packages/factory-ops/test/commands/judge-context-contract.test.mjs`
  - `packages/factory-ops/test/commands/scenario-information-wall.contract.test.mjs`

If any of these drift, the judge context gate should fail before merge with deterministic diagnostics.
