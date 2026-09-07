import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FACTORY_DASHBOARD_SCHEMA_VERSION,
  buildFactoryDashboard,
  formatFactoryDashboardHuman,
  validateFactoryDashboard,
} from "../../src/commands/factory-dashboard.ts";
import { collectFactoryOutcomes } from "../../src/commands/factory-outcomes.ts";

test("buildFactoryDashboard emits hard-plan reuse provenance in summary and human header", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-18T09:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
      hard_goal_review: {
        awaiting_post_plan_review_count: 0,
        awaiting_post_plan_review_goal_numbers: [],
      },
      hard_plan_traceability: {
        goals_with_materialized_hard_plans: 1,
        goals: [{
          goal_issue_number: 2230,
          prerequisite_goal_issue_numbers: [2190, 2195],
          final_instantiation_goal_issue_number: 2238,
          goal_issue_map: {
            "goal-prereq-a": "2190",
            "goal-prereq-b": "2195",
            "goal-final": "2238",
          },
          issue_set_map: {
            "issue-set-prereq": {
              issue_set_id: "issue-set-prereq",
              title: "Factory prerequisite goals",
              goal_ids: ["goal-prereq-a", "goal-prereq-b"],
              goal_issue_numbers: ["2190", "2195"],
              feature_ids: ["F-1", "F-2"],
              created_issue_numbers: [3301, 3302],
              created_issue_urls: [
                "https://github.com/recallnet/astrochicken/issues/3301",
                "https://github.com/recallnet/astrochicken/issues/3302",
              ],
            },
          },
          goal_feature_issue_map: {
            "goal-prereq-a": [{
              feature_id: "F-1",
              issue_number: 3301,
              issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
              issue_set_id: "issue-set-prereq",
              parent_goal_issue_number: "2230",
            }],
          },
        }],
      },
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 0,
      active_wave_count: 0,
      waves: [],
      non_wave_active: [],
    }),
    tickStatusFn: () => ({ ticks: [] }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({}),
  });

  assert.deepEqual(dashboard.summary.hard_plan_reuse_provenance, [{
    goal_issue_number: 2230,
    prerequisite_goal_issue_numbers: [2190, 2195],
    final_instantiation_goal_issue_number: 2238,
    goal_issue_map: {
      "goal-prereq-a": "2190",
      "goal-prereq-b": "2195",
      "goal-final": "2238",
    },
    issue_set_map: {
      "issue-set-prereq": {
        issue_set_id: "issue-set-prereq",
        title: "Factory prerequisite goals",
        goal_ids: ["goal-prereq-a", "goal-prereq-b"],
        goal_issue_numbers: ["2190", "2195"],
        feature_ids: ["F-1", "F-2"],
        created_issue_numbers: [3301, 3302],
        created_issue_urls: [
          "https://github.com/recallnet/astrochicken/issues/3301",
          "https://github.com/recallnet/astrochicken/issues/3302",
        ],
      },
    },
    goal_feature_issue_map: {
      "goal-prereq-a": [{
        feature_id: "F-1",
        issue_number: 3301,
        issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
        issue_set_id: "issue-set-prereq",
        parent_goal_issue_number: "2230",
      }],
    },
  }]);
  assert.equal(dashboard.summary.hard_plan_reuse_summary, "Prereqs: Goal #2230 ← [#2190,#2195] → final #2238");

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Prereqs: Goal #2230 ← \[#2190,#2195\] → final #2238/);
});

test("buildFactoryDashboard emits portable now/recent baseline with factory extension tab", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-dashboard-"));
  const factoryRoot = join(root, "factories", "demo");
  mkdirSync(factoryRoot, { recursive: true });
  const extensionPath = join(factoryRoot, "dashboard.extension.mjs");
  const configPath = join(factoryRoot, "factory.config.json");

  writeFileSync(extensionPath, `
export async function buildFactoryDashboardExtension() {
  return {
    tabs: [{
      id: "custom",
      title: "Custom",
      rows: [{
        id: "custom:1",
        kind: "custom",
        title: "Extension row",
        status: "ok",
        summary: "factory-specific inspector",
        detail: ["Extension loaded"],
      }],
      empty_message: "No custom rows.",
    }],
  };
}
`);
  writeFileSync(configPath, JSON.stringify({
    dashboard: {
      extension_module: "./dashboard.extension.mjs",
    },
  }, null, 2));

  const dashboard = await buildFactoryDashboard({
    runsDir: join(root, ".hatch", "demo", "runs"),
    nowMs: Date.parse("2026-03-11T18:30:00.000Z"),
    lookbackHours: 6,
    context: {
      factory_id: "demo",
      factory_root: factoryRoot,
      factory_config_path: configPath,
      target_repo: "recallnet/astrochicken",
      runs_dir: join(root, ".hatch", "demo", "runs"),
    },
    factoryStatusFn: () => ({
      active: [{ id: "tick-1" }],
      managed_state: {
        state_action: "resume",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [{
        milestone: "goal-1900-wave-1",
        issue_number: 1901,
        blockerKind: "upstream_bug",
        blockerRef: "#1901",
        unblockCondition: "Wait for upstream bug fix.",
      }],
      open_packets: [{
        packet_id: "packet-1",
        packet_type: "merge_conflict_packet",
        packet_state: "open",
        packet_path: "/tmp/packet-1.json",
        run_id: "run-p1",
        pipeline: "wave_execute",
        title: "merge_conflict_packet",
      }],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 2,
      active_wave_count: 1,
      waves: [{
        wave_run_id: "wave-run-1",
        milestone_title: "goal-1900-wave-1",
        current_issue_number: 1902,
        current_issue_node: "build",
        completed_issues: 1,
        total_issues: 3,
        last_progress_at: "2026-03-11T18:29:00.000Z",
        stalled: false,
        trace_kind: "coder",
        trace_run_id: "coder-run-1",
        live_attachable: true,
        live_attach_target: {
          factory_id: "demo",
          run_id: "coder-run-1",
          wave_run_id: "wave-run-1",
          trace_kind: "coder",
          node: "build",
        },
        expected_next_outcome: "review evidence",
        trace_command: "hatch-ops factory session-tail --run-id coder-run-1 --follow",
      }],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "running",
        stage: "execute_wave",
        stageLabel: "Executing wave",
        progress: "[12/28]",
        startedAt: "2026-03-11T18:20:00.000Z",
      }],
    }),
    collectFactoryOutcomesFn: () => ({
      commits: [
        {
          sha: "abc123456789",
          subject: "Merge branch 'wave/goal-1900-wave-1'",
          authored_at: "2026-03-11T18:10:00.000Z",
        },
        {
          sha: "def123456789",
          subject: "Fixes #1902",
          authored_at: "2026-03-11T18:05:00.000Z",
        },
      ],
      closed_goals: 1,
      closed_features: 1,
      closed_bugs: 0,
      merge_commits_main: 1,
    }),
    fetchGoalTitlesFn: () => ({ 1900: "Add review metrics pipeline" }),
  });

  assert.equal(dashboard.schema_version, FACTORY_DASHBOARD_SCHEMA_VERSION);
  assert.equal(validateFactoryDashboard(dashboard).length, 0);
  assert.equal(dashboard.summary.health, "healthy");
  assert.equal(dashboard.summary.active_waves, 1);
  assert.equal(dashboard.summary.open_packets, 1);
  assert.equal(dashboard.summary.recent_outcomes.merged, 1);
  assert.deepEqual(
    dashboard.tabs.map((tab) => tab.id),
    ["now", "recent", "packets", "custom"],
  );

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const nowKinds = nowRows.map((row) => row.kind);
  assert.deepEqual(nowKinds.slice(0, 4), ["supervisor", "goal", "wave", "blocker"]);
  assert.ok(!nowKinds.includes("packet"));

  const packetRows = dashboard.tabs.find((tab) => tab.id === "packets").rows;
  assert.deepEqual(packetRows.map((row) => row.kind), ["packet"]);

  const goalRow = nowRows.find((row) => row.kind === "goal");
  assert.equal(goalRow.issue, "#1900");
  assert.equal(goalRow.title, "Add review metrics pipeline");
  const blockerRow = nowRows.find((row) => row.kind === "blocker");
  assert.equal(blockerRow.issue, "#1901");
  const liveWave = nowRows.find((row) => row.kind === "wave");
  assert.ok(liveWave);
  assert.equal(liveWave.refs.live_attachable, true);
  assert.equal(liveWave.refs.live_attach_target.run_id, "coder-run-1");

  const renderedNow = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(renderedNow, /FACTORY DASHBOARD {2}demo {2}recallnet\/astrochicken/);
  assert.match(renderedNow, /Tabs {2}>1:Now<\s+2:Recent\s+3:Packets\s+4:Custom/);
  assert.match(renderedNow, /#\s+KIND\s+ISSUE\s+TITLE/);
  assert.match(renderedNow, /-> supervisor/);
  assert.match(renderedNow, /goal\s+#1900\s+Add review metrics/);
  assert.match(renderedNow, /\[live\] goal-1900-wave-1/);
  assert.doesNotMatch(renderedNow, /merge_conflict_packet/);
  assert.match(renderedNow, /Selection/);
  assert.match(renderedNow, /runIdentity\.graph: factory_supervisor_tick\.dot/);
  assert.match(renderedNow, /Keys {2}tab\/l\/h switch tabs {2}j\/k move {2}i inspect \(session browser\) {2}r refresh {2}q quit/);

  const renderedRecent = formatFactoryDashboardHuman(dashboard, {
    activeTab: "recent",
    selectedRowId: "recent:def123456789",
  });
  assert.match(renderedRecent, /Tabs\s+1:Now\s+>2:Recent<\s+3:Packets\s+4:Custom/);
  assert.match(renderedRecent, /Fixes #1902/);

  const renderedPackets = formatFactoryDashboardHuman(dashboard, {
    activeTab: "packets",
    selectedRowId: packetRows[0]?.id,
  });
  assert.match(renderedPackets, /Tabs\s+1:Now\s+2:Recent\s+>3:Packets<\s+4:Custom/);
  assert.match(renderedPackets, /merge_conflict_packet/);

  const renderedCustom = formatFactoryDashboardHuman(dashboard, { activeTab: "custom" });
  assert.match(renderedCustom, /Tabs\s+1:Now\s+2:Recent\s+3:Packets\s+>4:Custom</);
  assert.match(renderedCustom, /Extension row/);
});

test("buildFactoryDashboard fails closed when an extension returns an invalid dashboard tab", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-dashboard-invalid-"));
  const factoryRoot = join(root, "factories", "demo");
  mkdirSync(factoryRoot, { recursive: true });
  const extensionPath = join(factoryRoot, "dashboard.extension.mjs");
  const configPath = join(factoryRoot, "factory.config.json");

  writeFileSync(extensionPath, `
export async function buildFactoryDashboardExtension() {
  return {
    tabs: [{
      id: "",
      title: "Broken",
      rows: [],
    }],
  };
}
`);
  writeFileSync(configPath, JSON.stringify({
    dashboard: {
      extension_module: "./dashboard.extension.mjs",
    },
  }, null, 2));

  await assert.rejects(
    () => buildFactoryDashboard({
      runsDir: join(root, ".hatch", "demo", "runs"),
      nowMs: Date.parse("2026-03-11T18:30:00.000Z"),
      context: {
        factory_id: "demo",
        factory_root: factoryRoot,
        factory_config_path: configPath,
        target_repo: "recallnet/astrochicken",
        runs_dir: join(root, ".hatch", "demo", "runs"),
      },
      factoryStatusFn: () => ({
        active: [],
        runs: [],
        completed: 0,
        failed: 0,
        blocked_control_plane: [],
        managed_state: {
          state_action: "none",
          health_classification: "healthy",
          reason: "",
        },
        control_plane: {},
        open_packets: [],
        hard_goal_review: {},
        hard_plan_traceability: {},
      }),
      factoryActiveSummaryFn: () => ({
        active_run_count: 0,
        active_wave_count: 0,
        waves: [],
        non_wave_active: [],
      }),
      tickStatusFn: () => ({ ticks: [] }),
      collectFactoryOutcomesFn: () => ({
        commits: [],
        closed_goals: 0,
        closed_features: 0,
        closed_bugs: 0,
        merge_commits_main: 0,
      }),
      fetchGoalTitlesFn: () => ({}),
    }),
    /invalid_factory_dashboard:/u,
  );
});

test("buildFactoryDashboard renders [live] badges and attach refs only for attachable now rows", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1" }, { id: "goal-issue-1" }],
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
          run_id: "goal-run-1",
          graph_label: "goal_execute.dot",
          issue_number: 2005,
          node: "execute_issue",
          age: "15s",
          last_progress_at: "2026-03-14T16:09:45.000Z",
          expected_next_outcome: "issue run completes",
          trace_kind: "run",
          trace_run_id: "goal-run-1",
          live_attachable: false,
          live_attach_target: null,
        },
        {
          run_id: "goal-issue-1",
          graph_label: "goal_issue_execute.dot",
          issue_number: 2063,
          node: "build",
          age: "11s",
          last_progress_at: "2026-03-14T16:09:49.000Z",
          expected_next_outcome: "review decision",
          trace_kind: "coder",
          trace_run_id: "goal-issue-1",
          live_attachable: true,
          live_attach_target: {
            factory_id: "mothership",
            run_id: "goal-issue-1",
            trace_kind: "coder",
            node: "build",
          },
        },
      ],
      waves: [],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "running",
        stage: "fan_out_goal_run",
        stageLabel: "Running goals in parallel",
        progress: "[9/28]",
        startedAt: "2026-03-14T16:09:20.000Z",
      }],
    }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 2005: "Replay-lab capability extraction" }),
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const liveRows = nowRows.filter((row) => String(row.title || "").startsWith("[live] "));
  assert.equal(liveRows.length, 1);
  assert.equal(liveRows[0].kind, "goal_issue");
  assert.equal(liveRows[0].refs.live_attachable, true);
  assert.equal(liveRows[0].refs.live_attach_target.run_id, "goal-issue-1");

  const nonLiveGoalRun = nowRows.find((row) => row.kind === "goal_run");
  assert.ok(nonLiveGoalRun);
  assert.equal(Boolean(nonLiveGoalRun.refs?.live_attachable), false);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /\[live\] Issue #2063/);
  assert.doesNotMatch(rendered, /\[live\] Goal #2005/);
});

test("buildFactoryDashboard renders flattened goal-run and goal-issue work as first-class now rows", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [
        { id: "goal-run-1" },
        { id: "goal-issue-1" },
        { id: "goal-issue-2" },
      ],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 3,
      active_wave_count: 0,
      non_wave_active: [
        {
          run_id: "goal-run-1",
          graph: "/tmp/factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
          graph_label: "goal_execute.dot",
          issue_number: 2005,
          goal_execution_path: "easy",
          goal_execution_mode: "direct",
          is_direct_goal_execution: true,
          node: "execute_issue",
          age: "15s",
          last_progress_at: "2026-03-14T16:09:45.000Z",
          expected_next_outcome: "issue run completes",
          trace_kind: "run",
          trace_command: "node ... goal-run-1",
        },
        {
          run_id: "goal-issue-1",
          graph: "/tmp/factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
          graph_label: "goal_issue_execute.dot",
          issue_number: 2063,
          goal_execution_path: "medium",
          node: "build",
          age: "11s",
          last_progress_at: "2026-03-14T16:09:49.000Z",
          expected_next_outcome: "review decision",
          trace_kind: "coder",
          trace_command: "node ... goal-issue-1",
        },
        {
          run_id: "goal-issue-2",
          graph: "/tmp/factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
          graph_label: "goal_issue_execute.dot",
          issue_number: 2058,
          goal_execution_path: "hard",
          provisional_hard: true,
          node: "review",
          age: "9s",
          last_progress_at: "2026-03-14T16:09:51.000Z",
          expected_next_outcome: "review decision",
          trace_kind: "reviewer",
          trace_command: "node ... goal-issue-2",
        },
      ],
      waves: [],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "tick-1",
        runId: "tick-1",
        status: "running",
        stage: "fan_out_goal_run",
        stageLabel: "Running goals in parallel",
        progress: "[9/28]",
        startedAt: "2026-03-14T16:09:20.000Z",
      }],
    }),
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 2005: "Replay-lab capability extraction" }),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      assert.equal(goalNumber, 2005);
      return [
        { number: 2054, title: "First", state: "closed" },
        { number: 2058, title: "Second", state: "open" },
        { number: 2063, title: "Third", state: "open" },
        { number: 2068, title: "Fourth", state: "open" },
        { number: 2072, title: "Fifth", state: "open" },
      ];
    },
  });

  assert.equal(dashboard.summary.active_runs, 3);
  assert.equal(dashboard.summary.active_waves, 0);
  assert.equal(dashboard.summary.active_goals, 1);
  assert.equal(dashboard.summary.active_goal_issues, 2);

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  assert.deepEqual(nowRows.map((row) => row.kind), ["supervisor", "goal_run", "goal_issue", "goal_issue"]);

  const goalRun = nowRows.find((row) => row.kind === "goal_run");
  assert.equal(goalRun.issue, "#2005");
  assert.equal(goalRun.title, "Replay-lab capability extraction");
  assert.equal(goalRun.progress_label, "2/5");
  assert.match(goalRun.summary, /execute_issue/);
  assert.match(goalRun.summary, /path=easy \(direct\)/);
  assert.equal(goalRun.updated_age, "15s");
  assert.ok(goalRun.badges.includes("path:easy (direct)"));
  assert.equal(goalRun.refs.goal_execution_path, "easy");
  assert.equal(goalRun.refs.goal_execution_mode, "direct");
  assert.equal(goalRun.refs.is_direct_goal_execution, true);
  assert.equal(goalRun.refs.planning_state, "");
  assert.equal(goalRun.refs.planning_review_required, false);
  assert.match(goalRun.detail.join("\n"), /Execution path: easy \(direct\)/);
  assert.match(goalRun.detail.join("\n"), /Run age: 15s/);
  assert.match(goalRun.detail.join("\n"), /Last progress: 15s ago/);
  assert.match(goalRun.detail.join("\n"), /Goal progress: 2\/5/);

  const issueRows = nowRows.filter((row) => row.kind === "goal_issue");
  assert.deepEqual(issueRows.map((row) => row.issue), ["#2058", "#2063"]);
  assert.deepEqual(issueRows.map((row) => row.refs.goal_execution_path), ["hard", "medium"]);
  const provisionalIssue = issueRows.find((row) => row.issue === "#2058");
  assert.ok(provisionalIssue);
  assert.equal(provisionalIssue.refs.provisional_hard, true);
  assert.equal(provisionalIssue.refs.provisional, true);
  assert.equal(provisionalIssue.refs.planning_state, "");
  assert.equal(provisionalIssue.refs.planning_review_required, false);
  assert.deepEqual(
    issueRows.map((row) => ({ issue: row.issue, step: row.progress_label })).sort((left, right) => left.issue.localeCompare(right.issue, "en")),
    [
      { issue: "#2058", step: "review" },
      { issue: "#2063", step: "build" },
    ],
  );
  assert.deepEqual(issueRows.map((row) => row.updated_age), ["9s", "11s"]);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Health=healthy {2}State=none {2}Runs=3 {2}Goals=1 {2}Issues=2 {2}AwaitingHardPlanReview=0 {2}MaterializedHardPlans=0/);
  assert.match(rendered, /goal_run\s+#2005\s+Replay-lab capability extraction\s+running\s+2\/5/);
  assert.match(goalRun.badges.join(","), /path:easy \(direct\)/);
  assert.match(rendered, /goal_issue\s+#2058/);
  assert.match(rendered, /path=hard \(provisional\)/);
  assert.match(rendered, /goal_issue\s+#2063/);
});

test("buildFactoryDashboard falls back to closed-plus-next goal progress when no active child issue is visible", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1" }],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
      hard_goal_review: {
        awaiting_post_plan_review_count: 0,
        awaiting_post_plan_review_goal_numbers: [],
      },
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 1,
      active_wave_count: 0,
      non_wave_active: [
        {
          run_id: "goal-run-1",
          graph_label: "goal_execute.dot",
          issue_number: 2096,
          node: "execute_issue",
          age: "27s",
          last_progress_at: "2026-03-14T16:09:33.000Z",
          expected_next_outcome: "issue run completes",
          trace_kind: "run",
          trace_command: "node ... goal-run-1",
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
    fetchGoalTitlesFn: () => ({ 2096: "Daily Lens" }),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      assert.equal(goalNumber, 2096);
      return [
        { number: 2140, title: "One", state: "closed" },
        { number: 2144, title: "Two", state: "closed" },
        { number: 2148, title: "Three", state: "open" },
        { number: 2150, title: "Four", state: "open" },
      ];
    },
  });

  const goalRun = dashboard.tabs.find((tab) => tab.id === "now").rows.find((row) => row.kind === "goal_run");
  assert.ok(goalRun);
  assert.equal(goalRun.progress_label, "3/4");
  assert.match(goalRun.detail.join("\n"), /Goal progress: 3\/4/);
});

test("buildFactoryDashboard surfaces planning review hold metadata in now rows", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-2332" }],
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
        run_id: "goal-run-2332",
        graph_label: "goal_execute.dot",
        issue_number: 2332,
        node: "admission_check",
        age: "13s",
        last_progress_at: "2026-03-14T16:09:47.000Z",
        expected_next_outcome: "run state update",
        goal_execution_path: "hard",
        goal_execution_mode: "",
        goal_routing_state: {
          decomposition_state: "required",
          planning_state: "pending_review",
        },
        planning_state: "pending_review",
        trace_kind: "run",
        trace_command: "node ... goal-run-2332",
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
    fetchGoalTitlesFn: () => ({ 2332: "Hard-path planning gate" }),
    listGoalSubIssuesFn: () => [],
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  const goalRun = nowRows.find((row) => row.kind === "goal_run");
  assert.ok(goalRun);
  assert.ok(goalRun.badges.includes("planning:pending_review"));
  assert.ok(goalRun.badges.includes("planning_review_required"));
  assert.equal(goalRun.refs.planning_state, "pending_review");
  assert.equal(goalRun.refs.planning_review_required, true);
  assert.match(goalRun.detail.join("\n"), /Planning state: pending_review/);
  assert.match(goalRun.detail.join("\n"), /Planning review required: true/);
});

test("buildFactoryDashboard suppresses stale tick rows when there are no active runs", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [],
      managed_state: {
        state_action: "none",
        health_classification: "healthy",
        reason: "",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 0,
      active_wave_count: 0,
      non_wave_active: [],
      waves: [],
    }),
    tickStatusFn: () => ({
      ticks: [{
        id: "stale-tick",
        runId: "stale-tick",
        status: "running",
        stage: "fan_out_goal_run",
        stageLabel: "Running goals in parallel",
        progress: "[9/28]",
        startedAt: "2026-03-14T15:00:00.000Z",
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

  assert.equal(dashboard.summary.current_tick, null);
  assert.deepEqual(dashboard.tabs.find((tab) => tab.id === "now").rows, []);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Tick=idle/);
  assert.match(rendered, /No active work or recent handoffs\./);
  assert.doesNotMatch(rendered, /Supervisor\s+running/);
});

test("buildFactoryDashboard keeps now-tab continuity with recent handoffs when active work just rolled over", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-24T20:10:00.000Z"),
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [],
      managed_state: {
        state_action: "none",
        health_classification: "idle",
        reason: "release targeting degraded",
      },
      blocked_control_plane: [],
      open_packets: [],
    }),
    factoryActiveSummaryFn: () => ({
      active_run_count: 0,
      active_wave_count: 0,
      non_wave_active: [],
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
    fetchGoalTitlesFn: () => ({ 1394: "Research-derived reward MM spec" }),
    listGoalSubIssuesFn: () => [],
    readAllRunStatesFn: () => new Map([
      ["managed-supervisor-1", {
        status: "completed",
        graph: "/tmp/packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
        currentNodeId: "set_release_sha",
        updatedAt: "2026-03-24T20:10:00.000Z",
      }],
      ["goal-run-1394", {
        status: "completed",
        graph: "/tmp/factories/example-trading/graphs/goal_run.dot",
        issue_number: 1394,
        currentNodeId: "load_metadata",
        updatedAt: "2026-03-24T20:09:59.600Z",
      }],
    ]),
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  assert.equal(nowRows.length, 2);
  assert.deepEqual(nowRows.map((row) => row.kind), ["recent_handoff", "recent_handoff"]);
  assert.equal(nowRows[0].title, "managed supervisor");
  assert.equal(nowRows[1].issue, "#1394");
  assert.match(nowRows[1].title, /Research-derived reward MM spec/);
  assert.match(nowRows[1].summary, /load_metadata/);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /recent_handoff/);
  assert.doesNotMatch(rendered, /No active work\./);
});

test("buildFactoryDashboard applies deterministic run/graph/node/issue filters and preserves runIdentity", async () => {
  const status = {
    active: [{ id: "tick-1" }, { id: "goal-run-1" }, { id: "goal-issue-1" }],
    managed_state: {
      state_action: "none",
      health_classification: "healthy",
      reason: "",
    },
    blocked_control_plane: [{
      milestone: "goal-2100-wave-1",
      issue_number: 2100,
      blockerKind: "upstream_bug",
      blockerRef: "#2100",
      unblockCondition: "Wait for upstream",
    }],
    open_packets: [],
  };

  const summary = {
    active_run_count: 3,
    active_wave_count: 1,
    waves: [{
      wave_run_id: "wave-run-1",
      milestone_title: "goal-2100-wave-1",
      current_issue_number: 2105,
      current_issue_node: "build",
      completed_issues: 1,
      total_issues: 3,
      last_progress_at: "2026-03-14T16:09:00.000Z",
      stalled: false,
      trace_run_id: "wave-run-1",
      live_attachable: true,
      live_attach_target: { run_id: "wave-run-1" },
      expected_next_outcome: "review",
    }],
    non_wave_active: [
      {
        run_id: "goal-run-1",
        graph_label: "goal_execute.dot",
        issue_number: 2100,
        node: "execute_issue",
        age: "18s",
        last_progress_at: "2026-03-14T16:09:42.000Z",
        expected_next_outcome: "issue run completes",
        trace_run_id: "goal-run-1",
      },
      {
        run_id: "goal-issue-1",
        graph_label: "goal_issue_execute.dot",
        issue_number: 2105,
        node: "build",
        age: "12s",
        last_progress_at: "2026-03-14T16:09:48.000Z",
        expected_next_outcome: "review decision",
        trace_run_id: "goal-issue-1",
      },
    ],
  };

  const tick = {
    ticks: [{
      id: "tick-1",
      runId: "tick-1",
      status: "running",
      stage: "execute_wave",
      stageLabel: "Executing wave",
      progress: "[6/20]",
      startedAt: "2026-03-14T16:08:30.000Z",
    }],
  };

  const filteredByRun = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    filters: { run_id: "goal-issue-1" },
    factoryStatusFn: () => status,
    factoryActiveSummaryFn: () => summary,
    tickStatusFn: () => tick,
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 2100: "Goal #2100" }),
  });

  const runRows = filteredByRun.tabs.find((tab) => tab.id === "now").rows;
  assert.equal(runRows.length, 1);
  assert.equal(runRows[0].kind, "goal_issue");
  assert.equal(runRows[0].runIdentity.run_id, "goal-issue-1");
  assert.equal(filteredByRun.summary.filters.run_id, "goal-issue-1");
  assert.equal(filteredByRun.context.dashboard_filters.run_id, "goal-issue-1");

  const filteredByGraphNode = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    filters: { graph: "goal_issue_execute.dot", node: "build" },
    factoryStatusFn: () => status,
    factoryActiveSummaryFn: () => summary,
    tickStatusFn: () => tick,
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 2100: "Goal #2100" }),
  });
  const graphNodeRows = filteredByGraphNode.tabs.find((tab) => tab.id === "now").rows;
  assert.equal(graphNodeRows.length, 1);
  assert.equal(graphNodeRows[0].kind, "goal_issue");
  assert.equal(graphNodeRows[0].runIdentity.graph, "goal_issue_execute.dot");
  assert.equal(graphNodeRows[0].runIdentity.node, "build");

  const filteredByIssue = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    filters: { issue: 2100 },
    factoryStatusFn: () => status,
    factoryActiveSummaryFn: () => summary,
    tickStatusFn: () => tick,
    collectFactoryOutcomesFn: () => ({
      commits: [],
      closed_goals: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    fetchGoalTitlesFn: () => ({ 2100: "Goal #2100" }),
  });
  const issueRows = filteredByIssue.tabs.find((tab) => tab.id === "now").rows;
  assert.equal(issueRows.length, 3);
  assert.deepEqual(issueRows.map((row) => row.kind), ["goal_run", "goal", "blocker"]);
  assert.equal(issueRows[0].runIdentity.issue_number, 2100);
  assert.equal(issueRows[1].runIdentity.issue_number, 2100);
  assert.equal(issueRows[2].runIdentity, null);

  const rendered = formatFactoryDashboardHuman(filteredByRun, { activeTab: "now" });
  assert.match(rendered, /Filters {2}run=goal-issue-1/);
});

test("collectFactoryOutcomes uses at most 2 git spawns instead of 4", () => {
  const calls = [];
  const mockSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args: [...args] });
    if (args.includes("rev-list")) return { status: 0, stdout: "3" };
    // Combined log format: SHA\tsubject\tdate\0body\0
    return {
      status: 0,
      stdout: [
        "abc123\tMerge branch 'wave/goal-100-wave-1'\t2026-03-20T10:00:00Z\0\0",
        "def456\tfeat(goal-200): Fixes #301\t2026-03-20T09:00:00Z\0Closes #302, #303\0",
      ].join("\n"),
    };
  };
  const result = collectFactoryOutcomes({
    repo: "test/repo",
    repoPath: "/tmp/test-repo",
    lookbackHours: 24,
    nowMs: Date.parse("2026-03-20T12:00:00Z"),
    spawnSyncFn: mockSpawn,
  });
  // At most 2 git calls (combined log + rev-list), down from 4
  const gitCalls = calls.filter((c) => c.cmd === "git");
  assert.ok(gitCalls.length <= 2, `expected at most 2 git calls, got ${gitCalls.length}`);
  // Verify the combined call still extracts the same data
  assert.equal(result.closed_goals, 2);
  assert.ok(result.commit_log, "commit_log should still be populated");
});

test("buildFactoryDashboard runs independent data fetches concurrently", async () => {
  const callOrder = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-20T12:00:00Z"),
    context: {
      factory_id: "demo",
      target_repo: "test/repo",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => {
      callOrder.push({ fn: "status", at: Date.now() });
      return {
        active: [],
        managed_state: { state_action: "none", health_classification: "healthy", reason: "" },
        blocked_control_plane: [],
        open_packets: [],
      };
    },
    factoryActiveSummaryFn: () => {
      callOrder.push({ fn: "activeSummary", at: Date.now() });
      return { active_run_count: 0, active_wave_count: 0, waves: [], non_wave_active: [] };
    },
    tickStatusFn: () => {
      callOrder.push({ fn: "tick", at: Date.now() });
      return { ticks: [] };
    },
    collectFactoryOutcomesFn: () => {
      callOrder.push({ fn: "outcomes", at: Date.now() });
      return { commits: [], closed_goals: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 };
    },
    fetchGoalTitlesFn: () => ({}),
  });

  // Verify dashboard is still valid after refactor
  assert.equal(validateFactoryDashboard(dashboard).length, 0);
  // All 4 data fetches should have been called
  const fns = callOrder.map((c) => c.fn).sort();
  assert.deepEqual(fns, ["activeSummary", "outcomes", "status", "tick"]);
});

test("buildFactoryDashboard uses last progress age for active goal rows when progress is fresh", async () => {
  const dashboard = await buildFactoryDashboard({
    runsDir: "/tmp/demo-runs",
    nowMs: Date.parse("2026-03-14T16:10:00.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/demo-runs",
    },
    factoryStatusFn: () => ({
      active: [{ id: "goal-run-1" }, { id: "goal-issue-1" }],
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
          run_id: "goal-run-1",
          graph_label: "goal_execute.dot",
          issue_number: 2036,
          node: "execute_issue",
          age: "1h7m",
          last_progress_at: "2026-03-14T16:09:59.500Z",
          expected_next_outcome: "issue run completes",
        },
        {
          run_id: "goal-issue-1",
          graph_label: "goal_issue_execute.dot",
          issue_number: 2078,
          node: "build",
          age: "58m",
          last_progress_at: "2026-03-14T16:09:59.800Z",
          expected_next_outcome: "review decision",
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
    fetchGoalTitlesFn: () => ({ 2036: "Goal: Daily Lens" }),
  });

  const nowRows = dashboard.tabs.find((tab) => tab.id === "now").rows;
  assert.deepEqual(nowRows.map((row) => row.updated_age), ["500ms", "200ms"]);

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /goal_run\s+#2036.*500ms/);
  assert.match(rendered, /goal_issue\s+#2078.*200ms/);
});
