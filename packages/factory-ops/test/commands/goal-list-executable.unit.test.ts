import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTestAdapter } from "../../../github-adapter/src/test-adapter.ts";

import { listExecutableGoals } from "../../src/commands/goal-list-executable.ts";
import { buildGoalExecutionPathPacket } from "../../src/lib/goal-execution-path-packet.ts";

function makeGhJson({ goals = [], blockedByByGoal = {}, throwOnGraphQL = false } = {}) {
  return createTestAdapter({
    repo: "o/r",
    stubs: {
      issueList: () => goals,
      issueBlockedBy: ({ number }) => {
        if (throwOnGraphQL) return [];
        return blockedByByGoal[Number(number)] || [];
      },
      listSubIssues: () => [],
    },
  });
}

test("listExecutableGoals returns empty for missing repo", () => {
  const out = listExecutableGoals();
  assert.deepEqual(out, { executable_goals: [], goal_execution_paths: {}, count: 0, capped: false });
});

test("listExecutableGoals returns plain goal numbers for fan-out compatibility", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "Goal A" },
        { number: 20, title: "Goal B" },
      ],
    }),
    listSubIssuesFn: ({ goalNumber }) => {
      if (goalNumber === 10) return [{ state: "open" }, { state: "closed" }];
      if (goalNumber === 20) return [{ state: "open" }];
      return [];
    },
  });
  assert.equal(out.count, 2);
  // Must be plain numbers, not objects — fan_out.detached stringifies each item
  // and sets it as goal_issue_number in the child context.
  assert.deepEqual(out.executable_goals, [10, 20]);
  assert.deepEqual(out.goal_execution_paths, { "10": "unknown", "20": "unknown" });
  assert.equal(out.capped, false);
});

test("listExecutableGoals excludes goals with all sub-issues closed", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "Done Goal" },
        { number: 20, title: "Active Goal" },
      ],
    }),
    listSubIssuesFn: ({ goalNumber }) => {
      if (goalNumber === 10) return [{ state: "closed" }];
      if (goalNumber === 20) return [{ state: "open" }];
      return [];
    },
  });
  assert.equal(out.count, 1);
  assert.equal(out.executable_goals[0], 20);
  assert.deepEqual(out.goal_execution_paths, { "20": "unknown" });
});

test("listExecutableGoals caps results at maxConcurrent", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 1, title: "A" },
        { number: 2, title: "B" },
        { number: 3, title: "C" },
      ],
    }),
    maxConcurrent: 2,
    listSubIssuesFn: () => [{ state: "open" }],
  });
  assert.equal(out.count, 2);
  assert.equal(out.capped, true);
  assert.equal(out.executable_goals.length, 2);
  assert.deepEqual(out.goal_execution_paths, { "1": "unknown", "2": "unknown" });
});

test("listExecutableGoals sorts by issue number", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 30, title: "C" },
        { number: 10, title: "A" },
        { number: 20, title: "B" },
      ],
    }),
    listSubIssuesFn: () => [{ state: "open" }],
  });
  assert.deepEqual(out.executable_goals, [10, 20, 30]);
  assert.deepEqual(out.goal_execution_paths, { "10": "unknown", "20": "unknown", "30": "unknown" });
});

test("listExecutableGoals includes medium-path goals with no sub-issues when execution path metadata is durable", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-exec-medium-empty-"));

  const runMedium = join(runsDir, "run-medium");
  mkdirSync(runMedium, { recursive: true });
  writeFileSync(join(runMedium, "state.json"), JSON.stringify({
    status: "completed",
    context: {
      goal_execution_path: "medium",
    },
  }));
  writeFileSync(join(runMedium, "context.json"), JSON.stringify({ goal_issue_number: 10 }));

  const out = listExecutableGoals({
    adapter: makeGhJson({ goals: [{ number: 10, title: "Needs decomposition" }] }),
    runsDir,
    listSubIssuesFn: () => [],
  });
  assert.equal(out.count, 1);
  assert.deepEqual(out.executable_goals, [10]);
  assert.deepEqual(out.goal_execution_paths, { "10": "medium" });
});

test("listExecutableGoals includes easy goals with zero sub-issues when execution path metadata is easy", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-exec-easy-direct-"));

  const runEasy = join(runsDir, "run-easy");
  mkdirSync(runEasy, { recursive: true });
  writeFileSync(join(runEasy, "state.json"), JSON.stringify({
    status: "completed",
    context: {
      goal_execution_path: "easy",
    },
  }));
  writeFileSync(join(runEasy, "context.json"), JSON.stringify({ goal_issue_number: 10 }));

  const out = listExecutableGoals({
    adapter: makeGhJson({ goals: [{ number: 10, title: "Easy Goal" }] }),
    runsDir,
    listSubIssuesFn: () => [],
  });

  assert.equal(out.count, 1);
  assert.deepEqual(out.executable_goals, [10]);
  assert.deepEqual(out.goal_execution_paths, { "10": "easy" });
});

test("listExecutableGoals backs off recently failed goal runs when dispatch backoff is active", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-exec-backoff-"));
  const runFailed = join(runsDir, "run-failed");
  mkdirSync(runFailed, { recursive: true });
  writeFileSync(join(runFailed, "state.json"), JSON.stringify({
    status: "failed",
    endedAt: new Date().toISOString(),
  }));
  writeFileSync(join(runFailed, "context.json"), JSON.stringify({
    goal_issue_number: 10,
    impl_results: JSON.stringify([
      { issue_number: "101", review_failed: "true", review_notes: "retry later" },
    ]),
  }));

  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [{ number: 10, title: "Backoff Goal" }, { number: 20, title: "Ready Goal" }],
    }),
    runsDir,
    backoffSeconds: 60,
    listSubIssuesFn: ({ goalNumber }) => (goalNumber === 20 ? [{ state: "open" }] : [{ state: "open" }]),
  });

  assert.deepEqual(out.executable_goals, [20]);
  assert.match(JSON.stringify(out.skipped_reasons), /dispatch_backoff_active/);
});

test("listExecutableGoals excludes goals whose only open sub-issues are blocked_by or quarantined", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "All blocked" },
        { number: 20, title: "Has dispatchable" },
      ],
    }),
    listSubIssuesFn: ({ goalNumber }) => {
      if (goalNumber === 10) {
        return [
          { state: "closed", blocked_by_count: 0, labels: [] },
          { state: "open", blocked_by_count: 1, labels: [{ name: "quarantined" }] },
        ];
      }
      if (goalNumber === 20) {
        return [
          { state: "open", blocked_by_count: 1, labels: [] },
          { state: "open", blocked_by_count: 0, labels: [{ name: "feature" }] },
        ];
      }
      return [];
    },
  });
  assert.equal(out.count, 1);
  assert.deepEqual(out.executable_goals, [20]);
  assert.deepEqual(out.goal_execution_paths, { "20": "unknown" });
});

test("listExecutableGoals ignores stale GitHub open sub-issues that are canonically shipped", () => {
  const out = listExecutableGoals({
    repo: "example-org/example-trading",
    adapter: makeGhJson({
      goals: [{ number: 3000, title: "Canonically done goal" }],
    }),
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
    ],
    listSubIssuesFn: () => [
      { number: 3001, state: "open", blocked_by_count: 0, labels: [] },
    ],
  });

  assert.deepEqual(out.executable_goals, []);
  assert.equal(out.count, 0);
  assert.match(JSON.stringify(out.skipped_reasons), /no_dispatchable_sub_issues/);
});

test("listExecutableGoals preserves raw GitHub sub-issues when canonical link history lags behind a relink", () => {
  const out = listExecutableGoals({
    repo: "example-org/example-trading",
    adapter: makeGhJson({
      goals: [{ number: 1783, title: "Relinked goal" }],
    }),
    listCanonicalIssueLifecycleFn: () => [
      {
        issue_number: "1857",
        parent_issue_number: "1783",
        repo: "example-org/example-trading",
        created: true,
        sub_issue_link_status: "linked",
        merge_status: "pushed",
        shipped_to_main: true,
        github_close_status: "",
        last_error: "",
      },
      {
        issue_number: "1858",
        parent_issue_number: "1783",
        repo: "example-org/example-trading",
        created: true,
        sub_issue_link_status: "linked",
        merge_status: "pushed",
        shipped_to_main: true,
        github_close_status: "",
        last_error: "",
      },
    ],
    listSubIssuesFn: () => [
      { number: 1857, state: "closed", blocked_by_count: 0, labels: [] },
      { number: 1858, state: "closed", blocked_by_count: 0, labels: [] },
      { number: 1859, state: "open", blocked_by_count: 0, labels: [{ name: "feature" }, { name: "ready" }] },
    ],
  });

  assert.deepEqual(out.executable_goals, [1783]);
  assert.equal(out.count, 1);
  assert.deepEqual(out.goal_execution_paths, { "1783": "unknown" });
  assert.doesNotMatch(JSON.stringify(out.skipped_reasons), /no_dispatchable_sub_issues/);
});

// ─── adapter-based tests ─────────────────────────────────────────────────────

test("listExecutableGoals works with adapter for issueList", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      issueList: () => [
        { number: 10, title: "Goal A" },
        { number: 20, title: "Goal B" },
      ],
    },
  });
  const out = listExecutableGoals({
    adapter,
    listSubIssuesFn: ({ goalNumber }) => {
      if (goalNumber === 10) return [{ state: "open" }, { state: "closed" }];
      if (goalNumber === 20) return [{ state: "open" }];
      return [];
    },
  });
  assert.equal(out.count, 2);
  assert.deepEqual(out.executable_goals, [10, 20]);
  assert.deepEqual(out.goal_execution_paths, { "10": "unknown", "20": "unknown" });
  // Verify adapter was called
  assert.equal(adapter.callsTo("issueList").length, 1);
});

test("listExecutableGoals uses adapter for blockedBy and sub-issue reads when provided", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      issueList: () => [
        { number: 10, title: "Blocked goal" },
        { number: 20, title: "Ready goal" },
      ],
      issueBlockedBy: ({ number }) => (Number(number) === 10 ? [{ number: 9, state: "OPEN" }] : []),
      listSubIssues: ({ number }) => (Number(number) === 20 ? [{ state: "open", blocked_by_count: 0, labels: [] }] : [{ state: "open", blocked_by_count: 0, labels: [] }]),
    },
  });
  const out = listExecutableGoals({
    adapter,
    ghJsonFn: () => {
      throw new Error("ghJson must not be called when adapter is provided");
    },
  });

  assert.deepEqual(out.executable_goals, [20]);
  assert.equal(adapter.callsTo("issueBlockedBy").length, 2);
  assert.equal(adapter.callsTo("listSubIssues").length, 1);
});

test("listExecutableGoals skips goals with open goal-level blockedBy relationships", () => {
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "Blocked goal" },
        { number: 20, title: "Ready goal" },
      ],
      blockedByByGoal: {
        10: [{ number: 9, state: "OPEN" }],
        20: [],
      },
    }),
    listSubIssuesFn: () => [{ state: "open" }],
  });

  assert.deepEqual(out.executable_goals, [20]);
  assert.deepEqual(out.goal_execution_paths, { "20": "unknown" });
});

test("listExecutableGoals treats all goals as unblocked when batch blockedBy lookup fails", () => {
  // With batch queries, a total failure means all goals get empty blockedBy
  // and proceed to sub-issue checks (fail-open on blockedBy, sub-issues gate).
  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "Lookup failure goal" },
        { number: 20, title: "Ready goal" },
      ],
      throwOnGraphQL: true,
    }),
    listSubIssuesFn: () => [{ state: "open" }],
  });

  assert.deepEqual(out.executable_goals, [10, 20]);
  assert.deepEqual(out.goal_execution_paths, { "10": "unknown", "20": "unknown" });
});

test("listExecutableGoals reads persisted goal execution paths from run state context", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-exec-paths-"));

  const runEasy = join(runsDir, "run-easy");
  mkdirSync(runEasy, { recursive: true });
  writeFileSync(join(runEasy, "state.json"), JSON.stringify({
    status: "completed",
    context: {
      goal_execution_path: "easy",
    },
  }));
  writeFileSync(join(runEasy, "context.json"), JSON.stringify({ goal_issue_number: 10 }));

  const runFallbackUnknown = join(runsDir, "run-unknown");
  mkdirSync(runFallbackUnknown, { recursive: true });
  writeFileSync(join(runFallbackUnknown, "state.json"), JSON.stringify({
    status: "completed",
    context: {},
  }));
  writeFileSync(join(runFallbackUnknown, "context.json"), JSON.stringify({ goal_issue_number: 20 }));

  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [
        { number: 10, title: "Goal A" },
        { number: 20, title: "Goal B" },
      ],
    }),
    runsDir,
    listSubIssuesFn: () => [{ state: "open" }],
  });

  assert.deepEqual(out.executable_goals, [10, 20]);
  assert.deepEqual(out.goal_execution_paths, {
    "10": "easy",
    "20": "unknown",
  });
});

test("listExecutableGoals admits persisted medium-path packet goals when run context is absent", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-exec-packets-runs-"));
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-exec-packets-repo-"));
  const packetDir = join(repoRoot, ".hatch", "example-trading", "packets", "goal_execution_path_packet");
  mkdirSync(packetDir, { recursive: true });
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "10",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "goal_execution_path_migration/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedAt: "2026-03-24T00:00:00.000Z",
    classifiedBy: "goal.execution_path.ensure.migration",
    classificationReason: "test packet",
    understandingRisk: "unknown",
    rationaleRequired: false,
    factoryId: "example-trading",
    targetRepo: "o/r",
    controlPlaneRepo: "recallnet/astrochicken",
  });
  writeFileSync(join(packetDir, `${packet.packet_id}.json`), JSON.stringify(packet));

  const out = listExecutableGoals({
    adapter: makeGhJson({
      goals: [{ number: 10, title: "Needs decomposition" }],
    }),
    repoRoot,
    factoryId: "example-trading",
    runsDir,
    listSubIssuesFn: () => [],
  });

  assert.equal(out.count, 1);
  assert.deepEqual(out.executable_goals, [10]);
  assert.deepEqual(out.goal_execution_paths, { "10": "medium" });
  assert.doesNotMatch(JSON.stringify(out.skipped_reasons), /needs_decomposition|missing_execution_plan/);
});
