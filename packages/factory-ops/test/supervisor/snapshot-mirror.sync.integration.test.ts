import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { persistManagedLifecycleState } from "../../src/commands/supervisor-managed-persist-state.ts";
import {
  readManagedSnapshotMirror,
  resolveManagedSnapshotMirrorPath,
} from "../../src/lib/mirror-managed-snapshot.ts";

function makePersisted({ version = 1, lifecycleState = "active", now = "2026-03-16T20:00:00.000Z" } = {}) {
  return {
    state_path: `/tmp/control-state-v${version}.json`,
    version,
    lifecycle_state_snapshot: {
      schema_version: "managed-factory-snapshot/v1",
      lifecycle_state: lifecycleState,
      lifecycle_reason: lifecycleState === "idle" ? "no intake" : "tick running",
      lifecycle_failure_classification: "none",
      lifecycle_failure_reason: "",
      lifecycle_updated_at: now,
      lifecycle_updated_by: "managed_supervisor",
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
      unresolved_actions: 0,
      queue_depth: lifecycleState === "idle" ? 0 : 1,
      oldest_work_age_seconds: 0,
      latest_incidents: [],
    },
  };
}

test("persistManagedLifecycleState writes deterministic managed snapshot mirror in lockstep", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "managed-snapshot-mirror-sync-"));
  const instanceId = "fac_01TEST";
  const factoryId = "brainstorm";

  const out = persistManagedLifecycleState({
    factoryId,
    instanceId,
    rootDir,
    lifecycleState: "active",
    lifecycleReason: "tick running",
    failureClassification: "none",
    failureReason: "",
    hasOpenUpstreamBugs: "false",
    openUpstreamBugCount: "0",
    openUpstreamBugNumbers: "[]",
    hasActionItems: "false",
    actionItemCount: "0",
    unresolvedActions: "0",
    queueDepth: "1",
    oldestWorkAgeSeconds: "0",
    latestIncidents: "[]",
    writeLifecycleProjectionFn: () => makePersisted({ version: 3, lifecycleState: "active" }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.state_version, 3);
  assert.equal(out.mirror_error, "");

  const mirrorPath = resolveManagedSnapshotMirrorPath({ factoryId, instanceId, rootDir });
  assert.equal(out.mirror_path, mirrorPath);

  const raw = JSON.parse(readFileSync(mirrorPath, "utf8"));
  assert.equal(raw.schema_version, "managed-factory-snapshot-mirror/v1");
  assert.equal(raw.factory_id, factoryId);
  assert.equal(raw.instance_id, instanceId);
  assert.equal(raw.state_version, 3);
  assert.equal(raw.mirror_version, 3);
  assert.equal(raw.lifecycle_state, "active");
  assert.equal(raw.queue_depth, 1);

  const canonical = readManagedSnapshotMirror({ factoryId, instanceId, rootDir });
  assert.deepEqual(canonical, raw);
});

test("mirror version advances across sequential lifecycle writes", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "managed-snapshot-mirror-version-"));
  const instanceId = "fac_02TEST";
  const factoryId = "brainstorm";

  const first = persistManagedLifecycleState({
    factoryId,
    instanceId,
    rootDir,
    lifecycleState: "active",
    writeLifecycleProjectionFn: () => makePersisted({ version: 4, lifecycleState: "active", now: "2026-03-16T20:01:00.000Z" }),
  });

  const second = persistManagedLifecycleState({
    factoryId,
    instanceId,
    rootDir,
    lifecycleState: "idle",
    writeLifecycleProjectionFn: () => makePersisted({ version: 5, lifecycleState: "idle", now: "2026-03-16T20:02:00.000Z" }),
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.mirror_version, 4);
  assert.equal(second.mirror_version, 5);

  const mirrored = readManagedSnapshotMirror({ factoryId, instanceId, rootDir });
  assert.equal(mirrored.state_version, 5);
  assert.equal(mirrored.mirror_version, 5);
  assert.equal(mirrored.lifecycle_state, "idle");
  assert.equal(mirrored.lifecycle_reason, "no intake");
});
