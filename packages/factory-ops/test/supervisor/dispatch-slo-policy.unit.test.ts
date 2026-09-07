import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
  DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
  evaluateDispatchLatencySlo,
  evaluateMaintenanceTickDue,
  normalizeDispatchLatencySloSeconds,
  normalizeMaintenanceIntervalSeconds,
  readMaintenanceTickState,
  resolveMaintenanceTickStatePath,
  writeMaintenanceTickState,
} from "../../src/lib/dispatch-slo-policy.ts";

test("normalizeDispatchLatencySloSeconds clamps invalid and oversized values", () => {
  assert.equal(normalizeDispatchLatencySloSeconds(undefined), DEFAULT_DISPATCH_LATENCY_SLO_SECONDS);
  assert.equal(normalizeDispatchLatencySloSeconds(0), DEFAULT_DISPATCH_LATENCY_SLO_SECONDS);
  assert.equal(normalizeDispatchLatencySloSeconds(90), 30);
});

test("normalizeMaintenanceIntervalSeconds falls back for invalid values", () => {
  assert.equal(normalizeMaintenanceIntervalSeconds(undefined), DEFAULT_MAINTENANCE_INTERVAL_SECONDS);
  assert.equal(normalizeMaintenanceIntervalSeconds(-1), DEFAULT_MAINTENANCE_INTERVAL_SECONDS);
  assert.equal(normalizeMaintenanceIntervalSeconds(120), 120);
});

test("evaluateDispatchLatencySlo reports ok and breach deterministically", () => {
  assert.deepEqual(
    evaluateDispatchLatencySlo({ dispatchDurationMs: 14_000, dispatchLatencySloSeconds: 15 }),
    {
      schema: "dispatch-latency-slo/v1",
      duration_ms: 14_000,
      slo_seconds: 15,
      slo_ms: 15_000,
      ok: true,
      overage_ms: 0,
    },
  );

  assert.deepEqual(
    evaluateDispatchLatencySlo({ dispatchDurationMs: 18_500, dispatchLatencySloSeconds: 15 }),
    {
      schema: "dispatch-latency-slo/v1",
      duration_ms: 18_500,
      slo_seconds: 15,
      slo_ms: 15_000,
      ok: false,
      overage_ms: 3_500,
    },
  );
});

test("maintenance tick due is true when no prior state exists", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "dispatch-slo-policy-"));

  assert.deepEqual(
    evaluateMaintenanceTickDue({
      factoryId: "mothership",
      rootDir,
      nowMs: Date.parse("2026-03-21T18:00:00.000Z"),
      maintenanceIntervalSeconds: 300,
    }),
    {
      due: true,
      reason: "no_prior_maintenance_tick",
      remaining_ms: 0,
      interval_seconds: 300,
      last_completed_at: "",
    },
  );
});

test("write/read maintenance tick state persists the canonical cursor", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "dispatch-slo-policy-"));
  const written = writeMaintenanceTickState({
    factoryId: "mothership",
    rootDir,
    completedAt: "2026-03-21T18:00:00.000Z",
    runId: "maintenance-run",
    tickId: "tick-123",
  });

  assert.ok(written.path.endsWith(path.join(".hatch", "factories", "mothership", "maintenance-tick-state.json")));
  assert.deepEqual(readMaintenanceTickState({ factoryId: "mothership", rootDir }), {
    schema: "dispatch-latency-slo/v1",
    last_completed_at: "2026-03-21T18:00:00.000Z",
    last_run_id: "maintenance-run",
    last_tick_id: "tick-123",
  });
  assert.equal(
    JSON.parse(readFileSync(resolveMaintenanceTickStatePath({ factoryId: "mothership", rootDir }), "utf8")).schema,
    "dispatch-latency-slo/v1",
  );
});

test("maintenance tick due is false before interval elapses and true after", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "dispatch-slo-policy-"));
  writeMaintenanceTickState({
    factoryId: "mothership",
    rootDir,
    completedAt: "2026-03-21T18:00:00.000Z",
    runId: "maintenance-run",
    tickId: "tick-123",
  });

  assert.deepEqual(
    evaluateMaintenanceTickDue({
      factoryId: "mothership",
      rootDir,
      nowMs: Date.parse("2026-03-21T18:03:00.000Z"),
      maintenanceIntervalSeconds: 300,
    }),
    {
      due: false,
      reason: "maintenance_interval_not_elapsed",
      remaining_ms: 120000,
      interval_seconds: 300,
      last_completed_at: "2026-03-21T18:00:00.000Z",
    },
  );

  assert.deepEqual(
    evaluateMaintenanceTickDue({
      factoryId: "mothership",
      rootDir,
      nowMs: Date.parse("2026-03-21T18:05:00.000Z"),
      maintenanceIntervalSeconds: 300,
    }),
    {
      due: true,
      reason: "maintenance_interval_elapsed",
      remaining_ms: 0,
      interval_seconds: 300,
      last_completed_at: "2026-03-21T18:00:00.000Z",
    },
  );
});
