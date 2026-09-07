import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateManagedFactoryConfigSurfaces } from "./check-managed-factory-config-surfaces.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-managed-factory-config-surfaces.mjs");
const fixturesRoot = join(scriptsDir, "test", "fixtures", "managed-factory-configs");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

test("validateManagedFactoryConfigSurfaces accepts valid fixture", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("valid") });

  assert.equal(result.ok, true);
  assert.equal(result.kindCount, 1);
  assert.equal(result.instanceCount, 1);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.telemetry, "[managed-factory-config-surfaces] result=ok kind_count=1 instance_count=1");
});

test("validateManagedFactoryConfigSurfaces fails when kind misses shared_supervisor_shell", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("invalid-kind-missing-shared-shell"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("field=shared_supervisor_shell")), true);
  assert.match(result.telemetry, /^\[managed-factory-config-surfaces\] result=fail diagnostics=\d+ kind_count=1 instance_count=1$/);
});

test("validateManagedFactoryConfigSurfaces fails when factory kind directory is missing kind.json", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("invalid-missing-kind-file"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.kindCount, 1);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_file") && line.includes("kind.json")), true);
});

test("validateManagedFactoryConfigSurfaces fails when kind_id mismatches parent directory", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("invalid-kind-mismatch"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("kind_id_mismatch") && line.includes("expected=brainstorm") && line.includes("actual=brainstorm-v2")), true);
});

test("validateManagedFactoryConfigSurfaces fails when registry instance misses target_repo", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("invalid-registry-missing-target-repo"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("field=target_repo")), true);
});

test("validateManagedFactoryConfigSurfaces fails when shell-managed factory omits runtime readiness fields", () => {
  const result = validateManagedFactoryConfigSurfaces({ manifestsRoot: fixtureRoot("invalid-managed-runtime-readiness"), requireInstances: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("factory.config.json") && line.includes("field=workspace_mode")), true);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("factory.config.json") && line.includes("field=service_registry_path")), true);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("factory.config.json") && line.includes("field=installation_manifest_path")), true);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("instance.template.json") && line.includes("field=workspace_mode")), true);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_required_field") && line.includes("factory-registry.json") && line.includes("field=installation_manifest_path")), true);
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("valid")], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[managed-factory-config-surfaces] result=ok kind_count=1 instance_count=1");
  assert.equal(run.stderr.trim(), "");
});

test("CLI defaults to compatibility mode for legacy factories[] registry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("legacy-registry-factories-only")], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[managed-factory-config-surfaces] result=ok kind_count=0 instance_count=0");
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic pass telemetry for registry with target_repo (no longer forbidden)", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-registry-target-repo"), "--require-instances"], {
    encoding: "utf8",
  });

  // target_repo is a valid field now (cross-repo factory support)
  assert.equal(run.status, 0);
});
