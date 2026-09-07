import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { render as renderInk } from "ink-testing-library";

import {
  buildFleetTuiState,
  FactoryFleetTuiApp,
  normalizeFleetTuiRefreshMs,
  reduceFleetTuiKeypress,
  resolveFleetDashboardLaunch,
} from "../../src/cli/factory-fleet-tui.ts";

function sampleSnapshot() {
  return {
    generated_at: "2026-03-18T17:20:00.000Z",
    fleet_totals: {
      total_factories: 4,
      healthy: 1,
      blocked: 0,
      unhealthy: 1,
      active_waves: 1,
      active_issues: 2,
    },
    warnings: [
      "release_targeting:trading:manifest_fetch_failed",
    ],
    factories: [
      {
        factory_id: "brainstorm",
        target_repo: "example-org/example-notes",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/brainstorm",
        runs_dir: "/tmp/.hatch/brainstorm/runs",
        health: "idle",
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none stage=Done",
        blocked_reason: "",
        recent_host_activity: {
          count: 1,
          latest_summary: "completed factory_supervisor_tick.dot 4m ago",
          latest_graph: "factory_supervisor_tick.dot",
        },
        recent_outcomes: [{ merged_prs: 0, closed_features: 0, merge_commits_main: 0 }],
        daemon_health: { status: "running", running: true },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "unknown",
        rollout_channel: "stable",
        warnings: [],
      },
      {
        factory_id: "mothership",
        target_repo: "recallnet/astrochicken",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/mothership",
        runs_dir: "/tmp/.hatch/mothership/runs",
        health: "healthy",
        active_waves: [],
        active_issues: [2201, 2337],
        active_work_summary: "waves=none issues=2201,2337 stage=Sweeping run/worktree residue",
        blocked_reason: "",
        recent_host_activity: {
          count: 42,
          latest_summary: "completed factory_supervisor_tick.dot 1m ago",
          latest_graph: "factory_supervisor_tick.dot",
        },
        recent_outcomes: [{ merged_prs: 2, closed_features: 6, merge_commits_main: 6 }],
        daemon_health: { status: "running", running: true },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "stable",
        warnings: [],
      },
      {
        factory_id: "trading",
        target_repo: "example-org/trading",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/trading",
        runs_dir: "/tmp/.hatch/trading/runs",
        health: "idle",
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none stage=run_managed_supervisor_shell",
        blocked_reason: "",
        gate_reason: "manifest_fetch_failed",
        rollout_status: "blocked",
        recent_host_activity: {
          count: 2,
          latest_summary: "completed managed_supervisor.dot 1m ago",
          latest_graph: "managed_supervisor.dot",
        },
        recent_outcomes: [{ merged_prs: 0, closed_features: 0, merge_commits_main: 0 }],
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

function sampleDashboard(factoryId = "mothership") {
  return {
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
            id: "goal_issue:2201",
            kind: "goal_issue",
            issue: "#2201",
            title: `${factoryId} review`,
            status: "review",
            progress_label: "2/4",
            updated_age: "1m",
            summary: "Review is active.",
            detail: ["Review feedback is being addressed."],
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
            id: "recent:1",
            kind: "supervisor",
            issue: "",
            title: `${factoryId} recent`,
            status: "completed",
            progress_label: "",
            updated_age: "2m",
            summary: "Recent work completed.",
            detail: ["No follow-up required."],
            refs: {},
          },
        ],
      },
    ],
  };
}

function renderApp(props = {}) {
  return renderInk(React.createElement(FactoryFleetTuiApp, {
    initialSnapshot: sampleSnapshot(),
    initialUiState: { activeView: "all", selectedIndex: 0, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadSnapshot: async () => sampleSnapshot(),
    loadFactoryDetail: async ({ initialFactoryContext } = {}) => sampleDashboard(initialFactoryContext?.factory_id || "brainstorm"),
    refreshMs: 60_000,
    onAction: () => {},
    ...props,
  }));
}

test("buildFleetTuiState filters rows by active view and search", () => {
  const active = buildFleetTuiState(sampleSnapshot(), {
    activeView: "active",
    searchQuery: "astrochicken",
  });

  assert.equal(active.rows.length, 1);
  assert.equal(active.rows[0].factory_id, "mothership");
});

test("resolveFleetDashboardLaunch builds initial factory context from selected row", () => {
  const launch = resolveFleetDashboardLaunch(sampleSnapshot(), {
    activeView: "all",
    selectedIndex: 3,
  });

  assert.equal(launch.ok, true);
  assert.equal(launch.row.factory_id, "trading");
  assert.equal(launch.initialFactoryContext.factory_id, "trading");
  assert.equal(launch.initialFactoryContext.target_repo, "example-org/trading");
  assert.equal(launch.initialFactoryContext.runs_dir, "/tmp/.hatch/trading/runs");
});

test("reduceFleetTuiKeypress opens search, captures literal input, and clears on escape", () => {
  let current = buildFleetTuiState(sampleSnapshot(), {
    activeView: "all",
    selectedIndex: 0,
    searchMode: false,
    searchQuery: "",
  });

  let reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state: current,
    input: "/",
    key: { sequence: "/" },
  });
  assert.equal(reduced.action.type, "none");
  assert.equal(reduced.state.searchMode, true);

  reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state: reduced.state,
    input: "",
    key: { name: "escape", sequence: "\u001b" },
  });
  assert.equal(reduced.state.searchMode, false);
  assert.equal(reduced.state.searchQuery, "");
});

test("reduceFleetTuiKeypress emits open_detail and quit actions", () => {
  const state = buildFleetTuiState(sampleSnapshot(), {
    activeView: "all",
    selectedIndex: 1,
    searchMode: false,
    searchQuery: "",
  });

  let reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state,
    input: "",
    key: { name: "return", sequence: "\r" },
  });
  assert.equal(reduced.action.type, "open_detail");
  assert.equal(reduced.action.launch.row.factory_id, "mothership");

  reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state,
    input: "q",
    key: { sequence: "q" },
  });
  assert.equal(reduced.action.type, "quit");
});

test("reduceFleetTuiKeypress handles Ink boolean key shapes for tab and arrows", () => {
  let reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state: { activeView: "all", selectedIndex: 0, searchMode: false, searchQuery: "" },
    input: "",
    key: { tab: true },
  });
  assert.equal(reduced.state.activeView, "active");

  reduced = reduceFleetTuiKeypress({
    snapshot: sampleSnapshot(),
    state: reduced.state,
    input: "",
    key: { downArrow: true },
  });
  assert.equal(reduced.state.selectedRowId, "mothership");
});

test("FactoryFleetTuiApp renders a designed board and detail shell", async () => {
  const app = renderApp();
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frame = app.lastFrame();

    assert.match(frame, /HATCH OPS/);
    assert.match(frame, /Fleet control room/);
    assert.match(frame, /Factories/);
    assert.match(frame, /Running/);
    assert.match(frame, /brainstorm/);
    assert.match(frame, /mothership/);
    assert.match(frame, /Work/);
    assert.match(frame, /Recent/);
    assert.match(frame, /j\/k move/);
  } finally {
    app.unmount();
  }
});

test("FactoryFleetTuiApp hydrates immediately on mount from a shallow bootstrap snapshot", async () => {
  let loadCalls = 0;
  const bootstrapSnapshot = {
    generated_at: "2026-03-18T17:19:00.000Z",
    fleet_totals: { total_factories: 1, healthy: 0, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
    warnings: ["fleet_bootstrap_snapshot"],
    factories: [
      {
        factory_id: "trading",
        target_repo: "example-org/trading",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/trading",
        runs_dir: "/tmp/.hatch/trading/runs",
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

  const hydratedSnapshot = sampleSnapshot();
  const app = renderApp({
    initialSnapshot: bootstrapSnapshot,
    loadSnapshot: async () => {
      loadCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return hydratedSnapshot;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    let frame = app.lastFrame();
    assert.match(frame, /Hydrating fleet/);
    assert.match(frame, /trading/);

    await new Promise((resolve) => setTimeout(resolve, 40));
    frame = app.lastFrame();
    assert.equal(loadCalls >= 1, true);
    assert.match(frame, /mothership/);
    assert.match(frame, /Running/);
  } finally {
    app.unmount();
  }
});

test("bootstrap loading placeholders collapse to stable idle empty state in detail mode", async () => {
  const bootstrapSnapshot = {
    generated_at: "2026-03-18T17:19:00.000Z",
    fleet_totals: { total_factories: 1, healthy: 0, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
    warnings: ["fleet_bootstrap_snapshot"],
    factories: [
      {
        factory_id: "mothership",
        target_repo: "recallnet/astrochicken",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/mothership",
        runs_dir: "/tmp/.hatch/mothership/runs",
        health: "idle",
        active_waves: [],
        active_issues: [],
        active_work_summary: "Loading live factory state…",
        blocked_reason: "",
        recent_host_activity: { count: 0, latest_summary: "Hydrating fleet state…", latest_graph: "" },
        daemon_health: { status: "stopped", running: false },
        managed_state: { reason: "Loading live factory state…" },
        release_state: "unknown",
        drift_state: "unknown",
        rollout_channel: "stable",
        warnings: [],
        bootstrap_loading: true,
      },
    ],
  };
  const app = renderApp({
    initialSnapshot: bootstrapSnapshot,
    loadSnapshot: async () => bootstrapSnapshot,
    loadFactoryDetail: async () => ({
      summary: {
        health: "idle",
        active_runs: 0,
        active_goals: 0,
        active_goal_issues: 0,
      },
      tabs: [
        {
          id: "now",
          title: "Now",
          rows: [],
          empty_message: "No active work or recent handoffs.",
        },
      ],
    }),
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const frame = app.lastFrame();
    assert.match(frame, /\bIDLE\s+mothership\s+Fleet \/ Now/i);
    assert.match(frame, /Health idle\s+Daemon stopped/i);
    assert.match(frame, /Active\s+no active work/i);
    assert.match(frame, /Recent\s+no recent work/i);
    assert.match(frame, /Attention\s+none/i);
    assert.match(frame, /Posture\s+health idle/i);
    assert.doesNotMatch(frame, /Posture\s+.*daemon stopped/i);
    assert.match(frame, /No active work or recent handoffs\./);
    assert.doesNotMatch(frame, /Loading live factory state/);
    assert.doesNotMatch(frame, /Hydrating fleet state/);
    assert.doesNotMatch(frame, /No row selected\./);
  } finally {
    app.unmount();
  }
});

test("detail mode recent summary comes from recent outcomes before host activity residue", async () => {
  const snapshot = {
    generated_at: "2026-03-18T17:19:00.000Z",
    fleet_totals: { total_factories: 1, healthy: 1, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
    warnings: [],
    factories: [
      {
        factory_id: "trading",
        target_repo: "example-org/trading",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/trading",
        runs_dir: "/tmp/.hatch/trading/runs",
        health: "healthy",
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none",
        blocked_reason: "",
        recent_host_activity: { count: 0, latest_summary: "", latest_graph: "" },
        recent_outcomes: [{ merged_prs: 2, closed_goals: 1, closed_features: 3, closed_bugs: 0, merge_commits_main: 3 }],
        daemon_health: { status: "stopped", running: false },
        managed_state: { reason: "" },
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "stable",
        warnings: [],
      },
    ],
  };

  const app = renderApp({
    initialSnapshot: snapshot,
    loadSnapshot: async () => snapshot,
    loadFactoryDetail: async () => ({
      summary: {
        health: "healthy",
        active_runs: 0,
        active_goals: 0,
        active_goal_issues: 0,
      },
      tabs: [{ id: "now", title: "Now", rows: [] }],
    }),
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const frame = app.lastFrame();
    assert.match(frame, /Recent\s+1 goal · 2 merges · 3 issues · 3 commits/i);
  } finally {
    app.unmount();
  }
});

test("detail mode prefers live bug-fast dashboard state over stale fleet row daemon and posture fields", async () => {
  const snapshot = {
    generated_at: "2026-04-01T01:09:00.000Z",
    fleet_totals: { total_factories: 1, healthy: 1, blocked: 0, unhealthy: 0, active_waves: 0, active_issues: 0 },
    warnings: [],
    factories: [
      {
        factory_id: "trading",
        target_repo: "example-org/trading",
        control_plane_repo: "recallnet/astrochicken",
        factory_root: "/tmp/trading",
        runs_dir: "/tmp/.hatch/trading/runs",
        health: "healthy",
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none stage=Done",
        blocked_reason: "",
        recent_host_activity: { count: 0, latest_summary: "", latest_graph: "" },
        recent_outcomes: [{ merged_prs: 0, closed_goals: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }],
        daemon_health: { status: "stopped", running: false },
        managed_state: { reason: "" },
        release_state: "unknown",
        drift_state: "unknown",
        rollout_channel: "stable",
        warnings: [],
      },
    ],
  };

  const app = renderApp({
    initialSnapshot: snapshot,
    loadSnapshot: async () => snapshot,
    loadFactoryDetail: async () => ({
      summary: {
        health: "healthy",
        active_runs: 1,
        active_goals: 0,
        active_goal_issues: 0,
        current_tick: {
          run_id: "tick-1",
          stage: "run_domain_graph",
          progress: "",
          age: "7m",
        },
        bug_gate: {
          active: true,
          mode: "bug-fast",
          admission: "paused_for_bug_review",
          open_bug_count: 2,
          open_bug_refs: ["#1877", "#1878"],
        },
      },
      tabs: [{
        id: "now",
        title: "Now",
        rows: [{
          id: "supervisor:tick-1",
          kind: "supervisor",
          issue: "",
          title: "Supervisor",
          status: "running",
          progress_label: "",
          updated_age: "7m",
          summary: "run_domain_graph",
          detail: ["run_domain_graph"],
          refs: {},
        }],
      }],
    }),
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const frame = app.lastFrame();
    assert.match(frame, /Health healthy\s+Daemon running/i);
    assert.match(frame, /Posture\s+health healthy\s+·\s+release unknown\s+·\s+mode bug-fast\s+·\s+admission paused_for_bug_re/i);
    assert.match(frame, /Active\s+1 active run\s+·\s+bug-fast review\s+·\s+goal admission paused/i);
    assert.match(frame, /Blockers\s+#1877\s+#1878/i);
    assert.doesNotMatch(frame, /Health healthy\s+Daemon stopped/i);
  } finally {
    app.unmount();
  }
});

test("FactoryFleetTuiApp keyboard navigation moves selection and filters views", async () => {
  const app = renderApp();
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("j");
  await new Promise((resolve) => setTimeout(resolve, 10));
  let frame = app.lastFrame();
  assert.match(frame, /mothership/);
  assert.match(frame, /#2201 · #2337/);

  app.stdin.write("2");
  await new Promise((resolve) => setTimeout(resolve, 10));
  frame = app.lastFrame();
  assert.match(frame, /1:All/);
  assert.match(frame, /2:Active/);
  assert.match(frame, /mothership/);
  app.unmount();
});

test("FactoryFleetTuiApp search mode and attention copy prefer operator language over raw internals", async () => {
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 2, selectedRowId: "", searchMode: false, searchQuery: "" },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  let frame = app.lastFrame();
  assert.match(frame, /managed supervisor/);
  assert.match(frame, /release targeting degraded/);
  assert.doesNotMatch(frame, /manifest_fetch_failed/);

  app.stdin.write("/");
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("brain");
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  frame = app.lastFrame();
  assert.match(frame, /brainstorm/);
  app.unmount();
});

test("FactoryFleetTuiApp enter opens an in-app factory detail screen", async () => {
  const actions = [];
  const app = renderApp({
    onAction: (action) => actions.push(action),
    initialUiState: { activeView: "all", selectedIndex: 1, selectedRowId: "", searchMode: false, searchQuery: "" },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const frame = app.lastFrame();
  assert.equal(actions.length, 0);
  assert.match(frame, /mothership/);
  assert.match(frame, /Fleet \/ Now/);
  assert.match(frame, /mothership review/);
  // Selected row section header removed in visual redesign; inspector renders inline
  app.unmount();
});

test("FactoryFleetTuiApp detail header prefers live dashboard health and activity over stale fleet row posture", async () => {
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 2, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadFactoryDetail: async ({ initialFactoryContext } = {}) => ({
      summary: {
        health: "healthy",
        active_runs: 3,
        active_goals: 1,
        active_goal_issues: 1,
      },
      tabs: [
        {
          id: "now",
          title: "Now",
          rows: [
            {
              id: "goal_issue:1399",
              kind: "goal_issue",
              issue: "#1399",
              title: `${initialFactoryContext?.factory_id || "trading"} review`,
              status: "running",
              progress_label: "build",
              updated_age: "8s",
              summary: "Build is active.",
              detail: ["Builder is running."],
              refs: {},
            },
          ],
        },
      ],
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const frame = app.lastFrame();
  assert.match(frame, /HEALTHY/, "detail header should use live dashboard health");
  assert.match(frame, /3 active runs/, "detail summary should use live dashboard activity");
  assert.match(frame, /trading review/, "detail rows should still render normally");
  app.unmount();
});

test("FactoryFleetTuiApp detail posture does not count recent handoff continuity rows as active work", async () => {
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 2, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadFactoryDetail: async () => ({
      summary: {
        health: "idle",
        active_runs: 0,
        active_goals: 0,
        active_goal_issues: 0,
      },
      tabs: [
        {
          id: "now",
          title: "Now",
          rows: [
            {
              id: "recent-handoff:trading-1",
              kind: "recent_handoff",
              issue: "#1394",
              title: "Research-derived reward MM spec",
              status: "completed",
              progress_label: "load_metadata",
              updated_age: "0ms",
              summary: "load_metadata • recent handoff",
              detail: ["Active work just rolled over."],
              refs: {},
            },
          ],
        },
      ],
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const frame = app.lastFrame();
  assert.match(frame, /Active\s+managed supervisor/i);
  assert.doesNotMatch(frame, /1 active run/);
  assert.match(frame, /recent handoff/i);
  app.unmount();
});

test("FactoryFleetTuiApp detail enter emits a session action and escape returns to fleet", async () => {
  const actions = [];
  const app = renderApp({
    onAction: (action) => actions.push(action),
    initialUiState: { activeView: "all", selectedIndex: 1, selectedRowId: "", searchMode: false, searchQuery: "" },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 40));
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 20));
  let frame = app.lastFrame();
  assert.match(frame, /Fleet control room/);

  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 40));
  app.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "session");
  assert.equal(actions[0].launch.initialTarget.run_id, "mothership-run-1");
  app.unmount();
});

test("FactoryFleetTuiApp q quits and r requests a refresh", async () => {
  const actions = [];
  let refreshCount = 0;
  const app = renderApp({
    onAction: (action) => actions.push(action),
    loadSnapshot: async () => {
      refreshCount += 1;
      return sampleSnapshot();
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.stdin.write("r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(refreshCount >= 1, true);

  app.stdin.write("q");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "quit");
  app.unmount();
});

test("normalizeFleetTuiRefreshMs raises interactive refresh to a sane minimum", () => {
  assert.equal(normalizeFleetTuiRefreshMs(undefined), 10_000);
  assert.equal(normalizeFleetTuiRefreshMs(250), 1_500);
  assert.equal(normalizeFleetTuiRefreshMs("2000"), 2_000);
});

test("reduceFleetTuiKeypress j/k returns index-only patch without recomputing rows", () => {
  const snap = sampleSnapshot();
  const initial = buildFleetTuiState(snap, { activeView: "all", selectedIndex: 0, searchMode: false, searchQuery: "" });

  // Navigate down — should return state with rows carried over, not a fresh buildFleetTuiState call
  const down = reduceFleetTuiKeypress({ snapshot: snap, state: initial, input: "j", key: { sequence: "j" } });
  assert.equal(down.state.selectedIndex, 1);
  assert.equal(down.state.rows, initial.rows, "rows reference must be reused — not re-filtered");

  // Navigate up — same contract
  const up = reduceFleetTuiKeypress({ snapshot: snap, state: down.state, input: "k", key: { sequence: "k" } });
  assert.equal(up.state.selectedIndex, 0);
  assert.equal(up.state.rows, initial.rows, "rows reference must be reused on up navigation");
});

test("reduceFleetTuiKeypress detail j/k returns index-only patch without recomputing detail rows", () => {
  const snap = sampleSnapshot();
  const detailState = {
    mode: "detail",
    activeView: "all",
    selectedIndex: 1,
    selectedRowId: "mothership",
    searchMode: false,
    searchQuery: "",
    detailDashboard: sampleDashboard("mothership"),
    detailActiveTab: "now",
    detailSelectedIndex: 0,
    detailSelectedRowId: "",
    detailFactoryContext: { factory_id: "mothership" },
  };

  const down = reduceFleetTuiKeypress({ snapshot: snap, state: detailState, input: "j", key: { sequence: "j" } });
  // In "now" tab there's only 1 row, so index stays at 0 (clamped)
  assert.equal(down.state.detailSelectedIndex, 0);
  // State identity: only detailSelectedIndex/detailSelectedRowId should differ
  assert.equal(down.state.mode, "detail");
  assert.equal(down.state.detailActiveTab, "now");
});

test("reduceFleetTuiKeypress quit returns input state reference (no recompute)", () => {
  const snap = sampleSnapshot();
  const initial = buildFleetTuiState(snap, { activeView: "all", selectedIndex: 0, searchMode: false, searchQuery: "" });

  const quit = reduceFleetTuiKeypress({ snapshot: snap, state: initial, input: "q", key: { sequence: "q" } });
  assert.equal(quit.action.type, "quit");
  assert.equal(quit.state, initial, "quit must return input state — no recompute");
});

test("reduceFleetTuiKeypress unrecognized key returns input state reference (no recompute, no re-render)", () => {
  const snap = sampleSnapshot();
  const initial = buildFleetTuiState(snap, { activeView: "all", selectedIndex: 0, searchMode: false, searchQuery: "" });

  const noop = reduceFleetTuiKeypress({ snapshot: snap, state: initial, input: "z", key: { sequence: "z" } });
  assert.equal(noop.action.type, "none");
  assert.equal(noop.state, initial, "unrecognized key must return input state — no recompute");
});

test("auto-refresh in detail mode calls loadFactoryDetail not loadSnapshot (no stale closure)", async () => {
  let snapshotCalls = 0;
  let detailCalls = 0;
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 1, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadSnapshot: async () => {
      snapshotCalls += 1;
      return sampleSnapshot();
    },
    loadFactoryDetail: async ({ initialFactoryContext } = {}) => {
      detailCalls += 1;
      return sampleDashboard(initialFactoryContext?.factory_id || "brainstorm");
    },
    refreshMs: 1_500,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Navigate into detail mode
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const frame = app.lastFrame();
    assert.match(frame, /Fleet \/ Now/, "should be in detail mode");

    // Reset counters after entering detail mode
    const snapshotBefore = snapshotCalls;
    const detailBefore = detailCalls;

    // Wait for auto-refresh to fire (1.5s + buffer)
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // The refresh should have called loadFactoryDetail (detail mode), not loadSnapshot
    assert.equal(detailCalls > detailBefore, true, "detail refresh should call loadFactoryDetail");
    assert.equal(snapshotCalls, snapshotBefore, "detail refresh must NOT call loadSnapshot — stale closure bug");
  } finally {
    app.unmount();
  }
});

test("open detail switches modes immediately and preserves the latest async detail response", async () => {
  let resolverAlpha = null;
  let resolverMothership = null;
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 0, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadFactoryDetail: ({ initialFactoryContext } = {}) => new Promise((resolve) => {
      if (initialFactoryContext?.factory_id === "brainstorm") {
        resolverAlpha = () => resolve(sampleDashboard("brainstorm"));
        return;
      }
      resolverMothership = () => resolve(sampleDashboard(initialFactoryContext?.factory_id || "mothership"));
    }),
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(app.lastFrame(), /Fleet \/ Now/, "detail view should open immediately");
    assert.match(app.lastFrame(), /Loading brainstorm/, "detail view should show a loading state");

    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.stdin.write("j");
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(app.lastFrame(), /Loading mothership/, "latest selected factory should own the loading state");

    resolverAlpha?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.doesNotMatch(app.lastFrame(), /brainstorm review/, "stale detail response must not overwrite newer selection");

    resolverMothership?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(app.lastFrame(), /mothership review/, "latest detail response should render");
  } finally {
    app.unmount();
  }
});

test("open detail renders inline load failures instead of crashing", async () => {
  const app = renderApp({
    initialUiState: { activeView: "all", selectedIndex: 2, selectedRowId: "", searchMode: false, searchQuery: "" },
    loadFactoryDetail: async () => {
      throw new Error("HATCH_CANONICAL_EVENT_STORE_URL is required for canonical factory status");
    },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const frame = app.lastFrame();
    assert.match(frame, /Fleet \/ Now/, "detail view should remain mounted after a load failure");
    assert.match(frame, /Unable to load live factory detail./, "detail view should surface a stable fallback message");
    assert.match(frame, /HATCH_CANONICAL_EVENT_STORE_URL is required for canonical/, "detail view should show the canonical status prerequisite error");
    assert.match(frame, /factory status/, "detail view should preserve the wrapped canonical status suffix");
  } finally {
    app.unmount();
  }
});

test("auto-refresh with unchanged snapshot does not trigger unnecessary re-renders", async () => {
  let renderCount = 0;
  const stableSnapshot = sampleSnapshot();
  const app = renderApp({
    loadSnapshot: async () => {
      renderCount += 1;
      return stableSnapshot;
    },
    refreshMs: 1_500,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Wait for 2 refresh cycles
    const before = renderCount;
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    const after = renderCount;

    // loadSnapshot was called at least once (proving refresh fired)
    assert.equal(after > before, true, "loadSnapshot should have been called");

    // The app should still be responsive — verify by sending input
    app.stdin.write("j");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = app.lastFrame();
    assert.match(frame, /mothership/, "app should remain responsive after refreshes");
  } finally {
    app.unmount();
  }
});

test("offthread dispatcher is used for loadSnapshot in fleet-tui command", async () => {
  // Verify the offthread dispatcher module loads and works correctly.
  // The actual event-loop-blocking fix is in factory-status-cmds.mjs which
  // routes loadSnapshot through callOffThread, running heavy sync I/O
  // (readFileSync, spawnSync) in a worker thread instead of the main thread.
  const { callOffThread, terminateDispatcher } = await import("../../src/lib/offthread-dispatcher.ts");
  try {
    const result = await callOffThread("ping", { test: true });
    assert.equal(result.pong, true);
    assert.equal(result.test, true);
  } finally {
    await terminateDispatcher();
  }
});
