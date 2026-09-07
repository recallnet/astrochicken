import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { legacyFixtureFactoryActiveSummary as factoryActiveSummary } from "../../src/lib/factory-status-support.ts";

function writeRun(runsDir, id, state) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

test("factoryActiveSummary derives parent goal-run current issue progress from state context", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-active-summary-goal-run-progress-"));

  writeRun(runsDir, "goal-run-1700", {
    runId: "goal-run-1700",
    pipeline: "/tmp/goal_execute.dot",
    status: "running",
    currentNode: "execute_issue",
    startedAt: "2026-03-28T21:49:42.479Z",
    updatedAt: "2026-03-29T01:09:21.000Z",
    context: {
      goal_issue_number: "1700",
      next_issue_number: "1706",
      processed_issues: "[\"1703\",\"1704\",\"1705\"]",
      completed_issues: "[\"1703\",\"1704\",\"1705\"]",
    },
  });

  const summary = factoryActiveSummary({
    runsDir,
    now: Date.parse("2026-03-29T01:20:00.000Z"),
  });

  assert.equal(summary.non_wave_active.length, 1);
  assert.equal(summary.non_wave_active[0].issue_number, 1700);
  assert.equal(summary.non_wave_active[0].goal_issue_number, 1700);
  assert.equal(summary.non_wave_active[0].current_issue_number, 1706);
  assert.equal(summary.non_wave_active[0].completed_issues, 3);
  assert.deepEqual(summary.non_wave_active[0].completed_issue_numbers, [1703, 1704, 1705]);
});
