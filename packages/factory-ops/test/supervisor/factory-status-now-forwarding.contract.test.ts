import { buildControlPlaneManifestFixture as buildControlPlaneManifest } from "./control-plane-status.fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  legacyFixtureFactoryActiveSummary as factoryActiveSummary,
  legacyFixtureFactoryStatus as factoryStatus,
} from "../../src/lib/factory-status-support.ts";
import { syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";

function writeRun(runsDir, id, state) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}


function syncControlPlaneManifestForStatus(runsDir, { status = "promoted", reason = "" } = {}) {
  const hatchDir = join(runsDir, "..");
  const repoRoot = join(hatchDir, "..");
  const sourceManifestPath = join(hatchDir, "releases", "v9.9.9", "release-manifest.json");
  mkdirSync(join(hatchDir, "releases", "v9.9.9"), { recursive: true });
  writeFileSync(sourceManifestPath, JSON.stringify(buildControlPlaneManifest({ status, reason }), null, 2));
  return syncControlPlaneManifest({
    manifestPath: sourceManifestPath,
    repoRoot,
  });
}

test("legacy fixture status helper forwards explicit now for parity fixtures", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-now-forwarding-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  syncControlPlaneManifestForStatus(runsDir, { status: "promoted" });

  writeRun(runsDir, "active-run", {
    runId: "active-run",
    status: "running",
    currentNode: "build",
    updatedAt: "2026-03-25T20:00:00.000Z",
    startedAt: "2026-03-25T19:55:00.000Z",
  });

  const out = factoryStatus({
    runsDir,
    context: { factory_id: "mothership", control_plane_repo: "recallnet/astrochicken" },
    now: Date.parse("2026-03-25T20:01:00.000Z"),
  });

  assert.equal(out.active.length, 1);
  assert.equal(out.active[0].age_ms, 6 * 60_000);
  assert.equal(out.active[0].age, "6m0s");
  assert.equal(out.active[0].last_progress_age_ms, 60_000);
  assert.equal(out.active[0].last_progress_age, "1m0s");
});

test("legacy fixture active summary keeps long run age separate from fresh progress age", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-active-summary-run-age-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  syncControlPlaneManifestForStatus(runsDir, { status: "promoted" });

  writeRun(runsDir, "goal-run", {
    runId: "goal-run",
    pipeline: "/tmp/goal_execute.dot",
    status: "running",
    currentNode: "execute_issue",
    issueNumber: 1700,
    startedAt: "2026-03-28T21:49:42.479Z",
    updatedAt: "2026-03-29T00:29:45.000Z",
  });

  const summary = factoryActiveSummary({
    runsDir,
    context: { factory_id: "mothership", control_plane_repo: "recallnet/astrochicken" },
    now: Date.parse("2026-03-29T00:30:00.000Z"),
  });
  const run = summary.non_wave_active.find((row) => row.run_id === "goal-run");

  assert.ok(run);
  assert.equal(run.age, "2h40m");
  assert.equal(run.last_progress_age_ms, 15_000);
  assert.equal(run.stalled, false);
  assert.equal(run.expected_next_outcome, "issue run completes");
});
