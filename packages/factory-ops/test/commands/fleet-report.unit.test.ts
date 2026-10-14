import { makeInstalledHostCapacity } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { FLEET_REPORT_SCHEMA, FLEET_REPORT_VIEWS, computeBacklogAge, computeFailureRates, computeHostPressure, computeModelCost, computeThroughput, computeTimeToResolution, computeVersionDrift, fleetReport, formatFleetReportHuman } from "../../src/commands/fleet-report.ts";

function sampleEvents() {
  return [
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "completed",
      runtime_version: "1.2.0",
      kind_version: "2026.03.10",
      policy_profile: "stable",
      capability_version: "cap.v1",
      started_at: "2026-03-16T00:00:00.000Z",
      ended_at: "2026-03-16T00:00:10.000Z",
      host_id: "host-a",
      total_tokens: 100,
      estimated_cost_usd: 0.01,
    },
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "failed",
      runtime_version: "1.2.0",
      kind_version: "2026.03.10",
      policy_profile: "stable",
      capability_version: "cap.v1",
      incident_fingerprint: "inc-1",
      started_at: "2026-03-16T00:01:00.000Z",
      ended_at: "2026-03-16T00:01:30.000Z",
      host_id: "host-a",
      total_tokens: 40,
    },
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "completed",
      runtime_version: "1.2.1",
      kind_version: "2026.03.11",
      policy_profile: "stable",
      capability_version: "cap.v2",
      incident_fingerprint: "inc-1",
      started_at: "2026-03-16T00:02:00.000Z",
      ended_at: "2026-03-16T00:05:00.000Z",
      host_id: "host-a",
      total_tokens: 60,
      estimated_cost_usd: 0.02,
    },
    {
      factory_id: "beta",
      instance_id: "beta",
      kind_id: "triage",
      status: "failed",
      runtime_version: "2.0.0",
      kind_version: "2026.03.12",
      policy_profile: "canary",
      capability_version: "cap.v3",
      incident_fingerprint: "inc-2",
      started_at: "2026-03-16T00:03:00.000Z",
      ended_at: "2026-03-16T00:03:20.000Z",
      host_id: "host-b",
      total_tokens: 80,
      estimated_cost_usd: 0.04,
    },
    {
      factory_id: "beta",
      instance_id: "beta",
      kind_id: "triage",
      status: "completed",
      runtime_version: "2.0.1",
      kind_version: "2026.03.12",
      policy_profile: "canary",
      capability_version: "cap.v3",
      incident_fingerprint: "inc-2",
      started_at: "2026-03-16T00:04:00.000Z",
      ended_at: "2026-03-16T00:04:40.000Z",
      host_id: "host-b",
      total_tokens: 120,
      estimated_cost_usd: 0.06,
    },
  ];
}

function sampleSnapshots() {
  return [
    {
      factory_id: "alpha",
      instance_id: "alpha",
      mirror_updated_at: "2026-03-16T00:05:00.000Z",
      queue_depth: 3,
      oldest_work_age_seconds: 120,
      unresolved_actions: 1,
      lifecycle_state: "blocked_local",
    },
    {
      factory_id: "beta",
      instance_id: "beta",
      mirror_updated_at: "2026-03-16T00:05:10.000Z",
      queue_depth: 1,
      oldest_work_age_seconds: 60,
      unresolved_actions: 0,
      lifecycle_state: "running",
    },
  ];
}

function sampleReleaseRows() {
  return [
    {
      factory_id: "alpha",
      rollout_channel: "stable",
      rollout_status: "lagging",
      gate_reason: "factory_release_below_required",
      required_factory_release: "1.2.1",
      local_factory_release: "1.2.0",
    },
    {
      factory_id: "beta",
      rollout_channel: "canary",
      rollout_status: "ready",
      gate_reason: "ready_to_resume",
      required_factory_release: "2.0.1",
      local_factory_release: "2.0.1",
    },
  ];
}

test("fleet report exports include deterministic view list", () => {
  assert.deepEqual(FLEET_REPORT_VIEWS, [
    "throughput",
    "failure-rates",
    "backlog-age",
    "model-cost",
    "version-drift",
    "host-pressure",
    "time-to-resolution",
  ]);
});

test("computeThroughput aggregates completed events by instance and kind", () => {
  const payload = computeThroughput({ events: sampleEvents() });
  assert.equal(payload.completed_total, 3);
  assert.deepEqual(payload.by_instance, [
    { instance_id: "alpha", completed_count: 2 },
    { instance_id: "beta", completed_count: 1 },
  ]);
  assert.deepEqual(payload.by_kind, [
    { kind_id: "brainstorm", completed_count: 2 },
    { kind_id: "triage", completed_count: 1 },
  ]);
});

test("computeFailureRates groups by kind/runtime/capability with deterministic rates", () => {
  const payload = computeFailureRates({ events: sampleEvents(), releaseRows: sampleReleaseRows() });
  assert.equal(payload.totals.total_events, 5);
  assert.equal(payload.totals.failed_events, 2);
  assert.equal(payload.totals.failure_rate, 0.4);
  assert.deepEqual(
    payload.by_kind.map((row) => row.kind_id).sort(),
    ["brainstorm", "triage"],
  );
  assert.equal(payload.by_runtime_version[0].runtime_version, "1.2.0");
  assert.equal(payload.by_capability_version[0].capability_version, "cap.v1");
});

test("computeBacklogAge reports queue depth and oldest age", () => {
  const payload = computeBacklogAge({ snapshots: sampleSnapshots() });
  assert.equal(payload.totals.queue_depth_total, 4);
  assert.equal(payload.totals.max_oldest_work_age_seconds, 120);
  assert.equal(payload.by_instance[0].instance_id, "alpha");
});

test("computeModelCost returns unknown when estimates are missing", () => {
  const payload = computeModelCost({ events: sampleEvents() });
  assert.equal(payload.totals.event_count, 5);
  assert.equal(payload.totals.total_tokens, 400);
  assert.equal(payload.totals.total_cost_usd, 0.13);
  assert.equal(payload.totals.missing_estimate_events, 1);

  const filtered = computeModelCost({ events: sampleEvents(), profile: "canary" });
  assert.equal(filtered.filter_profile, "canary");
  assert.equal(filtered.totals.event_count, 2);
});

test("computeVersionDrift compares release rows with latest runtime signals", () => {
  const payload = computeVersionDrift({ releaseRows: sampleReleaseRows(), events: sampleEvents() });
  assert.equal(payload.totals.instance_count, 2);
  assert.equal(payload.totals.lagging, 1);
  assert.equal(payload.totals.ready, 1);
  assert.equal(payload.by_instance[0].instance_id, "alpha");
});

test("computeHostPressure reports deterministic fallback when host status absent", () => {
  const fallback = computeHostPressure({ hostStatus: null, events: sampleEvents() });
  assert.equal(fallback.by_host[0].host_id, "unknown");
  assert.equal(fallback.by_host[0].status, "unknown");

  const payload = computeHostPressure({
    hostStatus: makeInstalledHostCapacity(),
    events: sampleEvents(),
  });
  assert.equal(payload.totals.host_count, 1);
  assert.equal(payload.by_host[0].lease_saturation, 0.75);
});

test("computeTimeToResolution computes mean and p95 from fail->complete pairs", () => {
  const payload = computeTimeToResolution({ events: sampleEvents() });
  assert.equal(payload.sample_count, 2);
  assert.equal(payload.mean_seconds, 145);
  assert.equal(payload.p95_seconds, 210);
  assert.equal(payload.unresolved_incident_count, 0);
});

test("fleetReport emits schema envelope, window filtering, and per-view payload", async () => {
  const data = {
    warnings: ["registry:degraded"],
    events: sampleEvents(),
    snapshots: sampleSnapshots(),
    release_report: {
      generated_at: "2026-03-16T00:05:00.000Z",
      factories: sampleReleaseRows(),
    },
    host_status: makeInstalledHostCapacity(),
  };

  const report = await fleetReport({
    view: "throughput",
    factoryId: "mothership",
    instance: "alpha",
    from: "2026-03-16T00:00:00.000Z",
    to: "2026-03-16T00:03:00.000Z",
    now: Date.parse("2026-03-16T00:06:00.000Z"),
    data,
  });

  assert.equal(report.schema, FLEET_REPORT_SCHEMA);
  assert.equal(report.view, "throughput");
  assert.equal(report.instance_id, "alpha");
  assert.equal(report.payload.completed_total, 1);
  assert.equal(report.warnings[0], "registry:degraded");
});

test("formatFleetReportHuman renders deterministic one-screen summary", () => {
  const text = formatFleetReportHuman({
    view: "time-to-resolution",
    generated_at: "2026-03-16T00:06:00.000Z",
    window: {
      from: "2026-03-16T00:00:00.000Z",
      to: "2026-03-16T00:06:00.000Z",
    },
    payload: computeTimeToResolution({ events: sampleEvents() }),
    warnings: ["snapshot:missing"],
  });

  assert.match(text, /Fleet report view=time-to-resolution/);
  assert.match(text, /sample_count=2/);
  assert.match(text, /warnings=1/);
});

for (const view of [
  "throughput",
  "failure-rates",
  "backlog-age",
  "model-cost",
  "version-drift",
  "host-pressure",
  "time-to-resolution",
]) {
  test(`fleetReport supports ${view} view payload contract`, async () => {
    const report = await fleetReport({
      view,
      now: Date.parse("2026-03-16T00:06:00.000Z"),
      data: {
        warnings: [],
        events: sampleEvents(),
        snapshots: sampleSnapshots(),
        release_report: {
          generated_at: "2026-03-16T00:05:00.000Z",
          factories: sampleReleaseRows(),
        },
        host_status: makeInstalledHostCapacity(),
      },
    });

    assert.equal(report.schema, FLEET_REPORT_SCHEMA);
    assert.equal(report.view, view);
    assert.equal(typeof report.payload, "object");
  });
}
