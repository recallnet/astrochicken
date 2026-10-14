import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatTickStatus } from "../../src/commands/factory-tick-status.ts";
import { formatTickStageLine, presentTickStatus } from "../../src/lib/factory-status-presenter.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";
import { resolveRunsDir } from "../../src/lib/runs-dir-resolver.ts";

function readStateMap(runsDir) {
  const allStates = new Map();
  try {
    for (const runId of readdirSync(runsDir)) {
      const statePath = join(runsDir, runId, "state.json");
      try {
        allStates.set(runId, JSON.parse(readFileSync(statePath, "utf8")));
      } catch {}
    }
  } catch {}
  return allStates;
}

function tickStatus({ runsDir = ".hatch/runs", context = {}, now = Date.now() } = {}) {
  return buildTickProjectionFromStates({ allStates: readStateMap(runsDir), runsDir, context, now });
}

function tickHistoryFixture() {
  return [
      {
        id: "completed123",
        status: "completed",
        stage: "done",
        stageLabel: "Done",
        progress: "[23/23]",
        startedAt: "2026-01-01T00:00:00.000Z",
        elapsed: "45s",
        goalCount: "",
        child: null,
        blocked_control_plane: [],
      },
      {
        id: "failed123",
        status: "failed",
        stage: "review",
        stageLabel: "Review",
        progress: "[18/23]",
        startedAt: "2025-12-31T23:58:00.000Z",
        elapsed: "5m",
        goalCount: "",
        child: null,
        blocked_control_plane: [],
      },
  ];
}

test("tickStatus returns empty when no runs exist", () => {
  const out = tickStatus({ runsDir: "/nonexistent" });
  assert.ok(out.error || (out.ticks && out.ticks.length === 0));
});

test("formatTickStatus handles empty ticks", () => {
  const out = formatTickStatus({ ticks: [] });
  assert.match(out, /No supervisor ticks found/);
});

test("tickStatus carries resolved context into JSON output", () => {
  const out = tickStatus({
    runsDir: "/nonexistent",
    context: { factory_id: "mothership", runs_dir: "/tmp/runs" },
  });
  assert.equal(out.context.factory_id, "mothership");
  assert.equal(out.context.runs_dir, "/tmp/runs");
});

test("tickStatus emits blockerKind/blockerRef/unblockCondition in JSON for blocked control-plane waves", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-status-blocked-cp-"));
  const runId = "tick-1";
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId,
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
    currentNode: "decide_wave_dispatch",
    startedAt: new Date().toISOString(),
    context: {
      goal_execution_path: "hard",
      goal_routing_state: {
        decomposition_state: "required",
        planning_state: "pending_review",
      },
      goal_execution_path_version: "routing/v1",
      control_plane_blocked_items: JSON.stringify([
        {
          milestone: "goal-300-wave-1",
          issue_number: 301,
          kind: "upstream_bug",
          blockerRef: "#4000",
          unblockCondition: "release v6.0 ships",
          status: "blocked",
        },
      ]),
    },
  }));

  const out = tickStatus({ runsDir });
  assert.equal(out.ticks[0].goal_execution_path, "hard");
  assert.equal(out.ticks[0].planning_state, "pending_review");
  assert.equal(out.ticks[0].planning_review_required, true);
  assert.equal(out.ticks[0].blocked_control_plane.length, 1);
  assert.equal(out.ticks[0].blocked_control_plane[0].blockerKind, "upstream_bug");
  assert.equal(out.ticks[0].blocked_control_plane[0].blockerRef, "#4000");
  assert.equal(out.ticks[0].blocked_control_plane[0].unblockCondition, "release v6.0 ships");
  assert.equal(out.ticks[0].blocked_control_plane[0].linked_goal_number, 4000);
});

test("tickStatus inherits fresh child progress before declaring a running supervisor tick stuck", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-status-child-progress-"));
  const now = new Date();
  const startedAt = new Date(now.getTime() - 31 * 60_000).toISOString();
  const childUpdatedAt = new Date(now.getTime() - 30_000).toISOString();

  const tickDir = join(runsDir, "tick-1");
  mkdirSync(tickDir, { recursive: true });
  writeFileSync(join(tickDir, "state.json"), JSON.stringify({
    runId: "tick-1",
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
    currentNode: "run_domain_graph",
    startedAt,
    updatedAt: startedAt,
    context: {
      __child_run_id_run_domain_graph: "child-1",
    },
    activeChildren: {
      run_domain_graph__child_1: {
        parentNodeId: "run_domain_graph",
        childRunId: "child-1",
        status: "running",
        currentNode: "fan_out_goal_run",
      },
    },
  }, null, 2));

  const childDir = join(runsDir, "child-1");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(join(childDir, "state.json"), JSON.stringify({
    runId: "child-1",
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot",
    currentNode: "fan_out_goal_run",
    startedAt,
    updatedAt: childUpdatedAt,
    context: {},
  }, null, 2));

  const out = tickStatus({ runsDir });
  assert.equal(out.ticks[0].stuck_warning, "");
  assert.equal(out.ticks[0].tick_progress.made_progress, true);
  assert.match(out.ticks[0].tick_progress.summary, /active child progress in 1 run/);
});

test("formatTickStatus formats a running tick", () => {
  const out = formatTickStatus({
    context: {
      factory_root: "/tmp/factory-root",
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
      runs_dir: "/tmp/factory-root/.hatch/mothership/runs",
    },
    ticks: [{
      id: "abc12345",
      status: "running",
      stage: "wave_execute",
      stageLabel: "Executing wave",
      progress: "[14/23]",
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsed: "5m30s",
      elapsed_ms: 330000,
      goalCount: "3",
      child: {
        runId: "child123",
        node: "find_ready_wave",
        status: "running",
        issue: "205",
        milestone: "goal-205-wave-3",
      },
      blocked_control_plane: [
        {
          milestone: "goal-205-wave-3",
          issue_number: 205,
          blockerKind: "upstream_bug",
          blockerRef: "#1234",
          unblockCondition: "release v1.2 ships",
          status: "blocked",
        },
      ],
    }],
  });
  assert.match(out, /Factory: \/tmp\/factory-root/);
  assert.match(out, /Factory ID: mothership/);
  assert.match(out, /Target Repo: recallnet\/astrochicken/);
  assert.match(out, /CURRENT TICK/);
  assert.match(out, />>>/);
  assert.match(out, /Executing wave/);
  assert.match(out, /\[14\/23\]/);
  assert.match(out, /#205/);
  assert.match(out, /goal-205-wave-3/);
  assert.match(out, /Blocked: goal-205-wave-3 issue=#205 on upstream_bug #1234 until release v1.2 ships/);
});

test("tickStatus exposes multiple children for fan-out stages", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-status-fanout-"));

  const tickId = "tick-fanout";
  const childAId = "goal-a";
  const childBId = "goal-b";
  const grandchildAId = "decompose-a";
  const grandchildBId = "decompose-b";

  mkdirSync(join(runsDir, tickId), { recursive: true });
  mkdirSync(join(runsDir, childAId), { recursive: true });
  mkdirSync(join(runsDir, childBId), { recursive: true });
  mkdirSync(join(runsDir, grandchildAId), { recursive: true });
  mkdirSync(join(runsDir, grandchildBId), { recursive: true });

  writeFileSync(join(runsDir, tickId, "state.json"), JSON.stringify({
    runId: tickId,
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
    currentNode: "fan_out_goal_run",
    startedAt: new Date().toISOString(),
    context: {
      goal_count: "2",
    },
    activeChildren: {
      fan_out_goal_run__item_0__goal_a: {
        childId: "fan_out_goal_run__item_0__goal_a",
        parentNodeId: "fan_out_goal_run__item_0",
        runId: childAId,
        workerIndex: 0,
        status: "running",
      },
      fan_out_goal_run__item_1__goal_b: {
        childId: "fan_out_goal_run__item_1__goal_b",
        parentNodeId: "fan_out_goal_run__item_1",
        runId: childBId,
        workerIndex: 1,
        status: "running",
      },
    },
  }));

  writeFileSync(join(runsDir, childAId, "state.json"), JSON.stringify({
    runId: childAId,
    status: "running",
    currentNode: "intake_decompose",
    startedAt: new Date().toISOString(),
    context: {
      issue_number: "1812",
      goal_execution_path: "hard",
      goal_routing_state: {
        decomposition_state: "required",
        planning_state: "pending_review",
      },
      goal_execution_path_version: "routing/v1",
      __child_run_id_intake_decompose: grandchildAId,
    },
  }));

  writeFileSync(join(runsDir, childBId, "state.json"), JSON.stringify({
    runId: childBId,
    status: "running",
    currentNode: "intake_decompose",
    startedAt: new Date().toISOString(),
    context: {
      issue_number: "1852",
      goal_execution_path: "hard",
      goal_routing_state: {
        decomposition_state: "required",
        planning_state: "approved",
      },
      goal_execution_path_version: "routing/v1",
      __child_run_id_intake_decompose: grandchildBId,
    },
  }));

  writeFileSync(join(runsDir, grandchildAId, "state.json"), JSON.stringify({
    runId: grandchildAId,
    status: "running",
    currentNode: "analyze",
    startedAt: new Date().toISOString(),
    context: {
      issue_number: "1812",
      goal_execution_path: "hard",
      goal_routing_state: {
        decomposition_state: "required",
        planning_state: "pending_review",
      },
      goal_execution_path_version: "routing/v1",
    },
  }));

  writeFileSync(join(runsDir, grandchildBId, "state.json"), JSON.stringify({
    runId: grandchildBId,
    status: "running",
    currentNode: "analyze",
    startedAt: new Date().toISOString(),
    context: {
      issue_number: "1852",
      goal_execution_path: "hard",
      goal_routing_state: {
        decomposition_state: "required",
        planning_state: "approved",
      },
      goal_execution_path_version: "routing/v1",
    },
  }));

  const out = tickStatus({ runsDir });
  assert.equal(out.ticks[0].stage, "fan_out_goal_run");
  assert.equal(Array.isArray(out.ticks[0].children), true);
  assert.equal(out.ticks[0].children.length, 2);
  assert.equal(out.ticks[0].children[0].runId, childAId);
  assert.equal(out.ticks[0].children[0].child.runId, grandchildAId);
  assert.equal(out.ticks[0].children[1].runId, childBId);
  assert.equal(out.ticks[0].children[1].child.runId, grandchildBId);
  assert.equal(out.ticks[0].child.runId, childAId);
});

test("tickStatus includes managed_supervisor runs when selecting recent ticks", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-status-managed-supervisor-"));

  mkdirSync(join(runsDir, "legacy-old"), { recursive: true });
  writeFileSync(join(runsDir, "legacy-old", "state.json"), JSON.stringify({
    runId: "legacy-old",
    status: "completed",
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
    currentNode: "done",
    startedAt: "2026-03-24T03:00:35.354Z",
    context: {},
  }));

  mkdirSync(join(runsDir, "managed-current"), { recursive: true });
  writeFileSync(join(runsDir, "managed-current", "state.json"), JSON.stringify({
    runId: "managed-current",
    status: "running",
    pipelineFile: "/tmp/docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
    currentNode: "snapshot_state",
    startedAt: "2026-03-24T19:22:25.633Z",
    context: {},
  }));

  const out = tickStatus({ runsDir });
  assert.equal(out.ticks[0]?.id, "managed-current");
  assert.equal(out.ticks[0]?.status, "running");
  assert.equal(out.ticks[0]?.stage, "snapshot_state");
});

test("formatTickStatus shows completed tick as LAST TICK", () => {
  const out = formatTickStatus({
    ticks: [{
      id: "def67890",
      status: "completed",
      stage: "done",
      stageLabel: "Done",
      progress: "[23/23]",
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsed: "45s",
      elapsed_ms: 45000,
      goalCount: "",
      child: null,
    }],
  });
  assert.match(out, /LAST TICK/);
  assert.match(out, /OK/);
  assert.match(out, /Done/);
});

test("formatTickStatus prints CURRENT and LAST tick sections when latest tick is running", () => {
  const out = formatTickStatus({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    ticks: [
      {
        id: "running123",
        status: "running",
        stage: "wave_execute",
        stageLabel: "Executing wave",
        progress: "[12/23]",
        startedAt: "2026-01-01T00:01:00.000Z",
        elapsed: "2m10s",
        goalCount: "2",
        child: {
          runId: "child111",
          node: "execute_issue",
          status: "running",
          issue: "205",
          milestone: "goal-205-wave-2",
        },
        blocked_control_plane: [],
      },
      ...tickHistoryFixture(),
    ],
  });

  assert.match(out, /CURRENT TICK\s+>>>\s+running123/);
  assert.match(out, /LAST TICK\s+OK\s+completed123/);
  assert.match(out, /TICK -2\s+FAIL\s+failed123/);
  assert.match(out, /Stage: Executing wave\s+\[12\/23\]/);
  assert.match(out, /Elapsed: 2m10s\s+\(started 2026-01-01T00:01:00.000Z\)/);
  assert.match(out, /Active: child111\s+node=execute_issue #205 \[goal-205-wave-2\]/);
});

test("formatTickStatus labels third tick deterministically when latest is running", () => {
  const out = formatTickStatus({
    ticks: [
      {
        id: "running123",
        status: "running",
        stage: "wave_execute",
        stageLabel: "Executing wave",
        progress: "[12/23]",
        startedAt: "2026-01-01T00:01:00.000Z",
        elapsed: "2m10s",
        goalCount: "2",
        child: null,
        blocked_control_plane: [],
      },
      ...tickHistoryFixture(),
    ],
  });

  assert.match(out, /CURRENT TICK\s+>>>\s+running123/);
  assert.match(out, /LAST TICK\s+OK\s+completed123/);
  assert.match(out, /TICK -2\s+FAIL\s+failed123/);
});

test("formatTickStatus renders multiple active children for fan-out stages", () => {
  const out = formatTickStatus({
    ticks: [{
      id: "fanout123",
      status: "running",
      stage: "fan_out_goal_run",
      stageLabel: "Run goals in parallel",
      progress: "[9/28]",
      startedAt: "2026-03-11T20:38:56.053Z",
      elapsed: "1m13s",
      goalCount: "2",
      children: [
        {
          runId: "cdea906e",
          node: "intake_decompose",
          issue: "1812",
          goal_execution_path: "hard",
          goal_execution_path_version: "routing/v1",
          planning_state: "pending_review",
          child: {
            runId: "5fb96856",
            node: "analyze",
            issue: "1812",
            goal_execution_path: "hard",
            goal_execution_path_version: "routing/v1",
            planning_state: "pending_review",
          },
        },
        {
          runId: "4252df2e",
          node: "intake_decompose",
          issue: "1852",
          goal_execution_path: "hard",
          goal_execution_path_version: "routing/v1",
          planning_state: "approved",
          child: {
            runId: "d1e3dff4",
            node: "analyze",
            issue: "1852",
            goal_execution_path: "hard",
            goal_execution_path_version: "routing/v1",
            planning_state: "approved",
          },
        },
      ],
      blocked_control_plane: [],
    }],
  });

  assert.match(out, /Active children: 2/);
  assert.match(out, /- cdea906e\s+node=intake_decompose #1812\s+goal_execution_path=hard\s+goal_execution_path_version=routing\/v1\s+planning_state=pending_review/);
  assert.match(out, /└─ 5fb96856\s+node=analyze #1812\s+goal_execution_path=hard\s+goal_execution_path_version=routing\/v1\s+planning_state=pending_review/);
  assert.match(out, /- 4252df2e\s+node=intake_decompose #1852\s+goal_execution_path=hard\s+goal_execution_path_version=routing\/v1\s+planning_state=approved/);
  assert.match(out, /└─ d1e3dff4\s+node=analyze #1852\s+goal_execution_path=hard\s+goal_execution_path_version=routing\/v1\s+planning_state=approved/);
});

test("tick-status resolver supports factory-scoped defaults", () => {
  const scoped = resolveRunsDir({ factoryId: "external" });
  assert.match(scoped, /\.hatch[\\/]external[\\/]runs$/);
});

test("tick-status command is wired in CLI", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.ok(cmd.includes("tick-status"), "CLI must handle tick-status command");
  assert.ok(cmd.includes("tickStatus"), "CLI must import tickStatus");
  assert.match(cmd, /FactoryTickStatusCommand[\s\S]*Option\.String\("--factory-root", ""\)/);
  assert.match(cmd, /FactoryTickStatusCommand[\s\S]*Option\.String\("--factory-config-path", ""\)/);
  assert.match(cmd, /FactoryTickStatusCommand[\s\S]*Option\.String\("--factory-id", ""\)/);
  assert.match(cmd, /FactoryTickStatusCommand[\s\S]*resolveFactoryContextOrExit\(this, \{/);
  assert.match(cmd, /FactoryTickStatusCommand[\s\S]*Option\.Boolean\("--json", false\)/);
});

// ── Goal execution health signals ──────────────────────────────────────────

test("tickStatus returns goal_executions array for non-tick runs with goal_issue_number", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-exec-"));

  // Supervisor tick
  const tickId = "tick-1";
  mkdirSync(join(runsDir, tickId), { recursive: true });
  writeFileSync(join(runsDir, tickId, "state.json"), JSON.stringify({
    runId: tickId,
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
    currentNode: "wave_execute",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    context: {},
  }));

  // Goal execution run (active, healthy)
  const goalId = "goal-exec-1";
  const goalStarted = new Date(Date.now() - 300_000).toISOString();
  const recentHeartbeat = new Date(Date.now() - 10_000).toISOString();
  mkdirSync(join(runsDir, goalId), { recursive: true });
  writeFileSync(join(runsDir, goalId, "state.json"), JSON.stringify({
    runId: goalId,
    status: "running",
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    currentNode: "wave_execute",
    startedAt: goalStarted,
    updatedAt: new Date(Date.now() - 20_000).toISOString(),
    context: { goal_issue_number: 2320, milestone_title: "goal-2320-wave-1" },
    pid: process.pid, // use own PID so isProcessAlive returns true
  }));
  writeFileSync(join(runsDir, goalId, "metadata.json"), JSON.stringify({
    heartbeatAt: recentHeartbeat,
    pid: process.pid,
  }));

  const out = tickStatus({ runsDir });

  // Should have ticks
  assert.equal(out.ticks.length, 1);
  assert.equal(out.ticks[0].id, tickId);

  // Should have goal_executions
  assert.ok(Array.isArray(out.goal_executions), "goal_executions must be an array");
  assert.equal(out.goal_executions.length, 1);

  const ge = out.goal_executions[0];
  assert.equal(ge.runId, goalId);
  assert.equal(ge.goalIssueNumber, 2320);
  assert.equal(ge.status, "running");
  assert.equal(ge.currentNode, "wave_execute");
  assert.equal(ge.startedAt, goalStarted);
  assert.equal(ge.heartbeatAt, recentHeartbeat);
  assert.equal(ge.pidAlive, true);
  assert.equal(ge.health, "healthy");
  assert.ok(ge.elapsed_ms >= 290_000, "elapsed_ms should reflect start time");
  assert.ok(ge.heartbeatAge_ms < 30_000, "heartbeat should be recent");
});

test("tickStatus classifies zombie goal execution (stale heartbeat + dead PID)", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-zombie-"));

  const goalId = "goal-zombie-1";
  const staleHeartbeat = new Date(Date.now() - 7 * 3600_000).toISOString(); // 7 hours ago
  mkdirSync(join(runsDir, goalId), { recursive: true });
  writeFileSync(join(runsDir, goalId, "state.json"), JSON.stringify({
    runId: goalId,
    status: "running",
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    currentNode: "write_scenarios",
    startedAt: new Date(Date.now() - 8 * 3600_000).toISOString(),
    updatedAt: staleHeartbeat,
    context: { goal_issue_number: 2100 },
    pid: 999999, // dead PID
  }));
  writeFileSync(join(runsDir, goalId, "metadata.json"), JSON.stringify({
    heartbeatAt: staleHeartbeat,
    pid: 999999,
  }));

  const out = tickStatus({ runsDir });

  assert.equal(out.goal_executions.length, 1);
  const ge = out.goal_executions[0];
  assert.equal(ge.health, "zombie");
  assert.equal(ge.pidAlive, false);
  assert.ok(ge.heartbeatStale, "heartbeat should be stale");
  assert.ok(ge.heartbeatAge_ms > 6 * 3600_000, "heartbeat age should be >6h");
});

test("tickStatus classifies stale goal execution (stale heartbeat + alive PID)", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-stale-"));

  const goalId = "goal-stale-1";
  const staleHeartbeat = new Date(Date.now() - 600_000).toISOString(); // 10min ago
  mkdirSync(join(runsDir, goalId), { recursive: true });
  writeFileSync(join(runsDir, goalId, "state.json"), JSON.stringify({
    runId: goalId,
    status: "running",
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    currentNode: "intake_decompose",
    startedAt: new Date(Date.now() - 900_000).toISOString(),
    updatedAt: staleHeartbeat,
    context: { goal_issue_number: 2200 },
    pid: process.pid, // own PID — alive
  }));
  writeFileSync(join(runsDir, goalId, "metadata.json"), JSON.stringify({
    heartbeatAt: staleHeartbeat,
    pid: process.pid,
  }));

  const out = tickStatus({ runsDir });

  assert.equal(out.goal_executions.length, 1);
  const ge = out.goal_executions[0];
  assert.equal(ge.health, "stale");
  assert.equal(ge.pidAlive, true);
  assert.ok(ge.heartbeatStale, "heartbeat should be stale");
});

test("tickStatus uses state updatedAt when goal metadata heartbeatAt is missing", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-updatedat-heartbeat-"));

  const goalId = "goal-updated-fallback-1";
  const freshUpdate = new Date(Date.now() - 5_000).toISOString();
  mkdirSync(join(runsDir, goalId), { recursive: true });
  writeFileSync(join(runsDir, goalId, "state.json"), JSON.stringify({
    runId: goalId,
    status: "running",
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    currentNode: "execute_issue",
    startedAt: new Date(Date.now() - 900_000).toISOString(),
    updatedAt: freshUpdate,
    context: { goal_issue_number: 2201 },
    pid: process.pid,
  }));
  writeFileSync(join(runsDir, goalId, "metadata.json"), JSON.stringify({
    pid: process.pid,
  }));

  const out = tickStatus({ runsDir });

  assert.equal(out.goal_executions.length, 1);
  const ge = out.goal_executions[0];
  assert.equal(ge.health, "healthy");
  assert.equal(ge.heartbeatAt, freshUpdate);
  assert.equal(ge.pidAlive, true);
  assert.equal(ge.heartbeatStale, false);
});

test("tickStatus uses the freshest timestamp across metadata heartbeatAt and state updatedAt", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-freshest-heartbeat-"));

  const goalId = "goal-freshest-heartbeat-1";
  const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
  const freshUpdate = new Date(Date.now() - 5_000).toISOString();
  mkdirSync(join(runsDir, goalId), { recursive: true });
  writeFileSync(join(runsDir, goalId, "state.json"), JSON.stringify({
    runId: goalId,
    status: "running",
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    currentNode: "execute_issue",
    startedAt: new Date(Date.now() - 900_000).toISOString(),
    updatedAt: freshUpdate,
    context: { goal_issue_number: 2202 },
    pid: process.pid,
  }));
  writeFileSync(join(runsDir, goalId, "metadata.json"), JSON.stringify({
    heartbeatAt: staleHeartbeat,
    pid: process.pid,
  }));

  const out = tickStatus({ runsDir });

  assert.equal(out.goal_executions.length, 1);
  const ge = out.goal_executions[0];
  assert.equal(ge.health, "healthy");
  assert.equal(ge.heartbeatAt, freshUpdate);
  assert.equal(ge.pidAlive, true);
  assert.equal(ge.heartbeatStale, false);
});

test("tickStatus returns goal_execution_summary with health counts", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-summary-"));

  // Healthy goal
  const g1 = "goal-h1";
  mkdirSync(join(runsDir, g1), { recursive: true });
  writeFileSync(join(runsDir, g1, "state.json"), JSON.stringify({
    runId: g1, status: "running", currentNode: "wave_execute",
    pipelineFile: "goal_run.dot",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    context: { goal_issue_number: 100 }, pid: process.pid,
  }));
  writeFileSync(join(runsDir, g1, "metadata.json"), JSON.stringify({
    heartbeatAt: new Date(Date.now() - 5_000).toISOString(), pid: process.pid,
  }));

  // Zombie goal
  const g2 = "goal-z1";
  mkdirSync(join(runsDir, g2), { recursive: true });
  writeFileSync(join(runsDir, g2, "state.json"), JSON.stringify({
    runId: g2, status: "running", currentNode: "write_scenarios",
    pipelineFile: "goal_run.dot",
    startedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    context: { goal_issue_number: 200 }, pid: 999998,
  }));
  writeFileSync(join(runsDir, g2, "metadata.json"), JSON.stringify({
    heartbeatAt: new Date(Date.now() - 5 * 3600_000).toISOString(), pid: 999998,
  }));

  const out = tickStatus({ runsDir });

  assert.ok(out.goal_execution_summary, "must have goal_execution_summary");
  assert.equal(out.goal_execution_summary.total, 2);
  assert.equal(out.goal_execution_summary.healthy, 1);
  assert.equal(out.goal_execution_summary.zombie, 1);
  assert.equal(out.goal_execution_summary.stale, 0);
});

test("tickStatus excludes completed/failed goal runs from goal_executions", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-goal-done-"));

  const g1 = "goal-done-1";
  mkdirSync(join(runsDir, g1), { recursive: true });
  writeFileSync(join(runsDir, g1, "state.json"), JSON.stringify({
    runId: g1, status: "completed", currentNode: "done",
    pipelineFile: "goal_run.dot",
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    context: { goal_issue_number: 300 },
  }));

  const out = tickStatus({ runsDir });
  assert.equal(out.goal_executions.length, 0);
  assert.equal(out.goal_execution_summary.total, 0);
});

test("formatTickStatus renders goal execution health section", () => {
  const out = formatTickStatus({
    context: { factory_id: "mothership" },
    ticks: [{
      id: "tick-1", status: "running", stage: "wave_execute",
      stageLabel: "Executing wave", progress: "[14/28]",
      startedAt: "2026-03-20T10:00:00.000Z", elapsed: "2m",
      blocked_control_plane: [],
    }],
    goal_executions: [
      {
        runId: "abcd1234-long-id", goalIssueNumber: 2320,
        status: "running", currentNode: "wave_execute",
        startedAt: "2026-03-20T09:00:00.000Z", elapsed: "1h2m",
        heartbeatAt: "2026-03-20T09:58:00.000Z",
        heartbeatAge_ms: 120_000, heartbeatStale: false,
        pidAlive: true, health: "healthy",
        milestone: "goal-2320-wave-1",
      },
      {
        runId: "dead5678-long-id", goalIssueNumber: 2100,
        status: "running", currentNode: "write_scenarios",
        startedAt: "2026-03-20T02:00:00.000Z", elapsed: "8h2m",
        heartbeatAt: "2026-03-20T02:30:00.000Z",
        heartbeatAge_ms: 7 * 3600_000, heartbeatStale: true,
        pidAlive: false, health: "zombie",
        milestone: "goal-2100-wave-2",
      },
    ],
    goal_execution_summary: { total: 2, healthy: 1, stale: 0, zombie: 1 },
  });

  assert.match(out, /GOAL EXECUTIONS\s+2 active/);
  assert.match(out, /1 zombie/);
  assert.match(out, /✓ abcd1234\s+goal=#2320\s+node=wave_execute\s+elapsed=1h2m\s+health=healthy/);
  assert.match(out, /☠ dead5678\s+goal=#2100\s+node=write_scenarios\s+elapsed=8h2m\s+health=zombie/);
});

test("tick presenter emits shared stage/progress/elapsed/blocked block", () => {
  const stageLine = formatTickStageLine({ stageLabel: "Executing wave", progress: "[14/23]" });
  assert.equal(stageLine, "  Stage: Executing wave  [14/23]");

  const presentation = presentTickStatus({
    context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
    ticks: [{
      id: "tick-shared-1",
      status: "running",
      stage: "wave_execute",
      stageLabel: "Executing wave",
      progress: "[14/23]",
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsed: "5m30s",
      goalCount: "3",
      blocked_control_plane: [{
        milestone: "goal-205-wave-3",
        issue_number: 205,
        blockerKind: "upstream_bug",
        blockerRef: "#1234",
        unblockCondition: "release v1.2 ships",
      }],
    }],
  });
  const rendered = formatTickStatus(presentation.json);
  assert.match(rendered, /Stage: Executing wave {2}\[14\/23\]/);
  assert.match(rendered, /Elapsed: 5m30s {2}\(started 2026-01-01T00:00:00.000Z\)/);
  assert.match(rendered, /Blocked: goal-205-wave-3 issue=#205 on upstream_bug #1234 until release v1.2 ships/);
});
