import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildFactoryFleetProjection } from "../../src/lib/factory-fleet-projection-support.ts";

test("buildFactoryFleetProjection surfaces parent goal-run current issue and zero-delta burn warning", async () => {
  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = mkdtempSync(join(tmpdir(), "fleet-zero-delta-burn-"));

  try {
    const runsDir = "/tmp/example-trading-runs";
    const report = await buildFactoryFleetProjection({
      now: Date.parse("2026-03-29T01:20:00.000Z"),
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: "/tmp/factory-registry.json",
        factories: [
          { factory_id: "example-trading", target_repo: "example-org/example-trading", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: runsDir,
      }),
      factoryStatusFn: () => ({
        active: [{
          id: "goal-run-1700",
          issue: "1700",
          node: "execute_issue",
          graph: "/tmp/goal_execute.dot",
          milestone: "goal-1700-wave-1",
        }],
        blocked_control_plane: [],
        control_plane: { resume_reason: "ready_to_resume" },
      }),
      factoryActiveSummaryFn: () => ({
        waves: [],
        non_wave_active: [{
          run_id: "goal-run-1700",
          issue_number: 1700,
          current_issue_number: 1706,
          age: "31m",
          no_git_delta_since_start: true,
        }],
      }),
      tickStatusFn: () => ({ ticks: [] }),
      hostHealthFn: () => ({ status: "running", running: true, pid: 321, runCount: 1 }),
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories.length, 1);
    assert.deepEqual(report.factories[0].active_issues, [1700, 1706]);
    assert.ok(report.factories[0].warnings.includes("active_issue_zero_delta_burn:#1706:31m"));
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});
