import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactoryDashboard,
  formatFactoryDashboardHuman,
} from "../../src/commands/factory-dashboard.ts";

test("buildFactoryDashboard surfaces managed supervisor and goal-run families even without a running tick entry", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-24T20:10:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [
        {
          id: "supervisor-1",
          run_id: "supervisor-1",
          graph: "/tmp/packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
          node: "run_domain_graph",
          status: "running",
          age: "9s",
          updated_at: "2026-03-24T20:09:51.000Z",
          children: [{ runId: "domain-1", node: "fan_out_goal_run", issue: "#1393" }],
        },
        {
          id: "domain-1",
          run_id: "domain-1",
          graph: "/tmp/packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
          node: "fan_out_goal_run",
          status: "running",
          age: "7s",
          updated_at: "2026-03-24T20:09:53.000Z",
          children: [],
        },
        {
          id: "goal-run-1",
          run_id: "goal-run-1",
          graph: "/tmp/factories/example-trading/graphs/goal_run.dot",
          node: "intake_decompose",
          status: "running",
          age: "5s",
          updated_at: "2026-03-24T20:09:55.000Z",
          children: [],
        },
        {
          id: "goal-run-2",
          run_id: "goal-run-2",
          graph: "/tmp/factories/example-trading/graphs/goal_intake_decompose.dot",
          node: "propose",
          status: "running",
          age: "3s",
          updated_at: "2026-03-24T20:09:57.000Z",
          children: [],
        },
      ],
      managed_state: {
        state_action: "none",
        health_classification: "idle",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 4,
      active_wave_count: 0,
      non_wave_active: [
        {
          run_id: "supervisor-1",
          graph: "/tmp/packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
          graph_label: "managed_supervisor.dot",
          node: "run_domain_graph",
          age: "9s",
          last_progress_at: "2026-03-24T20:09:51.000Z",
          expected_next_outcome: "fan out goal run",
        },
        {
          run_id: "domain-1",
          graph: "/tmp/packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
          graph_label: "managed_software_delivery_domain.dot",
          issue_number: 1393,
          goal_issue_number: 1393,
          node: "fan_out_goal_run",
          age: "7s",
          last_progress_at: "2026-03-24T20:09:53.000Z",
          expected_next_outcome: "launch goal run",
        },
        {
          run_id: "goal-run-1",
          graph: "/tmp/factories/example-trading/graphs/goal_run.dot",
          graph_label: "goal_run.dot",
          issue_number: 1393,
          goal_issue_number: 1393,
          node: "intake_decompose",
          age: "5s",
          last_progress_at: "2026-03-24T20:09:55.000Z",
          expected_next_outcome: "goal decomposition proposal",
        },
        {
          run_id: "goal-run-2",
          graph: "/tmp/factories/example-trading/graphs/goal_intake_decompose.dot",
          graph_label: "goal_intake_decompose.dot",
          issue_number: 1393,
          goal_issue_number: 1393,
          node: "propose",
          age: "3s",
          last_progress_at: "2026-03-24T20:09:57.000Z",
          expected_next_outcome: "proposal emitted",
        },
      ],
      waves: [],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "completed",
        stage: "done",
        stageLabel: "Done",
        progress: "[1/1]",
        startedAt: "2026-03-24T20:08:00.000Z",
      }],
    }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 1393: "Trading bootstrap hardening" }),
    listGoalSubIssuesFn: () => [],
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  assert.deepEqual(nowRows.map((row) => row.kind), ["supervisor", "goal_run"]);
  assert.equal(nowRows[0].title, "Supervisor");
  assert.match(nowRows[0].summary, /run_domain_graph/);
  assert.match(nowRows[0].summary, /domain-1:fan_out_goal_run/i);
  assert.equal(nowRows[1].issue, "#1393");
  assert.match(nowRows[1].title, /Trading bootstrap hardening/);
  assert.match(nowRows[1].summary, /propose/);
  assert.match(nowRows[1].summary, /handoffs=3/);
  assert.match(nowRows[1].detail.join("\n"), /Active handoffs: 3/);
  assert.match(nowRows[1].detail.join("\n"), /managed_software_delivery_domain\.dot:fan_out_goal_run/);
  assert.match(nowRows[1].detail.join("\n"), /goal_run\.dot:intake_decompose/);
  assert.match(nowRows[1].detail.join("\n"), /goal_intake_decompose\.dot:propose/);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Supervisor/);
  assert.match(rendered, /goal_run\s+#1393\s+Trading bootstrap hardening/);
  assert.doesNotMatch(rendered, /No active work\./);
});
