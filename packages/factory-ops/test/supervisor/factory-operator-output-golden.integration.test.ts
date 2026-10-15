import { useCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const eventStoreFixture = useCanonicalEventStoreFixture();

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildRecoveredWaveFixture } from "./factory-status-fixture-harness.ts";
import {
  factoryActiveSummary,
  formatFactoryActiveMinimal,
} from "../../src/commands/factory-status.ts";
import { formatTickStatus } from "../../src/commands/factory-tick-status.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";

function readGolden(name) {
  return readFileSync(join("packages/factory-ops/test/supervisor/fixtures/operator-output", name), "utf8").trimEnd();
}

function normalizeOutput(text, runsDir) {
  return String(text || "")
    .replaceAll(runsDir, "<runs-dir>")
    .replace(/Elapsed: [^\n]+/g, "Elapsed: <elapsed>")
    .replace(/has been running for [^\n]+ \(threshold: [^)]+\)/g, "has been running for <stuck-age> (threshold: <threshold>)")
    .replace(/\(started [^)]+\)/g, "(started <started-at>)");
}

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

test("golden: recovered-wave active-summary minimal output stays stable", async () => {
  const { runsDir } = buildRecoveredWaveFixture();
  await eventStoreFixture.seedRuns({ runsDir });
  const summary = factoryActiveSummary({
    runsDir,
    now: Date.parse("2026-03-10T16:00:05.000Z"),
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
  });

  const actual = normalizeOutput(formatFactoryActiveMinimal(summary), runsDir);
  assert.equal(actual, readGolden("recovered-active-summary-minimal.expected.txt"));
});

test("golden: recovered-wave tick-status output stays stable", () => {
  const { runsDir } = buildRecoveredWaveFixture();
  const status = tickStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
  });

  assert.equal(status.ticks[0].stuck_warning, "");
  assert.equal(status.ticks[0].tick_progress.made_progress, true);
  const actual = normalizeOutput(formatTickStatus(status), runsDir);
  assert.equal(actual, readGolden("recovered-tick-status.expected.txt"));
});

test("golden: blocked active-summary minimal output stays stable", () => {
  const actual = formatFactoryActiveMinimal({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    managed_state: {
      health_classification: "control_plane_blocked",
      reason: "Publish or sync a control-plane release manifest.",
    },
    blocked_control_plane: [{
      milestone: "goal-1511-wave-2",
      issue_number: 1551,
      unblockCondition: "Publish or sync a control-plane release manifest.",
    }],
    control_plane: {
      resume_when: "Publish or sync a control-plane release manifest.",
    },
    waves: [],
    non_wave_active: [],
  });

  assert.equal(actual, readGolden("blocked-active-summary-minimal.expected.txt"));
});
