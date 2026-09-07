import { describe, expect, it, vi } from "vitest";

import { ForemanHost } from "./host.js";
import type { ForemanCycleInput, ForemanCycleDecision, ForemanProbeSnapshot } from "./types.js";

function probe(overrides: Partial<ForemanProbeSnapshot> = {}): ForemanProbeSnapshot {
  return {
    factory_id: "mothership",
    timestamp: "2026-03-19T10:00:00.000Z",
    anomaly_detected: false,
    anomalies: [],
    nominal_probes: ["daemon_alive", "last_tick_age"],
    summary: "healthy snapshot",
    ...overrides,
  };
}

describe("ForemanHost", () => {
  it("routes a nominal cycle through the foreman session and writes a concise artifact", async () => {
    const run = vi.fn<(_: ForemanCycleInput) => Promise<ForemanCycleDecision>>().mockResolvedValue({
      mode: "watch",
      summary: "healthy and watching",
      investigation: null,
    });
    const writeArtifact = vi.fn().mockResolvedValue("artifact.json");
    const host = new ForemanHost({
      factoryId: "mothership",
      runsDir: "/tmp/runs",
      sessionRunner: { run },
      writeArtifact,
      now: () => 1000,
    });

    await host.enqueueProbe(probe());

    expect(run).toHaveBeenCalledTimes(1);
    expect(writeArtifact).toHaveBeenCalledTimes(1);
    expect(host.getStatus()).toMatchObject({
      mode: "watch",
      active_incident_id: null,
      summary: "healthy and watching",
      pending_probe: false,
    });
  });

  it("coalesces superseded probes while busy and processes only the latest pending snapshot", async () => {
    let releaseFirst: (() => void) | undefined;
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<ForemanCycleDecision>((resolve) => {
        releaseFirst = () => resolve({ mode: "watch", summary: "first", investigation: null });
      }))
      .mockResolvedValueOnce({ mode: "watch", summary: "latest", investigation: null });
    const writeArtifact = vi.fn().mockResolvedValue("artifact.json");
    const host = new ForemanHost({
      factoryId: "mothership",
      runsDir: "/tmp/runs",
      sessionRunner: { run },
      writeArtifact,
      now: () => 1000,
    });

    const first = host.enqueueProbe(probe({ timestamp: "2026-03-19T10:00:00.000Z" }));
    const second = host.enqueueProbe(probe({ timestamp: "2026-03-19T10:05:00.000Z", summary: "stale pending" }));
    const third = host.enqueueProbe(probe({ timestamp: "2026-03-19T10:10:00.000Z", summary: "latest pending" }));
    releaseFirst?.();
    await Promise.all([first, second, third]);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].probe.timestamp).toBe("2026-03-19T10:10:00.000Z");
  });

  it("opens and persists an incident when anomaly work is escalated", async () => {
    const run = vi.fn().mockResolvedValue({
      mode: "investigate",
      summary: "daemon is down",
      open_incident: { summary: "daemon down" },
      investigation: { root_cause: "launchd crashed", action: "restart daemon", outcome: "pending" },
    });
    const persistIncident = vi.fn();
    const writeArtifact = vi.fn().mockResolvedValue("artifact.json");
    const host = new ForemanHost({
      factoryId: "mothership",
      runsDir: "/tmp/runs",
      sessionRunner: { run },
      writeArtifact,
      persistIncident,
      now: () => 2000,
    });

    await host.enqueueProbe(probe({
      anomaly_detected: true,
      anomalies: [{ probe: "daemon_alive", status: "fail", detail: "pid missing" }],
    }));

    expect(persistIncident).toHaveBeenCalledTimes(1);
    expect(host.getStatus()).toMatchObject({
      mode: "investigate",
      active_incident_id: expect.stringMatching(/^incident-/),
    });
  });

  it("resolves an active incident when the foreman closes it", async () => {
    const persistIncident = vi.fn();
    const writeArtifact = vi.fn().mockResolvedValue("artifact.json");
    const run = vi.fn()
      .mockResolvedValueOnce({
        mode: "investigate",
        summary: "stuck worktree cleanup needed",
        open_incident: { summary: "cleanup incident" },
      })
      .mockResolvedValueOnce({
        mode: "watch",
        summary: "incident resolved",
        resolve_incident: true,
      });
    const host = new ForemanHost({
      factoryId: "mothership",
      runsDir: "/tmp/runs",
      sessionRunner: { run },
      writeArtifact,
      persistIncident,
      now: () => 3000,
    });

    await host.enqueueProbe(probe({
      anomaly_detected: true,
      anomalies: [{ probe: "stuck_process", status: "fail", detail: "process exceeded threshold" }],
    }));
    await host.enqueueProbe(probe({ timestamp: "2026-03-19T10:06:00.000Z" }));

    expect(persistIncident).toHaveBeenCalledTimes(2);
    expect(host.getStatus().active_incident_id).toBeNull();
    expect(host.getStatus().summary).toBe("incident resolved");
  });
});
