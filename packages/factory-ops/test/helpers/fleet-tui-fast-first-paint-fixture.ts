import { runFactoryFleetTui } from "../../src/cli/factory-fleet-tui.ts";

const bootstrapSnapshot = {
  generated_at: "2026-03-18T18:30:00.000Z",
  fleet_totals: { total_factories: 1, healthy: 0, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
  warnings: ["fleet_bootstrap_snapshot"],
  factories: [
    {
      factory_id: "alpha",
      target_repo: "test/alpha",
      control_plane_repo: "test/control",
      factory_root: "/tmp/alpha",
      runs_dir: "/tmp/.hatch/alpha/runs",
      health: "idle",
      active_waves: [],
      active_issues: [],
      active_work_summary: "Loading live factory state…",
      blocked_reason: "",
      recent_host_activity: { count: 0, latest_summary: "Hydrating fleet state…", latest_graph: "" },
      daemon_health: { status: "running", running: true },
      managed_state: { reason: "Loading live factory state…" },
      release_state: "unknown",
      drift_state: "unknown",
      rollout_channel: "stable",
      warnings: [],
    },
  ],
};

setTimeout(() => {
  process.exit(0);
}, 500);

await runFactoryFleetTui({
  initialSnapshot: bootstrapSnapshot,
  loadSnapshot: async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return {
      generated_at: "2026-03-18T18:30:02.000Z",
      fleet_totals: { total_factories: 1, healthy: 1, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 1 },
      warnings: [],
      factories: [
        {
          ...bootstrapSnapshot.factories[0],
          health: "healthy",
          active_work_summary: "#101 · goal execute",
          active_issues: [101],
          recent_host_activity: { count: 1, latest_summary: "completed goal_execute.dot 1m ago", latest_graph: "goal_execute.dot" },
          managed_state: { reason: "" },
        },
      ],
    };
  },
  loadFactoryDetail: async () => ({
    summary: { health: "healthy", state_action: "running" },
    tabs: [{ id: "now", title: "Now", rows: [] }],
  }),
  refreshMs: 60_000,
});
