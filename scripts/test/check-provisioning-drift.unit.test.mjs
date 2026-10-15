import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runProvisioningDriftCheck } from "../../packages/factory-ops/src/lib/factory-provisioning-drift.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const driftScriptPath = join(repoRoot, "scripts", "check-provisioning-drift.ts");
const fixtureRoot = join(repoRoot, "scripts", "test", "fixtures", "provisioning-drift");

function fixturePath(...segments) {
  return join(fixtureRoot, ...segments);
}

test("runProvisioningDriftCheck reports compliant fixture as pass", () => {
  const out = runProvisioningDriftCheck({
    all: true,
    registryPath: resolve(fixturePath("factory-registry.json")),
    repoRoot,
    targetRepoMapJsonPath: resolve(fixturePath("home-repos.json")),
    labelsJsonPath: resolve(fixturePath("labels.compliant.json")),
    cwd: fixtureRoot,
  });

  assert.equal(out.ok, true);
  assert.equal(out.checked_count, 3);
  assert.equal(out.drifted_count, 0);
  assert.equal(out.entries.every((entry) => entry.ok === true && entry.drifted === false), true);
});

test("runProvisioningDriftCheck reports drift when labels/templates/manifest diverge", () => {
  const out = runProvisioningDriftCheck({
    all: true,
    registryPath: resolve(fixturePath("factory-registry.json")),
    repoRoot,
    targetRepoMapJsonPath: resolve(fixturePath("home-repos.json")),
    labelsJsonPath: resolve(fixturePath("labels.drifted.json")),
    cwd: fixtureRoot,
  });

  assert.equal(out.ok, false);
  assert.equal(out.checked_count, 3);
  assert.equal(out.drifted_count, 1);

  const exampleTrading = out.entries.find((entry) => entry.instance_id === "example-trading");
  assert.ok(exampleTrading, "expected example-trading entry");
  assert.equal(exampleTrading.drifted, true);
  assert.deepEqual(exampleTrading.missing_labels, ["factory:example-trading"]);
});

test("check-provisioning-drift script exits non-zero and emits report JSON for drift", () => {
  const run = spawnSync("node", [
    driftScriptPath,
    "--all",
    "--registry-path",
    resolve(fixturePath("factory-registry.json")),
    "--repo-root",
    repoRoot,
    "--target-repo-map-json",
    resolve(fixturePath("home-repos.json")),
    "--labels-json-path",
    resolve(fixturePath("labels.drifted.json")),
    "--json",
  ], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.equal(run.stderr.trim(), "");
  const outputLines = String(run.stdout || "").trim().split("\n").filter(Boolean);
  const payload = JSON.parse(outputLines[0] || "{}");
  assert.equal(payload.ok, false);
  assert.equal(payload.drifted_count, 1);
  assert.equal(outputLines[1], "[provisioning-drift] result=fail checked=3 drifted=1");
});
