import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactoryDashboard,
  formatFactoryDashboardHuman,
} from "../../src/commands/factory-dashboard.ts";

test("buildFactoryDashboard keeps stale open packet residue out of the primary now tab", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-31T20:20:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{
        id: "tick-1",
        run_id: "tick-1",
        status: "running",
        graph: "/tmp/packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
        node: "run_domain_graph",
        updated_at: "2026-03-31T20:19:45.000Z",
        children: [],
      }],
      managed_state: {
        state_action: "resume",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: Array.from({ length: 3 }, (_, index) => ({
        packet_id: `packet-${index + 1}`,
        packet_type: "merge_conflict_packet",
        packet_state: "open",
        packet_path: `/tmp/packet-${index + 1}.json`,
        run_id: `run-p${index + 1}`,
        pipeline: "goal_execute",
        title: "merge_conflict_packet",
      })),
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 1,
      active_wave_count: 0,
      waves: [],
      non_wave_active: [],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "running",
        stage: "run_domain_graph",
        stageLabel: "Running supervisor",
        progress: "",
        startedAt: "2026-03-31T20:02:16.000Z",
        children: [],
      }],
    }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({}),
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  assert.deepEqual(nowRows.map((row) => row.kind), ["supervisor"]);

  const packetRows = dashboard.tabs.find((tab) => tab.id === "packets").rows;
  assert.equal(packetRows.length, 3);

  const renderedNow = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(renderedNow, /-> supervisor/);
  assert.doesNotMatch(renderedNow, /merge_conflict_packet/);
});
