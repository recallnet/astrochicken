import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readMirroredSnapshot,
  readRecentEvents,
  resolveFactoryMirrorRoot,
} from "../../src/lib/factory-mirror-reader.ts";

function makeTmpDir(prefix = "factory-mirror-reader-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

test("resolveFactoryMirrorRoot prefers .hatch/fleet/mirrors when present", () => {
  const root = makeTmpDir("factory-mirror-root-");
  try {
    const factoryId = "brainstorm";
    const rootPath = join(root, ".hatch", "fleet", "mirrors", factoryId);
    mkdirSync(rootPath, { recursive: true });

    const resolved = resolveFactoryMirrorRoot({
      factoryId,
      rootDir: root,
    });

    assert.equal(resolved, rootPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readMirroredSnapshot loads and normalizes mirrored snapshot records", () => {
  const root = makeTmpDir("factory-mirror-snapshots-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    const instanceDir = join(mirrorRoot, "fac_01TEST");
    mkdirSync(instanceDir, { recursive: true });

    writeJson(join(instanceDir, "snapshot.json"), {
      schema_version: "managed-factory-snapshot-mirror/v1",
      factory_id: "brainstorm",
      instance_id: "fac_01TEST",
      mirror_version: 7,
      mirror_updated_at: "2026-03-16T21:00:00.000Z",
      mirror_path: join(instanceDir, "snapshot.json"),
      state_version: 7,
      lifecycle_state: "blocked_platform",
      lifecycle_reason: "awaiting upstream fix",
      blockers: {
        upstream: {
          has_open_upstream_bugs: true,
          open_upstream_bug_count: 2,
          open_upstream_bug_numbers: [18, "19", 0],
        },
        action_items: {
          has_action_items: true,
          action_item_count: 3,
        },
      },
      unresolved_actions: 3,
      queue_depth: 4,
      oldest_work_age_seconds: 900,
      latest_incidents: [
        {
          incident_fingerprint: "inc-1",
          severity: "warn",
        },
      ],
    });

    const out = readMirroredSnapshot("brainstorm", {
      mirrorDir: mirrorRoot,
      rootDir: root,
    });

    assert.equal(out.factory_id, "brainstorm");
    assert.equal(out.snapshot_count, 1);
    assert.equal(out.snapshots[0].instance_id, "fac_01TEST");
    assert.equal(out.snapshots[0].lifecycle_state, "blocked_platform");
    assert.equal(out.snapshots[0].state_version, 7);
    assert.deepEqual(out.snapshots[0].blockers.upstream.open_upstream_bug_numbers, [18, 19]);
    assert.deepEqual(out.snapshots[0].latest_incidents, [{ incident_fingerprint: "inc-1", severity: "warn" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readMirroredSnapshot fails with mirror_missing when mirror root is absent", () => {
  const root = makeTmpDir("factory-mirror-snapshots-missing-");
  try {
    assert.throws(
      () => readMirroredSnapshot("brainstorm", { mirrorDir: join(root, "missing"), rootDir: root }),
      (error) => error?.code === "mirror_missing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readMirroredSnapshot fails with mirror_invalid_json when snapshot is malformed", () => {
  const root = makeTmpDir("factory-mirror-snapshots-invalid-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    const instanceDir = join(mirrorRoot, "fac_bad");
    mkdirSync(instanceDir, { recursive: true });
    writeFileSync(join(instanceDir, "snapshot.json"), "{not valid json");

    assert.throws(
      () => readMirroredSnapshot("brainstorm", { mirrorDir: mirrorRoot, rootDir: root }),
      (error) => error?.code === "mirror_invalid_json",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readRecentEvents loads latest events and preserves required telemetry fields", () => {
  const root = makeTmpDir("factory-mirror-events-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    mkdirSync(mirrorRoot, { recursive: true });

    writeJson(join(mirrorRoot, "events.json"), [
      {
        factory_id: "brainstorm",
        instance_id: "fac_01",
        installation_id: "inst_01",
        host_id: "host-a",
        kind_id: "brainstorm",
        run_id: "run-1",
        tick_id: "tick-1",
        event_type: "factory.lifecycle.tick",
        status: "completed",
        started_at: "2026-03-16T20:00:00.000Z",
        ended_at: "2026-03-16T20:00:05.000Z",
        duration_ms: 5000,
        incident_fingerprint: "sha256:a",
        runtime_version: "1.0.0",
        kind_version: "2026.03.16",
        policy_profile: "policy_pack:v1",
      },
      {
        factory_id: "brainstorm",
        instance_id: "fac_01",
        installation_id: "inst_01",
        host_id: "host-a",
        kind_id: "brainstorm",
        run_id: "run-2",
        tick_id: "tick-2",
        event_type: "factory.lifecycle.tick",
        status: "failed",
        started_at: "2026-03-16T20:01:00.000Z",
        ended_at: "2026-03-16T20:01:04.000Z",
        duration_ms: 4000,
        incident_fingerprint: "sha256:b",
        runtime_version: "1.0.0",
        kind_version: "2026.03.16",
        policy_profile: "policy_pack:v1",
      },
    ]);

    const out = readRecentEvents("brainstorm", {
      mirrorDir: mirrorRoot,
      rootDir: root,
      limit: 1,
    });

    assert.equal(out.factory_id, "brainstorm");
    assert.equal(out.total_events, 2);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].run_id, "run-2");
    assert.equal(out.events[0].tick_id, "tick-2");
    assert.equal(out.events[0].event_type, "factory.lifecycle.tick");
    assert.equal(out.events[0].runtime_version, "1.0.0");
    assert.equal(out.events[0].incident_fingerprint, "sha256:b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readRecentEvents supports events.jsonl mirror files", () => {
  const root = makeTmpDir("factory-mirror-events-jsonl-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    mkdirSync(mirrorRoot, { recursive: true });
    writeFileSync(
      join(mirrorRoot, "events.jsonl"),
      `${JSON.stringify({
        factory_id: "brainstorm",
        instance_id: "fac_01",
        installation_id: "inst_01",
        host_id: "host-a",
        kind_id: "brainstorm",
        run_id: "run-3",
        tick_id: "tick-3",
        event_type: "factory.lifecycle.sleep",
        status: "scheduled",
        started_at: "2026-03-16T20:02:00.000Z",
        ended_at: "2026-03-16T20:02:45.000Z",
        duration_ms: 45000,
        incident_fingerprint: "sha256:c",
        runtime_version: "1.0.0",
        kind_version: "2026.03.16",
        policy_profile: "policy_pack:v1",
      })}\n`,
    );

    const out = readRecentEvents("brainstorm", {
      mirrorDir: mirrorRoot,
      rootDir: root,
    });

    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].event_type, "factory.lifecycle.sleep");
    assert.equal(out.events[0].run_id, "run-3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readRecentEvents fails with mirror_missing when no event file exists", () => {
  const root = makeTmpDir("factory-mirror-events-missing-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    mkdirSync(mirrorRoot, { recursive: true });

    assert.throws(
      () => readRecentEvents("brainstorm", { mirrorDir: mirrorRoot, rootDir: root }),
      (error) => error?.code === "mirror_missing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readRecentEvents fails with mirror_invalid_json when events payload is malformed", () => {
  const root = makeTmpDir("factory-mirror-events-invalid-");
  try {
    const mirrorRoot = join(root, "mirror-store");
    mkdirSync(mirrorRoot, { recursive: true });
    writeFileSync(join(mirrorRoot, "events.json"), "{broken json");

    assert.throws(
      () => readRecentEvents("brainstorm", { mirrorDir: mirrorRoot, rootDir: root }),
      (error) => error?.code === "mirror_invalid_json",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
