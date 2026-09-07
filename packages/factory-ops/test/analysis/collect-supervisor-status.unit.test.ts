import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSupervisorStatus,
  defaultExecFile,
  DEFAULT_EXEC_TIMEOUT_MS,
} from "../../src/lib/analysis/collect-supervisor-status.ts";

test("defaultExecFile has a bounded timeout", () => {
  assert.ok(DEFAULT_EXEC_TIMEOUT_MS > 0, "timeout must be positive");
  assert.ok(DEFAULT_EXEC_TIMEOUT_MS <= 60_000, "timeout must be ≤ 60s to prevent lens hangs");
});

test("defaultExecFile kills a hanging process via timeout", async () => {
  await assert.rejects(
    () => defaultExecFile("sleep", ["999"]),
    (error) => {
      assert.equal(error.killed, true, "process should be killed by timeout");
      return true;
    },
  );
});

test("collectSupervisorStatus degrades gracefully when execFile rejects", async () => {
  const result = await collectSupervisorStatus({
    windowStart: "2026-03-17T00:00:00.000Z",
    windowEnd: "2026-03-18T00:00:00.000Z",
    execFileFn: () => Promise.reject(new Error("Command timed out")),
  });

  assert.ok(result, "should return a result");
  assert.ok(Array.isArray(result.missing_data), "should have missing_data array");
  assert.ok(result.missing_data.length > 0, "should report missing data for failed commands");
  assert.deepEqual(result.runs, []);
  assert.deepEqual(result.ticks, []);
});

test("collectSupervisorStatus returns valid envelope from successful mock", async () => {
  const mockExecFile = (_command, args) => {
    if (args.includes("tick-status")) {
      return Promise.resolve({
        stdout: JSON.stringify({
          ticks: [
            { run_id: "tick1", status: "ok", stage: "done", updated_at: "2026-03-17T12:00:00.000Z" },
          ],
        }),
      });
    }
    if (args.includes("status")) {
      return Promise.resolve({
        stdout: JSON.stringify({
          runs: [
            { run_id: "abc123", status: "completed", node: "done", updated_at: "2026-03-17T12:00:00.000Z" },
          ],
        }),
      });
    }
    return Promise.resolve({ stdout: "{}" });
  };

  const result = await collectSupervisorStatus({
    windowStart: "2026-03-17T00:00:00.000Z",
    windowEnd: "2026-03-18T00:00:00.000Z",
    execFileFn: mockExecFile,
  });

  assert.equal(result.source, "supervisor_status");
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].run_id, "abc123");
  assert.equal(result.ticks.length, 1);
  assert.equal(result.ticks[0].run_id, "tick1");
  assert.equal(result.counts.active_runs, 1);
  assert.equal(result.counts.active_ticks, 1);
});
