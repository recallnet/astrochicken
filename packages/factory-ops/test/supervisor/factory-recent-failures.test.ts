import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listRecentFailures } from "../../src/commands/factory-failures.ts";

function writeRun(runsDir, id, state) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

test("listRecentFailures returns failed runs with failing node summary", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-recent-failures-"));

  writeRun(runsDir, "ok-1", {
    runId: "ok-1",
    status: "completed",
    updatedAt: "2026-03-04T00:00:00.000Z",
  });

  writeRun(runsDir, "fail-1", {
    runId: "fail-1",
    status: "failed",
    pipeline: "wave_execute.dot",
    currentNode: "fan_out_wave_execute",
    updatedAt: "2026-03-04T01:00:00.000Z",
    records: [
      { nodeId: "fan_out_wave_execute", status: "failed" },
    ],
  });

  writeRun(runsDir, "fail-2", {
    runId: "fail-2",
    status: "failed",
    pipeline: "triage.dot",
    currentNode: "fail_triage",
    updatedAt: "2026-03-04T02:00:00.000Z",
    records: [
      { nodeId: "apply_accept", status: "completed", outcome: { status: "failed", error: "updateIssue" } },
    ],
  });

  writeRun(runsDir, "suspended-1", {
    runId: "suspended-1",
    status: "suspended",
    pipeline: "factory_supervisor_tick.dot",
    currentNode: "fan_out_wave_execute",
    updatedAt: "2026-03-04T03:00:00.000Z",
    records: [
      { nodeId: "fan_out_wave_execute", status: "failed" },
    ],
  });

  const out = listRecentFailures({ runsDir, limit: 5 });
  assert.equal(out.length, 3);
  assert.equal(out[0].run_id, "suspended-1");
  assert.equal(out[1].run_id, "fail-2");
  assert.equal(out[1].failed_node, "apply_accept");
  assert.match(out[1].error, /updateIssue/);
  assert.equal(out[2].failed_node, "fan_out_wave_execute");
});
