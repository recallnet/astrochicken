import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { buildRunInspectionProjection } from "../../src/lib/run-inspection.ts";
import { persistNamedPacket } from "../../src/lib/packet-core.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const fixture = createCanonicalEventStoreFixture();

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

function writeJson(dir, name, value) {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2), "utf8");
}

function writeLifecycleEvents(dir, events) {
  writeFileSync(
    join(dir, "lifecycle-events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
}

function createRun(root, runId, { state, metadata, events, packets } = {}) {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (state) writeJson(dir, "state.json", state);
  if (metadata) writeJson(dir, "metadata.json", metadata);
  if (events) writeLifecycleEvents(dir, events);
  if (packets) {
    for (const pkt of packets) {
      const pktDir = join(dir, "packets", pkt.packet_type);
      mkdirSync(pktDir, { recursive: true });
      writeJson(pktDir, `packet_${pkt.packet_id}.json`, pkt);
    }
  }
  return dir;
}

async function appendRunEvents(connectionString, events) {
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

test("buildRunInspectionProjection returns all four top-level sections", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-basic-"));
  createRun(runsDir, "run-abc", {
    state: {
      runId: "run-abc",
      status: "running",
      currentNode: "execute_issue",
      pipelineFile: "goal_execute.dot",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      context: { issue_number: "42", milestone_title: "Wave 1" },
    },
    metadata: { heartbeatAt: "2026-03-20T10:05:00.000Z", pid: 12345 },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-abc" });

  assert.ok(result.run, "must have run section");
  assert.ok(result.diagnosis, "must have diagnosis section");
  assert.ok(Array.isArray(result.recent_transitions), "must have recent_transitions array");
  assert.ok(result.artifacts, "must have artifacts section");
});

test("run section contains identity fields", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-identity-"));
  createRun(runsDir, "run-123", {
    state: {
      runId: "run-123",
      status: "running",
      currentNode: "review",
      pipelineFile: "goal_execute.dot",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:10:00.000Z",
      context: { issue_number: "55", milestone_title: "Wave 2", branch: "fix/thing" },
    },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-123" });

  assert.equal(result.run.run_id, "run-123");
  assert.equal(result.run.status, "running");
  assert.equal(result.run.current_node, "review");
  assert.equal(result.run.graph, "goal_execute.dot");
  assert.equal(result.run.issue, "55");
  assert.equal(result.run.milestone, "Wave 2");
  assert.equal(result.run.started_at, "2026-03-20T10:00:00.000Z");
  assert.equal(result.run.updated_at, "2026-03-20T10:10:00.000Z");
});

test("diagnosis reports stalled and expected_next_outcome", () => {
  const now = Date.parse("2026-03-20T11:00:00.000Z");
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-diagnosis-"));
  createRun(runsDir, "run-stale", {
    state: {
      runId: "run-stale",
      status: "running",
      currentNode: "review",
      pipelineFile: "goal_execute.dot",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:30:00.000Z",
    },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-stale", now });

  assert.equal(result.diagnosis.stalled, true, "30min old should be stalled");
  assert.ok(result.diagnosis.last_progress_age_ms > 0);
  assert.equal(result.diagnosis.expected_next_outcome, "review decision");
  assert.ok(Number.isFinite(result.diagnosis.stalled_threshold_ms));
});

test("diagnosis reports not stalled for fresh runs", () => {
  const now = Date.parse("2026-03-20T10:02:00.000Z");
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-fresh-"));
  createRun(runsDir, "run-fresh", {
    state: {
      runId: "run-fresh",
      status: "running",
      currentNode: "execute_issue",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:01:00.000Z",
    },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-fresh", now });

  assert.equal(result.diagnosis.stalled, false);
});

test("recent_transitions reads lifecycle events", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-events-"));
  createRun(runsDir, "run-events", {
    state: {
      runId: "run-events",
      status: "running",
      currentNode: "review",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
    },
    events: [
      { event: "pipeline.start", timestamp: "2026-03-20T10:00:00.000Z", graph_label: "goal_execute", node: "start" },
      { event: "stage.start", timestamp: "2026-03-20T10:01:00.000Z", graph_label: "goal_execute", node: "execute_issue" },
      { event: "stage.start", timestamp: "2026-03-20T10:05:00.000Z", graph_label: "goal_execute", node: "review" },
    ],
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-events", maxEvents: 2 });

  assert.equal(result.recent_transitions.length, 2, "should return last 2 events");
  assert.equal(result.recent_transitions[0].node, "execute_issue");
  assert.equal(result.recent_transitions[1].node, "review");
});

test("artifacts lists open durable packets from canonical projection", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "run-inspect-packets-"));
  const runsDir = join(rootDir, ".hatch", "runs");
  createRun(runsDir, "run-packets", {
    state: {
      runId: "run-packets",
      status: "running",
      currentNode: "resolve_conflict",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
    },
  });
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  try {
    await appendRunEvents(fixture.connectionString, [
      {
        event_id: randomUUID(),
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.started",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-packets",
        emitter: "test.factory-run-inspect",
        emitted_at: "2026-03-20T10:00:00.000Z",
        event_origin: "runtime",
        payload: { graph: "goal_execute.dot", node: "resolve_conflict", issue: "42", milestone: "Wave 1" },
      },
      {
        event_id: randomUUID(),
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.node_entered",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-packets",
        emitter: "test.factory-run-inspect",
        emitted_at: "2026-03-20T10:05:00.000Z",
        event_origin: "runtime",
        payload: { graph: "goal_execute.dot", node: "resolve_conflict", issue: "42", milestone: "Wave 1" },
      },
    ]);
    persistNamedPacket({
      repo: rootDir,
      packet: {
        schema_version: "merge_conflict_packet/v1",
        packet_type: "merge_conflict_packet",
        packet_id: "pkt-001",
        packet_state: "open",
        created_at: "2026-03-20T10:04:00.000Z",
        factory_id: "mothership",
        run_id: "run-packets",
        pipeline: "goal_execute.dot",
        node_id: "resolve_conflict",
        target_repo: "recallnet/astrochicken",
        control_plane_repo: "recallnet/astrochicken",
        handoff_owner: "supervisor",
        handoff_kind: "merge_conflict_recovery",
        inspection_commands: ["echo inspect"],
        execution_commands: ["echo execute"],
        verify_commands: ["echo verify"],
        expected_outcomes: ["resolved"],
        preserve_work: { preserve_work_required: true },
        operator_prompt: "use packet",
      },
    });

    const result = buildRunInspectionProjection({ runsDir, runId: "run-packets" });

    assert.ok(result.artifacts.open_packets.length >= 1, "should list open packets");
    assert.equal(result.artifacts.open_packets[0].packet_id, "pkt-001");
    assert.equal(result.artifacts.open_packets[0].packet_type, "merge_conflict_packet");
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
  }
});

test("returns safe defaults when run directory is missing", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-missing-"));

  const result = buildRunInspectionProjection({ runsDir, runId: "nonexistent" });

  assert.ok(result.run);
  assert.equal(result.run.run_id, "nonexistent");
  assert.equal(result.run.status, null);
  assert.ok(result.diagnosis);
  assert.equal(result.diagnosis.stalled, false);
  assert.ok(Array.isArray(result.recent_transitions));
  assert.equal(result.recent_transitions.length, 0);
  assert.ok(result.artifacts);
});

test("recent_transitions returns empty array when no lifecycle events file exists", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-no-events-"));
  createRun(runsDir, "run-no-events", {
    state: {
      runId: "run-no-events",
      status: "completed",
      currentNode: "done",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:10:00.000Z",
    },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-no-events" });

  assert.deepEqual(result.recent_transitions, []);
});

test("run section includes context keys for operator drill-in", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "run-inspect-context-"));
  createRun(runsDir, "run-ctx", {
    state: {
      runId: "run-ctx",
      status: "running",
      currentNode: "build",
      pipelineFile: "goal_issue_execute.dot",
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      context: {
        issue_number: "100",
        branch: "fix/some-bug",
        review_attempt: "2",
        goal_issue_number: "2320",
      },
    },
  });

  const result = buildRunInspectionProjection({ runsDir, runId: "run-ctx" });

  assert.equal(result.run.context.branch, "fix/some-bug");
  assert.equal(result.run.context.review_attempt, "2");
  assert.equal(result.run.context.goal_issue_number, "2320");
});
