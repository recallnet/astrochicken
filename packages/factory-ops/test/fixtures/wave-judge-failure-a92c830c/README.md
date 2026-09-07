# wave-judge-failure-a92c830c fixture

Deterministic regression fixture for bug #1014 using run `a92c830c` (`goal-1-wave-1`).

## Provenance

- Run: `a92c830c`
- Bug: #1014
- Milestone: `goal-1-wave-1`
- Hidden failure signature: `JUDGE_CONTEXT_INVALID: judge_context_scope_identity_missing`

## Artifacts

- `merge_candidates.json`
  - Base64-ready merge-candidate payload replayed by the test.
- `review_evidence/issue-1014.failing.json`
  - Omits required `judge_context_scope_identity` metadata.
  - Expected gate outcome: context gate fails with `judge_context_scope_identity_missing`.
- `review_evidence/issue-1014.passing.json`
  - Adds `judge_context_scope_identity: "wave_execute"`.
  - Adds minimal QA metadata (`qa.status=pass`, `qa.command`).
  - Expected gate outcome: context/evidence gates both pass.
- `review_evidence/failing/issue-1014.json` and `review_evidence/passing/issue-1014.json`
  - Mirror copies of the same failing/passing evidence payloads.
- `scenario_registry/astrochicken/post-merge/**/SCENARIO.md`
  - Deterministic local scenarios used by both failing/passing replays.

## Contract replay model

The test replays the same four-step judge CLI sequence used by `wave_execute` pre-merge gating:

1. `judge run --op build-evidence-contract`
2. `judge run --op build-context-contract`
3. `judge run --op validate-context-contract`
4. `judge run --op validate-evidence-contract`

Failing replay intentionally omits `--judge-context-scope-identity`, which must produce
`JUDGE_CONTEXT_INVALID: judge_context_scope_identity_missing`.
Passing replay sets `--judge-context-scope-identity wave_execute`, which must produce
`judge_context_gate_pass=true` and `judge_evidence_gate_pass=true`.
