import assert from "node:assert/strict";
import test from "node:test";

import {
  canAutoCloseGoal,
  listActiveGoalRuns,
  reconcileGoalFinalState,
} from "../../src/commands/goal-final-state-review.ts";

function makeIssueSource(goal = null) {
  return {
    issueView() {
      return goal;
    },
  };
}

function makeCanonicalGoalProjection({
  goal_number = "",
  total_sub_issue_count = 0,
  closed_sub_issue_numbers = [],
  open_sub_issue_numbers = [],
  has_sub_issues = false,
  any_open_sub_issues = false,
  goal_close_request_status = "",
  goal_close_request_reason = "",
  goal_close_status = "",
  goal_close_reason = "",
  goal_close_error = "",
} = {}) {
  return {
    goal_number: String(goal_number),
    total_sub_issue_count: Number(total_sub_issue_count),
    closed_sub_issue_numbers: [...closed_sub_issue_numbers].map((value) => String(value)),
    open_sub_issue_numbers: [...open_sub_issue_numbers].map((value) => String(value)),
    closed_sub_issue_count: closed_sub_issue_numbers.length,
    open_sub_issue_count: open_sub_issue_numbers.length,
    has_sub_issues,
    any_open_sub_issues,
    goal_close_request_status: String(goal_close_request_status),
    goal_close_request_reason: String(goal_close_request_reason),
    goal_close_status: String(goal_close_status),
    goal_close_reason: String(goal_close_reason),
    goal_close_error: String(goal_close_error),
  };
}

function makeProjectionTarget(recordedCalls = [], {
  closeOk = true,
  editOk = true,
  commentOk = true,
} = {}) {
  return {
    issueClose({ number, reason }) {
      recordedCalls.push(["issue", "close", String(number), "--reason", String(reason || "")]);
      return { ok: closeOk };
    },
    issueEdit({ number, addLabels = [], removeLabels = [] } = {}) {
      const call = ["issue", "edit", String(number)];
      for (const label of addLabels) call.push("--add-label", String(label));
      for (const label of removeLabels) call.push("--remove-label", String(label));
      recordedCalls.push(call);
      return { ok: editOk };
    },
    issueComment({ number, body } = {}) {
      recordedCalls.push(["issue", "comment", String(number), "--body", String(body || "")]);
      return { ok: commentOk };
    },
  };
}

test("canAutoCloseGoal allows closure when all sub-issues closed", () => {
  const allowed = canAutoCloseGoal({
    goalState: "OPEN",
    hasSubIssues: true,
    anyOpenSubIssues: false,
  });
  assert.equal(allowed, true);
});

test("canAutoCloseGoal blocks closure when open sub-issues exist", () => {
  const allowed = canAutoCloseGoal({
    goalState: "OPEN",
    hasSubIssues: true,
    anyOpenSubIssues: true,
  });
  assert.equal(allowed, false);
});

test("canAutoCloseGoal blocks closure when goal has no sub-issues (never decomposed)", () => {
  const allowed = canAutoCloseGoal({
    goalState: "OPEN",
    hasSubIssues: false,
    anyOpenSubIssues: false,
  });
  assert.equal(allowed, false, "goal without sub-issues was never decomposed — must not auto-close");
});

test("canAutoCloseGoal remains projection-only and ignores historical goal state", () => {
  const allowed = canAutoCloseGoal({
    hasSubIssues: true,
    anyOpenSubIssues: false,
  });
  assert.equal(allowed, true);
});

// Regression: goal #2096 was stuck for >24h because the ready label was
// removed during execution and never re-added. reconcileGoalFinalState must
// ensure the ready label is present when the goal still has open sub-issues.
test("reconcileGoalFinalState re-adds ready label when goal has remaining open sub-issues", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2096",
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "2096",
      total_sub_issue_count: 3,
      closed_sub_issue_numbers: ["2145"],
      open_sub_issue_numbers: ["2146", "2147"],
      has_sub_issues: true,
      any_open_sub_issues: true,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });
  assert.equal(result.closedGoal, false);
  assert.equal(result.anyOpenSubIssues, true);
  assert.equal(result.reAddedReady, true);
  const addReadyCall = ghCalls.find((c) => c.includes("--add-label"));
  assert.ok(addReadyCall, "must call gh to add ready label");
  assert.ok(addReadyCall.includes("ready"), "must add the ready label");
});

test("reconcileGoalFinalState does not re-add ready when goal already has it", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "100",
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "100",
      total_sub_issue_count: 1,
      closed_sub_issue_numbers: [],
      open_sub_issue_numbers: ["1"],
      has_sub_issues: true,
      any_open_sub_issues: true,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });
  assert.equal(result.closedGoal, false);
  assert.equal(result.reAddedReady, true);
  const addReadyCall = ghCalls.find((c) => c.includes("--add-label"));
  assert.ok(addReadyCall, "canonical cutover always drives ready restoration from projection");
});

test("listActiveGoalRuns returns only other active runs for the same goal and forwards runsDir", () => {
  const readCalls = [];
  const activeGoalRuns = listActiveGoalRuns({
    runsDir: "/tmp/test-runs",
    goalNumber: "1403",
    excludeRunId: "current-run",
    readAllRunStatesFn: ({ runsDir }) => {
      readCalls.push(runsDir);
      return new Map([
        ["current-run", {
          runId: "current-run",
          status: "running",
          context: { goal_issue_number: "1403" },
        }],
        ["other-active-run", {
          runId: "other-active-run",
          status: "running",
          context: { issue_number: "1403" },
        }],
        ["terminal-run", {
          runId: "terminal-run",
          status: "completed",
          context: { issue_number: "1403" },
        }],
        ["different-goal-run", {
          runId: "different-goal-run",
          status: "running",
          context: { issue_number: "9999" },
        }],
      ]);
    },
  });

  assert.deepEqual(readCalls, ["/tmp/test-runs"]);
  assert.deepEqual(
    activeGoalRuns.map(({ runId }) => runId),
    ["other-active-run"],
  );
});

test("reconcileGoalFinalState does not close a goal while another active run for that goal still exists", async () => {
  const ghCalls = [];
  const runs = new Map([
    ["goal-run-active", {
      runId: "goal-run-active",
      status: "running",
      currentNode: "issues",
      pipelineFile: "goal_run.dot",
      context: { issue_number: "1403" },
    }],
    ["other-goal-run", {
      runId: "other-goal-run",
      status: "running",
      currentNode: "issues",
      pipelineFile: "goal_run.dot",
      context: { issue_number: "9999" },
    }],
  ]);

  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "1403",
    runId: "sweep-run",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => runs,
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1403",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1410", "1411"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, false);
  assert.equal(result.skippedGoalClosureReason, "goal_has_active_runs");
  assert.equal(result.activeGoalRunCount, 1);
  assert.deepEqual(result.activeGoalRunIds, ["goal-run-active"]);
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCall, undefined, "must not close goal while another active run for the same goal exists");
});

test("reconcileGoalFinalState fails closed when active-run guard cannot inspect runs", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "1403",
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1403",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1410", "1411"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, false);
  assert.equal(result.skippedGoalClosureReason, "active_goal_run_guard_unavailable");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCall, undefined, "must not close goal when active-run guard cannot inspect runs");
});

test("reconcileGoalFinalState blocks premature closure when canonical projection still has open sub-issues", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2500",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => new Map(),
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "2500",
      total_sub_issue_count: 3,
      closed_sub_issue_numbers: ["2501", "2502"],
      open_sub_issue_numbers: ["2503"],
      has_sub_issues: true,
      any_open_sub_issues: true,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, false);
  assert.equal(result.openSubIssueCount, 1);
  assert.equal(result.skippedGoalClosureReason, "");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCall, undefined, "must not close goal from partial canonical completion");
});

test("reconcileGoalFinalState closes goals when current sub-issue projection shows every packet-created child closed", async () => {
  const ghCalls = [];
  const projectionCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    repoRoot: "/srv/astrochicken",
    goalNumber: "1608",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => new Map(),
    listGoalSubIssuesFn: () => [
      { number: 1629, state: "closed" },
      { number: 1631, state: "closed" },
      { number: 1632, state: "closed" },
      { number: 1633, state: "closed" },
      { number: 1634, state: "closed" },
    ],
    projectGoalFinalStateFn: (options) => {
      projectionCalls.push(options);
      return makeCanonicalGoalProjection({
      goal_number: options.goalNumber,
      total_sub_issue_count: 5,
      closed_sub_issue_numbers: ["1629", "1631", "1632", "1633", "1634"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
      });
    },
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.openSubIssueCount, 0);
  assert.equal(projectionCalls[0].repo, "/srv/astrochicken");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "must close goal when packet-created sub-issues are all currently closed");
});

test("reconcileGoalFinalState records canonical goal close request and applied events when closure succeeds", async () => {
  const ghCalls = [];
  const appended = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1789",
    runId: "goal-close-run",
    runsDir: "/tmp/test-runs",
    factoryId: "example-trading",
    repoRoot: "/srv/astrochicken",
    readAllRunStatesFn: () => new Map(),
    appendCanonicalEventsFn: ({ events }) => {
      appended.push(...events);
      return 42;
    },
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1789",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1791", "1792"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.canonical_event_commit_cursor, 42);
  assert.equal(appended.some((event) => event.event_family === "factory.goal.close_requested"), true);
  assert.equal(appended.some((event) => event.event_family === "factory.goal.close_applied"), true);
});

test("reconcileGoalFinalState treats canonically closed goals as already finalized without issuing another close", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1789",
    runId: "goal-close-run",
    runsDir: "/tmp/test-runs",
    factoryId: "example-trading",
    readAllRunStatesFn: () => new Map(),
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1789",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1791", "1792"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
      goal_close_status: "closed",
      goal_close_reason: "completed",
    }),
    readGoalIssueFn: () => ({ number: 1789, state: "CLOSED" }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.goalCloseStatus, "closed");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCall, undefined, "must not re-close goal once canonical lifecycle says it is closed");
});

test("reconcileGoalFinalState repairs GitHub projection when canonical goal close is already closed but the issue is still open", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1789",
    runId: "goal-close-run",
    runsDir: "/tmp/test-runs",
    factoryId: "example-trading",
    readAllRunStatesFn: () => new Map(),
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1789",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1791", "1792"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
      goal_close_status: "closed",
      goal_close_reason: "completed",
    }),
    readGoalIssueFn: () => ({ number: 1789, state: "OPEN" }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.goalCloseStatus, "closed");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "must repair GitHub projection when canonical close says goal is closed but GitHub is still open");
});

test("reconcileGoalFinalState fails closed when canonical goal close projection repair cannot close the still-open goal", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1789",
    runId: "goal-close-run",
    runsDir: "/tmp/test-runs",
    factoryId: "example-trading",
    readAllRunStatesFn: () => new Map(),
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1789",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1791", "1792"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
      goal_close_status: "closed",
      goal_close_reason: "completed",
    }),
    readGoalIssueFn: () => ({ number: 1789, state: "OPEN" }),
    githubProjectionTarget: makeProjectionTarget(ghCalls, { closeOk: false }),
  });

  assert.equal(result.closedGoal, false);
  assert.equal(result.goalCloseStatus, "closed");
  assert.equal(result.skippedGoalClosureReason, "goal_close_projection_repair_failed");
  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "must attempt projection repair before giving up");
});

test("reconcileGoalFinalState direct mode closes goal, removes ready label, and comments deterministically", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2198",
    mode: "direct",
    directGoalResult: "merged",
    runId: "run-direct-success",
    directGoalOutcomeNotes: "merged via goal_execute",
    githubIssueSource: makeIssueSource({
      state: "OPEN",
      number: 2198,
      labels: [{ name: "goal" }, { name: "ready" }],
      comments: [],
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.mode, "direct");
  assert.equal(result.direct_goal_success, true);
  assert.equal(result.closedGoal, true);
  assert.equal(result.removedReady, true);
  assert.equal(result.postedDirectFinalizerComment, true);

  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "must close direct goal on success");

  const removeReadyCall = ghCalls.find((c) => c.includes("--remove-label"));
  assert.ok(removeReadyCall, "must remove ready label on successful direct close");

  const commentCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "comment");
  assert.ok(commentCall, "must leave deterministic completion comment");
  const body = String(commentCall[commentCall.indexOf("--body") + 1] || "");
  assert.match(body, /goal-final-state:direct:success:merged/);
  assert.match(body, /direct_goal_execution=true/);
  assert.match(body, /run_id=run-direct-success/);
});

test("reconcileGoalFinalState direct mode keeps goal open, re-adds ready label, and comments on failure", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2198",
    mode: "direct",
    directGoalResult: "failed",
    runId: "run-direct-fail",
    directGoalOutcomeNotes: "judge failed",
    githubIssueSource: makeIssueSource({
      state: "OPEN",
      number: 2198,
      labels: [{ name: "goal" }],
      comments: [],
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.mode, "direct");
  assert.equal(result.direct_goal_success, false);
  assert.equal(result.closedGoal, false);
  assert.equal(result.reAddedReady, true);
  assert.equal(result.postedDirectFinalizerComment, true);

  const closeCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCall, undefined, "must not close goal when direct execution failed");

  const addReadyCall = ghCalls.find((c) => c.includes("--add-label"));
  assert.ok(addReadyCall, "must re-add ready label for retry");

  const commentCall = ghCalls.find((c) => c[0] === "issue" && c[1] === "comment");
  assert.ok(commentCall, "must leave deterministic failure comment");
  const body = String(commentCall[commentCall.indexOf("--body") + 1] || "");
  assert.match(body, /goal-final-state:direct:failure:failed/);
  assert.match(body, /direct_goal_execution=true/);
  assert.match(body, /retry_ready_label=present/);
});

test("reconcileGoalFinalState direct success keeps goal retryable when close fails", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2198",
    mode: "direct",
    directGoalResult: "merged",
    runId: "run-direct-close-fail",
    directGoalOutcomeNotes: "merge happened but close failed",
    githubIssueSource: makeIssueSource({
      state: "OPEN",
      number: 2198,
      labels: [{ name: "goal" }],
      comments: [],
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls, { closeOk: false }),
  });

  assert.equal(result.mode, "direct");
  assert.equal(result.direct_goal_success, true);
  assert.equal(result.closedGoal, false);
  assert.equal(result.skippedGoalClosureReason, "direct_goal_close_failed");
  assert.equal(result.reAddedReady, true);
  assert.equal(result.removedReady, false);
  assert.equal(result.postedDirectFinalizerComment, true);

  const addReadyCall = ghCalls.find((c) => c.includes("--add-label"));
  assert.ok(addReadyCall, "must add ready label when direct close fails");

  const removeReadyCall = ghCalls.find((c) => c.includes("--remove-label"));
  assert.equal(removeReadyCall, undefined, "must not remove ready label when close fails");
});

test("reconcileGoalFinalState direct mode no longer depends on GitHub readback for finalizer idempotence", async () => {
  const ghCalls = [];
  const result = await reconcileGoalFinalState({
    repo: "test/repo",
    goalNumber: "2198",
    mode: "direct",
    directGoalResult: "merged",
    runId: "run-direct-success",
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  assert.equal(result.mode, "direct");
  assert.equal(result.closedGoal, true);
  assert.equal(result.directCommentAlreadyPresent, false);
  assert.equal(result.skippedGoalClosureReason, "");

  assert.equal(
    ghCalls.some((c) => c[0] === "issue" && c[1] === "close"),
    true,
    "canonical cutover closes from the direct result without reading GitHub state first",
  );
  assert.equal(
    ghCalls.some((c) => c[0] === "issue" && c[1] === "comment"),
    true,
    "canonical cutover emits the deterministic direct finalizer comment on the write path",
  );
});

// --- Sub-issue closure on goal completion (merge-failed orphan bug) ---

test("reconcileGoalFinalState does NOT close open sub-issues when executions completed but the merge did not land", async () => {
  const ghCalls = [];
  const subIssues = [
    { number: 1727, state: "open" },
    { number: 1728, state: "open" },
    { number: 1730, state: "open" },
  ];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1702",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => new Map(),
    allSubIssueExecutionsCompleted: true,
    listGoalSubIssuesFn: () => subIssues,
    projectGoalFinalStateFn: ({ listSubIssuesFn }) => {
      const issues = listSubIssuesFn({ goalNumber: "1702" });
      const open = issues.filter((i) => i.state === "open");
      const closed = issues.filter((i) => i.state !== "open");
      return makeCanonicalGoalProjection({
        goal_number: "1702",
        total_sub_issue_count: issues.length,
        closed_sub_issue_numbers: closed.map((i) => String(i.number)),
        open_sub_issue_numbers: open.map((i) => String(i.number)),
        has_sub_issues: issues.length > 0,
        any_open_sub_issues: open.length > 0,
      });
    },
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  const closeCalls = ghCalls.filter((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCalls.length, 0, "must not close sub-issues when the merge never landed");
  assert.equal(result.closedSubIssueNumbers.length, 0, "must not report API-closed sub-issues");
  assert.equal(result.closedGoal, false, "parent goal must stay open for retry");
  assert.equal(result.reAddedReady, true, "goal must be put back in ready state");
});

test("reconcileGoalFinalState does NOT close sub-issues when allSubIssueExecutionsCompleted is false", async () => {
  const ghCalls = [];

  const result = await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "1702",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => new Map(),
    allSubIssueExecutionsCompleted: false,
    listGoalSubIssuesFn: () => [
      { number: 1727, state: "open" },
      { number: 1728, state: "closed" },
    ],
    projectGoalFinalStateFn: () => makeCanonicalGoalProjection({
      goal_number: "1702",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1728"],
      open_sub_issue_numbers: ["1727"],
      has_sub_issues: true,
      any_open_sub_issues: true,
    }),
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  const closeCalls = ghCalls.filter((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCalls.length, 0, "must NOT close sub-issues when executions are still in progress");
  assert.equal(result.closedGoal, false, "parent must stay open");
  assert.equal(result.reAddedReady, true, "ready label must be re-added for retry");
});

test("reconcileGoalFinalState only closes OPEN sub-issues, not already-closed ones", async () => {
  const ghCalls = [];

  await reconcileGoalFinalState({
    repo: "example-org/example-trading",
    goalNumber: "100",
    runsDir: "/tmp/test-runs",
    readAllRunStatesFn: () => new Map(),
    allSubIssueExecutionsCompleted: true,
    listGoalSubIssuesFn: () => [
      { number: 101, state: "closed" },
      { number: 102, state: "open" },
      { number: 103, state: "closed" },
    ],
    projectGoalFinalStateFn: ({ listSubIssuesFn }) => {
      const issues = listSubIssuesFn({ goalNumber: "100" });
      const open = issues.filter((i) => i.state === "open");
      const closed = issues.filter((i) => i.state !== "open");
      return makeCanonicalGoalProjection({
        goal_number: "100",
        total_sub_issue_count: issues.length,
        closed_sub_issue_numbers: closed.map((i) => String(i.number)),
        open_sub_issue_numbers: open.map((i) => String(i.number)),
        has_sub_issues: true,
        any_open_sub_issues: open.length > 0,
      });
    },
    githubProjectionTarget: makeProjectionTarget(ghCalls),
  });

  const closeCalls = ghCalls.filter((c) => c[0] === "issue" && c[1] === "close");
  assert.equal(closeCalls.length, 0, "merge-failed finalization must not API-close sub-issues or parent goal");
});
