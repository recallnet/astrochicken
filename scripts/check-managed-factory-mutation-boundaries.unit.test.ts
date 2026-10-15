import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateManagedFactoryMutationBoundaries } from "./check-managed-factory-mutation-boundaries.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-managed-factory-mutation-boundaries.ts");
const fixturesRoot = join(scriptsDir, "test", "fixtures", "managed-factory-mutation-boundaries");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

test("validateManagedFactoryMutationBoundaries accepts valid fixture", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("valid"),
    requireKinds: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.managedFactoryCount, 1);
  assert.equal(result.managedKindCount, 1);
  assert.equal(result.graphCount, 1);
  assert.equal(result.kindSource, "kind_json");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.telemetry,
    "[managed-factory-mutation-boundaries] result=ok managed_factory_count=1 managed_kind_count=1 graph_count=1 kind_source=kind_json",
  );
});

test("validateManagedFactoryMutationBoundaries fails when a managed graph mutates control_plane_repo", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("invalid-graph-control-plane-mutation"),
    requireKinds: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("control_plane_mutation_detected") && line.includes("node=mutate_control_plane")),
    true,
  );
  assert.equal(
    result.diagnostics.some((line) => line.includes("policy=disallowed_control_plane_mutation:git_push")),
    true,
  );
  assert.match(
    result.telemetry,
    /^\[managed-factory-mutation-boundaries\] result=fail diagnostics=\d+ managed_factory_count=1 managed_kind_count=1 graph_count=1 kind_source=kind_json$/,
  );
});

test("validateManagedFactoryMutationBoundaries fails when control_plane issue create misses required destination labels", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("invalid-control-plane-missing-labels"),
    requireKinds: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("control_plane_mutation_detected") && line.includes("node=mutate_control_plane_missing_labels")),
    true,
  );
  assert.equal(
    result.diagnostics.some((line) => line.includes("policy=destination_issue_create_missing_required_labels")),
    true,
  );
});

test("validateManagedFactoryMutationBoundaries fails when kind:<kind_id> label is missing", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("invalid-missing-kind-label"),
    requireKinds: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("missing_required_label") && line.includes("label=kind:brainstorm")),
    true,
  );
});

test("validateManagedFactoryMutationBoundaries fails when graph mutates target_repo outside status-only flow", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("invalid-target-repo-mutation"),
    requireKinds: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("target_repo_mutation_detected") && line.includes("node=mutate_target_repo")),
    true,
  );
  assert.equal(
    result.diagnostics.some((line) => line.includes("policy=disallowed_target_repo_mutation:issue_create")),
    true,
  );
});

test("validateManagedFactoryMutationBoundaries validates golden mutation fixture contract", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("valid"),
    requireKinds: true,
  });

  assert.equal(
    result.diagnostics.some((line) => line.includes("missing_expected_golden_violation") || line.includes("unexpected_golden_violation_shape")),
    false,
  );
});

test("validateManagedFactoryMutationBoundaries fails when incident fingerprint field is missing", async () => {
  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: fixtureRoot("invalid-missing-fingerprint-field"),
    requireKinds: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("missing_fingerprint_field") && line.includes("field=signature_hash")),
    true,
  );
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("valid"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout.trim(),
    "[managed-factory-mutation-boundaries] result=ok managed_factory_count=1 managed_kind_count=1 graph_count=1 kind_source=kind_json",
  );
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic fail telemetry and diagnostics", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-control-plane-missing-labels"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /control_plane_mutation_detected file=.*factory_supervisor_tick\.dot node=mutate_control_plane_missing_labels attr=prompt/);
  assert.match(run.stderr, /policy=destination_issue_create_missing_required_labels/);
  assert.match(
    run.stderr,
    /^.*\[managed-factory-mutation-boundaries\] result=fail diagnostics=\d+ managed_factory_count=1 managed_kind_count=1 graph_count=1 kind_source=kind_json\n?$/m,
  );
});
