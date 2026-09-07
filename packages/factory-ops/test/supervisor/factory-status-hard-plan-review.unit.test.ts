import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { factoryStatus } from "../../src/commands/factory-status.ts";
import { buildFactoryDashboard, formatFactoryDashboardHuman } from "../../src/commands/factory-dashboard.ts";

test("factoryStatus adds hard-goal review projection with awaiting_post_plan_review counts", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-hard-plan-review-"));
  mkdirSync(runsDir, { recursive: true });

  const repoRoot = mkdtempSync(join(tmpdir(), "factory-status-hard-plan-review-repo-"));
  const packetPath = join(
    repoRoot,
    ".hatch",
    "mothership",
    "packets",
    "goal_hard_plan_materialization_packet",
    "goal_hard_plan_materialization_packet_goal_issue_number-2200_plan_packet_id-plan-2200.json",
  );
  mkdirSync(join(repoRoot, ".hatch", "mothership", "packets", "goal_hard_plan_materialization_packet"), { recursive: true });
  writeFileSync(packetPath, JSON.stringify({
    schema_version: "goal_hard_plan_materialization_packet/v1",
    packet_type: "goal_hard_plan_materialization_packet",
    packet_id: "goal_hard_plan_materialization_packet_goal_issue_number-2200_plan_packet_id-plan-2200",
    packet_state: "open",
    created_at: "2026-03-18T12:00:00.000Z",
    factory_id: "mothership",
    run_id: "run-2200",
    plan_packet_id: "plan-2200",
    planning_artifact_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2200.json",
    decomposition_packet_id: "goal_decomposition_packet_2200",
    decomposition_packet_path: ".hatch/mothership/packets/goal_decomposition_packet/goal-2200.json",
    goal_issue_number: "2200",
    materialization_state: "completed",
    approved_features: [{ feature_id: "F-1" }],
    created_issue_numbers: [3301],
    created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/3301"],
    feature_issue_map: [{
      feature_id: "F-1",
      issue_number: 3301,
      issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
      blocked_by_feature_ids: [],
    }],
    blocked_by_edges: [{ issue_number: 3301, blocked_by: [] }],
    goal_issue_map: {
      "goal-prereq-1": "2190",
      "goal-prereq-2": "2195",
      "goal-final": "2230",
    },
    issue_set_map: {
      "issue-set-prereq": {
        issue_set_id: "issue-set-prereq",
        title: "Prerequisites",
        goal_ids: ["goal-prereq-1", "goal-prereq-2"],
        goal_issue_numbers: ["2190", "2195"],
        feature_ids: ["F-1", "F-2"],
        created_issue_numbers: [3301],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/3301"],
      },
    },
    prerequisite_goal_issue_numbers: [2190, 2195],
    final_instantiation_goal_issue_number: 2230,
    goal_feature_issue_map: {
      "goal-prereq-1": [{
        feature_id: "F-1",
        issue_number: 3301,
        issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
        issue_set_id: "issue-set-prereq",
        parent_goal_issue_number: "2200",
      }],
    },
  }, null, 2));

  const out = factoryStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      repo: repoRoot,
    },
    listGoalHardStatesFn: () => ({
      repo: "recallnet/astrochicken",
      goal_count: 4,
      hard_goal_count: 2,
      needs_planning_count: 0,
      awaiting_post_plan_review_count: 1,
      approved_plan_resume_count: 1,
      awaiting_post_plan_review_goal_numbers: [2200],
      approved_plan_resume_goal_numbers: [2201],
      hard_goals: [
        {
          goal_number: 2200,
          title: "Goal A",
          hard_goal_state: "awaiting_post_plan_review",
        },
      ],
    }),
  });

  assert.equal(out.hard_goal_review.awaiting_post_plan_review_count, 1);
  assert.deepEqual(out.hard_goal_review.awaiting_post_plan_review_goal_numbers, [2200]);
  assert.equal(out.hard_plan_traceability.goals_with_materialized_hard_plans, 1);
  assert.deepEqual(out.hard_plan_traceability.goals, [{
    goal_issue_number: 2200,
    plan_packet_id: "plan-2200",
    decomposition_packet_id: "goal_decomposition_packet_2200",
    decomposition_packet_path: ".hatch/mothership/packets/goal_decomposition_packet/goal-2200.json",
    materialization_packet_id: "goal_hard_plan_materialization_packet_goal_issue_number-2200_plan_packet_id-plan-2200",
    materialization_packet_path: packetPath,
    created_issue_numbers: [3301],
    goal_issue_map: {
      "goal-final": "2230",
      "goal-prereq-1": "2190",
      "goal-prereq-2": "2195",
    },
    issue_set_map: {
      "issue-set-prereq": {
        issue_set_id: "issue-set-prereq",
        title: "Prerequisites",
        goal_ids: ["goal-prereq-1", "goal-prereq-2"],
        goal_issue_numbers: ["2190", "2195"],
        feature_ids: ["F-1", "F-2"],
        created_issue_numbers: [3301],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/3301"],
      },
    },
    goal_feature_issue_map: {
      "goal-prereq-1": [{
        feature_id: "F-1",
        issue_number: 3301,
        issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
        issue_set_id: "issue-set-prereq",
        parent_goal_issue_number: "2200",
      }],
    },
    prerequisite_goal_issue_numbers: [2190, 2195],
    final_instantiation_goal_issue_number: 2230,
  }]);
});

test("factoryStatus tolerates hard-goal review lookup failures and falls back to empty projection", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-hard-plan-review-"));
  mkdirSync(runsDir, { recursive: true });

  const out = factoryStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      repo: process.cwd(),
    },
    listGoalHardStatesFn: () => {
      throw new Error("simulated hard-state failure");
    },
  });

  assert.equal(out.hard_goal_review.repo, "recallnet/astrochicken");
  assert.equal(out.hard_goal_review.awaiting_post_plan_review_count, 0);
  assert.deepEqual(out.hard_goal_review.awaiting_post_plan_review_goal_numbers, []);
  assert.equal(out.hard_plan_traceability.goals_with_materialized_hard_plans, 0);
  assert.deepEqual(out.hard_plan_traceability.goals, []);
});

test("factory dashboard summary surfaces awaiting hard-plan review counts", async () => {
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
        awaiting_post_plan_review_count: 2,
        awaiting_post_plan_review_goal_numbers: [2200, 2204],
      },
      hard_plan_traceability: {
        goals_with_materialized_hard_plans: 1,
        goals: [{
          goal_issue_number: 2201,
          plan_packet_id: "plan-2201",
          goal_issue_map: { "goal-prereq": "2190", "goal-final": "2230" },
          issue_set_map: {
            "issue-set-prereq": {
              issue_set_id: "issue-set-prereq",
              title: "Prerequisites",
              goal_ids: ["goal-prereq"],
              goal_issue_numbers: ["2190"],
              feature_ids: ["F-1"],
              created_issue_numbers: [3301],
              created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/3301"],
            },
          },
          goal_feature_issue_map: {
            "goal-prereq": [{
              feature_id: "F-1",
              issue_number: 3301,
              issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
              issue_set_id: "issue-set-prereq",
              parent_goal_issue_number: "2201",
            }],
          },
          prerequisite_goal_issue_numbers: [2190],
          final_instantiation_goal_issue_number: 2230,
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

  assert.equal(dashboard.summary.awaiting_hard_plan_review_count, 2);
  assert.deepEqual(dashboard.summary.awaiting_hard_plan_review_goal_numbers, [2200, 2204]);
  assert.equal(dashboard.summary.hard_plan_materialized_goal_count, 1);
  assert.deepEqual(dashboard.summary.hard_plan_reuse_provenance, [{
    goal_issue_number: 2201,
    prerequisite_goal_issue_numbers: [2190],
    final_instantiation_goal_issue_number: 2230,
    goal_issue_map: { "goal-prereq": "2190", "goal-final": "2230" },
    issue_set_map: {
      "issue-set-prereq": {
        issue_set_id: "issue-set-prereq",
        title: "Prerequisites",
        goal_ids: ["goal-prereq"],
        goal_issue_numbers: ["2190"],
        feature_ids: ["F-1"],
        created_issue_numbers: [3301],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/3301"],
      },
    },
    goal_feature_issue_map: {
      "goal-prereq": [{
        feature_id: "F-1",
        issue_number: 3301,
        issue_url: "https://github.com/recallnet/astrochicken/issues/3301",
        issue_set_id: "issue-set-prereq",
        parent_goal_issue_number: "2201",
      }],
    },
  }]);
  assert.equal(dashboard.summary.hard_plan_reuse_summary, "Prereqs: Goal #2201 ← [#2190] → final #2230");

  const rendered = formatFactoryDashboardHuman(dashboard, { activeTab: "now" });
  assert.match(rendered, /Awaiting hard-plan review: 2 goal\(s\) #2200, #2204/);
  assert.match(rendered, /AwaitingHardPlanReview=2/);
  assert.match(rendered, /MaterializedHardPlans=1/);
  assert.match(rendered, /Materialized hard plans: 1/);
  assert.match(rendered, /Prereqs: Goal #2201 ← \[#2190\] → final #2230/);
});
