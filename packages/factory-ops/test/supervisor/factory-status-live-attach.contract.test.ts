import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { factoryActiveSummary } from "../../src/commands/factory-status.ts";

function writeRun(runsDir, id, state) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

test("factoryActiveSummary projects deterministic live attach metadata", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-active-summary-live-attach-"));

  writeRun(runsDir, "supervisor-run", {
    runId: "supervisor-run",
    pipeline: "/tmp/factory_supervisor_tick.dot",
    status: "running",
    currentNode: "supervisor_review",
    updatedAt: new Date().toISOString(),
    context: {
      session_id: "supervisor-main",
    },
  });
  mkdirSync(join(runsDir, "supervisor-run", "sessions", "supervisor_review"), { recursive: true });
  writeFileSync(join(runsDir, "supervisor-run", "sessions", "supervisor_review", "session.jsonl"), "{\"type\":\"session\"}\n");

  writeRun(runsDir, "tool-run", {
    runId: "tool-run",
    pipeline: "/tmp/tool.dot",
    status: "running",
    currentNode: "collect_metrics",
    updatedAt: new Date().toISOString(),
  });

  const summary = factoryActiveSummary({
    runsDir,
    context: { factory_id: "mothership" },
  });

  const supervisorRow = summary.non_wave_active.find((row) => row.run_id === "supervisor-run");
  assert.ok(supervisorRow);
  assert.equal(supervisorRow.live_attachable, true);
  assert.equal(supervisorRow.live_attach_target.factory_id, "mothership");
  assert.equal(supervisorRow.live_attach_target.run_id, "supervisor-run");
  assert.equal(supervisorRow.live_attach_target.trace_kind, supervisorRow.trace_kind);
  assert.equal(supervisorRow.live_attach_target.session_id, "supervisor-main");

  const toolRow = summary.non_wave_active.find((row) => row.run_id === "tool-run");
  assert.ok(toolRow);
  assert.equal(toolRow.live_attachable, false);
  assert.equal(toolRow.live_attach_target, null);
});
