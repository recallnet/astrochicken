import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeRunState(runsDir, runId, state, metadata = null) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({ runId, ...state }, null, 2));
  if (metadata) {
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  }
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

export function buildLifecycleEvents({ factoryId, runId, startedAt, updatedAt, currentNode, status, issue = "", milestone = "", graph = "" }) {
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

export function writeRegistry(rootDir, entries) {
  const registryPath = join(rootDir, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: entries,
  }, null, 2));
  return registryPath;
}


export async function appendCanonicalFixtureEvents(connectionString, events) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const next = await client.query("select nextval('canonical_event_commit_seq')");
      const commitCursor = Number(next.rows[0]?.nextval || 0);
      for (const [index, event] of events.entries()) {
        await client.query(
          `insert into factory_events (
            event_id, commit_cursor, batch_offset, schema, event_family, event_version,
            factory_id, run_id, emitter, emitted_at, event_origin, provenance, payload
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
          [
            event.event_id,
            commitCursor,
            index,
            event.schema,
            event.event_family,
            event.event_version,
            event.factory_id,
            event.run_id || null,
            event.emitter,
            event.emitted_at,
            event.event_origin || "runtime",
            JSON.stringify(event.provenance || {}),
            JSON.stringify(event.payload || {}),
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
