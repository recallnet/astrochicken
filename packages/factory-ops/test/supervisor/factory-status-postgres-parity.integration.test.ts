import { appendFixtureBatch } from "./canonical-parity.fixture.ts";
import { writeRunState } from "./canonical-parity.fixture.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import { factoryStatus } from "../../src/commands/factory-status.ts";
import { ensureFactoryStatusProjectionSchema, projectFactoryStatusToPostgres, readFactoryStatusProjection,  } from "../../src/lib/factory-status-postgres-projection.ts";
import { buildReleaseManifest } from "../../src/lib/control-plane-manifest.ts";


const repoRoot = path.resolve(import.meta.dirname, "../../../..");

function writeControlState({ rootDir, factoryId, state }) {
  const controlStatePath = join(rootDir, ".hatch", "factories", factoryId, "control-state.json");
  mkdirSync(path.dirname(controlStatePath), { recursive: true });
  writeFileSync(controlStatePath, JSON.stringify(state, null, 2));
  return controlStatePath;
}

function writePromotedManifest({ rootDir, factoryId }) {
  const manifestPath = join(rootDir, ".hatch", "releases", "stable", "release-manifest.json");
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v9.9.9",
    entries: [{
      source_repo: "recallnet/astrochicken",
      source_issue: 1,
      source_issue_url: "https://github.com/recallnet/astrochicken/issues/1",
      summary: "factory status parity fixture",
      factory_id: factoryId,
      required_factory_release: "9.9.9",
      status: "blocked_upstream",
      signature_hash: "sha256:test",
      linkage: {
        schema_version: "factory_link.v1",
        linkage_key: "sha256:test",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 1,
        source_repo: "recallnet/astrochicken",
        source_issue: 1,
        status: "blocked_upstream",
        factory_id: factoryId,
        required_factory_release: "9.9.9",
        signature_hash: "sha256:test",
      },
    }],
  });
  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status: "promoted",
    stage: "general",
    resume_blocked: false,
    rollback_reason: "",
    publish: {
      release_id: "v9.9.9",
      release_tag: "v9.9.9",
      release_sha: "abc123",
      asset_id: "asset-555",
      asset_url: "https://example/assets/555",
      manifest_path: "control-plane-manifests/release-manifest.json",
      published_at: "2026-03-25T19:00:00.000Z",
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function compareKey(value = {}) {
  const entry = value && typeof value === "object" ? value : {};
  return JSON.stringify([
    String(entry.id || entry.run_id || entry.child_id || entry.milestone || entry.packet_id || ""),
    String(entry.node || entry.current_node || entry.parent_node_id || entry.blockerRef || entry.path || ""),
    String(entry.issue || entry.issue_number || ""),
    String(entry.status || entry.state_action || ""),
  ]);
}


function simplifyStatus(status = {}) {
  return normalizeDeep({
    context: status.context || {},
    active: Array.isArray(status.active) ? status.active : [],
    runs: Array.isArray(status.runs) ? status.runs : [],
    completed: Number(status.completed || 0),
    failed: Number(status.failed || 0),
    blocked_control_plane: Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane : [],
    managed_state: status.managed_state || null,
    control_plane: status.control_plane || null,
    open_packets: Array.isArray(status.open_packets) ? status.open_packets : [],
    hard_goal_review: status.hard_goal_review || null,
    hard_plan_traceability: status.hard_plan_traceability || null,
  });
}

async function ensureFactoryEventsSchema(pool) {
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
}

async function resetProjectionTables(pool) {
  await pool.query("drop table if exists factory_status_projection");
  await pool.query("truncate table factory_events");
}


const canonicalFixture = createCanonicalEventStoreFixture();
let connectionString = "";
before(async () => {
  await canonicalFixture.setup();
  connectionString = canonicalFixture.connectionString;
});
after(() => { canonicalFixture.teardown(); });

test("status cutover: factory status reads canonical projection for normal tick fixture", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-parity-normal-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  const now = "2026-03-25T20:00:00.000Z";
  writePromotedManifest({ rootDir, factoryId: "mothership" });

  writeRunState(runsDir, "tick-1", {
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "running",
    currentNode: "fan_out_goal_run",
    startedAt: "2026-03-25T19:58:00.000Z",
    updatedAt: now,
    context: {},
  });
  writeRunState(runsDir, "goal-1", {
    pipelineFile: "factories/mothership/graphs/goal_run.dot",
    status: "running",
    currentNode: "execute_issue",
    startedAt: "2026-03-25T19:59:00.000Z",
    updatedAt: now,
    context: {
      goal_issue_number: "2411",
      issue_number: "2564",
      milestone_title: "goal-2411-wave-1",
    },
  });

  const pool = new Pool({ connectionString });
  try {
    await ensureFactoryEventsSchema(pool);
    await resetProjectionTables(pool);
    await appendFixtureBatch(pool, [
      {
        event_family: "hatch.run.started",
        factory_id: "mothership",
        run_id: "tick-1",
        emitted_at: "2026-03-25T19:58:00.000Z",
        payload: { run_id: "tick-1", graph: "factory_supervisor_tick", node: "fan_out_goal_run", issue: "", milestone: "" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "mothership",
        run_id: "tick-1",
        emitted_at: now,
        payload: { run_id: "tick-1", graph: "factory_supervisor_tick", node: "fan_out_goal_run", issue: "", milestone: "" },
      },
      {
        event_family: "hatch.run.started",
        factory_id: "mothership",
        run_id: "goal-1",
        emitted_at: "2026-03-25T19:59:00.000Z",
        payload: { run_id: "goal-1", graph: "goal_run", node: "execute_issue", issue: "2564", milestone: "goal-2411-wave-1" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "mothership",
        run_id: "goal-1",
        emitted_at: now,
        payload: { run_id: "goal-1", graph: "goal_run", node: "execute_issue", issue: "2564", milestone: "goal-2411-wave-1" },
      },
    ]);

    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId: "mothership",
      runsDir,
      context: { factory_id: "mothership", canonical_event_store_url: connectionString },
      now: Date.parse(now),
    });
    const projected = await readFactoryStatusProjection({ connectionString, factoryId: "mothership" });
    const legacy = factoryStatus({
      runsDir,
      context: { factory_id: "mothership", canonical_event_store_url: connectionString },
      now: Date.parse(now),
    });
    assert.deepEqual(simplifyStatus({
      ...projected.projection,
      context: { ...projected.projection.context, canonical_event_store_url: connectionString },
    }), simplifyStatus(legacy));
  } finally {
    await pool.end();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("status cutover: factory status reads canonical projection for stale run fixture", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-parity-stale-"));
  const runsDir = join(rootDir, ".hatch", "example-trading", "runs");
  mkdirSync(runsDir, { recursive: true });
  const staleAt = "2026-03-25T18:00:00.000Z";
  const freshAt = "2026-03-25T19:59:00.000Z";
  const now = Date.parse("2026-03-25T20:00:00.000Z");
  writePromotedManifest({ rootDir, factoryId: "example-trading" });

  writeRunState(runsDir, "stale-running", {
    pipelineFile: "factories/example-trading/graphs/goal_run.dot",
    status: "running",
    currentNode: "review",
    updatedAt: staleAt,
    pid: 999999,
    context: { issue_number: "1536", milestone_title: "goal-1462-wave-1" },
  }, {
    pid: 999999,
    heartbeatAt: staleAt,
    updatedAt: staleAt,
  });
  writeRunState(runsDir, "healthy-running", {
    pipelineFile: "factories/example-trading/graphs/goal_run.dot",
    status: "running",
    currentNode: "build",
    updatedAt: freshAt,
    context: { issue_number: "1541", milestone_title: "goal-1463-wave-1" },
  }, {
    heartbeatAt: freshAt,
    updatedAt: freshAt,
  });

  const pool = new Pool({ connectionString });
  try {
    await ensureFactoryEventsSchema(pool);
    await resetProjectionTables(pool);
    await appendFixtureBatch(pool, [
      {
        event_family: "hatch.run.started",
        factory_id: "example-trading",
        run_id: "stale-running",
        emitted_at: "2026-03-25T17:58:00.000Z",
        payload: { run_id: "stale-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "example-trading",
        run_id: "stale-running",
        emitted_at: staleAt,
        payload: { run_id: "stale-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
      },
      {
        event_family: "hatch.run.started",
        factory_id: "example-trading",
        run_id: "healthy-running",
        emitted_at: "2026-03-25T19:55:00.000Z",
        payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "example-trading",
        run_id: "healthy-running",
        emitted_at: freshAt,
        payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
      },
    ]);

    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId: "example-trading",
      runsDir,
      context: { factory_id: "example-trading", canonical_event_store_url: connectionString },
      staleMinutes: 20,
      now,
    });
    const projected = await readFactoryStatusProjection({ connectionString, factoryId: "example-trading" });
    const legacy = factoryStatus({
      runsDir,
      context: { factory_id: "example-trading", canonical_event_store_url: connectionString },
      staleMinutes: 20,
      now,
    });
    assert.deepEqual(simplifyStatus({
      ...projected.projection,
      context: { ...projected.projection.context, canonical_event_store_url: connectionString },
    }), simplifyStatus(legacy));
  } finally {
    await pool.end();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("status cutover: canonical status excludes ghost running rows without readable local state", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-parity-ghost-running-"));
  const runsDir = join(rootDir, ".hatch", "example-trading", "runs");
  mkdirSync(runsDir, { recursive: true });
  const nowIso = "2026-03-25T20:00:00.000Z";
  const now = Date.parse(nowIso);
  writePromotedManifest({ rootDir, factoryId: "example-trading" });

  writeRunState(runsDir, "healthy-running", {
    pipelineFile: "factories/example-trading/graphs/goal_run.dot",
    status: "running",
    currentNode: "build",
    updatedAt: "2026-03-25T19:59:00.000Z",
    context: { issue_number: "1541", milestone_title: "goal-1463-wave-1" },
  }, {
    heartbeatAt: "2026-03-25T19:59:00.000Z",
    updatedAt: "2026-03-25T19:59:00.000Z",
  });

  const pool = new Pool({ connectionString });
  try {
    await ensureFactoryEventsSchema(pool);
    await resetProjectionTables(pool);
    await appendFixtureBatch(pool, [
      {
        event_family: "hatch.run.started",
        factory_id: "example-trading",
        run_id: "ghost-running",
        emitted_at: "2026-03-25T19:58:00.000Z",
        payload: { run_id: "ghost-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "example-trading",
        run_id: "ghost-running",
        emitted_at: "2026-03-25T19:59:00.000Z",
        payload: { run_id: "ghost-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
      },
      {
        event_family: "hatch.run.started",
        factory_id: "example-trading",
        run_id: "healthy-running",
        emitted_at: "2026-03-25T19:55:00.000Z",
        payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
      },
      {
        event_family: "hatch.run.node_entered",
        factory_id: "example-trading",
        run_id: "healthy-running",
        emitted_at: "2026-03-25T19:59:00.000Z",
        payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
      },
    ]);

    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId: "example-trading",
      runsDir,
      context: { factory_id: "example-trading", canonical_event_store_url: connectionString },
      staleMinutes: 20,
      now,
    });
    const projected = await readFactoryStatusProjection({ connectionString, factoryId: "example-trading" });
    const legacy = factoryStatus({
      runsDir,
      context: { factory_id: "example-trading", canonical_event_store_url: connectionString },
      staleMinutes: 20,
      now,
    });

    assert.deepEqual(simplifyStatus({
      ...projected.projection,
      context: { ...projected.projection.context, canonical_event_store_url: connectionString },
    }), simplifyStatus(legacy));
    assert.equal(projected.projection.active.some((entry) => entry.run_id === "ghost-running"), false);
    assert.equal(projected.projection.runs.some((entry) => entry.run_id === "ghost-running"), false);
    assert.equal(projected.projection.active.some((entry) => entry.run_id === "healthy-running"), true);
  } finally {
    await pool.end();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("status cutover: factory status reads canonical projection for paused daemon fixture", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-parity-paused-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  const pausedAt = "2026-03-25T20:00:00.000Z";
  const controlStatePath = writeControlState({
    rootDir,
    factoryId: "mothership",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "mothership",
      version: 3,
      updated_at: pausedAt,
      updated_by: "operator",
      reason: "manual pause",
      action_state: {
        pause: { active: true },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "",
      notes: [],
    },
  });

  const pool = new Pool({ connectionString });
  try {
    await ensureFactoryEventsSchema(pool);
    await resetProjectionTables(pool);
    await appendFixtureBatch(pool, [
      {
        event_family: "factory.control.action_applied",
        factory_id: "mothership",
        emitted_at: pausedAt,
        payload: {
          action: "pause",
          reason: "manual pause",
          actor: "operator",
          retry_target: "",
          state_action: "pause",
          state_path: controlStatePath,
        },
      },
    ]);

    await projectFactoryStatusToPostgres({
      connectionString,
      factoryId: "mothership",
      runsDir,
      context: { factory_id: "mothership", canonical_event_store_url: connectionString },
      now: Date.parse(pausedAt),
    });
    const projected = await readFactoryStatusProjection({ connectionString, factoryId: "mothership" });
    const legacy = factoryStatus({
      runsDir,
      context: { factory_id: "mothership", canonical_event_store_url: connectionString },
      now: Date.parse(pausedAt),
    });
    assert.deepEqual(simplifyStatus({
      ...projected.projection,
      context: { ...projected.projection.context, canonical_event_store_url: connectionString },
    }), simplifyStatus(legacy));
  } finally {
    await pool.end();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("status cutover: no production imports reference deleted legacy status projection", () => {
  const result = spawnSync(
    "rg",
    ["-n", "factory-state-status-projection\\.mjs", "packages/factory-ops/src"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1, result.stdout || result.stderr || "");
});

test("status cutover: projection schema initialization is safe under concurrent callers", async () => {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("drop table if exists factory_status_projection");
    await Promise.all([
      ensureFactoryStatusProjectionSchema({ connectionString }),
      ensureFactoryStatusProjectionSchema({ connectionString }),
      ensureFactoryStatusProjectionSchema({ connectionString }),
      ensureFactoryStatusProjectionSchema({ connectionString }),
    ]);
    const result = await pool.query("select to_regclass('public.factory_status_projection') as name");
    assert.equal(result.rows[0]?.name, "factory_status_projection");
  } finally {
    await pool.end();
  }
});

function normalizeDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDeep(entry)).sort((left, right) => compareKey(left).localeCompare(compareKey(right)));
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
