import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  applyExternalFactoryControlAction,
  readExternalFactoryControlState,
  resolveExternalFactoryControlStatePath,
  writeExternalFactoryControlState,
  writeExternalFactoryLifecycleState,
} from "../../src/lib/external-factory-control-state.ts";

const repoRoot = resolve(".");

function createRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("external factory control-state enforces transition semantics", () => {
  const rootDir = createRoot("external-factory-control-state-");

  const initial = readExternalFactoryControlState({ factoryId: "external-worker", rootDir });
  assert.equal(initial.version, 0);
  assert.equal(initial.reason, "");

  const paused = applyExternalFactoryControlAction({
    action: "pause",
    factoryId: "external-worker",
    reason: "pause for maintenance",
    actor: "operator-a",
    rootDir,
  });
  assert.equal(paused.ok, true);
  assert.equal(paused.state_action, "pause");
  assert.equal(paused.state_version, 1);

  const unpaused = applyExternalFactoryControlAction({
    action: "pause",
    factoryId: "external-worker",
    reason: "resume from maintenance",
    actor: "operator-a",
    rootDir,
  });
  assert.equal(unpaused.state_action, "none");
  assert.equal(unpaused.state_version, 2);

  const quarantined = applyExternalFactoryControlAction({
    action: "quarantine",
    factoryId: "external-worker",
    reason: "review failures exceeded threshold",
    actor: "operator-a",
    rootDir,
  });
  assert.equal(quarantined.state_action, "quarantine");
  assert.equal(quarantined.state.action_state.quarantine.count, 1);

  assert.throws(
    () => applyExternalFactoryControlAction({
      action: "resume",
      factoryId: "external-worker",
      reason: "resume now",
      actor: "operator-a",
      rootDir,
    }),
    /resume_requires_unblock_after_quarantine/,
  );

  const unblocked = applyExternalFactoryControlAction({
    action: "unblock",
    factoryId: "external-worker",
    reason: "verified upstream fix",
    actor: "operator-a",
    rootDir,
  });
  assert.equal(unblocked.state.action_state.unblock.active, true);

  const resumed = applyExternalFactoryControlAction({
    action: "resume",
    factoryId: "external-worker",
    reason: "restart queue",
    actor: "operator-a",
    rootDir,
  });
  assert.equal(resumed.state_action, "resume");
  assert.equal(resumed.state.action_state.quarantine.active, false);

  const retried = applyExternalFactoryControlAction({
    action: "retry",
    factoryId: "external-worker",
    reason: "rerun failed tick",
    actor: "operator-a",
    retryTarget: "run-123",
    rootDir,
  });
  assert.equal(retried.state_action, "retry");
  assert.equal(retried.state.retry_target, "run-123");
  assert.equal(retried.state.action_state.retry.count, 1);
});

test("external factory control-state supports draining action-state shape", () => {
  const rootDir = createRoot("external-factory-control-draining-");

  const written = writeExternalFactoryControlState({
    factoryId: "ext-draining",
    nextState: {
      reason: "draining for maintenance",
      action_state: {
        pause: { active: false },
        quarantine: { active: false },
        draining: { active: true, at: "2026-03-15T00:00:00.000Z" },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
    },
    reason: "draining for maintenance",
    actor: "operator",
    rootDir,
  });

  assert.equal(written.action_state.draining.active, true);
  assert.equal(written.action_state.draining.at, "2026-03-15T00:00:00.000Z");
});

test("external factory control-state rejects optimistic concurrency mismatch", () => {
  const rootDir = createRoot("external-factory-control-version-");

  const first = writeExternalFactoryControlState({
    factoryId: "ext-2",
    nextState: { reason: "initial" },
    reason: "initial",
    actor: "operator",
    rootDir,
  });
  assert.equal(first.version, 1);

  assert.throws(
    () => writeExternalFactoryControlState({
      factoryId: "ext-2",
      nextState: { reason: "stale write" },
      reason: "stale write",
      actor: "operator",
      expectedVersion: 0,
      rootDir,
    }),
    /expected_version=0 actual_version=1/,
  );
});

test("external factory control-state writes atomically and leaves no tmp artifact", () => {
  const rootDir = createRoot("external-factory-control-atomic-");
  const statePath = resolveExternalFactoryControlStatePath({
    factoryId: "ext-atomic",
    rootDir,
  });

  const out = writeExternalFactoryControlState({
    factoryId: "ext-atomic",
    nextState: { reason: "atomic test" },
    reason: "atomic test",
    actor: "operator",
    rootDir,
  });

  assert.equal(out.state_path, statePath);
  assert.equal(existsSync(statePath), true);
  assert.equal(existsSync(`${statePath}.tmp`), false);
});

test("external factory control-state survives process restart (read-after-write)", () => {
  const rootDir = createRoot("external-factory-control-restart-");

  const persisted = applyExternalFactoryControlAction({
    action: "retry",
    factoryId: "ext-restart",
    reason: "retry after crash",
    actor: "operator",
    retryTarget: "run-55",
    rootDir,
  }).state;

  const command = [
    "--input-type=module",
    "-e",
    `import { readExternalFactoryControlState } from ${JSON.stringify(resolve(repoRoot, "packages/factory-ops/src/lib/external-factory-control-state.ts"))};\n`
      + `const state = readExternalFactoryControlState({ factoryId: "ext-restart", rootDir: ${JSON.stringify(rootDir)} });\n`
      + "console.log(JSON.stringify(state));\n",
  ];

  const proc = spawnSync("node", command, { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  const reloaded = JSON.parse(String(proc.stdout || "{}").trim() || "{}");
  assert.equal(reloaded.version, persisted.version);
  assert.equal(reloaded.reason, persisted.reason);
  assert.equal(reloaded.retry_target, persisted.retry_target);
  assert.equal(reloaded.action_state.retry.active, true);
});

test("external factory control-state persists lifecycle_state_snapshot metadata", () => {
  const rootDir = createRoot("external-factory-control-lifecycle-");

  const persisted = writeExternalFactoryLifecycleState({
    factoryId: "ext-lifecycle",
    rootDir,
    lifecycleState: "degraded",
    lifecycleReason: "domain failure",
    failureClassification: "local",
    failureReason: "action_item_count=1",
    blockers: {
      upstream: {
        has_open_upstream_bugs: false,
        open_upstream_bug_count: 0,
        open_upstream_bug_numbers: [],
      },
      action_items: {
        has_action_items: true,
        action_item_count: 1,
      },
    },
    unresolvedActions: 1,
    queueDepth: 1,
    oldestWorkAgeSeconds: 0,
    latestIncidents: [{ incident_fingerprint: "inc-1", severity: "warn" }],
    actor: "managed_supervisor",
    nowIso: "2026-03-15T22:00:00.000Z",
  });

  assert.equal(persisted.lifecycle_state_snapshot.schema_version, "managed-factory-snapshot/v1");
  assert.equal(persisted.lifecycle_state_snapshot.lifecycle_state, "degraded");
  assert.equal(persisted.lifecycle_state_snapshot.lifecycle_reason, "domain failure");
  assert.equal(persisted.lifecycle_state_snapshot.lifecycle_failure_classification, "local");
  assert.equal(persisted.lifecycle_state_snapshot.lifecycle_failure_reason, "action_item_count=1");
  assert.equal(persisted.lifecycle_state_snapshot.lifecycle_updated_by, "managed_supervisor");
  assert.equal(persisted.lifecycle_state_snapshot.unresolved_actions, 1);
  assert.equal(persisted.lifecycle_state_snapshot.queue_depth, 1);
  assert.equal(persisted.lifecycle_state_snapshot.oldest_work_age_seconds, 0);
  assert.deepEqual(persisted.lifecycle_state_snapshot.latest_incidents, [{ incident_fingerprint: "inc-1", severity: "warn" }]);
  assert.equal(persisted.lifecycle_state_snapshot.blockers.action_items.action_item_count, 1);

  const reloaded = readExternalFactoryControlState({ factoryId: "ext-lifecycle", rootDir });
  assert.equal(reloaded.lifecycle_state_snapshot.lifecycle_state, "degraded");
  assert.equal(reloaded.lifecycle_state_snapshot.lifecycle_updated_at, "2026-03-15T22:00:00.000Z");
  assert.equal(reloaded.lifecycle_state_snapshot.queue_depth, 1);
  assert.deepEqual(reloaded.lifecycle_state_snapshot.latest_incidents, [{ incident_fingerprint: "inc-1", severity: "warn" }]);
});

test("external factory lifecycle persistence clears stale control-state reason", () => {
  const rootDir = createRoot("external-factory-control-lifecycle-clear-reason-");

  applyExternalFactoryControlAction({
    action: "retry",
    factoryId: "ext-lifecycle-clear",
    reason: "action_item_count=1",
    actor: "operator",
    retryTarget: "run-55",
    rootDir,
  });

  const persisted = writeExternalFactoryLifecycleState({
    factoryId: "ext-lifecycle-clear",
    rootDir,
    lifecycleState: "idle",
    lifecycleReason: "",
    failureClassification: "none",
    failureReason: "",
    blockers: {
      upstream: {
        has_open_upstream_bugs: false,
        open_upstream_bug_count: 0,
        open_upstream_bug_numbers: [],
      },
      action_items: {
        has_action_items: false,
        action_item_count: 0,
      },
    },
    unresolvedActions: 0,
    queueDepth: 0,
    oldestWorkAgeSeconds: 0,
    latestIncidents: [],
    actor: "managed_supervisor",
    nowIso: "2026-03-24T01:10:00.000Z",
  });

  assert.equal(persisted.reason, "");
  const reloaded = readExternalFactoryControlState({ factoryId: "ext-lifecycle-clear", rootDir });
  assert.equal(reloaded.reason, "");
  assert.equal(reloaded.lifecycle_state_snapshot.lifecycle_state, "idle");
  assert.equal(reloaded.lifecycle_state_snapshot.blockers.action_items.action_item_count, 0);
});

test("external factory control-state rejects invalid managed snapshot shape", () => {
  const rootDir = createRoot("external-factory-control-lifecycle-invalid-");

  assert.throws(
    () => writeExternalFactoryLifecycleState({
      factoryId: "ext-lifecycle-invalid",
      rootDir,
      lifecycleState: "degraded",
      lifecycleReason: "domain failure",
      failureClassification: "local",
      failureReason: "action_item_count=1",
      blockers: {
        upstream: {
          has_open_upstream_bugs: false,
          open_upstream_bug_count: 0,
          open_upstream_bug_numbers: [],
        },
        action_items: {
          has_action_items: false,
          action_item_count: 0,
        },
      },
      unresolvedActions: 0,
      queueDepth: -2,
      oldestWorkAgeSeconds: 0,
      latestIncidents: [],
    }),
    /queue_depth must be a non-negative integer/,
  );
});
