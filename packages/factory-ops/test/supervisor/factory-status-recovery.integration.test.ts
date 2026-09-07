import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildRecoveredWaveFixture } from "./factory-status-fixture-harness.ts";
import { factoryActiveSummary, formatFactoryActiveMinimal } from "../../src/commands/factory-status.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";

function readStateMap(runsDir) {
  const allStates = new Map();
  for (const runId of readdirSync(runsDir)) {
    try {
      allStates.set(runId, JSON.parse(readFileSync(join(runsDir, runId, "state.json"), "utf8")));
    } catch {}
  }
  return allStates;
}

function tickStatus({ runsDir = ".hatch/runs", context = {}, now = Date.now() } = {}) {
  return buildTickProjectionFromStates({ allStates: readStateMap(runsDir), runsDir, context, now });
}

test("recovered-wave fixture drives active-summary from real run state", () => {
  const { runsDir } = buildRecoveredWaveFixture();

  const summary = factoryActiveSummary({
    runsDir,
    now: Date.parse("2026-03-10T16:00:05.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
  });

  assert.equal(summary.active_wave_count, 1);
  assert.equal(summary.waves[0].milestone_title, "goal-1564-wave-2");
  assert.equal(summary.waves[0].wave_issue_number, 1646);
  assert.equal(summary.waves[0].current_issue_number, 1625);
  assert.equal(summary.waves[0].current_issue_node, "build");
  assert.equal(summary.waves[0].completed_issues, 1);
  assert.equal(summary.waves[0].total_issues, 3);
  assert.equal(summary.waves[0].trace_run_id, "issue-1");
  assert.equal(summary.waves[0].trace_available, true);
  assert.equal(summary.waves[0].trace_kind, "coder");
  assert.match(summary.waves[0].trace_command, /factory session-tail --run-id issue-1/);

  const rendered = formatFactoryActiveMinimal(summary);
  assert.match(rendered, /^mothership {2}recallnet\/astrochicken/m);
  assert.match(rendered, /^supervisor {2}fan_out_wave_execute/m);
  assert.match(rendered, /^goal-1564-wave-2 {2}#1625 {2}build {2}1\/3$/m);
});

test("recovered-wave fixture drives tick-status child context from real run state", () => {
  const { runsDir } = buildRecoveredWaveFixture();

  const status = tickStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
  });

  assert.equal(status.ticks.length, 1);
  assert.equal(status.ticks[0].stage, "fan_out_wave_execute");
  assert.equal(status.ticks[0].goalCount, "3");
  assert.equal(status.ticks[0].child.runId, "wave-1");
  assert.equal(status.ticks[0].child.node, "execute_issue_in_wave");
  assert.equal(status.ticks[0].child.issue, "1625");
  assert.equal(status.ticks[0].child.milestone, "goal-1564-wave-2");
  assert.equal(status.ticks[0].child.child.runId, "issue-1");
  assert.equal(status.ticks[0].child.child.node, "build");
  assert.equal(status.ticks[0].child.child.issue, "1625");
  assert.equal(status.ticks[0].child.child.milestone, "goal-1564-wave-2");
});
