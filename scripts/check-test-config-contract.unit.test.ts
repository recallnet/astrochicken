import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  REQUIRED_CONFIGS,
  validateTestingConfig,
} from "./check-test-config-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-test-config-contract.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createValidFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "test-config-contract-"));
  mkdirSync(join(dir, "config", "testing", "package-test-manifests"), { recursive: true });
  writeJson(join(dir, "config", "testing", "test-taxonomy.json"), {
    schema: "hatch.test-taxonomy.v1",
    allowed_categories: ["unit", "contract", "integration", "regressions"],
    naming: {
      required_class_suffixes: [".unit.test.", ".contract.test."],
      forbidden_new_generic_names: ["misc.test."],
    },
  });
  writeJson(join(dir, "config", "testing", "subsystem-ownership.json"), {
    schema: "hatch.subsystem-ownership.v1",
    scan_roots: [],
    owners: [],
    path_rules: [],
  });
  writeJson(join(dir, "config", "testing", "shared-surface-ownership.json"), {
    schema: "hatch.shared-surface-ownership.v1",
    scan_roots: [],
    surfaces: [],
  });
  writeJson(join(dir, "config", "testing", "suite-routing.json"), {
    schema: "hatch.suite-routing.v1",
    routes: [{ pattern: "*", bucket: "neither_change" }],
    bucket_suites: {
      guard_only: ["test:guard-gates"],
      wave_claim_only: ["test:wave-claim-gates"],
      all_suites: ["test:guard-gates", "test:wave-claim-gates"],
      platform_invariant_trigger: [],
      neither_change: [],
    },
    selection_matrix: [
      { bucket_key: "neither_change", selected_bucket: "neither_change", reason: "bucket_neither_change" },
    ],
  });
  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    required_owner_ids: ["repo.testing_infra"],
    specs: [],
  });
  writeJson(join(dir, "config", "testing", "topology-enforcement.json"), {
    schema: "hatch.test-topology.v1",
    allowed_test_prefixes: ["apps/hatch/src/", "scripts/"],
    allowed_fixture_prefixes: ["apps/hatch/src/", "scripts/fixtures/", "scripts/test/"],
    fixture_directory_names: ["fixtures", "golden"],
  });
  writeJson(join(dir, "config", "testing", "hook-profiles.json"), {
    schema: "hatch.hook-profiles.v1",
    profiles: {
      fast: { description: "fast", suite_selectors: [] },
      strict: { description: "strict", suite_selectors: [] },
      full: { description: "full", suite_selectors: [] },
    },
  });
  return dir;
}

test("parseArgs reads repo-root and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--json"]), {
    repoRoot: "/tmp/repo",
    json: true,
  });
  assert.deepEqual(parseArgs([]), {
    repoRoot: process.cwd(),
    json: false,
  });
});

test("REQUIRED_CONFIGS declares the canonical config contract", () => {
  assert.deepEqual(
    REQUIRED_CONFIGS.map((entry) => entry.relativePath),
    [
      "config/testing/test-taxonomy.json",
      "config/testing/subsystem-ownership.json",
      "config/testing/shared-surface-ownership.json",
      "config/testing/suite-routing.json",
      "config/testing/spec-registry.json",
      "config/testing/topology-enforcement.json",
      "config/testing/hook-profiles.json",
    ],
  );
});

test("validateTestingConfig accepts the canonical fixture shape", () => {
  const dir = createValidFixtureRepo();
  assert.deepEqual(validateTestingConfig({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    config_count: 7,
    manifest_entries: 0,
  });
});

test("validateTestingConfig fails closed on missing files and malformed shapes", () => {
  const dir = createValidFixtureRepo();
  writeJson(join(dir, "config", "testing", "test-taxonomy.json"), {
    schema: "wrong.schema",
    allowed_categories: ["unit"],
    naming: {
      required_class_suffixes: [],
      forbidden_new_generic_names: [],
    },
  });

  const result = validateTestingConfig({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /test-taxonomy\.json\.schema must be "hatch\.test-taxonomy\.v1"/);
  assert.match(result.diagnostics.join("\n"), /allowed_categories must include "contract"/);
});

test("CLI emits telemetry and JSON for a valid repo", () => {
  const dir = createValidFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\[test_config_contract\] result=ok configs=7 manifests=0 errors=0/);
  assert.match(out.stdout, /"ok":true/);
});

test("CLI fails for a missing config root", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-config-contract-missing-"));
  const out = spawnSync("node", [checkerPath, "--repo-root", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(out.status, 0);
  assert.match(out.stdout, /\[test_config_contract\] result=fail/);
});
