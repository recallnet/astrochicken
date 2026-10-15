import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { Pool } from "pg";

export function normalizeTmpAlias(value) {
  return String(value || "").replace(/^\/private\//, "/");
}

export function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function pathRelativeFactoryRoot(configPath, rootDir) {
  const configDir = dirname(configPath);
  const rel = relative(rootDir, configDir).replace(/\\/g, "/");
  return rel || ".";
}

export function buildLifecycleEvents({ factoryId, runId, startedAt, updatedAt, currentNode, status, graph, issue = "", milestone = "" }) {
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
    emitted_at: String(startedAt || updatedAt || ""),
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
      emitted_at: String(updatedAt || startedAt || ""),
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
      emitted_at: String(updatedAt || startedAt || ""),
      event_origin: "runtime",
      payload,
    });
  }
  return rows;
}

export async function appendFixtureBatch(pool, events) {
  const { rows } = await pool.query("select nextval('canonical_event_commit_seq')::bigint as cursor");
  const commitCursor = Number(rows[0].cursor);
  for (const [index, event] of events.entries()) {
    await pool.query(
      `insert into factory_events (
        event_id, commit_cursor, batch_offset, schema, event_family, event_version,
        factory_id, run_id, emitter, emitted_at, event_origin, provenance, payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [
        event.event_id,
        commitCursor,
        index,
        "canonical_event_envelope/v1",
        event.event_family,
        1,
        event.factory_id,
        event.run_id,
        event.emitter,
        event.emitted_at,
        event.event_origin,
        JSON.stringify({}),
        JSON.stringify(event.payload || {}),
      ],
    );
  }
}

export async function seedCanonicalTickFixtures(connectionString) {
  const nowIso = new Date().toISOString();
  const previousIso = new Date(Date.now() - 60_000).toISOString();
  const events = [
    ...buildLifecycleEvents({
      factoryId: "mothership",
      runId: "tick-1",
      startedAt: nowIso,
      updatedAt: nowIso,
      currentNode: "wave_execute",
      status: "running",
      graph: "factory_supervisor_tick",
    }),
    ...buildLifecycleEvents({
      factoryId: "mothership",
      runId: "tick-0",
      startedAt: previousIso,
      updatedAt: previousIso,
      currentNode: "done",
      status: "completed",
      graph: "factory_supervisor_tick",
    }),
    ...buildLifecycleEvents({
      factoryId: "mothership",
      runId: "wave-1",
      startedAt: nowIso,
      updatedAt: nowIso,
      currentNode: "execute_issue",
      status: "running",
      graph: "wave_execute",
      issue: "205",
      milestone: "goal-205-wave-1",
    }),
  ];
  const pool = new Pool({ connectionString });
  try {
    await pool.query("truncate table factory_events");
    await appendFixtureBatch(pool, events);
  } finally {
    await pool.end();
  }
}

export function buildReleaseManifestFixture(rootDir) {
  writeJson(join(rootDir, ".hatch", "releases", "stable", "release-manifest.json"), {
    release: {
      release_id: "rel-test",
      tag: "v0.0.1-test",
      sha: "abc123",
    },
    compatibility_matrix: {
      required_factory_release_floor: "v0.0.1-test",
    },
    rollout: {
      controller: {
        status: "stable",
        stage: "general",
        resume_blocked: false,
        publish: {
          release_id: "rel-test",
          release_tag: "v0.0.1-test",
          release_sha: "abc123",
          manifest_path: ".hatch/releases/stable/release-manifest.json",
          published_at: "2026-03-25T00:00:00.000Z",
        },
      },
    },
  });
}
