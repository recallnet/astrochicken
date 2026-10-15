import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { runFactoryFleetTui } from "../../src/cli/factory-fleet-tui.ts";

const actionPath = process.env.FLEET_TUI_ACTION_PATH || "";

function writeAction(payload = {}) {
  if (!actionPath) return;
  if (existsSync(actionPath)) return;
  mkdirSync(dirname(actionPath), { recursive: true });
  writeFileSync(actionPath, JSON.stringify(payload, null, 2));
}

function snapshot() {
  return {
    generated_at: "2026-03-18T18:30:00.000Z",
    fleet_totals: {
      total_factories: 2,
      healthy: 1,
      blocked: 0,
      unhealthy: 0,
      active_waves: 1,
      active_issues: 1,
    },
    warnings: [],
    factories: [
      {
        factory_id: "alpha",
        target_repo: "example-org/alpha",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/alpha",
        runs_dir: "/tmp/.hatch/alpha/runs",
        health: "healthy",
        active_waves: ["wave-1"],
        active_issues: [101],
        active_work_summary: "waves=wave-1 issues=101 stage=goal_execute.dot",
        blocked_reason: "",
        recent_host_activity: {
          count: 2,
          latest_summary: "completed goal_execute.dot 1m ago",
          latest_graph: "goal_execute.dot",
        },
        daemon_health: { status: "running", running: true },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "stable",
        warnings: [],
      },
      {
        factory_id: "beta",
        recent_outcomes: [{ closed_features: 1 }],
        target_repo: "example-org/beta",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/beta",
        runs_dir: "/tmp/.hatch/beta/runs",
        health: "idle",
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none stage=Done",
        blocked_reason: "",
        recent_host_activity: {
          count: 1,
          latest_summary: "completed managed_supervisor.dot 2m ago",
          latest_graph: "managed_supervisor.dot",
        },
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

function dashboard(factoryId = "alpha") {
  return {
    generated_at: "2026-03-18T18:30:00.000Z",
    summary: {
      health: "healthy",
      state_action: "running",
    },
    tabs: [
      {
        id: "now",
        title: "Now",
        rows: [
          {
            id: "goal_issue:101",
            kind: "goal_issue",
            issue: "#101",
            title: `${factoryId} ship review`,
            status: "review",
            progress_label: "2/4",
            updated_age: "1m",
            summary: "Reviewing the current implementation.",
            detail: [
              "Open review comments are being reconciled.",
              "Merge candidate is waiting on approval.",
            ],
            refs: {
              live_attachable: true,
              live_attach_target: {
                factory_id: factoryId,
                run_id: `${factoryId}-run-1`,
                session_id: `${factoryId}-session-1`,
                node: "review",
              },
            },
          },
        ],
      },
      {
        id: "recent",
        title: "Recent",
        rows: [
          {
            id: "run:recent",
            kind: "supervisor",
            issue: "",
            title: `${factoryId} supervisor tick`,
            status: "completed",
            progress_label: "",
            updated_age: "2m",
            summary: "Completed recent supervisor work.",
            detail: ["No follow-up required."],
            refs: {},
          },
        ],
      },
    ],
  };
}

await runFactoryFleetTui({
  loadSnapshot: async () => snapshot(),
  loadFactoryDetail: async ({ initialFactoryContext } = {}) => dashboard(initialFactoryContext?.factory_id || "alpha"),
  refreshMs: 60_000,
  launchSessionBrowser: async ({ initialTarget, initialFactoryContext } = {}) => {
    writeAction({
      type: "session",
      factory_id: initialFactoryContext?.factory_id || "",
      run_id: initialTarget?.run_id || "",
    });
  },
});

writeAction({ type: "quit" });
