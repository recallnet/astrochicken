// terminal-cleanup-release-requeue.contract.test.mjs
//
// Previously tested terminal cleanup, release, and requeue branches of wave_execute.dot.
// All functions under test (completeReadyWaveIssue, closeMergedIssues, blockReadyWaveIssue,
// releaseReadyWaveClaim, lockReadyWaveIssue, buildWaveReadyLeaseEvent, etc.) and the
// wave_execute.dot graph were removed during the wave->goal migration.
//
// Goal execution terminal paths are now tested via goal_execute.dot contracts
// in judge-gate-failure.contract.test.mjs and packet-resolver-retry.contract.test.mjs.

import test from "node:test";

test("terminal-cleanup-release-requeue — placeholder (wave claim ops removed in goal migration)", () => {
  // All wave claim/lease/block/close functions were deleted during the wave->goal migration.
  // The equivalent goal execution terminal paths are covered by other contract tests.
});
