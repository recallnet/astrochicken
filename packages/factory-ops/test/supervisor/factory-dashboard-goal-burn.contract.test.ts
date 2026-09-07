import assert from "node:assert/strict";
import test from "node:test";

import { buildFactoryDashboard } from "../../src/lib/command-owners/factory-dashboard.ts";

test("buildFactoryDashboard surfaces current issue and zero-delta burn detail for long-running goal runs", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-29T01:10:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1700" }, { id: "goal-issue-1706" }],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 2,
      active_wave_count: 0,
      non_wave_active: [
        {
          run_id: "goal-run-1700",
          graph_label: "goal_execute.dot",
          issue_number: 1700,
          node: "execute_issue",
          age: "3h20m",
          last_progress_at: "2026-03-29T01:09:21.000Z",
          expected_next_outcome: "issue run completes",
          trace_kind: "run",
          trace_command: "node ... goal-run-1700",
        },
        {
          run_id: "goal-issue-1706",
          graph_label: "goal_issue_execute.dot",
          issue_number: 1706,
          goal_issue_number: 1700,
          node: "build",
          age: "31m",
          last_progress_at: "2026-03-29T01:09:21.000Z",
          expected_next_outcome: "issue run completes",
          trace_kind: "coder",
          trace_command: "node ... goal-issue-1706",
          no_git_delta_since_start: true,
          git_progress_status: "no_delta_since_start",
          git_progress_reason: "no_git_delta_since_start",
          worktree_clean: true,
          commits_ahead: 3,
          issue_commits_since_snapshot: 0,
          issue_changed_files: [],
        },
      ],
      waves: [],
    }),
    tickStatusFn: () => ({ ticks: [] }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 1700: "Latency optimization" }),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      assert.equal(goalNumber, 1700);
      return [
        { number: 1703, state: "closed" },
        { number: 1704, state: "closed" },
        { number: 1705, state: "closed" },
        { number: 1706, state: "open" },
        { number: 1707, state: "open" },
        { number: 1708, state: "open" },
        { number: 1709, state: "open" },
      ];
    },
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const goalRun = nowRows.find((row) => row.kind === "goal_run");
  const issueRun = nowRows.find((row) => row.kind === "goal_issue");

  assert.ok(goalRun);
  assert.equal(goalRun.progress_label, "4/7");
  assert.match(goalRun.summary, /#1706/);
  assert.match(goalRun.detail.join("\n"), /Current issue: #1706/);
  assert.match(goalRun.detail.join("\n"), /Goal progress: 4\/7/);

  assert.ok(issueRun);
  assert.ok(issueRun.badges.includes("zero_delta_burn"));
  assert.match(issueRun.detail.join("\n"), /Git progress: none since issue start/);
  assert.match(issueRun.detail.join("\n"), /Worktree: clean/);
  assert.match(issueRun.detail.join("\n"), /Branch ahead: 3/);
  assert.match(issueRun.detail.join("\n"), /Issue-scoped delta since snapshot: 0 commits, 0 files/);
});

test("buildFactoryDashboard derives current goal issue from parent goal run when child rows are absent", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-29T01:10:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1700" }],
      managed_state: {
        state_action: "resume",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 1,
      active_wave_count: 0,
      non_wave_active: [{
        run_id: "goal-run-1700",
        graph_label: "goal_execute.dot",
        issue_number: 1700,
        goal_issue_number: 1700,
        current_issue_number: 1706,
        completed_issues: 3,
        completed_issue_numbers: [1703, 1704, 1705],
        node: "execute_issue",
        age: "3h20m",
        last_progress_at: "2026-03-29T01:09:21.000Z",
        expected_next_outcome: "issue run completes",
        trace_kind: "run",
        trace_command: "node ... goal-run-1700",
        no_git_delta_since_start: true,
      }],
      waves: [],
    }),
    tickStatusFn: () => ({ ticks: [] }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 1700: "Latency optimization" }),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      assert.equal(goalNumber, 1700);
      return [
        { number: 1703, state: "closed" },
        { number: 1704, state: "closed" },
        { number: 1705, state: "closed" },
        { number: 1706, state: "open" },
        { number: 1707, state: "open" },
        { number: 1708, state: "open" },
        { number: 1709, state: "open" },
      ];
    },
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const goalRun = nowRows.find((row) => row.kind === "goal_run");

  assert.ok(goalRun);
  assert.equal(goalRun.progress_label, "4/7");
  assert.match(goalRun.summary, /#1706/);
  assert.ok(goalRun.badges.includes("zero_delta_burn"));
  assert.match(goalRun.detail.join("\n"), /Current issue: #1706/);
  assert.match(goalRun.detail.join("\n"), /Git progress: none since current issue started/);
  assert.match(goalRun.detail.join("\n"), /Goal progress: 4\/7/);
});

test("buildFactoryDashboard keeps a first-class goal issue row when only the parent goal run is persisted", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-29T01:10:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1700" }],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 1,
      active_wave_count: 0,
      non_wave_active: [{
        run_id: "goal-run-1700",
        graph_label: "goal_execute.dot",
        issue_number: 1700,
        goal_issue_number: 1700,
        current_issue_number: 1708,
        completed_issues: 5,
        completed_issue_numbers: [1703, 1704, 1705, 1706, 1707],
        node: "execute_issue",
        age: "5h26m",
        last_progress_at: "2026-03-29T01:09:21.000Z",
        expected_next_outcome: "issue run completes",
        trace_kind: "run",
        trace_command: "node ... goal-run-1700",
        no_git_delta_since_start: true,
        worktree_clean: true,
        commits_ahead: 6,
        issue_commits_since_snapshot: 0,
        issue_changed_files: [],
      }],
      waves: [],
    }),
    tickStatusFn: () => ({ ticks: [] }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 1700: "Latency optimization" }),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      assert.equal(goalNumber, 1700);
      return [
        { number: 1703, state: "closed" },
        { number: 1704, state: "closed" },
        { number: 1705, state: "closed" },
        { number: 1706, state: "closed" },
        { number: 1707, state: "closed" },
        { number: 1708, state: "open" },
        { number: 1709, state: "open" },
      ];
    },
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const issueRun = nowRows.find((row) => row.kind === "goal_issue");

  assert.ok(issueRun);
  assert.equal(issueRun.issue, "#1708");
  assert.match(issueRun.summary, /projected from parent goal run/i);
  assert.ok(issueRun.badges.includes("projection:parent_goal_run"));
  assert.match(issueRun.detail.join("\n"), /Projected from parent goal run/);
  assert.match(issueRun.detail.join("\n"), /Issue-scoped delta since snapshot: 0 commits, 0 files/);
});
