import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactoryAttentionReport,
  formatFactoryAttentionHuman,
} from "../../src/commands/factory-attention.ts";

test("buildFactoryAttentionReport filters to actionable factories and carries fleet kpis", () => {
  const report = buildFactoryAttentionReport({
    generated_at: "2026-03-23T20:00:00.000Z",
    kpis: {
      window_hours: 1,
      factories_reporting: 3,
      daemons_running: 2,
      last_tick_known: 2,
      closed_goals: 1,
      closed_features: 3,
      closed_bugs: 2,
      merge_commits_main: 4,
      attention_factories: 2,
    },
    factories: [
      {
        factory_id: "mothership",
        health: "healthy",
        blocked_reason: "",
        managed_state: { reason: "" },
        control_plane_blocker: "",
        gate_reason: "",
        rollout_status: "ready",
        warnings: [],
        recent_outcomes: [{ summary: "merged_prs=1" }],
      },
      {
        factory_id: "example-trading",
        health: "blocked",
        blocked_reason: "await release gate",
        managed_state: { reason: "" },
        control_plane_blocker: "await release gate",
        gate_reason: "release_rollout_blocked",
        rollout_status: "blocked",
        warnings: [],
        recent_outcomes: [{ summary: "merged_prs=0" }],
      },
      {
        factory_id: "example-scanner",
        health: "unhealthy",
        blocked_reason: "",
        managed_state: { reason: "" },
        control_plane_blocker: "",
        gate_reason: "",
        rollout_status: "unknown",
        warnings: ["runs_dir_missing:/tmp/example-scanner"],
        recent_outcomes: [{ summary: "merged_prs=0" }],
      },
    ],
  });

  assert.equal(report.schema_version, "factory_attention.v1");
  assert.equal(report.summary.total_factories, 3);
  assert.equal(report.summary.attention_factories, 2);
  assert.equal(report.summary.attention_ids.join(","), "example-scanner,example-trading");
  assert.equal(report.kpis.window_hours, 1);
  assert.equal(report.items.length, 2);
  assert.equal(report.items[0].factory_id, "example-scanner");
  assert.match(report.items[0].attention, /runs dir missing/i);
  assert.equal(report.items[1].factory_id, "example-trading");
  assert.match(report.items[1].attention, /await release gate/i);
});

test("formatFactoryAttentionHuman renders KPI header and actionable rows only", () => {
  const output = formatFactoryAttentionHuman({
    generated_at: "2026-03-23T20:00:00.000Z",
    kpis: {
      window_hours: 1,
      factories_reporting: 3,
      daemons_running: 2,
      last_tick_known: 2,
      closed_goals: 1,
      closed_features: 3,
      closed_bugs: 2,
      merge_commits_main: 4,
      attention_factories: 2,
    },
    summary: {
      total_factories: 3,
      attention_factories: 2,
      attention_ids: ["example-scanner", "example-trading"],
    },
    items: [
      {
        factory_id: "example-scanner",
        health: "unhealthy",
        attention: "runs dir missing",
        outcomes_summary: "merged_prs=0",
      },
      {
        factory_id: "example-trading",
        health: "blocked",
        attention: "await release gate",
        outcomes_summary: "merged_prs=0",
      },
    ],
  });

  assert.match(output, /Factory attention generated_at=/);
  assert.match(output, /KPIs window=1h/);
  assert.match(output, /Attention total=2\/3/);
  assert.match(output, /example-scanner health=unhealthy attention=runs dir missing/);
  assert.match(output, /example-trading health=blocked attention=await release gate/);
});

test("buildFactoryAttentionReport surfaces zero-delta burn warnings for active issue runs", () => {
  const report = buildFactoryAttentionReport({
    generated_at: "2026-03-29T01:10:00.000Z",
    kpis: {},
    factories: [
      {
        factory_id: "example-trading",
        health: "healthy",
        blocked_reason: "",
        managed_state: { reason: "" },
        control_plane_blocker: "",
        gate_reason: "",
        rollout_status: "ready",
        warnings: ["active_issue_zero_delta_burn:#1706:31m"],
        recent_outcomes: [{ summary: "merged_prs=0" }],
      },
    ],
  });

  assert.equal(report.items.length, 1);
  assert.match(report.items[0].attention, /issue #1706 burning with no git delta/i);
});
