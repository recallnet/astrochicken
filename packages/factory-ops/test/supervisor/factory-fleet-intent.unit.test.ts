import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyFleetFactoryHealth,
  formatFleetStatusHuman,
} from "../../src/commands/factory-fleet-status.ts";
import {
  collectFactoryRow,
} from "../../src/lib/factory-fleet-projection-support.ts";

test("classifyFleetFactoryHealth returns disabled when host_intent_enabled is false", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    host_intent_enabled: false,
    blocked_reason: "",
    release_state: "ready",
    active_waves: ["wave"],
    active_issues: [1],
  }), "disabled", "disabled intent should return disabled");
});

test("classifyFleetFactoryHealth returns unhealthy over disabled when errors exist", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: ["boom"],
    daemon_health: { status: "running", running: true },
    host_intent_enabled: false,
    blocked_reason: "",
    release_state: "ready",
    active_waves: [],
    active_issues: [],
  }), "unhealthy", "errors should win over disabled");
});

test("classifyFleetFactoryHealth returns healthy when host_intent_enabled is true", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    host_intent_enabled: true,
    blocked_reason: "",
    release_state: "ready",
    active_waves: ["wave"],
    active_issues: [1],
  }), "healthy", "enabled intent should not affect normal classification");
});

test("classifyFleetFactoryHealth treats missing host_intent_enabled as enabled", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    blocked_reason: "",
    release_state: "ready",
    active_waves: ["wave"],
    active_issues: [1],
  }), "healthy", "missing host_intent_enabled should be treated as enabled");
});

test("formatFleetStatusHuman includes disabled in totals line", () => {
  const result = {
    generated_at: "2026-03-23T00:00:00Z",
    factories: [
      {
        factory_id: "alpha",
        target_repo: "org/alpha",
        health: "disabled",
        host_intent_enabled: false,
        host_intent_disabled_reason: "maintenance",
        release_state: "ready",
        drift_state: "unknown",
        rollout_channel: "general",
        runtime_version: "v1",
        kind_version: "v1",
        active_waves: [],
        active_issues: [],
        recent_outcomes: [],
        daemon_health: { status: "running", running: true },
        managed_state: {},
        errors: [],
      },
      {
        factory_id: "beta",
        target_repo: "org/beta",
        health: "healthy",
        host_intent_enabled: true,
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "general",
        runtime_version: "v1",
        kind_version: "v1",
        active_waves: ["w1"],
        active_issues: [],
        recent_outcomes: [],
        daemon_health: { status: "running", running: true },
        managed_state: {},
        errors: [],
      },
    ],
  };

  const output = formatFleetStatusHuman(result);
  assert.ok(output.includes("disabled=1"), `totals line should include disabled=1, got: ${output}`);
  assert.ok(output.includes("healthy=1"), `totals line should include healthy=1, got: ${output}`);
  assert.ok(output.includes("intent_disabled"), `disabled row should show intent_disabled reason`);
});

test("collectFactoryRow populates host_intent_enabled from intent reader", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "fleet-intent-row-"));
  const registryPath = join(tmpDir, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [{ instance_id: "test-fac", kind_id: "test-fac", target_repo: "org/test", status: "active" }],
  }));

  const row = collectFactoryRow({
    registryEntry: { factory_id: "test-fac", kind_id: "test-fac", target_repo: "org/test", graphs: [] },
    baseContext: {},
    rootDir: tmpDir,
    factoryStatusFn: () => ({}),
    factoryActiveSummaryFn: () => ({}),
    tickStatusFn: () => ({ ticks: [] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 1, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0 }),
    readHostFactoryIntentFn: () => ({ enabled: false, disabled_at: "2026-03-23T00:00:00Z", disabled_reason: "test" }),
  });

  assert.equal(row.host_intent_enabled, false, "should propagate disabled intent to row");
  assert.equal(row.health, "disabled", "health should be disabled when intent is disabled");
  assert.equal(row.host_intent_disabled_reason, "test", "should propagate disabled reason");
});

test("collectFactoryRow defaults host_intent_enabled to true when intent is enabled", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "fleet-intent-row-en-"));

  const row = collectFactoryRow({
    registryEntry: { factory_id: "test-fac", kind_id: "test-fac", target_repo: "org/test", graphs: [] },
    baseContext: {},
    rootDir: tmpDir,
    factoryStatusFn: () => ({}),
    factoryActiveSummaryFn: () => ({}),
    tickStatusFn: () => ({ ticks: [] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 1, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0 }),
    readHostFactoryIntentFn: () => ({ enabled: true, disabled_at: null, disabled_reason: null }),
  });

  assert.equal(row.host_intent_enabled, true, "should propagate enabled intent to row");
  assert.notEqual(row.health, "disabled", "health should not be disabled when intent is enabled");
});
