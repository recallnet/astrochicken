import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  legacyFixtureFactoryActiveSummary,
  legacyFixtureFactoryStatus,
} from "../../src/lib/factory-status-support.ts";
import { writeRunState } from "./factory-status-fixture-harness.ts";

test("factoryStatus keeps shared capability runs when factory identity matches context", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-shared-capability-"));
  const factoryRoot = join(rootDir, "factories", "example-trading");
  const runsDir = join(rootDir, ".hatch", "example-trading", "runs");
  mkdirSync(factoryRoot, { recursive: true });
  mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "merge-review", {
    status: "running",
    currentNode: "review_merge",
    updatedAt: new Date().toISOString(),
    pipelineFile: join(rootDir, "packages", "capability-merge", "graphs", "merge_item.dot"),
    pipeline: join(rootDir, "packages", "capability-merge", "graphs", "merge_item.dot"),
    context: {
      factory_id: "example-trading",
      instance_id: "example-trading",
      target_repo: "example-org/example-trading",
      issue_number: 1231,
      milestone_title: "goal-1230-wave-1",
    },
  });

  const context = {
    factory_id: "example-trading",
    instance_id: "example-trading",
    factory_root: factoryRoot,
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: runsDir,
  };

  const status = legacyFixtureFactoryStatus({ runsDir, context });
  assert.equal(status.active.length, 1);
  assert.equal(status.active[0].run_id, "merge-review");
  assert.equal(status.active[0].issue, 1231);
  assert.match(String(status.active[0].graph || ""), /merge_item\.dot$/);

  const summary = legacyFixtureFactoryActiveSummary({ runsDir, context });
  assert.equal(summary.active_run_count, 1);
  assert.equal(summary.active_wave_count, 0);
  assert.equal(summary.non_wave_active.length, 1);
  assert.equal(summary.non_wave_active[0].issue_number, 1231);
  assert.match(String(summary.non_wave_active[0].graph || ""), /merge_item\.dot$/);
});
