import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFleetTriageQueues,
  rankFleetQueueItems,
} from "../../src/lib/fleet-triage-projection.ts";

function createBaseInputs({
  snapshotsByFactory = {},
  eventsByFactory = {},
  registryFactories = [],
  profileInstances = [],
  fleetRows = [],
  releaseRows = [],
  hostStatus = null,
} = {}) {
  return {
    now: Date.parse("2026-03-17T04:00:00.000Z"),
    factoryId: "mothership",
    context: {},
    registryPath: "factory-registry.json",
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: registryFactories,
    }),
    loadFactoryRegistryFn: () => ({
      registryPath: "/tmp/factory-registry.json",
      registry: {
        schema: "hatch.factory.registry.v1",
        instances: profileInstances,
      },
    }),
    readMirroredSnapshotFn: (factoryId) => {
      const snapshots = snapshotsByFactory[factoryId];
      if (!snapshots) throw Object.assign(new Error("mirror_missing"), { code: "mirror_missing" });
      return {
        factory_id: factoryId,
        snapshots,
      };
    },
    readRecentEventsFn: (factoryId) => {
      const events = eventsByFactory[factoryId];
      if (!events) throw Object.assign(new Error("mirror_missing"), { code: "mirror_missing" });
      return {
        factory_id: factoryId,
        events,
      };
    },
    factoryFleetStatusFn: async () => ({
      generated_at: "2026-03-17T04:00:00.000Z",
      factories: fleetRows,
    }),
    factoryReleaseTargetingStatusFn: async () => ({
      generated_at: "2026-03-17T04:00:00.000Z",
      factories: releaseRows,
    }),
    getHostRuntimeStatusFn: () => hostStatus,
  };
}

function findByFingerprint(items = [], fingerprint = "") {
  return items.find((item) => String(item?.fingerprint || "") === String(fingerprint));
}

test("buildFleetTriageQueues always returns schema metadata and six queue keys", async () => {
  const projection = await buildFleetTriageQueues(createBaseInputs({
    registryFactories: [
      { factory_id: "alpha", target_repo: "example/alpha" },
      { factory_id: "beta", target_repo: "example/beta" },
    ],
    profileInstances: [
      {
        instance_id: "alpha",
        target_repo: "example/alpha",
        support_owner: "ops-alpha",
        service_tier: "premium",
      },
      {
        instance_id: "beta",
        target_repo: "example/beta",
        support_owner: "ops-beta",
        service_tier: "standard",
      },
    ],
    snapshotsByFactory: {
      alpha: [
        {
          factory_id: "alpha",
          instance_id: "alpha",
          lifecycle_state: "active",
          lifecycle_updated_at: "2026-03-17T03:50:00.000Z",
          latest_incidents: [
            { incident_fingerprint: "inc-platform-1", severity: "error" },
          ],
          blockers: {
            upstream: { has_open_upstream_bugs: false },
            action_items: { has_action_items: false },
          },
          queue_depth: 0,
          unresolved_actions: 0,
          oldest_work_age_seconds: 0,
        },
      ],
      beta: [
        {
          factory_id: "beta",
          instance_id: "beta",
          lifecycle_state: "blocked_local",
          lifecycle_reason: "awaiting local fix",
          lifecycle_updated_at: "2026-03-17T03:40:00.000Z",
          latest_incidents: [
            { incident_fingerprint: "inc-local-1", severity: "warn" },
          ],
          blockers: {
            upstream: { has_open_upstream_bugs: false },
            action_items: { has_action_items: true },
          },
          queue_depth: 3,
          unresolved_actions: 2,
          oldest_work_age_seconds: 1200,
        },
      ],
    },
    eventsByFactory: {
      alpha: [
        {
          factory_id: "alpha",
          instance_id: "alpha",
          status: "completed",
          started_at: "2026-03-17T03:00:00.000Z",
          ended_at: "2026-03-17T03:01:00.000Z",
          incident_fingerprint: "",
        },
      ],
      beta: [
        {
          factory_id: "beta",
          instance_id: "beta",
          status: "failed",
          started_at: "2026-03-17T03:30:00.000Z",
          ended_at: "2026-03-17T03:31:00.000Z",
          incident_fingerprint: "inc-local-1",
        },
      ],
    },
    fleetRows: [
      { factory_id: "alpha", release_state: "ready", blocked_reason: "" },
      { factory_id: "beta", release_state: "blocked", blocked_reason: "release gate blocked" },
    ],
    releaseRows: [
      {
        factory_id: "beta",
        rollout_status: "lagging",
        gate_reason: "factory_release_below_required",
        status_detail: "factory release 1.0.0 below required 2.0.0",
        required_factory_release: "2.0.0",
        local_factory_release: "1.0.0",
      },
    ],
    hostStatus: {
      ok: true,
      hostId: "host-a",
      host_capacity_pressure: 0.91,
      host_queue_depth: 4,
      host_pending_installations: 2,
      scheduler: { updated_at: "2026-03-17T03:59:00.000Z" },
    },
  }));

  assert.equal(projection.schema_version, "fleet_triage_queues.v1");
  assert.equal(typeof projection.generated_at, "string");
  for (const key of [
    "platform_incidents",
    "local_instance_incidents",
    "blocked_instances",
    "repeated_failure_risk",
    "upgrade_drift",
    "host_capacity_pressure",
  ]) {
    assert.ok(Array.isArray(projection[key]), `${key} should be present`);
  }
});

test("platform incidents dedupe by incident_fingerprint and aggregate blast radius", async () => {
  const projection = await buildFleetTriageQueues(createBaseInputs({
    registryFactories: [
      { factory_id: "alpha", target_repo: "example/alpha" },
      { factory_id: "beta", target_repo: "example/beta" },
    ],
    profileInstances: [
      {
        instance_id: "alpha",
        target_repo: "example/alpha",
        support_owner: "ops-platform",
        service_tier: "premium",
      },
      {
        instance_id: "beta",
        target_repo: "example/beta",
        support_owner: "ops-platform",
        service_tier: "premium",
      },
    ],
    snapshotsByFactory: {
      alpha: [
        {
          factory_id: "alpha",
          instance_id: "alpha",
          lifecycle_state: "blocked_platform",
          lifecycle_updated_at: "2026-03-17T03:00:00.000Z",
          latest_incidents: [{ incident_fingerprint: "shared-fingerprint", severity: "error" }],
          blockers: {
            upstream: { has_open_upstream_bugs: true },
            action_items: { has_action_items: false },
          },
          queue_depth: 1,
          unresolved_actions: 0,
          oldest_work_age_seconds: 300,
        },
      ],
      beta: [
        {
          factory_id: "beta",
          instance_id: "beta",
          lifecycle_state: "blocked_platform",
          lifecycle_updated_at: "2026-03-17T03:10:00.000Z",
          latest_incidents: [{ incident_fingerprint: "shared-fingerprint", severity: "warn" }],
          blockers: {
            upstream: { has_open_upstream_bugs: true },
            action_items: { has_action_items: false },
          },
          queue_depth: 1,
          unresolved_actions: 0,
          oldest_work_age_seconds: 240,
        },
      ],
    },
    eventsByFactory: {
      alpha: [],
      beta: [],
    },
    fleetRows: [
      { factory_id: "alpha", release_state: "ready", blocked_reason: "" },
      { factory_id: "beta", release_state: "ready", blocked_reason: "" },
    ],
    hostStatus: {
      ok: true,
      hostId: "host-a",
      host_capacity_pressure: 0.2,
      host_queue_depth: 0,
      host_pending_installations: 0,
      scheduler: { updated_at: "2026-03-17T03:59:59.000Z" },
    },
  }));

  const item = findByFingerprint(projection.platform_incidents, "shared-fingerprint");
  assert.ok(item);
  assert.deepEqual(item.affected_instances, ["alpha", "beta"]);
  assert.equal(item.blast_radius.affected_instance_count, 2);
  assert.equal(item.blast_radius.support_owner, "ops-platform");
  assert.equal(item.blast_radius.service_tier, "premium");
});

test("blocked instances include non-negative durations and backlog ages when timestamps are missing", async () => {
  const projection = await buildFleetTriageQueues(createBaseInputs({
    registryFactories: [
      { factory_id: "alpha", target_repo: "example/alpha" },
    ],
    profileInstances: [
      {
        instance_id: "alpha",
        target_repo: "example/alpha",
        support_owner: "ops",
        service_tier: "standard",
      },
    ],
    snapshotsByFactory: {
      alpha: [
        {
          factory_id: "alpha",
          instance_id: "alpha",
          lifecycle_state: "blocked_local",
          lifecycle_updated_at: "",
          latest_incidents: [{ incident_fingerprint: "inc-alpha", severity: "warn" }],
          blockers: {
            upstream: { has_open_upstream_bugs: false },
            action_items: { has_action_items: true },
          },
          queue_depth: 2,
          unresolved_actions: 1,
          oldest_work_age_seconds: 0,
        },
      ],
    },
    eventsByFactory: {
      alpha: [],
    },
    fleetRows: [
      { factory_id: "alpha", release_state: "blocked", blocked_reason: "gate" },
    ],
    hostStatus: {
      ok: true,
      hostId: "host-a",
      host_capacity_pressure: 0.3,
      host_queue_depth: 0,
      host_pending_installations: 0,
      scheduler: { updated_at: "2026-03-17T03:59:59.000Z" },
    },
  }));

  const blocked = projection.blocked_instances.find((item) => item.instance_id === "alpha");
  assert.ok(blocked);
  assert.equal(blocked.blocked_duration_seconds >= 0, true);
  assert.equal(blocked.backlog_age_seconds >= 0, true);
});

test("upgrade drift maps release targeting lagging and blocked_gate reasons", async () => {
  const projection = await buildFleetTriageQueues(createBaseInputs({
    registryFactories: [
      { factory_id: "alpha", target_repo: "example/alpha" },
      { factory_id: "beta", target_repo: "example/beta" },
    ],
    profileInstances: [
      { instance_id: "alpha", target_repo: "example/alpha", support_owner: "ops-a", service_tier: "premium" },
      { instance_id: "beta", target_repo: "example/beta", support_owner: "ops-b", service_tier: "standard" },
    ],
    snapshotsByFactory: {
      alpha: [],
      beta: [],
    },
    eventsByFactory: {
      alpha: [
        {
          factory_id: "alpha",
          instance_id: "alpha",
          status: "completed",
          started_at: "2026-03-17T02:00:00.000Z",
          ended_at: "2026-03-17T02:02:00.000Z",
          incident_fingerprint: "",
        },
      ],
      beta: [],
    },
    fleetRows: [
      { factory_id: "alpha", release_state: "ready", blocked_reason: "" },
      { factory_id: "beta", release_state: "ready", blocked_reason: "" },
    ],
    releaseRows: [
      {
        factory_id: "alpha",
        rollout_status: "lagging",
        gate_reason: "factory_release_below_required",
        status_detail: "factory release 1.0.0 below required 2.0.0",
        required_factory_release: "2.0.0",
        local_factory_release: "1.0.0",
      },
      {
        factory_id: "beta",
        rollout_status: "blocked",
        gate_reason: "release_rollout_blocked",
        status_detail: "release rollout currently blocked",
        required_factory_release: "2.0.0",
        local_factory_release: "2.0.0",
      },
    ],
    hostStatus: {
      ok: true,
      hostId: "host-a",
      host_capacity_pressure: 0.3,
      host_queue_depth: 0,
      host_pending_installations: 0,
      scheduler: { updated_at: "2026-03-17T03:59:59.000Z" },
    },
  }));

  const lagging = projection.upgrade_drift.find((item) => item.factory_id === "alpha");
  const blocked = projection.upgrade_drift.find((item) => item.factory_id === "beta");

  assert.ok(lagging);
  assert.equal(lagging.phase, "lagging");
  assert.equal(typeof lagging.reason, "string");
  assert.equal(lagging.last_successful_release_at, "2026-03-17T02:02:00.000Z");

  assert.ok(blocked);
  assert.equal(blocked.phase, "blocked_gate");
  assert.equal(typeof blocked.reason, "string");
});

test("host capacity queue emits degradation warning when host pressure feed is empty", async () => {
  const projection = await buildFleetTriageQueues(createBaseInputs({
    registryFactories: [{ factory_id: "alpha", target_repo: "example/alpha" }],
    profileInstances: [{ instance_id: "alpha", target_repo: "example/alpha", support_owner: "ops", service_tier: "standard" }],
    snapshotsByFactory: { alpha: [] },
    eventsByFactory: { alpha: [] },
    fleetRows: [{ factory_id: "alpha", release_state: "ready", blocked_reason: "" }],
    releaseRows: [],
    hostStatus: null,
  }));

  assert.equal(projection.host_capacity_pressure.length, 1);
  assert.equal(projection.host_capacity_pressure[0].degradation_warning, true);
  assert.equal(projection.queue_metadata.host_capacity_pressure.degraded, true);
  assert.ok(
    projection.queue_metadata.host_capacity_pressure.warnings.some((entry) => String(entry).includes("host_pressure_feed_empty")),
  );
});

test("rankFleetQueueItems orders queue entries by deterministic priority metadata", () => {
  const ranked = rankFleetQueueItems({
    platform_incidents: [
      {
        fingerprint: "low",
        severity: "warn",
        service_tier: "standard",
        blast_radius: { affected_instance_count: 1 },
        queue_reasons: ["warn"],
      },
      {
        fingerprint: "high",
        severity: "error",
        service_tier: "premium",
        blast_radius: { affected_instance_count: 3 },
        queue_reasons: ["error"],
      },
    ],
    local_instance_incidents: [],
    blocked_instances: [],
    repeated_failure_risk: [],
    upgrade_drift: [],
    host_capacity_pressure: [],
  });

  assert.equal(ranked.platform_incidents[0].fingerprint, "high");
  assert.equal(ranked.platform_incidents[0].ranking.rank, 1);
  assert.equal(typeof ranked.platform_incidents[0].ranking.priority_score, "number");
});
