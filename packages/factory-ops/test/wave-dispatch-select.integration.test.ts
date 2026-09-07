import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { selectDispatchWavesFromRun } from "../src/commands/wave-dispatch-select.ts";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const fixturePath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

test("selectDispatchWavesFromRun emits a tick artifact and launches one wave per tick", () => {
  const runId = "run-123";
  const runsDir = mkdtempSync(join(tmpdir(), "wave-dispatch-"));
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  copyFileSync(
    fixturePath("./fixtures/wave-dispatch-select/state.json"),
    join(runDir, "state.json"),
  );

  const originalPath = process.env.PATH;
  process.env.PATH = `${fixturePath("./fixtures/wave-dispatch-select/bin")}:${originalPath}`;
  process.env.WAVE_DISPATCH_FIXTURE = fixturePath("./fixtures/wave-dispatch-select/gh-responses.json");

  try {
    const selection = selectDispatchWavesFromRun({
      runId,
      runsDir,
      repo: "recallnet/astrochicken",
      maxConcurrent: 1,
    });

    const expectedSelection = loadJson("./snapshots/wave-dispatch-select/selection.expected.json");
    assert.deepEqual(selection, expectedSelection);
    assert.equal(selection.selected_waves.length, 1);

    const tickPath = join(runsDir, runId, "ticks", "tick-000001.json");
    const tick = JSON.parse(readFileSync(tickPath, "utf8"));
    const expectedTick = loadJson("./snapshots/wave-dispatch-select/tick.expected.json");
    assert.deepEqual(tick, expectedTick);
    assert.equal(tick.schema_version, "tick.v1");
    assert.equal(tick.runs.filter((run) => run.status === "launched").length, 1);
    assert.equal(tick.slots.filter((slot) => slot.state === "launched").length, 1);
    assert.equal(tick.throughput_invariants.idle_with_runnable_backlog, true);
    assert.equal(tick.throughput_invariants.refill_latency.sample_count, 0);
  } finally {
    process.env.PATH = originalPath;
    delete process.env.WAVE_DISPATCH_FIXTURE;
  }
});
