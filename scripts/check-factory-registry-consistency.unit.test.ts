import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateFactoryRegistryConsistency } from "./check-factory-registry-consistency.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-factory-registry-consistency.mjs");
const fixturesRoot = join(scriptsDir, "test", "fixtures", "managed-factory-registry");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

test("validateFactoryRegistryConsistency accepts valid registry fixture", () => {
  const result = validateFactoryRegistryConsistency({ manifestsRoot: fixtureRoot("valid"), requireInstances: true });

  assert.equal(result.ok, true);
  assert.equal(result.kindCount, 1);
  assert.equal(result.instanceCount, 1);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.telemetry, "[factory-registry-consistency] result=ok kind_count=1 instance_count=1");
});

test("validateFactoryRegistryConsistency fails when registry references unknown kind", () => {
  const result = validateFactoryRegistryConsistency({ manifestsRoot: fixtureRoot("invalid-missing-kind"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("unknown_kind_id") && line.includes("kind_id=brainstorm")), true);
  assert.match(result.telemetry, /^\[factory-registry-consistency\] result=fail diagnostics=\d+ kind_count=0 instance_count=1$/);
});

test("validateFactoryRegistryConsistency fails when instance_id is duplicated", () => {
  const result = validateFactoryRegistryConsistency({ manifestsRoot: fixtureRoot("invalid-duplicate-instance-id"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("duplicate_instance_id") && line.includes("instance_id=fac_registry_duplicate")), true);
});

test("validateFactoryRegistryConsistency fails when status is outside allowed enum", () => {
  const result = validateFactoryRegistryConsistency({ manifestsRoot: fixtureRoot("invalid-status-value"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("invalid_status") && line.includes("status=sleeping")), true);
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("valid"), "--require-instances"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[factory-registry-consistency] result=ok kind_count=1 instance_count=1");
  assert.equal(run.stderr.trim(), "");
});

test("CLI defaults to compatibility mode for legacy factories[] registry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", join(scriptsDir, "test", "fixtures", "managed-factory-configs", "legacy-registry-factories-only")], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[factory-registry-consistency] result=ok kind_count=0 instance_count=0");
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic fail telemetry and diagnostics", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-status-value"), "--require-instances"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /invalid_status file=.*factory-registry\.json entry=instances\[0\] status=sleeping/);
  assert.match(run.stderr, /^.*\[factory-registry-consistency\] result=fail diagnostics=\d+ kind_count=1 instance_count=1\n?$/m);
});
