import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { projectGoalFinalState } from "../../src/lib/goal-final-state-projection.ts";

function writeRunState(runsDir, runId, state) {
  const dir = join(runsDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8");
}

test("projectGoalFinalState keeps partially completed goals open from canonical packet + run history", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-projection-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const packetsDir = join(repoRoot, ".hatch", "mothership", "packets", "goal_decomposition_packet");
  mkdirSync(packetsDir, { recursive: true });
  writeFileSync(join(packetsDir, "goal-2500.json"), JSON.stringify({
    packet_type: "goal_decomposition_packet",
    packet_state: "open",
    created_at: "2026-03-26T10:00:00.000Z",
    goal_issue_number: "2500",
    created_issue_numbers: ["2501", "2502", "2503"],
  }), "utf8");

  writeRunState(runsDir, "run-1", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "2500",
      completed_issues: "[\"2501\",\"2502\"]",
    },
  });

  const projection = projectGoalFinalState({
    repo: repoRoot,
    goalNumber: "2500",
    runsDir,
    factoryId: "mothership",
  });

  assert.equal(projection.has_sub_issues, true);
  assert.equal(projection.total_sub_issue_count, 3);
  assert.deepEqual(projection.closed_sub_issue_numbers, ["2501", "2502"]);
  assert.deepEqual(projection.open_sub_issue_numbers, ["2503"]);
  assert.equal(projection.any_open_sub_issues, true);

  rmSync(repoRoot, { recursive: true, force: true });
});

test("projectGoalFinalState trusts current sub-issue closure when terminal goal run history is stale", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-current-subissues-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const packetsDir = join(repoRoot, ".hatch", "mothership", "packets", "goal_decomposition_packet");
  mkdirSync(packetsDir, { recursive: true });
  writeFileSync(join(packetsDir, "goal-1608.json"), JSON.stringify({
    packet_type: "goal_decomposition_packet",
    packet_state: "open",
    created_at: "2026-03-27T00:00:00.000Z",
    goal_issue_number: "1608",
    created_issue_numbers: ["1629", "1631", "1632", "1633", "1634"],
  }), "utf8");

  writeRunState(runsDir, "run-1", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "1608",
      completed_issues: "[\"1629\",\"1631\"]",
    },
  });

  const projection = projectGoalFinalState({
    repo: repoRoot,
    goalNumber: "1608",
    runsDir,
    factoryId: "mothership",
    listSubIssuesFn: () => [
      { number: 1629, state: "closed" },
      { number: 1631, state: "closed" },
      { number: 1632, state: "closed" },
      { number: 1633, state: "closed" },
      { number: 1634, state: "closed" },
    ],
  });

  assert.equal(projection.has_sub_issues, true);
  assert.equal(projection.any_open_sub_issues, false);
  assert.equal(projection.open_sub_issue_count, 0);
  assert.deepEqual(projection.closed_sub_issue_numbers, ["1629", "1631", "1632", "1633", "1634"]);

  rmSync(repoRoot, { recursive: true, force: true });
});

test("projectGoalFinalState derives sub-issue membership from current projection when packet membership is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-subissue-fallback-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const projection = projectGoalFinalState({
    repo: repoRoot,
    goalNumber: "2568",
    runsDir,
    factoryId: "mothership",
    listSubIssuesFn: () => [
      { number: 2569, state: "closed" },
      { number: 2570, state: "closed" },
      { number: 2571, state: "closed" },
    ],
  });

  assert.equal(projection.has_sub_issues, true);
  assert.equal(projection.total_sub_issue_count, 3);
  assert.equal(projection.any_open_sub_issues, false);
  assert.equal(projection.open_sub_issue_count, 0);
  assert.deepEqual(projection.closed_sub_issue_numbers, ["2569", "2570", "2571"]);

  rmSync(repoRoot, { recursive: true, force: true });
});

test("projectGoalFinalState trusts canonical shipped sub-issue lifecycle when GitHub sub-issue state is stale", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-canonical-shipped-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const projection = projectGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "3000",
    runsDir,
    factoryId: "example-trading",
    listCanonicalIssueLifecycleFn: () => [
      {
        issue_number: "3001",
        parent_issue_number: "3000",
        repo: "example-org/example-trading",
        created: true,
        sub_issue_link_status: "linked",
        merge_status: "pushed",
        shipped_to_main: true,
        github_close_status: "",
        last_error: "",
      },
      {
        issue_number: "3002",
        parent_issue_number: "3000",
        repo: "example-org/example-trading",
        created: true,
        sub_issue_link_status: "linked",
        merge_status: "already_merged",
        shipped_to_main: true,
        github_close_status: "",
        last_error: "",
      },
    ],
    listSubIssuesFn: () => [
      { number: 3001, state: "open" },
      { number: 3002, state: "open" },
    ],
  });

  assert.equal(projection.has_sub_issues, true);
  assert.equal(projection.any_open_sub_issues, false);
  assert.deepEqual(projection.closed_sub_issue_numbers, ["3001", "3002"]);
  assert.deepEqual(projection.open_sub_issue_numbers, []);

  rmSync(repoRoot, { recursive: true, force: true });
});

test("projectGoalFinalState carries canonical goal close state independently from GitHub goal readback", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-goal-close-state-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const projection = projectGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "3000",
    runsDir,
    factoryId: "example-trading",
    listCanonicalGoalLifecycleFn: () => [
      {
        goal_issue_number: "3000",
        repo: "example-org/example-trading",
        goal_close_request_status: "requested",
        goal_close_request_reason: "all_sub_issues_shipped",
        goal_close_status: "failed",
        goal_close_reason: "completed",
        last_error: "projection_transport_failed",
      },
    ],
  });

  assert.equal(projection.goal_close_request_status, "requested");
  assert.equal(projection.goal_close_request_reason, "all_sub_issues_shipped");
  assert.equal(projection.goal_close_status, "failed");
  assert.equal(projection.goal_close_reason, "completed");
  assert.equal(projection.goal_close_error, "projection_transport_failed");

  rmSync(repoRoot, { recursive: true, force: true });
});

test("projectGoalFinalState prefers GitHub sub-issues when re-decomposition added more issues than the packet recorded", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-final-state-redecompose-"));
  const runsDir = join(repoRoot, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  // First decomposition created 3 sub-issues (all now closed)
  const packetsDir = join(repoRoot, ".hatch", "example-trading", "packets", "goal_decomposition_packet");
  mkdirSync(packetsDir, { recursive: true });
  writeFileSync(join(packetsDir, "goal-1780.json"), JSON.stringify({
    packet_type: "goal_decomposition_packet",
    packet_state: "open",
    created_at: "2026-03-30T00:00:00.000Z",
    goal_issue_number: "1780",
    created_issue_numbers: ["1822", "1823", "1824"],
  }), "utf8");

  writeRunState(runsDir, "run-first-decompose", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "1780",
      completed_issues: "[\"1822\",\"1823\",\"1824\"]",
    },
  });

  // Re-decomposition added 13 more sub-issues (all open), but the packet only
  // records the first 3. GitHub sub-issues show the full 16.
  const projection = projectGoalFinalState({
    repo: repoRoot,
    goalNumber: "1780",
    runsDir,
    factoryId: "example-trading",
    listSubIssuesFn: () => [
      { number: 1822, state: "closed" },
      { number: 1823, state: "closed" },
      { number: 1824, state: "closed" },
      { number: 1807, state: "open" },
      { number: 1808, state: "open" },
      { number: 1809, state: "open" },
      { number: 1810, state: "open" },
      { number: 1811, state: "open" },
      { number: 1812, state: "open" },
      { number: 1813, state: "open" },
      { number: 1814, state: "open" },
      { number: 1859, state: "open" },
      { number: 1860, state: "open" },
      { number: 1861, state: "open" },
      { number: 1862, state: "open" },
      { number: 1863, state: "open" },
    ],
  });

  assert.equal(projection.has_sub_issues, true, "goal should have sub-issues");
  assert.equal(projection.any_open_sub_issues, true, "goal should have open sub-issues from re-decomposition");
  assert.equal(projection.total_sub_issue_count, 16, "should use all 16 GitHub sub-issues, not just the 3 from the packet");
  assert.ok(projection.open_sub_issue_count >= 13, "at least 13 open sub-issues from later decomposition");

  rmSync(repoRoot, { recursive: true, force: true });
});
