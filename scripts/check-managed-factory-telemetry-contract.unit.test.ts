import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MANAGED_FACTORY_TELEMETRY_EVENTS, emitManagedLifecycleEvent } from "../packages/factory-ops/src/lib/daemon.ts";

import { validateManagedFactoryTelemetryContract } from "./check-managed-factory-telemetry-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-managed-factory-telemetry-contract.mjs");
const fixturesRoot = join(scriptsDir, "fixtures", "managed-factory-telemetry-contract");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

function pathToLogFile(name) {
  return join(process.cwd(), `.tmp-managed-telemetry-${name}.log`);
}

test("validateManagedFactoryTelemetryContract accepts valid fixture", () => {
  const result = validateManagedFactoryTelemetryContract({
    manifestsRoot: fixtureRoot("valid"),
    contractPath: "contract.json",
  });

  assert.equal(result.ok, true);
  assert.equal(result.filesChecked, 2);
  assert.equal(result.eventsChecked, 2);
  assert.equal(result.daemonSchemaFields, 4);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.telemetry,
    "[managed-factory-telemetry-contract] result=ok daemon_schema_fields=4 events_checked=2 files_checked=2",
  );
});

test("validateManagedFactoryTelemetryContract fails when telemetry event required field is missing", () => {
  const result = validateManagedFactoryTelemetryContract({
    manifestsRoot: fixtureRoot("invalid-missing-required-field"),
    contractPath: "contract.json",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) =>
      line.includes("event_schema_mismatch")
      && line.includes("event=factory.lifecycle.tick")
      && line.includes("missing_required_field field=runtime_version")),
    true,
  );
  assert.match(
    result.telemetry,
    /^\[managed-factory-telemetry-contract\] result=fail diagnostics=\d+ daemon_schema_fields=4 events_checked=2 files_checked=2$/,
  );
});

test("validateManagedFactoryTelemetryContract fails when daemon snapshot schema drifts", () => {
  const result = validateManagedFactoryTelemetryContract({
    manifestsRoot: fixtureRoot("invalid-schema-drift"),
    contractPath: "contract.json",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) =>
      line.includes("state_snapshot_schema_mismatch")
      && line.includes("missing_required_field field=running_from_canonical")),
    true,
  );
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync(
    "node",
    [
      checkerPath,
      "--manifests",
      fixtureRoot("valid"),
      "--contract",
      "contract.json",
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout.trim(),
    "[managed-factory-telemetry-contract] result=ok daemon_schema_fields=4 events_checked=2 files_checked=2",
  );
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic fail telemetry and diagnostics", () => {
  const run = spawnSync(
    "node",
    [
      checkerPath,
      "--manifests",
      fixtureRoot("invalid-missing-required-field"),
      "--contract",
      "contract.json",
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 1);
  assert.match(
    run.stderr,
    /event_schema_mismatch file=.*packages\/factory-runtime\/telemetry\/managed-factory-telemetry\.mjs event=factory\.lifecycle\.tick missing_required_field field=runtime_version/,
  );
  assert.match(
    run.stderr,
    /^.*\[managed-factory-telemetry-contract\] result=fail diagnostics=\d+ daemon_schema_fields=4 events_checked=2 files_checked=2\n?$/m,
  );
});

test("emitManagedLifecycleEvent fails closed when required identity fields are missing", () => {
  const emitted = [];

  const result = emitManagedLifecycleEvent({
    runtime: {
      factoryId: "brainstorm",
      mutationContext: {
        instance_id: "brainstorm",
        kind_id: "brainstorm",
      },
      config: {
        kind_id: "brainstorm",
      },
    },
    paths: {},
    repoRoot: process.cwd(),
    daemonLogPath: pathToLogFile("missing-identity"),
    eventType: "factory.lifecycle.tick",
    status: "completed",
    runId: "run-1",
    tickId: "tick-1",
    startedAt: "2026-03-16T18:00:00.000Z",
    endedAt: "2026-03-16T18:00:05.000Z",
    durationMs: 5000,
    extraFields: {
      tick_idle: "false",
    },
    readCurrentLeaseFn: () => ({ ok: true, exists: false, lease: null }),
    emitOtelEventFn: (payload) => {
      emitted.push(payload);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_required_identity");
  assert.equal(emitted.length, 0);
});

test("emitManagedLifecycleEvent emits lifecycle payload with v1 required fields", () => {
  const emitted = [];

  const result = emitManagedLifecycleEvent({
    runtime: {
      factoryId: "brainstorm",
      kindVersion: "2026.03.16",
      policyProfile: "policy_pack:v2",
      mutationContext: {
        instance_id: "fac_brainstorm_01",
        kind_id: "brainstorm",
      },
      config: {
        kind_id: "brainstorm",
        runtime_version: "host-runtime-1.0.0",
      },
    },
    paths: {},
    repoRoot: process.cwd(),
    daemonLogPath: pathToLogFile("valid-payload"),
    eventType: "factory.lifecycle.tick",
    status: "completed",
    runId: "run-1",
    tickId: "tick-1",
    startedAt: "2026-03-16T18:00:00.000Z",
    endedAt: "2026-03-16T18:00:05.000Z",
    durationMs: 5000,
    incidentFingerprint: "sha256:test",
    extraFields: {
      tick_idle: "false",
    },
    readCurrentLeaseFn: () => ({
      ok: true,
      exists: true,
      lease: {
        instance_id: "fac_brainstorm_01",
        installation_id: "inst_fac_brainstorm_01_host-a",
        host_id: "host-a",
        runtime_version: "host-runtime-1.0.0",
      },
    }),
    emitOtelEventFn: (payload) => {
      emitted.push(payload);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(emitted.length, 1);
  const body = emitted[0].body;

  const tickRequired = MANAGED_FACTORY_TELEMETRY_EVENTS
    .find((entry) => entry.event === "factory.lifecycle.tick")
    ?.required_fields || [];

  for (const field of tickRequired) {
    const value = body[field];
    if (typeof value === "number") {
      assert.equal(Number.isFinite(value), true, `${field} should be numeric`);
    } else {
      assert.equal(String(value || "").trim().length > 0, true, `${field} should be populated`);
    }
  }

  assert.equal(body.event_type, "factory.lifecycle.tick");
  assert.equal(body.tick_idle, "false");
});

test("emitManagedLifecycleEvent derives inline-config policy profile for managed factories", () => {
  const emitted = [];

  const result = emitManagedLifecycleEvent({
    runtime: {
      factoryId: "example-trading",
      mutationContext: {
        instance_id: "example-trading",
        kind_id: "example-trading",
      },
      config: {
        kind_id: "example-trading",
        runtime_version: "host-runtime-1.0.0",
        provider: "openrouter",
        model: "openai/gpt-5.3-codex",
      },
    },
    paths: {},
    repoRoot: process.cwd(),
    daemonLogPath: pathToLogFile("inline-policy-profile"),
    eventType: "factory.lifecycle.tick",
    status: "completed",
    runId: "run-inline-policy",
    tickId: "tick-inline-policy",
    startedAt: "2026-03-27T21:56:42.000Z",
    endedAt: "2026-03-27T21:56:47.000Z",
    durationMs: 5000,
    extraFields: {
      tick_idle: "false",
    },
    readCurrentLeaseFn: () => ({
      ok: true,
      exists: true,
      lease: {
        instance_id: "example-trading",
        installation_id: "inst_example_trading_host-a",
        host_id: "host-a",
        runtime_version: "host-runtime-1.0.0",
      },
    }),
    emitOtelEventFn: (payload) => {
      emitted.push(payload);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].body.policy_profile, "inline-config:openrouter:openai/gpt-5.3-codex");
});
