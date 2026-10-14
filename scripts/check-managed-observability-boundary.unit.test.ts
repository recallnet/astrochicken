import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateManagedObservabilityBoundary } from "./check-managed-observability-boundary.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-managed-observability-boundary.ts");

function readFixture(pathParts) {
  return readFileSync(join(process.cwd(), ...pathParts), "utf8");
}

function withTempFixture(mutator) {
  const root = mkdtempSync(join(tmpdir(), "managed-observability-boundary-"));
  const fixturesRoot = join(root, "scripts", "fixtures", "managed-factory-observability-boundary");

  mkdirSync(fixturesRoot, { recursive: true });

  const contractJson = readFixture(["scripts", "fixtures", "managed-factory-observability-boundary", "contract.json"]);
  const summaryJson = readFixture(["scripts", "fixtures", "managed-factory-observability-boundary", "summary.json"]);

  writeFileSync(join(fixturesRoot, "contract.json"), contractJson, "utf8");

  const parsedSummary = JSON.parse(summaryJson);
  const mutatedSummary = mutator(parsedSummary);
  writeFileSync(join(fixturesRoot, "summary.json"), JSON.stringify(mutatedSummary, null, 2), "utf8");

  return root;
}

test("validateManagedObservabilityBoundary accepts canonical fixture", () => {
  const out = validateManagedObservabilityBoundary();
  assert.equal(out.ok, true);
  assert.deepEqual(out.diagnostics, []);
  assert.equal(out.telemetry, "[managed-observability-boundary-contract] result=ok violations=0");
});

test("CLI emits fail telemetry when forbidden key is introduced", () => {
  const tempRoot = withTempFixture((summary) => ({
    ...summary,
    domain_result: { leaked: true },
  }));

  try {
    const run = spawnSync("node", [checkerPath, "--manifests", tempRoot], {
      encoding: "utf8",
    });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /forbidden_key path=domain_result/);
    assert.match(run.stderr, /\[managed-observability-boundary-contract\] result=fail violations=\d+/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
