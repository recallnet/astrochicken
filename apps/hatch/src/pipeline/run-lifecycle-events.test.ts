import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearLifecycleProjectionEmitters,
  configureRunStorageScope,
  createRunState,
  lifecycleEventsPath,
  saveRunState,
  setLifecycleProjectionEmitter,
} from "./run.js";

// Ensure setLifecycleProjectionEmitter is covered by workspace export gate.
void setLifecycleProjectionEmitter;

function parseCloudEventLines(path: string) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventData(event: any) {
  return event?.data ?? event;
}

const originalRunsDir = process.env["HATCH_RUNS_DIR"];
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (originalRunsDir === undefined) delete process.env["HATCH_RUNS_DIR"];
  else process.env["HATCH_RUNS_DIR"] = originalRunsDir;
  clearLifecycleProjectionEmitters();
  configureRunStorageScope({ runsDir: ".hatch/runs" });
});

describe("run lifecycle events", () => {
  it("persists durable lifecycle events across node and status transitions", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-run-lifecycle-"));
    cleanupDirs.push(root);
    const scopedRunsDir = join(root, "runs");
    process.env["HATCH_RUNS_DIR"] = scopedRunsDir;
    configureRunStorageScope({ runsDir: scopedRunsDir });

    const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const state = createRunState(runId, "docs/contracts/workflow-ir/mothership/wave_execute.dot");
    state.context.issue_number = "1551";
    state.context.milestone_title = "goal-1511-wave-2";
    state.context.traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    state.context.tracestate = "rojo=00f067aa0ba902b7";
    state.currentNode = "build";
    saveRunState(state, { updatePid: false });

    state.context.review_artifact_url = "https://example.test/artifacts/review-1551";
    state.currentNode = "review";
    saveRunState(state, { updatePid: false });

    state.status = "completed";
    state.currentNode = "done";
    saveRunState(state, { updatePid: false });

    const events = parseCloudEventLines(lifecycleEventsPath(runId));
    const payloads = events.map(eventData);

    expect(payloads.map((event) => event.event)).toEqual([
      "run-start",
      "node-change",
      "node-change",
      "artifact",
      "node-change",
      "complete",
    ]);
    expect(payloads.at(0)?.issue).toBe("1551");
    expect(payloads.at(0)?.milestone).toBe("goal-1511-wave-2");
    expect(payloads.find((event) => event.event === "artifact")?.artifactUrl).toBe("https://example.test/artifacts/review-1551");
    expect(events.at(0)?.traceparent).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    expect(events.at(0)?.tracestate).toBe("rojo=00f067aa0ba902b7");
    expect(events.at(0)?.openlineage?.eventType).toBe("START");
    expect(events.at(0)?.openlineage?.job).toEqual({ namespace: "hatch.graph", name: "wave_execute" });
    expect(events.at(0)?.openlineage?.run).toEqual({ runId });
    expect(events.find((event) => eventData(event).event === "artifact")?.openlineage?.eventType).toBe("OUTPUT");
    expect(events.find((event) => eventData(event).event === "artifact")?.openlineage?.outputs).toEqual([
      { namespace: "artifact", name: "https://example.test/artifacts/review-1551" },
    ]);
    expect(events.find((event) => eventData(event).event === "complete")?.openlineage?.eventType).toBe("COMPLETE");
  });

  it("persists concurrent saveRunState calls for the same run without tmp-path races", async () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-run-lifecycle-race-"));
    cleanupDirs.push(root);
    const scopedRunsDir = join(root, "runs");
    process.env["HATCH_RUNS_DIR"] = scopedRunsDir;
    configureRunStorageScope({ runsDir: scopedRunsDir });

    const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const base = createRunState(runId, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
    base.currentNode = "start";

    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      Promise.resolve().then(() => {
        const state = structuredClone(base);
        state.currentNode = `node-${index}`;
        saveRunState(state, { updatePid: false });
      })
    ));

    const statePath = join(scopedRunsDir, runId, "state.json");
    expect(existsSync(statePath)).toBe(true);
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    expect(saved.runId).toBe(runId);
    expect(saved.currentNode).toMatch(/^node-\d+$/);
  });
});
