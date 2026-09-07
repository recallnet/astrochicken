import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readForemanHistory, writeForemanArtifact } from "./telemetry.js";
import type { ForemanCycleArtifact } from "./types.js";

function artifact(overrides: Partial<ForemanCycleArtifact> = {}): ForemanCycleArtifact {
  return {
    type: "foreman_cycle",
    cycle_id: "abcd1234",
    factory_id: "mothership",
    timestamp: "2026-03-19T10:00:00.000Z",
    mode: "watch",
    anomaly_detected: false,
    anomalies: [],
    incident_id: null,
    summary: "healthy",
    investigation: null,
    duration_ms: 25,
    cost: {},
    ...overrides,
  };
}

describe("foreman telemetry", () => {
  it("writes a foreman cycle artifact into the runs directory", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "foreman-runs-"));
    const target = await writeForemanArtifact(runsDir, artifact());
    const raw = await readFile(target, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      type: "foreman_cycle",
      factory_id: "mothership",
      summary: "healthy",
    });
  });

  it("reads recent history in reverse chronological order with since filtering", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "foreman-history-"));
    await writeForemanArtifact(runsDir, artifact({ cycle_id: "one", timestamp: "2026-03-19T09:00:00.000Z", summary: "older" }));
    await writeForemanArtifact(runsDir, artifact({ cycle_id: "two", timestamp: "2026-03-19T11:00:00.000Z", summary: "newer" }));

    const history = await readForemanHistory(runsDir, { since: "2026-03-19T10:00:00.000Z", limit: 10 });
    expect(history).toHaveLength(1);
    expect(history[0]?.summary).toBe("newer");
  });
});
