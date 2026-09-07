import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { factoryFleetStatus } from "../../src/commands/factory-fleet-status.ts";

test("fleet cutover: command surface reads canonical Postgres projection", async () => {
  const calls = [];
  const projection = {
    generated_at: "2026-03-26T20:00:00.000Z",
    fleet_totals: { total_factories: 1 },
    kpis: { factories_reporting: 1 },
    warnings: [],
    factories: [{ factory_id: "mothership", health: "healthy" }],
  };

  const report = await factoryFleetStatus({
    context: {
      factory_id: "mothership",
      runs_dir: "/tmp/mothership/runs",
      canonical_event_store_url: "postgres://fixture/fleet",
    },
    registryPath: "/tmp/factory-registry.json",
    now: Date.parse("2026-03-26T20:00:00.000Z"),
    resolveCanonicalEventStoreUrlFn: ({ surface }) => {
      calls.push({ type: "resolve", surface });
      return "postgres://fixture/fleet";
    },
    projectFactoryFleetToPostgresFn: async (args) => {
      calls.push({ type: "project", connectionString: args.connectionString, registryPath: args.registryPath });
      return { projection_scope: "global", after_commit_cursor: 42, projection };
    },
    readFactoryFleetProjectionFn: async ({ connectionString }) => {
      calls.push({ type: "read", connectionString });
      return { projection_scope: "global", after_commit_cursor: 42, projection };
    },
    readLatestCanonicalEventCursorFn: async ({ connectionString }) => {
      calls.push({ type: "cursor", connectionString });
      return 99;
    },
  });

  assert.equal(report, projection);
  assert.deepEqual(calls, [
    { type: "resolve", surface: "canonical fleet projection" },
    { type: "read", connectionString: "postgres://fixture/fleet" },
    { type: "cursor", connectionString: "postgres://fixture/fleet" },
    { type: "project", connectionString: "postgres://fixture/fleet", registryPath: "/tmp/factory-registry.json" },
    { type: "read", connectionString: "postgres://fixture/fleet" },
  ]);
});

test("fleet cutover: command surface reuses current persisted projection before reprojecting", async () => {
  const calls = [];
  const projection = {
    generated_at: "2026-03-31T17:00:00.000Z",
    fleet_totals: { total_factories: 1 },
    kpis: { factories_reporting: 1 },
    warnings: [],
    factories: [{ factory_id: "example-trading", health: "healthy" }],
  };

  const report = await factoryFleetStatus({
    context: {
      factory_id: "example-trading",
      runs_dir: "/tmp/example-trading/runs",
      canonical_event_store_url: "postgres://fixture/fleet",
    },
    registryPath: "/tmp/factory-registry.json",
    resolveCanonicalEventStoreUrlFn: ({ surface }) => {
      calls.push({ type: "resolve", surface });
      return "postgres://fixture/fleet";
    },
    readFactoryFleetProjectionFn: async ({ connectionString, projectionScope }) => {
      calls.push({ type: "read", connectionString, projectionScope });
      return { projection_scope: "global", after_commit_cursor: 42, projection };
    },
    readLatestCanonicalEventCursorFn: async ({ connectionString }) => {
      calls.push({ type: "cursor", connectionString });
      return 42;
    },
    projectFactoryFleetToPostgresFn: async () => {
      throw new Error("should not reproject current fleet state");
    },
  });

  assert.equal(report, projection);
  assert.deepEqual(calls, [
    { type: "resolve", surface: "canonical fleet projection" },
    { type: "read", connectionString: "postgres://fixture/fleet", projectionScope: "global" },
    { type: "cursor", connectionString: "postgres://fixture/fleet" },
  ]);
});

test("fleet cutover: src no longer imports deleted fleet truth reader", () => {
  const files = [
    "packages/factory-ops/src/commands/factory-fleet-status.ts",
    "packages/factory-ops/src/commands/factory-release-targeting-status.ts",
    "packages/factory-ops/src/commands/fleet-report.ts",
    "packages/factory-ops/src/cli/commands/factory-status-cmds.ts",
    "packages/factory-ops/src/lib/factory-state-reader.ts",
    "packages/factory-ops/src/lib/factory-fleet-bootstrap-snapshot.ts",
    "packages/factory-ops/src/lib/factory-row-collector-worker.ts",
    "packages/factory-ops/src/lib/factory-row-collector-worker-pooled.ts",
    "packages/factory-ops/src/lib/factory-fleet-postgres-projection.ts",
  ];

  for (const relativePath of files) {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    assert.equal(
      source.includes("factory-state-fleet-projection.mjs"),
      false,
      `${relativePath} should not import the deleted fleet truth reader`,
    );
  }
});
