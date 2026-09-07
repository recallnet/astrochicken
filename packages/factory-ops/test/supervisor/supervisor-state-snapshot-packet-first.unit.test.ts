import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";

import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";
import { persistNamedPacket } from "../../src/lib/packet-core.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

function ghStub(_args, fallback = []) {
  return fallback;
}

const fixture = createCanonicalEventStoreFixture();

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

function createRunsDir(prefix = "snapshot-packet-first-") {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  const runsDir = join(rootDir, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });
  return runsDir;
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

async function writeDurablePacket({
  runsDir,
  factoryId = "mothership",
  runId,
  packetType,
  packetId,
  createdAt,
  targetRepo = "recallnet/astrochicken",
  controlPlaneRepo = "recallnet/astrochicken",
  handoffKind = "supervisor_recovery",
} = {}) {
  mkdirSync(join(runsDir, runId), { recursive: true });
  writeFileSync(join(runsDir, runId, "state.json"), JSON.stringify({
    runId,
    status: "running",
    currentNode: "build_packet",
    pipelineFile: "wave_execute",
    startedAt: createdAt,
    updatedAt: createdAt,
  }, null, 2));
  await appendRunEvents(fixture.connectionString, [
    {
      event_id: randomUUID(),
      schema: "canonical_event_envelope/v1",
      event_family: "hatch.run.started",
      event_version: 1,
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.snapshot-packet-first",
      emitted_at: createdAt,
      event_origin: "runtime",
      payload: { graph: "wave_execute", node: "build_packet" },
    },
    {
      event_id: randomUUID(),
      schema: "canonical_event_envelope/v1",
      event_family: "hatch.run.node_entered",
      event_version: 1,
      factory_id: factoryId,
      run_id: runId,
      emitter: "test.snapshot-packet-first",
      emitted_at: createdAt,
      event_origin: "runtime",
      payload: { graph: "wave_execute", node: "build_packet" },
    },
  ]);
  persistNamedPacket({
    repo: dirname(dirname(runsDir)),
    packet: {
      schema_version: "remediation_packet/v1",
      packet_type: packetType,
      packet_id: packetId,
      created_at: createdAt,
      packet_state: "open",
      factory_id: factoryId,
      run_id: runId,
      pipeline: "wave_execute",
      node_id: "build_packet",
      target_repo: targetRepo,
      control_plane_repo: controlPlaneRepo,
      handoff_owner: "supervisor",
      handoff_kind: handoffKind,
      inspection_commands: ["echo inspect"],
      execution_commands: ["echo execute"],
      verify_commands: ["echo verify"],
      expected_outcomes: ["recovered"],
      resource_refs: { milestone_title: "goal-1-wave-1" },
      preserve_work: { preserve_work_required: true },
      operator_prompt: "use packet",
      intent: "recover",
    },
  });
}

test("packet-first snapshot surfaces persisted durable packet action items and coverage summary", async () => {
  const runsDir = createRunsDir();
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  await writeDurablePacket({
    runsDir,
    factoryId: "mothership-packet-summary",
    runId: "run-1",
    packetType: "judge_context_contract_recovery",
    packetId: "judge_context_contract_recovery_pkt",
    createdAt: "2026-03-10T00:00:00.000Z",
  });

  try {
    const out = JSON.parse(buildStateSnapshot({
      repo: "recallnet/astrochicken",
      factoryId: "mothership-packet-summary",
      ghJsonFn: ghStub,
      recoverySweepFn: () => ({ stale_runs: [] }),
      nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
      runsDir,
    }));

    assert.ok(Array.isArray(out.persisted_packet_action_items));
    const persisted = out.persisted_packet_action_items.find((item) => item?.remediation_packet?.packet_type === "judge_context_contract_recovery");
    assert.ok(persisted);
    assert.equal(persisted.source, "persisted_packet");
    assert.equal(persisted.packet_preferred, true);
    assert.equal(out.packet_coverage_summary.total_open_durable_packets, 1);
    assert.equal(out.packet_coverage_summary.covered_by_packet, 1);
    assert.equal(out.packet_coverage_summary.covered_by_synthesis_only, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
  }
});

test("packet-first snapshot suppresses synthesis duplicate when durable packet exists for matching packet_type+run_id", async () => {
  const runsDir = createRunsDir("snapshot-packet-first-dedupe-");
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  await writeDurablePacket({
    runsDir,
    factoryId: "mothership-packet-dedupe",
    runId: "run-remote",
    packetType: "remote_cli_runtime_crash",
    packetId: "remote_cli_runtime_crash_existing",
    createdAt: "2026-03-10T00:00:00.000Z",
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
    handoffKind: "remote_cli_runtime_crash",
  });

  try {
    const out = JSON.parse(buildStateSnapshot({
      repo: "acme/target",
      targetRepo: "acme/target",
      controlPlaneRepo: "acme/control",
      factoryId: "mothership-packet-dedupe",
      ghJsonFn: ghStub,
      recoverySweepFn: () => ({ stale_runs: [] }),
      scanCliCrashesFn: () => ([{
        run_id: "run-remote",
        pipeline: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
        node: "execute_issue",
        crash_type: "module_not_found",
        file_path: "/tmp/missing.mjs",
        error_excerpt: "ERR_MODULE_NOT_FOUND",
      }]),
      nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
      runsDir,
    }));

    const matchingCrashItems = (out.action_items || []).filter((item) => (
      String(item?.remediation_packet?.packet_type || "") === "remote_cli_runtime_crash"
      && String(item?.remediation_packet?.run_id || "") === "run-remote"
    ));
    assert.equal(matchingCrashItems.length, 1);
    assert.equal(matchingCrashItems[0].source, "persisted_packet");
    assert.equal(matchingCrashItems[0].packet_preferred, true);
    assert.equal(out.packet_coverage_summary.total_open_durable_packets, 1);
    assert.equal(out.packet_coverage_summary.covered_by_packet, 1);
    assert.equal(out.packet_coverage_summary.covered_by_synthesis_only, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
  }
});

test("packet-first snapshot keeps total_open_durable_packets scoped to upfront scan", () => {
  const runsDir = createRunsDir("snapshot-packet-first-scan-count-");
  const out = JSON.parse(buildStateSnapshot({
    repo: "acme/target",
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
    factoryId: "mothership-packet-scan",
    ghJsonFn: ghStub,
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => ([{
      run_id: "run-remote-new",
      pipeline: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
      node: "execute_issue",
      crash_type: "module_not_found",
      file_path: "/tmp/missing-new.mjs",
      error_excerpt: "ERR_MODULE_NOT_FOUND",
    }]),
    nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
    runsDir,
  }));

  assert.equal(out.packet_coverage_summary.total_open_durable_packets, 0);
  assert.equal(out.packet_coverage_summary.covered_by_packet, 0);
  assert.equal(out.packet_coverage_summary.covered_by_synthesis_only, 1);
});

test("packet-first snapshot reports empty persisted packet arrays when no durable packets exist", () => {
  const out = JSON.parse(buildStateSnapshot({
    repo: "acme/packet-first-empty",
    factoryId: "packet-first-empty-factory",
    ghJsonFn: ghStub,
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
    runsDir: createRunsDir("snapshot-packet-first-empty-"),
  }));

  assert.deepEqual(out.persisted_packet_action_items, []);
  assert.equal(out.packet_coverage_summary.total_open_durable_packets, 0);
  assert.equal(out.packet_coverage_summary.covered_by_packet, 0);
});

test("packet-first snapshot structurally hides merge_conflict_packet from completed runs without mutating the file mirror", async () => {
  const runsDir = createRunsDir("snapshot-packet-first-stale-merge-");
  const rootDir = dirname(dirname(runsDir));
  const runId = "run-merge";
  const packetDir = join(runsDir, runId, "packets", "merge_conflict_packet");
  mkdirSync(packetDir, { recursive: true });
  const packetPath = join(packetDir, "merge_conflict_packet_test.json");
  writeFileSync(packetPath, JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: "merge_conflict_packet_test",
    created_at: "2026-03-10T00:00:00.000Z",
    packet_state: "open",
    factory_id: "mothership-packet-stale-merge",
    run_id: runId,
    pipeline: "wave_execute",
    node_id: "build_post_merge_packet",
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
    resource_refs: {
      repo: "/tmp/nonexistent-repo",
      branch: "wave/goal-1-wave-1",
      worktree_dir: "/tmp/nonexistent-worktree",
      issue_number: "123",
    },
    repo: "/tmp/nonexistent-repo",
    branch: "wave/goal-1-wave-1",
    worktree_dir: "/tmp/nonexistent-worktree",
    conflict_files: ["foo.txt"],
    branch_commits: [],
    main_commits_touching_conflicts: [],
  }, null, 2));
  writeFileSync(join(runsDir, runId, "state.json"), JSON.stringify({
    runId,
    status: "completed",
    pipeline: "wave_execute",
    currentNode: "done",
    updatedAt: "2026-03-10T00:30:00.000Z",
    context: {
      merge_status: "already_merged",
    },
  }, null, 2));
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  try {
    await appendRunEvents(fixture.connectionString, [
      {
        event_id: randomUUID(),
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.started",
        event_version: 1,
        factory_id: "mothership-packet-stale-merge",
        run_id: runId,
        emitter: "test.snapshot-packet-first",
        emitted_at: "2026-03-10T00:00:00.000Z",
        event_origin: "runtime",
        payload: { graph: "wave_execute", node: "build_post_merge_packet" },
      },
      {
        event_id: randomUUID(),
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.completed",
        event_version: 1,
        factory_id: "mothership-packet-stale-merge",
        run_id: runId,
        emitter: "test.snapshot-packet-first",
        emitted_at: "2026-03-10T00:30:00.000Z",
        event_origin: "runtime",
        payload: { graph: "wave_execute", node: "done" },
      },
    ]);
    persistNamedPacket({
      repo: rootDir,
      packet: JSON.parse(readFileSync(packetPath, "utf8")),
    });

    const out = JSON.parse(buildStateSnapshot({
      repo: "recallnet/astrochicken",
      factoryId: "mothership-packet-stale-merge",
      ghJsonFn: ghStub,
      recoverySweepFn: () => ({ stale_runs: [] }),
      nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
      runsDir,
    }));

    assert.deepEqual(out.persisted_packet_action_items, []);
    assert.equal(out.packet_coverage_summary.total_open_durable_packets, 0);

    const persisted = JSON.parse(readFileSync(packetPath, "utf8"));
    assert.equal(persisted.packet_state, "open");
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
  }
});

test("packet-first snapshot hides merge_conflict_packet for closed issue numbers even when the packet file remains open", async () => {
  const runsDir = createRunsDir("snapshot-packet-first-closed-issue-merge-");
  const rootDir = dirname(dirname(runsDir));
  const runId = "run-merge-closed-issue";
  const packetDir = join(runsDir, runId, "packets", "merge_conflict_packet");
  mkdirSync(packetDir, { recursive: true });
  const packetPath = join(packetDir, "merge_conflict_packet_closed_issue.json");
  writeFileSync(packetPath, JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: "merge_conflict_packet_closed_issue",
    created_at: "2026-03-10T00:00:00.000Z",
    packet_state: "open",
    factory_id: "mothership-packet-closed-issue-merge",
    run_id: runId,
    pipeline: "goal_execute",
    node_id: "build_push_failure_packet",
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
    issue_number: "1751",
    branch: "wave/goal-1751-wave-1",
    worktree_dir: "/tmp/nonexistent-worktree",
    conflict_files: ["foo.txt"],
    branch_commits: [],
    main_commits_touching_conflicts: [],
    resource_refs: {
      branch: "wave/goal-1751-wave-1",
      issue_number: "1751",
      worktree_dir: "/tmp/nonexistent-worktree",
    },
  }, null, 2));
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  try {
    await appendRunEvents(fixture.connectionString, [
      {
        event_id: randomUUID(),
        schema: "canonical_event_envelope/v1",
        event_family: "hatch.run.started",
        event_version: 1,
        factory_id: "mothership-packet-closed-issue-merge",
        run_id: runId,
        emitter: "test.snapshot-packet-first",
        emitted_at: "2026-03-10T00:00:00.000Z",
        event_origin: "runtime",
        payload: { graph: "goal_execute", node: "build_push_failure_packet" },
      },
    ]);
    persistNamedPacket({
      repo: rootDir,
      packet: JSON.parse(readFileSync(packetPath, "utf8")),
    });

    const out = JSON.parse(buildStateSnapshot({
      repo: "recallnet/astrochicken",
      factoryId: "mothership-packet-closed-issue-merge",
      ghJsonFn: (_args, fallback = []) => {
        if (Array.isArray(fallback)) {
          return [{
            number: 2000,
            title: "Some still-open goal",
            labels: [{ name: "goal" }],
            createdAt: "2026-03-10T00:00:00.000Z",
          }];
        }
        return fallback;
      },
      recoverySweepFn: () => ({ stale_runs: [] }),
      nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
      runsDir,
    }));

    assert.deepEqual(out.persisted_packet_action_items, []);
    assert.equal(
      (out.action_items || []).some((item) => String(item.type || "") === "merge_conflict_packet"),
      false,
    );
    assert.equal(out.packet_coverage_summary.total_open_durable_packets, 0);

    const persisted = JSON.parse(readFileSync(packetPath, "utf8"));
    assert.equal(persisted.packet_state, "open");
  } finally {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
  }
});
