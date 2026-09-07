import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseArgs, validateTestTopology } from "./check-test-topology.mjs";

function write(path, content = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "test-topology-"));
  write(join(dir, "config", "testing", "topology-enforcement.json"), JSON.stringify({
    schema: "hatch.test-topology.v1",
    allowed_test_prefixes: ["apps/hatch/src/", "packages/factory-ops/test/", "packages/factory-telemetry/src/", "scripts/"],
    allowed_fixture_prefixes: ["apps/hatch/src/", "packages/factory-ops/test/", "scripts/fixtures/", "scripts/test/"],
    fixture_directory_names: ["fixtures", "golden"],
  }, null, 2));
  return dir;
}

test("parseArgs reads repo-root, config, and modes", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--config", "foo.json", "--json"]), {
    repoRoot: "/tmp/repo",
    configPath: "foo.json",
    stagedFileList: "",
    allTracked: false,
    json: true,
  });
});

test("validateTestTopology accepts approved test placement", () => {
  const dir = createFixtureRepo();
  const result = validateTestTopology({
    repoRoot: dir,
    files: [
      "apps/hatch/src/pipeline/runtime/engine-node-timeout.contract.test.ts",
      "packages/factory-ops/test/scenarios/write-scenarios.contract.test.ts",
      "scripts/check-test-topology.unit.test.mjs",
    ],
  });
  assert.deepEqual(result, { ok: true, diagnostics: [], checked: 3, violations: 0 });
});

test("validateTestTopology rejects tests outside approved roots", () => {
  const dir = createFixtureRepo();
  const result = validateTestTopology({
    repoRoot: dir,
    files: [
      "misc/example.unit.test.ts",
      "packages/factory-ops/test/wave/wave-claim.contract.test.mjs",
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /test outside approved topology: misc\/example\.unit\.test\.ts/);
});
