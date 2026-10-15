import { writeRegistry } from "./canonical-parity.fixture.ts";
import { writeRunState } from "./canonical-parity.fixture.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import { applyCanonicalFactoryControlAction, readCanonicalFactoryControlState } from "../../src/lib/canonical-control-state.ts";
import { projectFactoryFleetToPostgres, readFactoryFleetProjection } from "../../src/lib/factory-fleet-postgres-projection.ts";
import { projectFactoryStatusToPostgres, readFactoryStatusProjection } from "../../src/lib/factory-status-postgres-projection.ts";
import { projectFactoryTickToPostgres, readFactoryTickProjection } from "../../src/lib/factory-tick-postgres-projection.ts";
import { listCanonicalPackets } from "../../src/lib/canonical-packet-projection.ts";
import { persistNamedPacket } from "../../src/lib/packet-core.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const fixture = createCanonicalEventStoreFixture();


function buildLifecycleEvents({ factoryId, runId, startedAt, updatedAt, currentNode, status, issue = "", milestone = "", graph = "" }) {
  const emittedStart = String(startedAt || updatedAt || "");
  const emittedUpdate = String(updatedAt || startedAt || "");
  const payload = { run_id: runId, graph, node: currentNode, issue, milestone };
  const events = [{
    event_id: randomUUID(),
    event_family: "hatch.run.started",
    factory_id: factoryId,
    run_id: runId,
    emitter: "test.replay",
    emitted_at: emittedStart,
    event_origin: "runtime",
    payload,
  }];
  if (currentNode) {
    events.push({
      event_id: randomUUID(),
      event_family: "hatch.run.node_entered",
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.replay",
      emitted_at: emittedUpdate,
      event_origin: "runtime",
      payload,
    });
  }
  if (status === "completed") {
    events.push({
      event_id: randomUUID(),
      event_family: "hatch.run.completed",
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.replay",
      emitted_at: emittedUpdate,
      event_origin: "runtime",
      payload,
    });
  }
  return events;
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
        event.emitter || "test.replay",
        event.emitted_at,
        event.event_origin || "runtime",
        JSON.stringify(event.provenance || {}),
        JSON.stringify(event.payload || {}),
      ],
    );
  }
}


function createFleetDeps({ rootDir, nowMs }) {
  return {
    now: nowMs,
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: join(rootDir, "factories", factoryId),
      runs_dir: join(rootDir, ".hatch", factoryId, "runs"),
    }),
    factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 4001, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0", source: "fixture" }),
    collectFactoryOutcomesFn: () => ({
      closed_goals: 0,
      merged_prs: 0,
      closed_features: 0,
      closed_bugs: 0,
      merge_commits_main: 0,
    }),
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  };
}

async function captureReplaySnapshot({ rootDir, connectionString, registryPath, nowMs }) {
  const registryEntries = [
    {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
    {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
      control_plane_repo: "recallnet/astrochicken",
    },
  ];

  for (const entry of registryEntries) {
    const factoryId = entry.factory_id;
    const runsDir = join(rootDir, ".hatch", factoryId, "runs");
    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId,
      runsDir,
      context: {
        factory_id: factoryId,
        target_repo: entry.target_repo,
        control_plane_repo: entry.control_plane_repo,
      },
      now: nowMs,
    });
    await projectFactoryTickToPostgres({
      connectionString,
      factoryId,
      runsDir,
      context: {
        factory_id: factoryId,
        target_repo: entry.target_repo,
        control_plane_repo: entry.control_plane_repo,
      },
      now: nowMs,
    });
  }

  await projectFactoryFleetToPostgres({
    connectionString,
    context: {
      control_plane_repo: "recallnet/astrochicken",
    },
    registryPath,
    now: nowMs,
    ...createFleetDeps({ rootDir, nowMs }),
  });

  const mothershipPackets = await listCanonicalPackets({
    connectionString,
    factoryId: "mothership",
    runsDir: join(rootDir, ".hatch", "mothership", "runs"),
    packetState: "open",
    durableOnly: true,
    excludeTerminalRuns: true,
    nowMs,
    windowMs: 30 * 24 * 60 * 60 * 1000,
  });

  return normalizeDeep({
    status: {
      mothership: (await readFactoryStatusProjection({ connectionString, factoryId: "mothership" }))?.projection || {},
      "example-trading": (await readFactoryStatusProjection({ connectionString, factoryId: "example-trading" }))?.projection || {},
    },
    tick: {
      mothership: (await readFactoryTickProjection({ connectionString, factoryId: "mothership" }))?.projection || {},
      "example-trading": (await readFactoryTickProjection({ connectionString, factoryId: "example-trading" }))?.projection || {},
    },
    fleet: (await readFactoryFleetProjection({ connectionString }))?.projection || {},
    control: {
      mothership: await readCanonicalFactoryControlState({ connectionString, factoryId: "mothership", rootDir }),
      "example-trading": await readCanonicalFactoryControlState({ connectionString, factoryId: "example-trading", rootDir }),
    },
    packets: {
      mothership: mothershipPackets,
    },
  });
}

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

test("canonical replay rebuilds status, tick, fleet, control-state, and packet projections from event zero", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "postgres-canonical-replay-"));
  const nowMs = Date.parse("2026-03-26T18:00:00.000Z");
  const registryPath = writeRegistry(rootDir, [
    { factory_id: "mothership", target_repo: "recallnet/astrochicken", control_plane_repo: "recallnet/astrochicken" },
    { factory_id: "example-trading", target_repo: "example-org/example-trading", control_plane_repo: "recallnet/astrochicken" },
  ]);

  const mothershipRunsDir = join(rootDir, ".hatch", "mothership", "runs");
  const exampleTradingRunsDir = join(rootDir, ".hatch", "example-trading", "runs");

  writeRunState(mothershipRunsDir, "run-m-1", {
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    status: "running",
    startedAt: "2026-03-26T17:00:00.000Z",
    updatedAt: "2026-03-26T17:10:00.000Z",
    currentNode: "review",
    context: { factory_id: "mothership", issue_number: "2411", milestone_title: "goal-2411" },
  }, { pid: process.pid, heartbeatAt: "2026-03-26T17:10:00.000Z" });
  writeRunState(exampleTradingRunsDir, "run-t-1", {
    pipelineFile: "factories/example-trading/graphs/goal_run.dot",
    status: "completed",
    startedAt: "2026-03-26T16:00:00.000Z",
    updatedAt: "2026-03-26T16:15:00.000Z",
    currentNode: "done",
    context: { factory_id: "example-trading", issue_number: "1462", milestone_title: "goal-1462" },
  }, { pid: process.pid, heartbeatAt: "2026-03-26T16:15:00.000Z" });

  const pool = new Pool({ connectionString: fixture.connectionString });
  try {
    await pool.query(`
      create sequence if not exists canonical_event_commit_seq;
      create table if not exists factory_events (
        event_id uuid primary key,
        commit_cursor bigint not null,
        batch_offset integer not null,
        schema text not null,
        event_family text not null,
        event_version integer not null,
        factory_id text not null,
        run_id text,
        emitter text not null,
        emitted_at timestamptz not null,
        recorded_at timestamptz not null default now(),
        event_origin text not null,
        provenance jsonb not null default '{}'::jsonb,
        payload jsonb not null
      );
    `);
    await pool.query("truncate table factory_events");
    await appendFixtureBatch(pool, [
      ...buildLifecycleEvents({
        factoryId: "mothership",
        runId: "run-m-1",
        startedAt: "2026-03-26T17:00:00.000Z",
        updatedAt: "2026-03-26T17:10:00.000Z",
        currentNode: "review",
        status: "running",
        issue: "2411",
        milestone: "goal-2411",
        graph: "goal_run",
      }),
      ...buildLifecycleEvents({
        factoryId: "example-trading",
        runId: "run-t-1",
        startedAt: "2026-03-26T16:00:00.000Z",
        updatedAt: "2026-03-26T16:15:00.000Z",
        currentNode: "done",
        status: "completed",
        issue: "1462",
        milestone: "goal-1462",
        graph: "goal_run",
      }),
    ]);
  } finally {
    await pool.end();
  }

  await applyCanonicalFactoryControlAction({
    connectionString: fixture.connectionString,
    factoryId: "mothership",
    rootDir,
    action: "pause",
    reason: "maintenance",
    actor: "operator",
  });
  await applyCanonicalFactoryControlAction({
    connectionString: fixture.connectionString,
    factoryId: "example-trading",
    rootDir,
    action: "retry",
    reason: "rerun completed proof fixture",
    actor: "operator",
    retryTarget: "run-t-1",
  });
  const previousStoreUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  persistNamedPacket({
    repo: rootDir,
    packet: {
      schema_version: "merge_conflict_packet/v1",
      packet_id: "pkt-replay-1",
      packet_type: "merge_conflict_packet",
      packet_state: "open",
      factory_id: "mothership",
      run_id: "run-m-1",
      pipeline: "goal_run",
      node_id: "review",
      created_at: "2026-03-26T17:11:00.000Z",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
      handoff_owner: "supervisor",
      handoff_kind: "merge_conflict_recovery",
      inspection_commands: ["echo inspect"],
      execution_commands: ["echo execute"],
      verify_commands: ["echo verify"],
      expected_outcomes: ["resolved"],
      preserve_work: { preserve_work_required: true },
      operator_prompt: "Resolve replay conflict",
      intent: "Resolve replay conflict",
      resource_refs: {
        milestone_title: "goal-2411",
        issue_number: "2411",
      },
    },
  });

  try {
    const first = await captureReplaySnapshot({
      rootDir,
      connectionString: fixture.connectionString,
      registryPath,
      nowMs,
    });

    const resetPool = new Pool({ connectionString: fixture.connectionString });
    try {
      await resetPool.query("drop table if exists factory_status_projection");
      await resetPool.query("drop table if exists factory_tick_projection");
      await resetPool.query("drop table if exists factory_fleet_projection");
      await resetPool.query("drop table if exists factory_control_state_projection");
    } finally {
      await resetPool.end();
    }

    const replayed = await captureReplaySnapshot({
      rootDir,
      connectionString: fixture.connectionString,
      registryPath,
      nowMs,
    });

    assert.deepEqual(replayed, first);
  } finally {
    if (previousStoreUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousStoreUrl;
    rmSync(rootDir, { recursive: true, force: true });
  }
});

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
