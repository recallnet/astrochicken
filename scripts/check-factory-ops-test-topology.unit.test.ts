import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseArgs, validateFactoryOpsTestTopology } from "./check-factory-ops-test-topology.ts";

function write(path, content = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "factory-ops-topology-"));
  write(join(dir, "packages", "factory-ops", "test", ".coverage-baseline.json"), "{}\n");
  for (const subdir of ["commands", "packets", "merge", "wave", "scenarios", "supervisor", "leases", "shared"]) {
    mkdirSync(join(dir, "packages", "factory-ops", "test", subdir), { recursive: true });
  }
  return dir;
}

test("parseArgs reads repo-root and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--json"]), { repoRoot: "/tmp/repo", json: true });
});

test("validateFactoryOpsTestTopology accepts the subsystem-first layout", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(validateFactoryOpsTestTopology({ repoRoot: dir }), { ok: true, diagnostics: [], checked_entries: 9 });
});

test("validateFactoryOpsTestTopology rejects legacy root test files", () => {
  const dir = createFixtureRepo();
  write(join(dir, "packages", "factory-ops", "test", "flat.test.mjs"), 'import test from "node:test";\n');
  const result = validateFactoryOpsTestTopology({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unexpected top-level file/);
});

test("validateFactoryOpsTestTopology rejects legacy fixture buckets", () => {
  const dir = createFixtureRepo();
  mkdirSync(join(dir, "packages", "factory-ops", "test", "fixtures"), { recursive: true });
  const result = validateFactoryOpsTestTopology({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /forbidden legacy top-level directory/);
});
