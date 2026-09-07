/**
 * Test fixture that simulates blocking loadSnapshot to verify the TUI
 * stays responsive when refresh I/O is offloaded to a worker thread.
 *
 * In production, factoryFleetStatus uses readFileSync, spawnSync("git"),
 * etc. which block the event loop. This fixture simulates that with a
 * busy-wait to prove the Ink input loop stays free.
 */

import { runFactoryFleetTui } from "../../src/cli/factory-fleet-tui.ts";

let callCount = 0;

function blockMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin — simulates spawnSync / readFileSync */ }
}

function snapshot() {
  callCount += 1;
  return {
    generated_at: `2026-03-18T18:30:0${callCount}.000Z`,
    fleet_totals: { total_factories: 2, healthy: 1, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
    warnings: [],
    factories: [
      {
        factory_id: "alpha",
        target_repo: "test/alpha",
        control_plane_repo: "test/control",
        factory_root: "/tmp/alpha",
        runs_dir: "/tmp/.hatch/alpha/runs",
        health: "healthy",
        active_waves: [],
        active_issues: [],
        active_work_summary: "Done",
        blocked_reason: "",
        recent_host_activity: { count: 1, latest_summary: "tick 1m ago", latest_graph: "tick.dot" },
        daemon_health: { status: "running", running: true },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "stable",
        warnings: [],
      },
      {
        factory_id: "beta",
        target_repo: "test/beta",
        control_plane_repo: "test/control",
        factory_root: "/tmp/beta",
        runs_dir: "/tmp/.hatch/beta/runs",
        health: "idle",
        active_waves: [],
        active_issues: [],
        active_work_summary: "Done",
        blocked_reason: "",
        recent_host_activity: { count: 0, latest_summary: "", latest_graph: "" },
        daemon_health: { status: "running", running: true },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "unknown",
        rollout_channel: "stable",
        warnings: [],
      },
    ],
  };
}

await runFactoryFleetTui({
  loadSnapshot: async () => {
    // Simulate 800ms of blocking sync I/O (real factoryFleetStatus does readFileSync, spawnSync)
    blockMs(800);
    return snapshot();
  },
  loadFactoryDetail: async () => ({
    summary: { health: "healthy", state_action: "running" },
    tabs: [{ id: "now", title: "Now", rows: [] }],
  }),
  // Very fast refresh so blocking happens frequently during the test.
  // With 1.5s interval and 800ms block, the event loop is blocked ~53% of the time.
  refreshMs: 1_500,
});
