import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pollHostWakeups } from "../../src/lib/host-wakeup.ts";

function makeTmpDir(prefix = "host-wakeup-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function basePaths(root = "") {
  return {
    baseDir: root,
    runtimeDir: join(root, "runtime"),
    runtimeLogDir: join(root, "runtime", "logs"),
    repoRoot: root,
  };
}

function writeMirrorEvent(root = "", instanceId = "", event = {}) {
  const mirrorDir = join(root, instanceId);
  mkdirSync(mirrorDir, { recursive: true });
  writeJson(join(mirrorDir, "events.json"), [event]);
}

function writeMirrorSnapshot(root = "", instanceId = "", snapshot = {}) {
  const mirrorDir = join(root, instanceId);
  mkdirSync(join(mirrorDir, instanceId), { recursive: true });
  writeJson(join(mirrorDir, instanceId, "snapshot.json"), snapshot);
}

function writeRegistry(root = "") {
  const registryPath = join(root, "factory-registry.json");
  writeJson(registryPath, {
    schema: "hatch.factory.registry.v1",
    instances: [],
  });
  return registryPath;
}

test("pollHostWakeups triggers intake activity before reconcile timer when event cursor advances", () => {
  const root = makeTmpDir("host-wakeup-intake-");
  const mirrorRoot = join(root, "mirrors");
  const instanceId = "fac_intake";

  try {
    writeRegistry(root);
    writeMirrorEvent(mirrorRoot, instanceId, {
      factory_id: instanceId,
      instance_id: instanceId,
      run_id: "run-2",
      tick_id: "tick-2",
      event_type: "intake.issue.updated",
      status: "queued",
      started_at: "2026-03-16T21:00:00.000Z",
      ended_at: "2026-03-16T21:00:01.000Z",
      duration_ms: 1000,
    });

    const now = Date.parse("2026-03-16T21:01:00.000Z");
    const out = pollHostWakeups({
      hostId: "host_wakeup_01",
      installations: [{ installation_id: "inst_intake", instance_id: instanceId }],
      previousState: {
        host_id: "host_wakeup_01",
        next_reconcile_at: "2026-03-16T21:10:00.000Z",
        installations: {
          inst_intake: {
            installation_id: "inst_intake",
            instance_id: instanceId,
            latest_event_cursor: "intake.issue.updated|queued|run-1|tick-1|2026-03-16T20:59:01.000Z",
          },
        },
      },
      paths: basePaths(root),
      env: {
        ...process.env,
        HATCH_HOST_WAKEUP_MIRROR_DIR: mirrorRoot,
        HATCH_HOST_RECONCILE_INTERVAL_SEC: "600",
      },
      nowEpochMs: now,
    });

    assert.equal(out.triggered, true);
    assert.equal(out.wake_sources.includes("intake_activity"), true);
    assert.equal(out.wake_sources.includes("reconcile_timer"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pollHostWakeups classifies incident/blocker deltas from mirrored snapshots", () => {
  const root = makeTmpDir("host-wakeup-incident-");
  const mirrorRoot = join(root, "mirrors");
  const instanceId = "fac_incident";

  try {
    writeRegistry(root);
    writeMirrorSnapshot(mirrorRoot, instanceId, {
      factory_id: instanceId,
      instance_id: instanceId,
      state_version: 12,
      mirror_updated_at: "2026-03-16T21:05:00.000Z",
      action_item_count: 1,
      unresolved_actions: 1,
      blockers: {
        upstream: {
          has_open_upstream_bugs: true,
          open_upstream_bug_count: 1,
          open_upstream_bug_numbers: [2193],
        },
        action_items: {
          has_action_items: true,
          action_item_count: 1,
        },
      },
      latest_incidents: [
        {
          incident_fingerprint: "inc-2193",
          severity: "warn",
        },
      ],
    });

    const out = pollHostWakeups({
      hostId: "host_wakeup_02",
      installations: [{ installation_id: "inst_incident", instance_id: instanceId }],
      previousState: {
        host_id: "host_wakeup_02",
        next_reconcile_at: "2026-03-16T21:10:00.000Z",
        installations: {
          inst_incident: {
            installation_id: "inst_incident",
            instance_id: instanceId,
            latest_snapshot_cursor: JSON.stringify({ state_version: 11, incidents: [] }),
          },
        },
      },
      paths: basePaths(root),
      env: {
        ...process.env,
        HATCH_HOST_WAKEUP_MIRROR_DIR: mirrorRoot,
        HATCH_HOST_RECONCILE_INTERVAL_SEC: "600",
      },
      nowEpochMs: Date.parse("2026-03-16T21:06:00.000Z"),
    });

    assert.equal(out.triggered, true);
    assert.equal(out.wake_sources.includes("incident_blocker"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pollHostWakeups emits policy registry delta and reconcile fallback", () => {
  const root = makeTmpDir("host-wakeup-policy-");
  try {
    const registryPath = writeRegistry(root);
    const stats = statSync(registryPath);

    const out = pollHostWakeups({
      hostId: "host_wakeup_03",
      installations: [],
      previousState: {
        host_id: "host_wakeup_03",
        next_reconcile_at: "2026-03-16T21:00:00.000Z",
        registry_cursor: {
          path: registryPath,
          exists: true,
          mtime_ms: Math.trunc(stats.mtimeMs) - 1000,
          size: stats.size,
        },
      },
      paths: basePaths(root),
      env: {
        ...process.env,
        HATCH_FACTORY_REGISTRY_PATH: registryPath,
        HATCH_FACTORY_REGISTRY_CWD: root,
        HATCH_HOST_RECONCILE_INTERVAL_SEC: "60",
      },
      nowEpochMs: Date.parse("2026-03-16T21:01:00.000Z"),
    });

    assert.equal(out.triggered, true);
    assert.equal(out.wake_sources.includes("policy_registry_delta"), true);
    assert.equal(out.wake_sources.includes("reconcile_timer"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
