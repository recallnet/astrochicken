import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import {
  buildFactoryFleetProjection,
  readFactoryRegistry,
} from "../../src/lib/factory-fleet-projection-support.ts";
import {
  projectFactoryFleetToPostgres,
  readFactoryFleetProjection,
} from "../../src/lib/factory-fleet-postgres-projection.ts";
import {
  projectFactoryStatusToPostgres,
  readFactoryStatusProjection,
} from "../../src/lib/factory-status-postgres-projection.ts";
import {
  projectFactoryTickToPostgres,
  readFactoryTickProjection,
} from "../../src/lib/factory-tick-postgres-projection.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

function writeRunState(runsDir, runId, state, metadata = null) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({ runId, ...state }, null, 2));
  if (metadata) {
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  }
}

function writeRegistry(rootDir, entries) {
  const registryPath = join(rootDir, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: entries,
  }, null, 2));
  return registryPath;
}

function normalizeDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeDeep(entry))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeDeep(entry)]),
    );
  }
  return value;
}

function buildLifecycleEvents({ factoryId, runId, startedAt, updatedAt, currentNode, status, issue = "", milestone = "", graph = "" }) {
  const emittedStart = String(startedAt || updatedAt || "");
  const emittedUpdate = String(updatedAt || startedAt || "");
  const payload = {
    run_id: runId,
    graph,
    node: currentNode,
    issue,
    milestone,
  };
  const rows = [{
    event_id: randomUUID(),
    event_family: "hatch.run.started",
    factory_id: factoryId,
    run_id: runId,
    emitter: "test.fixture",
    emitted_at: emittedStart,
    event_origin: "runtime",
    payload,
  }];
  if (currentNode) {
    rows.push({
      event_id: randomUUID(),
      event_family: "hatch.run.node_entered",
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.fixture",
      emitted_at: emittedUpdate,
      event_origin: "runtime",
      payload,
    });
  }
  if (status === "completed") {
    rows.push({
      event_id: randomUUID(),
      event_family: "hatch.run.completed",
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.fixture",
      emitted_at: emittedUpdate,
      event_origin: "runtime",
      payload,
    });
  }
  if (["failed", "guarded", "guarded_terminal", "blocked", "terminal"].includes(String(status))) {
    rows.push({
      event_id: randomUUID(),
      event_family: "hatch.run.failed",
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.fixture",
      emitted_at: emittedUpdate,
      event_origin: "runtime",
      payload,
    });
  }
  return rows;
}

function buildControlActionEvent({ factoryId, emittedAt, action, reason }) {
  return {
    event_id: randomUUID(),
    event_family: "factory.control.action_applied",
    factory_id: factoryId,
    emitter: "test.fixture",
    emitted_at: emittedAt,
    event_origin: "runtime",
    payload: {
      action,
      state_action: action,
      actor: "operator",
      reason,
      retry_target: "",
      state_path: "",
    },
  };
}

async function appendFixtureBatch(pool, events) {
  const { rows } = await pool.query("select nextval('canonical_event_commit_seq')::bigint as cursor");
  const commitCursor = Number(rows[0].cursor);
  for (const [index, event] of events.entries()) {
    await pool.query(
      `insert into factory_events (
        event_id, commit_cursor, batch_offset, schema, event_family, event_version,
        factory_id, run_id, emitter, emitted_at, event_origin, provenance, payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [
        event.event_id || randomUUID(),
        commitCursor,
        index,
        "canonical_event_envelope/v1",
        event.event_family,
        1,
        event.factory_id,
        event.run_id || null,
        event.emitter || "test.fixture",
        event.emitted_at,
        event.event_origin || "runtime",
        JSON.stringify(event.provenance || {}),
        JSON.stringify(event.payload || {}),
      ],
    );
  }
}

function createFixtureDeps({ rootDir, nowMs, releaseRows, activeSummaries, hostHealthByFactory, versionsByFactory, outcomesByRepo }) {
  return {
    now: nowMs,
    readFactoryRegistryFn: ({ context, registryPath, cwd }) => readFactoryRegistry({ context, registryPath, cwd }),
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: join(rootDir, "factories", factoryId),
      runs_dir: join(rootDir, ".hatch", factoryId, "runs"),
    }),
    factoryActiveSummaryFn: ({ context }) => activeSummaries[context.factory_id] || { waves: [], non_wave_active: [] },
    hostHealthFn: ({ factoryId }) => hostHealthByFactory[factoryId] || {
      status: "running",
      running: true,
      pid: 4001,
      runCount: 1,
    },
    hostVersionFn: ({ factoryId }) => versionsByFactory[factoryId] || {
      version: "v1.0.0",
      source: "fixture",
    },
    collectFactoryOutcomesFn: ({ repo }) => outcomesByRepo[repo] || {
      closed_goals: 0,
      merged_prs: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    },
    factoryReleaseTargetingStatusFn: () => ({
      factories: releaseRows,
      warnings: [],
    }),
  };
}

async function runFleetParityFixture({
  rootDir,
  registryEntries,
  events,
  runSetup,
  deps,
  connectionString,
}) {
  const registryPath = writeRegistry(rootDir, registryEntries);
  await runSetup();
  const pool = new Pool({ connectionString });
  try {
    await pool.query("truncate table factory_events");
    await pool.query("drop table if exists factory_status_projection");
    await pool.query("drop table if exists factory_tick_projection");
    await pool.query("drop table if exists factory_fleet_projection");
    await appendFixtureBatch(pool, events);
  } finally {
    await pool.end();
  }

  const statusByFactory = new Map();
  const tickByFactory = new Map();
  for (const entry of registryEntries) {
    const factoryId = String(entry.factory_id || "").trim();
    if (!factoryId) continue;
    const factoryContext = deps.resolveFactoryContextFn({
      factoryId,
      targetRepo: entry.target_repo,
    });
    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId,
      runsDir: factoryContext.runs_dir,
      context: factoryContext,
      now: deps.now,
    });
    await projectFactoryTickToPostgres({
      connectionString,
      factoryId,
      runsDir: factoryContext.runs_dir,
      context: factoryContext,
      now: deps.now,
    });
    statusByFactory.set(factoryId, (await readFactoryStatusProjection({ connectionString, factoryId }))?.projection || {});
    tickByFactory.set(factoryId, (await readFactoryTickProjection({ connectionString, factoryId }))?.projection || { context: {}, ticks: [] });
  }

  const directProjection = await buildFactoryFleetProjection({
    context: { control_plane_repo: "recallnet/astrochicken" },
    registryPath,
    factoryStatusFn: ({ context = {} }) => statusByFactory.get(String(context.factory_id || "").trim()) || {},
    tickStatusFn: ({ context = {} }) => tickByFactory.get(String(context.factory_id || "").trim()) || { context: {}, ticks: [] },
    ...deps,
  });
  await projectFactoryFleetToPostgres({
    connectionString,
    context: { control_plane_repo: "recallnet/astrochicken" },
    registryPath,
    ...deps,
  });
  const projected = await readFactoryFleetProjection({ connectionString });
  assert.ok(projected, "expected persisted fleet projection");
  assert.deepEqual(normalizeDeep(projected.projection), normalizeDeep(directProjection));
}

const fixture = createCanonicalEventStoreFixture();

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

test("fleet parity: mothership and example-trading multi-factory fixture matches canonical projection", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-fleet-parity-multi-"));
  const nowMs = Date.parse("2026-03-26T20:00:00.000Z");
  const mothershipRunsDir = join(rootDir, ".hatch", "mothership", "runs");
  const exampleTradingRunsDir = join(rootDir, ".hatch", "example-trading", "runs");
  mkdirSync(mothershipRunsDir, { recursive: true });
  mkdirSync(exampleTradingRunsDir, { recursive: true });

  try {
    await runFleetParityFixture({
      rootDir,
      connectionString: fixture.connectionString,
      registryEntries: [
        { factory_id: "mothership", kind_id: "mothership", target_repo: "recallnet/astrochicken", graphs: [], daemon_status: { status: "running" } },
        { factory_id: "example-trading", kind_id: "example-trading", target_repo: "example-org/example-trading", graphs: [], daemon_status: { status: "running" } },
      ],
      events: [
        ...buildLifecycleEvents({
          factoryId: "mothership",
          runId: "tick-1",
          startedAt: "2026-03-26T19:58:00.000Z",
          updatedAt: "2026-03-26T20:00:00.000Z",
          currentNode: "fan_out_goal_run",
          status: "running",
          graph: "factory_supervisor_tick",
        }),
        ...buildLifecycleEvents({
          factoryId: "example-trading",
          runId: "goal-1",
          startedAt: "2026-03-26T19:10:00.000Z",
          updatedAt: "2026-03-26T19:30:00.000Z",
          currentNode: "review",
          status: "failed",
          issue: "1536",
          milestone: "goal-1462-wave-1",
          graph: "goal_run",
        }),
      ],
      runSetup: async () => {
        writeRunState(mothershipRunsDir, "tick-1", {
          pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
          status: "running",
          currentNode: "fan_out_goal_run",
          startedAt: "2026-03-26T19:58:00.000Z",
          updatedAt: "2026-03-26T20:00:00.000Z",
          context: {},
        });
        writeRunState(exampleTradingRunsDir, "goal-1", {
          pipelineFile: "factories/example-trading/graphs/goal_run.dot",
          status: "failed",
          currentNode: "review",
          startedAt: "2026-03-26T19:10:00.000Z",
          updatedAt: "2026-03-26T19:30:00.000Z",
          context: { issue_number: "1536", milestone_title: "goal-1462-wave-1" },
        });
      },
      deps: createFixtureDeps({
        rootDir,
        nowMs,
        releaseRows: [
          {
            factory_id: "mothership",
            rollout_channel: "stable",
            rollout_status: "ready",
            gate_reason: "allowed",
            gate_allowed: true,
            selected_for_canary: false,
            resume_blocked: false,
            release_identity: { release_id: "r1", release_tag: "v1.2.3", release_sha: "abc123" },
            required_factory_release: "",
            upgrade_verification_outcome: "passed",
          },
          {
            factory_id: "example-trading",
            rollout_channel: "stable",
            rollout_status: "lagging",
            gate_reason: "drift_detected",
            gate_allowed: false,
            selected_for_canary: false,
            resume_blocked: false,
            release_identity: { release_id: "r2", release_tag: "v1.0.0", release_sha: "def456" },
            required_factory_release: "v1.2.3",
            upgrade_verification_outcome: "pending",
          },
        ],
        activeSummaries: {
          mothership: {
            waves: [{ milestone_title: "goal-2411-wave-1", current_issue_number: "2564" }],
            non_wave_active: [],
          },
          "example-trading": {
            waves: [],
            non_wave_active: [{ issue_number: "1536" }],
          },
        },
        hostHealthByFactory: {
          mothership: { status: "running", running: true, pid: 4101, runCount: 14 },
          "example-trading": { status: "running", running: true, pid: 4102, runCount: 2 },
        },
        versionsByFactory: {
          mothership: { version: "v1.2.3", source: "fixture" },
          "example-trading": { version: "v1.0.0", source: "fixture" },
        },
        outcomesByRepo: {
          "recallnet/astrochicken": {
            closed_goals: 2,
            merged_prs: 1,
            closed_features: 1,
            closed_bugs: 0,
            merge_commits_main: 1,
          },
          "example-org/example-trading": {
            closed_goals: 0,
            merged_prs: 0,
            closed_features: 0,
            closed_bugs: 1,
            merge_commits_main: 0,
          },
        },
      }),
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("fleet parity: paused factory fixture matches canonical projection", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-fleet-parity-paused-"));
  const nowMs = Date.parse("2026-03-26T20:00:00.000Z");
  const runsDir = join(rootDir, ".hatch", "paused", "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    await runFleetParityFixture({
      rootDir,
      connectionString: fixture.connectionString,
      registryEntries: [
        { factory_id: "paused", kind_id: "paused", target_repo: "example-org/paused-factory", graphs: [], daemon_status: { status: "running" } },
      ],
      events: [
        buildControlActionEvent({
          factoryId: "paused",
          emittedAt: "2026-03-26T19:59:00.000Z",
          action: "pause",
          reason: "manual pause",
        }),
      ],
      runSetup: async () => {},
      deps: createFixtureDeps({
        rootDir,
        nowMs,
        releaseRows: [{
          factory_id: "paused",
          rollout_channel: "stable",
          rollout_status: "ready",
          gate_reason: "allowed",
          gate_allowed: true,
          selected_for_canary: false,
          resume_blocked: false,
          release_identity: { release_id: "r3", release_tag: "v1.0.0", release_sha: "ghi789" },
          required_factory_release: "",
          upgrade_verification_outcome: "passed",
        }],
        activeSummaries: {
          paused: { waves: [], non_wave_active: [] },
        },
        hostHealthByFactory: {
          paused: { status: "running", running: true, pid: 4103, runCount: 4 },
        },
        versionsByFactory: {
          paused: { version: "v1.0.0", source: "fixture" },
        },
        outcomesByRepo: {},
      }),
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("fleet parity: unhealthy factory fixture matches canonical projection", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-fleet-parity-unhealthy-"));
  const nowMs = Date.parse("2026-03-26T20:00:00.000Z");
  const runsDir = join(rootDir, ".hatch", "unhealthy", "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    await runFleetParityFixture({
      rootDir,
      connectionString: fixture.connectionString,
      registryEntries: [
        { factory_id: "unhealthy", kind_id: "unhealthy", target_repo: "example-org/unhealthy-factory", graphs: [], daemon_status: { status: "stopped" } },
      ],
      events: [
        ...buildLifecycleEvents({
          factoryId: "unhealthy",
          runId: "goal-77",
          startedAt: "2026-03-26T18:30:00.000Z",
          updatedAt: "2026-03-26T18:45:00.000Z",
          currentNode: "build",
          status: "running",
          issue: "1777",
          milestone: "goal-1777-wave-1",
          graph: "goal_run",
        }),
      ],
      runSetup: async () => {
        writeRunState(runsDir, "goal-77", {
          pipelineFile: "factories/unhealthy/graphs/goal_run.dot",
          status: "running",
          currentNode: "build",
          startedAt: "2026-03-26T18:30:00.000Z",
          updatedAt: "2026-03-26T18:45:00.000Z",
          pid: 999999,
          context: { issue_number: "1777", milestone_title: "goal-1777-wave-1" },
        }, {
          pid: 999999,
          heartbeatAt: "2026-03-26T18:45:00.000Z",
        });
      },
      deps: createFixtureDeps({
        rootDir,
        nowMs,
        releaseRows: [{
          factory_id: "unhealthy",
          rollout_channel: "stable",
          rollout_status: "ready",
          gate_reason: "allowed",
          gate_allowed: true,
          selected_for_canary: false,
          resume_blocked: false,
          release_identity: { release_id: "r4", release_tag: "v1.0.0", release_sha: "jkl012" },
          required_factory_release: "",
          upgrade_verification_outcome: "passed",
        }],
        activeSummaries: {
          unhealthy: { waves: [], non_wave_active: [{ issue_number: "1777" }] },
        },
        hostHealthByFactory: {
          unhealthy: { status: "stopped", running: false, pid: null, runCount: 0 },
        },
        versionsByFactory: {
          unhealthy: { version: "v1.0.0", source: "fixture" },
        },
        outcomesByRepo: {},
      }),
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
