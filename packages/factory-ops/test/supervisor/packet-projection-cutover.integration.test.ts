import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";
import { persistNamedPacket } from "../../src/lib/packet-core.ts";
import { projectFactoryStatusToPostgres } from "../../src/lib/factory-status-postgres-projection.ts";
import { buildRunInspectionProjection } from "../../src/lib/run-inspection.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const fixture = createCanonicalEventStoreFixture();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

function makeRoot(prefix = "packet-projection-cutover-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFactoryConfig(rootDir, runsDir) {
  mkdirSync(join(rootDir, "scenarios"), { recursive: true });
  writeFileSync(join(rootDir, "factory.config.json"), JSON.stringify({
    schema: "hatch.factory.config.v1",
    factory_id: "mothership",
    factory_root: ".",
    kind_id: "mothership",
    instance_id: "mothership",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    provider: "openrouter",
    model: "openai/gpt-5.3-codex",
    runs_dir: runsDir,
    scenarios: {
      root: "scenarios",
    },
  }, null, 2));
}

async function appendFactoryEvents(connectionString, events) {
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

function writeRunState(runsDir, runId, state) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
}

function runPacketListCli({ cwd, runsDir, factoryId }) {
  const proc = spawnSync("node", [
    opsCliPath,
    "packet",
    "list",
    "--factory-root",
    cwd,
    "--runs-dir",
    runsDir,
    "--factory-id",
    factoryId,
    "--json",
  ], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_CANONICAL_EVENT_STORE_URL: fixture.connectionString,
    },
  });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  return JSON.parse(String(proc.stdout || "[]"));
}

test("packet cutover reads canonical projection instead of stale packet files", async () => {
  const rootDir = makeRoot();
  const runsDir = join(rootDir, ".hatch", "runs");
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;

  try {
    const nowIso = "2026-03-26T18:00:00.000Z";
    writeFactoryConfig(rootDir, runsDir);
    writeRunState(runsDir, "run-active", {
      runId: "run-active",
      status: "running",
      currentNode: "resolve_conflict",
      pipelineFile: "wave_execute.dot",
      startedAt: "2026-03-26T17:55:00.000Z",
      updatedAt: nowIso,
      context: {
        issue_number: "101",
        milestone_title: "goal-1-wave-1",
      },
    });
    writeRunState(runsDir, "run-completed", {
      runId: "run-completed",
      status: "completed",
      currentNode: "done",
      pipelineFile: "wave_execute.dot",
      startedAt: "2026-03-26T17:00:00.000Z",
      updatedAt: nowIso,
      context: {
        issue_number: "102",
        milestone_title: "goal-1-wave-2",
      },
    });

    await appendFactoryEvents(fixture.connectionString, [
      {
        event_id: "11111111-1111-4111-8111-111111111111",
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.started",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-active",
        emitter: "test.packet-cutover",
        emitted_at: "2026-03-26T17:55:00.000Z",
        event_origin: "runtime",
        payload: { graph: "wave_execute.dot", node: "resolve_conflict", issue: "101", milestone: "goal-1-wave-1" },
      },
      {
        event_id: "22222222-2222-4222-8222-222222222222",
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.node_entered",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-active",
        emitter: "test.packet-cutover",
        emitted_at: nowIso,
        event_origin: "runtime",
        payload: { graph: "wave_execute.dot", node: "resolve_conflict", issue: "101", milestone: "goal-1-wave-1" },
      },
      {
        event_id: "33333333-3333-4333-8333-333333333333",
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.started",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-completed",
        emitter: "test.packet-cutover",
        emitted_at: "2026-03-26T17:00:00.000Z",
        event_origin: "runtime",
        payload: { graph: "wave_execute.dot", node: "resolve_conflict", issue: "102", milestone: "goal-1-wave-2" },
      },
      {
        event_id: "44444444-4444-4444-8444-444444444444",
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.completed",
        event_version: 1,
        factory_id: "mothership",
        run_id: "run-completed",
        emitter: "test.packet-cutover",
        emitted_at: nowIso,
        event_origin: "runtime",
        payload: { graph: "wave_execute.dot", node: "done", issue: "102", milestone: "goal-1-wave-2" },
      },
    ]);

    const activePersisted = persistNamedPacket({
      repo: rootDir,
      packet: {
        schema_version: "merge_conflict_packet/v1",
        packet_type: "merge_conflict_packet",
        packet_id: "pkt-active",
        packet_state: "open",
        created_at: "2026-03-26T17:59:00.000Z",
        factory_id: "mothership",
        run_id: "run-active",
        pipeline: "wave_execute.dot",
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
        operator_prompt: "canonical packet wins",
        resource_refs: {
          milestone_title: "goal-1-wave-1",
          issue_number: "101",
          branch: "wave/goal-1-wave-1",
        },
        repo: rootDir,
        branch: "wave/goal-1-wave-1",
        worktree_dir: join(rootDir, "worktrees", "run-active"),
        conflict_files: ["src/index.ts"],
      },
    });
    persistNamedPacket({
      repo: rootDir,
      packet: {
        schema_version: "merge_conflict_packet/v1",
        packet_type: "merge_conflict_packet",
        packet_id: "pkt-completed",
        packet_state: "open",
        created_at: "2026-03-26T17:30:00.000Z",
        factory_id: "mothership",
        run_id: "run-completed",
        pipeline: "wave_execute.dot",
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
        operator_prompt: "should be hidden structurally",
        resource_refs: {
          milestone_title: "goal-1-wave-2",
          issue_number: "102",
          branch: "wave/goal-1-wave-2",
        },
        repo: rootDir,
        branch: "wave/goal-1-wave-2",
        worktree_dir: join(rootDir, "worktrees", "run-completed"),
        conflict_files: ["src/other.ts"],
      },
    });

    const tampered = JSON.parse(readFileSync(activePersisted.packet_path, "utf8"));
    tampered.packet_state = "resolved";
    tampered.operator_prompt = "tampered file should not win";
    tampered.resource_refs.milestone_title = "tampered-title";
    writeFileSync(activePersisted.packet_path, JSON.stringify(tampered, null, 2));

    const status = await projectFactoryStatusToPostgres({
      connectionString: fixture.connectionString,
      factoryId: "mothership",
      runsDir,
      context: { factory_id: "mothership" },
      now: Date.parse("2026-03-26T18:01:00.000Z"),
    });
    assert.deepEqual(
      status.projection.open_packets.map((packet) => packet.packet_id),
      ["pkt-active"],
    );
    assert.equal(status.projection.open_packets[0].packet_state, "open");
    assert.equal(status.projection.open_packets[0].title, "goal-1-wave-1");

    const inspection = buildRunInspectionProjection({
      runsDir,
      runId: "run-active",
    });
    assert.equal(inspection.artifacts.open_packets.length, 1);
    assert.equal(inspection.artifacts.open_packets[0].packet_id, "pkt-active");
    assert.equal(inspection.artifacts.open_packets[0].packet_state, "open");

    const snapshot = JSON.parse(buildStateSnapshot({
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      ghJsonFn: () => [],
      recoverySweepFn: () => ({ stale_runs: [] }),
      nowMs: Date.parse("2026-03-26T18:01:00.000Z"),
      runsDir,
    }));
    assert.equal(snapshot.persisted_packet_action_items.length, 1);
    assert.equal(snapshot.persisted_packet_action_items[0].remediation_packet.packet_id, "pkt-active");
    assert.equal(snapshot.persisted_packet_action_items[0].remediation_packet.packet_state, "open");

    const listed = runPacketListCli({
      cwd: rootDir,
      runsDir,
      factoryId: "mothership",
    });
    assert.deepEqual(listed.map((packet) => packet.packet_id), ["pkt-active"]);
    assert.equal(listed[0].packet_state, "open");
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
    rmSync(rootDir, { recursive: true, force: true });
  }
});
