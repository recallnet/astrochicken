import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutionPlan,
  fetchSubIssueBlockedBy,
  buildExecutionPlanFromGoal,
  pickPlanIssue,
} from "../../src/commands/goal-execution-plan.ts";


// ─── buildExecutionPlan (pure toposort) ─────────────────────────────────────

test("buildExecutionPlan orders independent issues by number (stable sort)", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 103, title: "C", state: "open" },
      { number: 101, title: "A", state: "open" },
      { number: 102, title: "B", state: "open" },
    ],
    blockedByMap: {},
    completedIssues: [],
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["101", "102", "103"],
  );
  assert.equal(plan.total, 3);
  assert.equal(plan.planned, 3);
  assert.equal(plan.cycle_blocked, 0);
});

test("buildExecutionPlan respects linear dependency chain A -> B -> C", () => {
  // C blocked by B, B blocked by A
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 3, title: "C", state: "open" },
      { number: 1, title: "A", state: "open" },
      { number: 2, title: "B", state: "open" },
    ],
    blockedByMap: {
      2: [{ number: 1, state: "OPEN" }],
      3: [{ number: 2, state: "OPEN" }],
    },
    completedIssues: [],
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["1", "2", "3"],
  );
  assert.equal(plan.planned, 3);
  assert.equal(plan.cycle_blocked, 0);
});

test("buildExecutionPlan handles diamond dependency (A blocks B and C, both block D)", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "open" },
      { number: 2, title: "B", state: "open" },
      { number: 3, title: "C", state: "open" },
      { number: 4, title: "D", state: "open" },
    ],
    blockedByMap: {
      2: [{ number: 1, state: "OPEN" }],
      3: [{ number: 1, state: "OPEN" }],
      4: [{ number: 2, state: "OPEN" }, { number: 3, state: "OPEN" }],
    },
    completedIssues: [],
  });
  const order = plan.execution_plan.map((i) => i.issue_number);
  assert.equal(order[0], "1", "A must be first");
  assert.equal(order[3], "4", "D must be last");
  assert.equal(plan.planned, 4);
});

test("buildExecutionPlan filters out already-completed issues", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "closed" },
      { number: 2, title: "B", state: "open" },
      { number: 3, title: "C", state: "open" },
    ],
    blockedByMap: {
      2: [{ number: 1, state: "CLOSED" }],
      3: [{ number: 2, state: "OPEN" }],
    },
    completedIssues: ["1"],
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["2", "3"],
  );
  assert.equal(plan.total, 2);
  assert.equal(plan.planned, 2);
});

test("buildExecutionPlan ignores blockers outside the sub-issue set", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 10, title: "A", state: "open" },
      { number: 11, title: "B", state: "open" },
    ],
    blockedByMap: {
      11: [{ number: 999, state: "OPEN" }], // 999 not a sub-issue
    },
    completedIssues: [],
  });
  // External blocker ignored — B is unblocked within the plan
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["10", "11"],
  );
  assert.equal(plan.planned, 2);
});

test("buildExecutionPlan ignores closed blockers within sub-issue set", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "closed" },
      { number: 2, title: "B", state: "open" },
    ],
    blockedByMap: {
      2: [{ number: 1, state: "CLOSED" }],
    },
    completedIssues: ["1"],
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["2"],
  );
  assert.equal(plan.planned, 1);
});

test("buildExecutionPlan detects cycles and excludes cycled issues", () => {
  // A blocks B, B blocks A — cycle
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "open" },
      { number: 2, title: "B", state: "open" },
      { number: 3, title: "C", state: "open" },
    ],
    blockedByMap: {
      1: [{ number: 2, state: "OPEN" }],
      2: [{ number: 1, state: "OPEN" }],
    },
    completedIssues: [],
  });
  // Only C is plannable; A and B are in a cycle
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["3"],
  );
  assert.equal(plan.planned, 1);
  assert.equal(plan.cycle_blocked, 2);
});

test("buildExecutionPlan returns empty plan for no open issues", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "closed" },
    ],
    blockedByMap: {},
    completedIssues: ["1"],
  });
  assert.deepEqual(plan.execution_plan, []);
  assert.equal(plan.total, 0);
  assert.equal(plan.planned, 0);
});

test("buildExecutionPlan returns empty plan for empty input", () => {
  const plan = buildExecutionPlan({
    subIssues: [],
    blockedByMap: {},
    completedIssues: [],
  });
  assert.deepEqual(plan.execution_plan, []);
  assert.equal(plan.total, 0);
});

test("buildExecutionPlan skips quarantined issues", () => {
  const plan = buildExecutionPlan({
    subIssues: [
      { number: 1, title: "A", state: "open", labels: [{ name: "quarantined" }] },
      { number: 2, title: "B", state: "open" },
    ],
    blockedByMap: {},
    completedIssues: [],
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["2"],
  );
  assert.equal(plan.total, 1);
  assert.equal(plan.planned, 1);
  assert.equal(plan.quarantined, 1);
});


// ─── fetchSubIssueBlockedBy ─────────────────────────────────────────────────

test("fetchSubIssueBlockedBy returns blockedBy nodes from GraphQL", () => {
  const ghJsonFn = (args) => {
    const query = args.find((a) => a.startsWith("query="));
    assert.ok(query.includes("blockedBy"));
    return {
      data: {
        repository: {
          i101: { blockedBy: { nodes: [{ number: 100, state: "OPEN" }] } },
          i102: { blockedBy: { nodes: [] } },
        },
      },
    };
  };
  const result = fetchSubIssueBlockedBy({
    repo: "owner/repo",
    issueNumbers: [101, 102],
    ghJsonFn,
  });
  assert.deepEqual(result[101], [{ number: 100, state: "OPEN" }]);
  assert.deepEqual(result[102], []);
});

test("fetchSubIssueBlockedBy returns empty map on GraphQL failure", () => {
  const ghJsonFn = () => { throw new Error("network"); };
  const result = fetchSubIssueBlockedBy({
    repo: "owner/repo",
    issueNumbers: [101],
    ghJsonFn,
  });
  assert.deepEqual(result, {});
});

test("fetchSubIssueBlockedBy returns empty map for empty issue list", () => {
  const result = fetchSubIssueBlockedBy({
    repo: "owner/repo",
    issueNumbers: [],
    ghJsonFn: () => ({}),
  });
  assert.deepEqual(result, {});
});


// ─── buildExecutionPlanFromGoal (IO wrapper) ────────────────────────────────

test("buildExecutionPlanFromGoal composes sub-issue query + blocked_by + toposort", () => {
  const plan = buildExecutionPlanFromGoal({
    repo: "owner/repo",
    goalNumber: "2181",
    completedIssues: [],
    listSubIssuesFn: () => [
      { number: 2186, title: "A", state: "open" },
      { number: 2187, title: "B", state: "open" },
      { number: 2188, title: "C", state: "open" },
    ],
    fetchBlockedByFn: () => ({
      2187: [{ number: 2186, state: "OPEN" }],
      2188: [{ number: 2187, state: "OPEN" }, { number: 2186, state: "OPEN" }],
    }),
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["2186", "2187", "2188"],
  );
  assert.equal(plan.planned, 3);
  assert.equal(plan.direct_execution, false);
  assert.equal(plan.plan_type, "goal_decomposed_execute");
});

test("buildExecutionPlanFromGoal returns empty plan for missing repo", () => {
  const plan = buildExecutionPlanFromGoal({
    repo: "",
    goalNumber: "123",
  });
  assert.deepEqual(plan.execution_plan, []);
  assert.equal(plan.total, 0);
  assert.equal(plan.direct_execution, false);
  assert.equal(plan.plan_type, "goal_decomposed_execute");
});

test("buildExecutionPlanFromGoal filters completed and respects closed blockers", () => {
  const plan = buildExecutionPlanFromGoal({
    repo: "owner/repo",
    goalNumber: "2181",
    completedIssues: ["2186", "2187"],
    listSubIssuesFn: () => [
      { number: 2186, title: "A", state: "closed" },
      { number: 2187, title: "B", state: "closed" },
      { number: 2188, title: "C", state: "open" },
    ],
    fetchBlockedByFn: () => ({
      2188: [{ number: 2187, state: "CLOSED" }, { number: 2186, state: "CLOSED" }],
    }),
  });
  assert.deepEqual(
    plan.execution_plan.map((i) => i.issue_number),
    ["2188"],
  );
  assert.equal(plan.planned, 1);
  assert.equal(plan.direct_execution, false);
  assert.equal(plan.plan_type, "goal_decomposed_execute");
});

test("buildExecutionPlanFromGoal returns direct goal-native plan when direct execution is requested", () => {
  const plan = buildExecutionPlanFromGoal({
    repo: "owner/repo",
    goalNumber: "2198",
    directExecution: "true",
    directExecutionPath: "easy",
    fetchGoalIssueFn: () => ({ number: 2198, title: "Goal: easy direct path" }),
    listSubIssuesFn: () => {
      throw new Error("listSubIssuesFn should not run for direct execution");
    },
    fetchBlockedByFn: () => {
      throw new Error("fetchBlockedByFn should not run for direct execution");
    },
  });

  assert.equal(plan.direct_execution, true);
  assert.equal(plan.plan_type, "goal_issue_execute");
  assert.equal(plan.total, 1);
  assert.equal(plan.planned, 1);
  assert.deepEqual(plan.execution_plan, [{
    issue_number: "2198",
    issue_title: "Goal: easy direct path",
    plan_type: "goal_issue_execute",
    direct_execution: true,
  }]);
});

test("buildExecutionPlanFromGoal requires canonical routing metadata for easy direct execution via route hint", () => {
  const plan = buildExecutionPlanFromGoal({
    repo: "owner/repo",
    goalNumber: "2200",
    directExecutionPath: "easy",
    goalRoutingState: JSON.stringify({ decomposition_state: "not_required", planning_state: "not_required" }),
    goalExecutionPathVersion: "routing/v1",
    goalExecutionPathPacketId: "packet-2200",
    fetchGoalIssueFn: () => ({ number: 2200, title: "Goal: canonical easy path" }),
    listSubIssuesFn: () => {
      throw new Error("listSubIssuesFn should not run for canonical easy direct execution");
    },
    fetchBlockedByFn: () => {
      throw new Error("fetchBlockedByFn should not run for canonical easy direct execution");
    },
  });

  assert.equal(plan.direct_execution, true);
  assert.equal(plan.plan_type, "goal_issue_execute");
  assert.equal(plan.total, 1);
  assert.equal(plan.planned, 1);
  assert.deepEqual(plan.execution_plan, [{
    issue_number: "2200",
    issue_title: "Goal: canonical easy path",
    plan_type: "goal_issue_execute",
    direct_execution: true,
  }]);
});

test("buildExecutionPlanFromGoal fails closed to decomposed execution when easy route hint lacks packet metadata", () => {
  let listedSubIssues = 0;
  let fetchedBlockedBy = 0;
  const plan = buildExecutionPlanFromGoal({
    repo: "owner/repo",
    goalNumber: "2201",
    directExecutionPath: "easy",
    goalRoutingState: JSON.stringify({ decomposition_state: "not_required", planning_state: "not_required" }),
    listSubIssuesFn: () => {
      listedSubIssues += 1;
      return [
        { number: 22011, title: "Sub issue", state: "open" },
      ];
    },
    fetchBlockedByFn: () => {
      fetchedBlockedBy += 1;
      return {};
    },
  });

  assert.equal(listedSubIssues, 1);
  assert.equal(fetchedBlockedBy, 1);
  assert.equal(plan.direct_execution, false);
  assert.equal(plan.plan_type, "goal_decomposed_execute");
  assert.deepEqual(plan.execution_plan, [{
    issue_number: "22011",
    issue_title: "Sub issue",
  }]);
});


// ─── pickPlanIssue ──────────────────────────────────────────────────────────

test("pickPlanIssue returns first issue from plan", () => {
  const result = pickPlanIssue({
    executionPlanRaw: JSON.stringify([
      { issue_number: "101", issue_title: "A" },
      { issue_number: "102", issue_title: "B" },
    ]),
    planIndex: 0,
  });
  assert.equal(result.has_next, true);
  assert.equal(result.next_issue_number, "101");
  assert.equal(result.next_issue_title, "A");
  assert.equal(result.plan_index, 0);
  assert.equal(result.remaining_count, 2);
});

test("pickPlanIssue advances to second issue", () => {
  const result = pickPlanIssue({
    executionPlanRaw: JSON.stringify([
      { issue_number: "101", issue_title: "A" },
      { issue_number: "102", issue_title: "B" },
    ]),
    planIndex: 1,
  });
  assert.equal(result.has_next, true);
  assert.equal(result.next_issue_number, "102");
  assert.equal(result.next_issue_title, "B");
  assert.equal(result.remaining_count, 1);
});

test("pickPlanIssue returns has_next=false when plan exhausted", () => {
  const result = pickPlanIssue({
    executionPlanRaw: JSON.stringify([
      { issue_number: "101", issue_title: "A" },
    ]),
    planIndex: 1,
  });
  assert.equal(result.has_next, false);
  assert.equal(result.next_issue_number, "");
  assert.equal(result.remaining_count, 0);
});

test("pickPlanIssue returns has_next=false for empty plan", () => {
  const result = pickPlanIssue({
    executionPlanRaw: "[]",
    planIndex: 0,
  });
  assert.equal(result.has_next, false);
});

test("pickPlanIssue handles malformed JSON gracefully", () => {
  const result = pickPlanIssue({
    executionPlanRaw: "not json",
    planIndex: 0,
  });
  assert.equal(result.has_next, false);
});
