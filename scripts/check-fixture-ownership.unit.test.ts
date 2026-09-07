import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { filterExistingStagedPaths, parseArgs, validateFixtureOwnership } from "./check-fixture-ownership.ts";

function write(path, content = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fixture-ownership-"));
  write(join(dir, "config", "testing", "topology-enforcement.json"), JSON.stringify({
    schema: "hatch.test-topology.v1",
    allowed_test_prefixes: ["apps/hatch/src/", "packages/factory-ops/test/", "packages/factory-telemetry/src/", "scripts/"],
    allowed_fixture_prefixes: ["apps/hatch/src/", "packages/factory-ops/test/", "scripts/fixtures/", "scripts/test/"],
    fixture_directory_names: ["fixtures", "golden"],
  }, null, 2));
  write(join(dir, "config", "testing", "subsystem-ownership.json"), JSON.stringify({
    schema: "hatch.subsystem-ownership.v1",
    scan_roots: [],
    owners: [
      { id: "hatch.runtime", package: "hatch", subsystem: "runtime", description: "Runtime" },
      { id: "factory_ops.supervisor", package: "@hatch/factory-ops", subsystem: "supervisor", description: "Supervisor" },
      { id: "repo.testing_infra", package: "repo", subsystem: "testing_infra", description: "Testing infra" },
    ],
    path_rules: [
      { path_prefix: "apps/hatch/src/", owner_id: "hatch.runtime" },
      { path_prefix: "packages/factory-ops/test/supervisor/", owner_id: "factory_ops.supervisor" },
      { path_prefix: "scripts/fixtures/", owner_id: "repo.testing_infra" },
      { path_prefix: "scripts/test/fixtures/", owner_id: "repo.testing_infra" },
      { path_prefix: "scripts/test/golden/", owner_id: "repo.testing_infra" },
    ],
  }, null, 2));
  return dir;
}

test("parseArgs reads repo-root and config paths", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--config", "topology.json", "--ownership", "owners.json", "--json"]), {
    repoRoot: "/tmp/repo",
    topologyConfigPath: "topology.json",
    ownershipConfigPath: "owners.json",
    stagedFileList: "",
    allTracked: false,
    json: true,
  });
});

test("validateFixtureOwnership accepts owned fixture paths", () => {
  const dir = createFixtureRepo();
  const result = validateFixtureOwnership({
    repoRoot: dir,
    files: [
      "apps/hatch/src/pipeline/fixtures/example.json",
      "packages/factory-ops/test/supervisor/fixtures/status.json",
      "scripts/test/golden/pre-commit/output.txt",
    ],
  });
  assert.deepEqual(result, { ok: true, diagnostics: [], checked: 3, violations: 0 });
});

test("validateFixtureOwnership rejects stray fixture placement", () => {
  const dir = createFixtureRepo();
  const result = validateFixtureOwnership({
    repoRoot: dir,
    files: [
      "misc/fixtures/example.json",
      "packages/factory-ops/test/merge/fixtures/state.json",
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /fixture outside approved ownership roots: misc\/fixtures\/example\.json/);
  assert.match(result.diagnostics.join("\n"), /fixture without deterministic owner: packages\/factory-ops\/test\/merge\/fixtures\/state\.json/);
});

test("validateFixtureOwnership rejects fixture roots under factories outside scaffold conformance", () => {
  const dir = createFixtureRepo();
  const result = validateFixtureOwnership({
    repoRoot: dir,
    files: [
      "factories/astrochicken-fixtures/ops/test/fixtures/state.json",
      "factories/_templates/factory/conformance/fixtures/valid.json",
    ],
  });
  assert.equal(result.ok, false);
  assert.match(
    result.diagnostics.join("\n"),
    /factory fixture roots are forbidden outside scaffold conformance template: factories\/astrochicken-fixtures\/ops\/test\/fixtures\/state\.json/,
  );
});

test("validateFixtureOwnership ignores deleted staged fixture paths that no longer exist", () => {
  const dir = createFixtureRepo();
  write(join(dir, "packages", "factory-ops", "test", "fixtures", "present-fixture.json"), "{}");
  const result = filterExistingStagedPaths([
    "packages/factory-ops/test/fixtures/deleted-fixture.json",
    "packages/factory-ops/test/fixtures/present-fixture.json",
  ], {
    repoRoot: dir,
  });
  assert.deepEqual(result, ["packages/factory-ops/test/fixtures/present-fixture.json"]);
});
