import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyCanonicalFactoryControlAction,
  persistCanonicalFactoryLifecycleSnapshot,
  readCanonicalFactoryControlState,
} from "../../src/lib/canonical-control-state.ts";
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

function makeRoot(prefix = "control-state-cutover-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeLegacyControlState(rootDir, factoryId, state) {
  const statePath = join(rootDir, ".hatch", "factories", factoryId, "control-state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

function runCli(args, { cwd, env = {}, expectedStatus = 0 } = {}) {
  const proc = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_CANONICAL_EVENT_STORE_URL: fixture.connectionString,
      ...env,
    },
  });
  assert.equal(proc.status, expectedStatus, proc.stderr || proc.stdout);
  return JSON.parse(String(proc.stdout || "{}").trim() || "{}");
}

test("control-state cutover ignores stale local truth file and replays canonical events", async () => {
  const rootDir = makeRoot();
  try {
    const statePath = writeLegacyControlState(rootDir, "example-trading", {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 99,
      updated_at: "2026-03-01T00:00:00.000Z",
      updated_by: "legacy-operator",
      reason: "stale local pause",
      retry_target: "",
      notes: [],
      lifecycle_state_snapshot: {
        schema_version: "managed-factory-snapshot/v1",
        lifecycle_state: "paused",
        lifecycle_reason: "legacy pause",
        lifecycle_failure_classification: "none",
        lifecycle_failure_reason: "",
        lifecycle_updated_at: "2026-03-01T00:00:00.000Z",
        lifecycle_updated_by: "legacy-operator",
        blockers: {
          upstream: { has_open_upstream_bugs: false, open_upstream_bug_count: 0, open_upstream_bug_numbers: [] },
          action_items: { has_action_items: false, action_item_count: 0 },
        },
        unresolved_actions: 0,
        queue_depth: 0,
        oldest_work_age_seconds: 0,
        latest_incidents: [],
      },
      action_state: {
        pause: { active: true },
        quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
        draining: { active: false, at: "" },
        retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
        unblock: { active: false, note: "", at: "" },
        resume: { active: false, at: "" },
      },
    });

    await applyCanonicalFactoryControlAction({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      action: "pause",
      reason: "maintenance",
      actor: "operator",
    });
    await applyCanonicalFactoryControlAction({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      action: "quarantine",
      reason: "review failures exceeded threshold",
      actor: "operator",
    });
    await applyCanonicalFactoryControlAction({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      action: "unblock",
      reason: "upstream fixed",
      actor: "operator",
    });
    await applyCanonicalFactoryControlAction({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      action: "resume",
      reason: "restart dispatcher",
      actor: "operator",
    });
    await applyCanonicalFactoryControlAction({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      action: "retry",
      reason: "rerun failed tick",
      actor: "operator",
      retryTarget: "run-42",
    });
    await persistCanonicalFactoryLifecycleSnapshot({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
      actor: "managed_supervisor",
      lifecycleStateSnapshot: {
        schema_version: "managed-factory-snapshot/v1",
        lifecycle_state: "blocked_platform",
        lifecycle_reason: "open upstream blockers",
        lifecycle_failure_classification: "infrastructure",
        lifecycle_failure_reason: "open_upstream_bugs=2",
        lifecycle_updated_at: "2026-03-26T23:00:00.000Z",
        lifecycle_updated_by: "managed_supervisor",
        blockers: {
          upstream: { has_open_upstream_bugs: true, open_upstream_bug_count: 2, open_upstream_bug_numbers: [2116, 2117] },
          action_items: { has_action_items: true, action_item_count: 1 },
        },
        unresolved_actions: 1,
        queue_depth: 3,
        oldest_work_age_seconds: 120,
        latest_incidents: [{ incident_fingerprint: "inc-1", severity: "warn" }],
      },
    });

    const projection = await readCanonicalFactoryControlState({
      connectionString: fixture.connectionString,
      factoryId: "example-trading",
      rootDir,
    });

    assert.equal(projection.version, 6);
    assert.equal(projection.reason, "open upstream blockers");
    assert.equal(projection.retry_target, "run-42");
    assert.equal(projection.action_state.pause.active, false);
    assert.equal(projection.action_state.retry.active, true);
    assert.equal(projection.action_state.quarantine.count, 1);
    assert.equal(projection.lifecycle_state_snapshot.lifecycle_state, "blocked_platform");
    assert.equal(projection.lifecycle_state_snapshot.blockers.upstream.open_upstream_bug_count, 2);
    assert.equal(projection.notes.length, 5);

    assert.equal(existsSync(statePath), true);
    const mirrored = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(mirrored.version, 6);
    assert.equal(mirrored.action_state.retry.active, true);
    assert.equal(mirrored.lifecycle_state_snapshot.lifecycle_state, "blocked_platform");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("control-state operator CLI smoke uses canonical projection", () => {
  const cwd = makeRoot("control-state-cli-");
  try {
    const paused = runCli([
      "factory", "pause",
      "--factory-id", "mothership",
      "--reason", "scheduled maintenance",
    ], { cwd });
    assert.equal(paused.ok, true);
    assert.equal(paused.action, "pause");

    const state = runCli([
      "factory", "control-state",
      "--factory-id", "mothership",
    ], { cwd });
    assert.equal(state.factory_id, "mothership");
    assert.equal(state.action_state.pause.active, true);

    const retried = runCli([
      "factory", "retry",
      "--factory-id", "mothership",
      "--reason", "rerun failed tick",
      "--retry-target", "run-cli-9",
    ], { cwd });
    assert.equal(retried.ok, true);

    const finalState = runCli([
      "factory", "control-state",
      "--factory-id", "mothership",
    ], { cwd });
    assert.equal(finalState.action_state.retry.active, true);
    assert.equal(finalState.retry_target, "run-cli-9");
    assert.equal(finalState.notes.length, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
