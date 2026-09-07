# wave-judge-failure-0932c093 fixture

Deterministic regression fixture for bug #1042 using run `0932c093` (`goal-324-wave-3`).

## Provenance

- Run: `0932c093`
- Bug: #1042 (`[bug] wave-judge-failure: Judge failed for goal-324-wave-3.`)
- Milestone: `goal-324-wave-3`
- Scenario registry path used by the passing replay: `${repo}/factories/mothership/scenarios`
  - Rename note: in mothership naming this is `${repo}/factories/mothership/scenarios`.

## Artifacts

- `merge_candidates.json`
  - Stable merge-candidate payload for issue `#1031` on branch `wave/goal-324-wave-3`.
  - Includes commit metadata (`merge_commit_sha`) from the historical run.
- `review_evidence/issue-1031.json`
  - Deterministic judge evidence payload with QA markers and changed-files metadata.
  - Carries the canonical hidden-note token from bug #1042: `judge_context_scope_identity_missing`.

## Canonical telemetry strings

Expected failure-phase markers for this fixture replay:

- `judge_context_gate_code=judge_context_scenario_registry_root_missing`
- `judge_route_code=judge_context_scenario_registry_root_missing`
- `judge_notes` includes `JUDGE_CONTEXT_INVALID`
- Canonical hidden-note provenance includes `judge_context_scope_identity_missing`
- Signature marker: `wave-judge-failure` (run `0932c093`)

## Contract replay model

The regression test replays the same judge CLI sequence used by `wave_execute` post-merge gating:

1. `judge run --op build-evidence-contract`
2. `judge run --op build-context-contract`
3. `judge run --op validate-context-contract`
4. `judge run --op validate-evidence-contract` (only when context gate passes)

Phase 1 intentionally omits `--scenario-registry-root` and must fail with
`judge_context_scenario_registry_root_missing`.

Phase 2 reruns with `${repo}/factories/mothership/scenarios` and must pass
both context/evidence gates with no `wave-judge-failure` telemetry.
