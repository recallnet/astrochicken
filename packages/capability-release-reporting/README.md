# Capability: Release Reporting

Deterministic release-reporting flow for factory ticks.

## Worthiness output contract

`hatch-ops release evaluate-worthiness` now emits deterministic significance metadata in addition to delivery routing:

- `worthiness_score` (number)
- `delivery_decision` (`skip|issue_only|slack_and_issue`)
- `should_generate_report` (`"true"|"false"`)
- `should_post_to_slack` (`"true"|"false"`)
- `reasons` (array)
- `significance_score` (number)
- `comprehension_significant` (`"true"|"false"`)
- `significance_reasons` (array)
- `release_context` (object)
  - includes `release_context.worthiness` with the fields above for narrator/publish/slack consumers

## Narrator output contract (non-skip)

Release narrator outputs must include comprehension fields:

- `structural_changes` (array, 1-3)
- `behavioral_shifts` (array, 1-3)
- `implicit_decisions` (array, 1-3)
- `entry_points` (array, 1-3)
- `watch_items` (array, 0-3)

Validator source: `packages/factory-ops/src/lib/release-narrative-validator.mjs`.
