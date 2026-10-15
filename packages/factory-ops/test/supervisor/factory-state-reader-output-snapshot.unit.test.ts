import { useCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const eventStoreFixture = useCanonicalEventStoreFixture();

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRunsFixture,
  writeRunState,
  writeRegistryFixture,
} from "./factory-status-fixture-harness.ts";
import { formatFleetStatusHuman, readFactoryRegistry } from "../../src/commands/factory-fleet-status.ts";
import { collectFactoryProgressMetrics, formatFactoryProgressMetrics } from "../../src/commands/factory-progress-metrics.ts";
import { factoryStatus, formatFactoryStatus } from "../../src/commands/factory-status.ts";
import { formatTickStatus } from "../../src/commands/factory-tick-status.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";

import { buildFactoryFleetProjection } from "../../src/lib/factory-fleet-projection-support.ts";

// factory-outcomes.mjs is intentionally excluded from this snapshot suite.
// It shells out to `git log` to compute outcome diffs; mocking git is out of scope.
// Output-identity for factory-outcomes is verified by its dedicated command tests.

const SNAPSHOT_DIR = new URL("./fixtures/operator-output/", import.meta.url);

function readGolden(name) {
  return readFileSync(new URL(name, SNAPSHOT_DIR), "utf8").trimEnd();
}

function normalizeOutput(text, runsDirs = []) {
  let output = String(text || "");
  for (const runsDir of runsDirs.filter(Boolean)) {
    output = output.replaceAll(runsDir, "<runs-dir>");
  }
  return output
    .replace(/Elapsed: [^\n]+/g, "Elapsed: <elapsed>")
    .replace(/has been running for [^\n]+ \(threshold: [^)]+\)/g, "has been running for <stuck-age> (threshold: <threshold>)")
    .replace(/\(started [^)]+\)/g, "(started <started-at>)")
    .replace(/-?\d+(?:ms|s|m\d+s|h\d+m) ago/g, "<age> ago")
    .trimEnd();
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function readStateMap(runsDir) {
  const allStates = new Map();
  for (const runId of readdirSync(runsDir)) {
    try {
      allStates.set(runId, JSON.parse(readFileSync(join(runsDir, runId, "state.json"), "utf8")));
    } catch {}
  }
  return allStates;
}

function tickStatus({ runsDir = ".hatch/runs", context = {}, now = Date.now() } = {}) {
  return buildTickProjectionFromStates({ allStates: readStateMap(runsDir), runsDir, context, now });
}

function buildActiveWaveFixture() {
  const fixture = createRunsFixture("factory-state-reader-active-wave-");
  const startedAt = "2026-03-10T16:00:00.000Z";
  const updatedAt = nowIso(-30 * 1000);

  writeRunState(fixture.runsDir, "supervisor-active", {
    pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "running",
    currentNode: "wave_execute",
    startedAt,
    updatedAt,
    context: {
      goal_count: 1,
      __child_run_id_wave_execute: "wave-active",
    },
  });

  writeRunState(fixture.runsDir, "wave-active", {
    pipeline: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    status: "running",
    currentNode: "execute_issue_in_wave",
    startedAt,
    updatedAt,
    context: {
      milestone_title: "goal-42-wave-1",
      current_issue_number: "42",
      __child_run_id_execute_issue_in_wave: "issue-active-42",
    },
  });

  writeRunState(fixture.runsDir, "issue-active-42", {
    pipeline: "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
    status: "running",
    currentNode: "execute_issue",
    startedAt,
    updatedAt,
    context: {
      issue_number: "42",
      milestone_title: "goal-42-wave-1",
    },
  });

  return fixture;
}

function buildSupervisorTickFixture() {
  const fixture = createRunsFixture("factory-state-reader-supervisor-tick-");
  const startedAt = "2026-03-10T16:00:00.000Z";
  const updatedAt = nowIso(-45 * 1000);

  writeRunState(fixture.runsDir, "supervisor-12", {
    pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "running",
    currentNode: "set_release_sha",
    startedAt,
    updatedAt,
    context: {
      goal_count: 2,
      __child_run_id_set_release_sha: "wave-supervisor",
    },
  });

  writeRunState(fixture.runsDir, "wave-supervisor", {
    pipeline: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    status: "running",
    currentNode: "execute_issue_in_wave",
    startedAt,
    updatedAt,
    context: {
      milestone_title: "goal-42-wave-1",
      current_issue_number: "77",
    },
  });

  return fixture;
}

function buildCompletedRunFixture() {
  const fixture = createRunsFixture("factory-state-reader-complete-");
  writeRunState(fixture.runsDir, "complete-1", {
    pipeline: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    status: "completed",
    currentNode: "exit",
    startedAt: "2026-03-10T16:00:00.000Z",
    completedAt: "2026-03-10T16:04:00.000Z",
    updatedAt: nowIso(-30 * 1000),
    context: {
      milestone_title: "goal-42-wave-1",
    },
  });
  return fixture;
}

function buildMetricsFixture() {
  const fixture = createRunsFixture("factory-state-reader-metrics-");
  writeRunState(fixture.runsDir, "stalled-wave", {
    pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "completed",
    currentNode: "detect_stalled_wave",
    startedAt: "2026-03-10T16:00:00.000Z",
    updatedAt: nowIso(-30 * 1000),
    context: {
      stalled_wave_telemetry: JSON.stringify([
        {
          wave_issue_number: 901,
          milestone: "goal-901-wave-1",
          reason: "wave_marker_stale",
          wave_stale_minutes: 47,
          threshold_minutes: 20,
          open_feature_count: 2,
          open_feature_numbers: [9011, 9012],
        },
      ]),
    },
  });
  return fixture;
}

function buildFleetFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-state-reader-fleet-"));
  const alpha = createRunsFixture("factory-state-reader-fleet-alpha-");
  const beta = createRunsFixture("factory-state-reader-fleet-beta-");

  const registryPath = writeRegistryFixture(rootDir, {
    schema: "hatch.factory.registry.v1",
    factories: [
      {
        id: "alpha",
        kind_id: "brainstorm",
        repo: "acme/alpha",
        daemonStatus: { status: "running" },
        graphs: ["factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"],
      },
      {
        id: "beta",
        kind_id: "brainstorm",
        repo: "acme/beta",
        daemonStatus: { status: "stopped" },
        graphs: ["factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"],
      },
    ],
  });

  return {
    rootDir,
    registryPath,
    runsByFactory: {
      alpha: alpha.runsDir,
      beta: beta.runsDir,
    },
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(alpha.rootDir, { recursive: true, force: true });
      rmSync(beta.rootDir, { recursive: true, force: true });
    },
  };
}

const BASE_CONTEXT = {
  factory_id: "mothership",
  target_repo: "recallnet/astrochicken",
};

test("snapshot: active wave status output remains stable", async () => {
  const fixture = buildActiveWaveFixture();
  try {
    await eventStoreFixture.seedRuns({ runsDir: fixture.runsDir });
    const status = factoryStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    const actual = normalizeOutput(formatFactoryStatus(status), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-active-wave-status.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: active wave tick output remains stable", async () => {
  const fixture = buildActiveWaveFixture();
  try {
    const status = tickStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    assert.equal(status.ticks[0].stuck_warning, "");
    assert.equal(status.ticks[0].tick_progress.made_progress, true);
    const actual = normalizeOutput(formatTickStatus(status), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-active-wave-tick.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: supervisor tick status output remains stable", async () => {
  const fixture = buildSupervisorTickFixture();
  try {
    await eventStoreFixture.seedRuns({ runsDir: fixture.runsDir });
    const status = factoryStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    const actual = normalizeOutput(formatFactoryStatus(status), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-supervisor-tick-status.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: supervisor tick tick output includes stage progress", async () => {
  const fixture = buildSupervisorTickFixture();
  try {
    const status = tickStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    assert.equal(status.ticks[0].stuck_warning, "");
    assert.equal(status.ticks[0].tick_progress.made_progress, true);
    const actual = normalizeOutput(formatTickStatus(status), [fixture.runsDir]);
    assert.match(actual, /\[12\/28\]/);
    assert.equal(actual, readGolden("factory-state-reader-supervisor-tick-tick.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: completed-run status output remains stable", async () => {
  const fixture = buildCompletedRunFixture();
  try {
    await eventStoreFixture.seedRuns({ runsDir: fixture.runsDir });
    const status = factoryStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    const actual = normalizeOutput(formatFactoryStatus(status), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-completed-run-status.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: empty-runs status output remains stable", async () => {
  const fixture = createRunsFixture("factory-state-reader-empty-");
  try {
    await eventStoreFixture.seedRuns({ runsDir: fixture.runsDir });
    const status = factoryStatus({
      runsDir: fixture.runsDir,
      context: {
        ...BASE_CONTEXT,
        runs_dir: fixture.runsDir,
      },
    });
    const actual = normalizeOutput(formatFactoryStatus(status), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-empty-runs-status.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: stalled metrics output remains stable", async () => {
  const fixture = buildMetricsFixture();
  try {
    const metrics = collectFactoryProgressMetrics({
      repo: "recallnet/astrochicken",
      runsDir: fixture.runsDir,
      ghGraphqlFn: () => ({ data: { search: { nodes: [] } } }),
    });
    const actual = normalizeOutput(formatFactoryProgressMetrics(metrics), [fixture.runsDir]);
    assert.equal(actual, readGolden("factory-state-reader-metrics-stalled.expected.txt"));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("snapshot: fleet-status output remains stable for registry fixture", async () => {
  const fixture = buildFleetFixture();
  try {
    const report = await buildFactoryFleetProjection({
      context: { control_plane_repo: "recallnet/astrochicken" },
      now: Date.parse("2026-03-10T18:00:00.000Z"),
      lookbackHours: 24,
      registryPath: fixture.registryPath,
      readFactoryRegistryFn: (options) => readFactoryRegistry({
        ...options,
        registryPath: fixture.registryPath,
        cwd: fixture.rootDir,
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: fixture.runsByFactory[factoryId] || `/tmp/runs/${factoryId}`,
      }),
      factoryStatusFn: ({ context }) => {
        if (context.factory_id === "alpha") {
          return {
            active: [{ issue: "101" }],
            blocked_control_plane: [],
            control_plane: { resume_reason: "ready_to_resume" },
            managed_state: {
              state_action: "none",
              reason: "",
              retry_target: "",
              health_classification: "healthy",
            },
          };
        }
        return {
          active: [],
          blocked_control_plane: [{
            milestone: "goal-77-wave-2",
            issue_number: 7702,
            linked_goal_number: 77,
            unblockCondition: "wait for control-plane rollout",
          }],
          control_plane: {
            resume_reason: "release_rollout_blocked",
            resume_when: "wait for control-plane rollout",
          },
          managed_state: {
            state_action: "quarantine",
            reason: "manual quarantine",
            retry_target: "",
            health_classification: "operator_quarantined",
          },
        };
      },
      factoryActiveSummaryFn: ({ context }) => {
        if (context.factory_id === "alpha") {
          return {
            waves: [{ milestone_title: "goal-101-wave-1", current_issue_number: 101 }],
            non_wave_active: [],
          };
        }
        return { waves: [], non_wave_active: [] };
      },
      tickStatusFn: () => ({ ticks: [{ stageLabel: "Executing wave" }] }),
      hostHealthFn: ({ factoryId }) => {
        if (factoryId === "beta") return { status: "stopped", running: false, pid: 0, runCount: 0 };
        return { status: "running", running: true, pid: 123, runCount: 1 };
      },
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: ({ repo }) => ({
        repo,
        merged_prs: 1,
        closed_features: 2,
        closed_bugs: 0,
        merge_commits_main: 3,
      }),
      factoryReleaseTargetingStatusFn: () => ({
        factories: [
          {
            factory_id: "alpha",
            rollout_channel: "stable",
            rollout_status: "ready",
            gate_reason: "ready_to_resume",
            upgrade_verification_outcome: "passed",
            release_identity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "sha-100" },
            required_factory_release: "1.0.0",
            selected_for_canary: false,
            gate_allowed: true,
            resume_blocked: false,
          },
          {
            factory_id: "beta",
            rollout_channel: "stable",
            rollout_status: "blocked",
            gate_reason: "release_rollout_blocked",
            upgrade_verification_outcome: "failed",
            release_identity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "sha-100" },
            required_factory_release: "1.0.0",
            selected_for_canary: false,
            gate_allowed: false,
            resume_blocked: true,
          },
        ],
        warnings: [],
      }),
    });

    const actual = normalizeOutput(formatFleetStatusHuman(report), Object.values(fixture.runsByFactory));
    assert.equal(actual, readGolden("factory-state-reader-fleet-status.expected.txt"));
  } finally {
    fixture.cleanup();
  }
});
