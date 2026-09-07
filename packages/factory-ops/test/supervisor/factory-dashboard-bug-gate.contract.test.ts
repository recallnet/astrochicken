import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactoryDashboard,
  formatFactoryDashboardHuman,
} from "../../src/commands/factory-dashboard.ts";

test("buildFactoryDashboard surfaces bug-fast supervisor routing when open-bug review blocks goal admission", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-31T23:35:15.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{
        id: "tick-1",
        run_id: "tick-1",
        graph: "managed_supervisor.dot",
        node: "run_domain_graph",
        current_node: "run_domain_graph",
        updated_at: "2026-03-31T23:35:03.951Z",
        children: [{
          name: "run_domain_graph",
          role: "reviewer",
          runId: "child-1",
          status: "running",
          current_node: "supervisor_review_bug_fast",
          parent_node_id: "run_domain_graph",
        }],
      }],
      managed_state: {
        state_action: "resume",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [{
        milestone: "goal-1872-wave-1",
        issue_number: 1872,
        blockerKind: "upstream_bug",
        blockerRef: "#1872",
        unblockCondition: "bug-fast review resolves the open CI incident",
      }],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 1,
      active_wave_count: 0,
      waves: [],
      non_wave_active: [{
        run_id: "tick-1",
        graph_label: "managed_supervisor.dot",
        node: "run_domain_graph",
        last_progress_at: "2026-03-31T23:35:03.951Z",
      }],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "running",
        stage: "run_domain_graph",
        stageLabel: "run_domain_graph",
        progress: "",
        startedAt: "2026-03-31T23:25:01.139Z",
        age: "10m14s",
        blocked_control_plane: [{
          milestone: "goal-1872-wave-1",
          issue_number: 1872,
          blockerKind: "upstream_bug",
          blockerRef: "#1872",
          unblockCondition: "bug-fast review resolves the open CI incident",
        }],
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

  assert.equal(dashboard.summary.bug_gate.mode, "bug-fast");
  assert.equal(dashboard.summary.bug_gate.admission, "paused_for_bug_review");
  assert.equal(dashboard.summary.bug_gate.open_bug_count, 1);
  assert.deepEqual(dashboard.summary.bug_gate.open_bug_refs, ["#1872"]);

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const supervisorRow = nowRows.find((row) => row.kind === "supervisor");
  assert.ok(supervisorRow);
  assert.match(supervisorRow.summary, /bug-fast/);
  assert.match(supervisorRow.detail.join("\n"), /Mode: bug-fast/);
  assert.match(supervisorRow.detail.join("\n"), /Open bug refs: #1872/);

  const blockerRow = nowRows.find((row) => row.kind === "blocker");
  assert.ok(blockerRow);
  assert.equal(blockerRow.issue, "#1872");

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Mode=bug-fast/);
  assert.match(rendered, /OpenBugs=1/);
  assert.match(rendered, /Refs=#1872/);
  assert.match(rendered, /Admission=paused_for_bug_review/);
});
