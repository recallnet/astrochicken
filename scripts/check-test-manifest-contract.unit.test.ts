import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJsonFixtureRepo } from "./test/helpers/json-fixture-repo.ts";

import {
  parseArgs,
  REQUIRED_PACKAGE_MANIFESTS,
  validateManifestCollection,
  validatePackageManifest,
} from "./check-test-manifest-contract.ts";

const scriptsDir = import.meta.dirname;
const checkerPath = join(scriptsDir, "check-test-manifest-contract.ts");
const repoRoot = resolve(scriptsDir, "..");

function packageManifestFixture(packageName, packagePath, suites) {
  return { schema: "hatch.package-test-manifest.v1", package_name: packageName, package_path: packagePath, default_suite: "default", suites };
}

function vitestSuiteFixture(name, workingDirectory, command) {
  return { name, runner: "vitest", working_directory: workingDirectory, entrypoints: ["src/**/*.test.ts"], command };
}

function opsSuiteFixture(overrides) {
  return {
    working_directory: ".",
    entrypoints: ["commands", "packets", "merge", "wave", "scenarios", "supervisor", "leases", "shared"].map((name) => `packages/factory-ops/test/${name}`),
    ...overrides,
  };
}

function createFixtureRepo() {
  return createJsonFixtureRepo({
"config/testing/package-test-manifests/apps-hatch.json": packageManifestFixture("hatch", "apps/hatch", [
vitestSuiteFixture("default", "apps/hatch", "vitest --run --passWithNoTests --reporter=dot"),
vitestSuiteFixture("guard-gates", "apps/hatch", "vitest --run --coverage --coverage.reporter=text-summary --reporter=dot")
]),
"config/testing/package-test-manifests/packages-factory-ops.json": packageManifestFixture("@hatch/factory-ops", "packages/factory-ops", [
opsSuiteFixture({ name: "default", runner: "node:test", command: "node --test --test-reporter=dot $(find packages/factory-ops/test -mindepth 2 -type f -name '*.test.mjs' | sort)" }),
opsSuiteFixture({ name: "wave-claim-gates", runner: "node:test+c8", command: "node scripts/run-c8-with-temp-dir.mjs --all --src packages/factory-ops/src --reporter=text-summary --reporter=lcov --check-coverage --statements 57 --lines 57 --functions 55 --branches 61 node --max-old-space-size=8192 --test --test-reporter=dot $(find packages/factory-ops/test -mindepth 2 -type f -name '*.test.mjs' | sort)", coverage_policy: {
          src: ["packages/factory-ops/src"],
          exclude: ["packages/factory-ops/src/generated/**"],
          thresholds: { statements: 57, lines: 57, functions: 55, branches: 61 },
        } })
]),
"config/testing/package-test-manifests/packages-factory-telemetry.json": packageManifestFixture("@recallnet/factory-telemetry", "packages/factory-telemetry", [
vitestSuiteFixture("default", "packages/factory-telemetry", "vitest --run --passWithNoTests --reporter=dot")
])
  }, { prefix: "test-manifest-contract-" });
}

test("parseArgs reads repo-root, manifest, and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--manifest", "x.json", "--json"]), {
    repoRoot: "/tmp/repo",
    manifest: "x.json",
    json: true,
  });
});

test("required manifest list is deterministic", () => {
  assert.deepEqual(
    REQUIRED_PACKAGE_MANIFESTS.map((entry) => entry.relativePath),
    [
      "config/testing/package-test-manifests/apps-hatch.json",
      "config/testing/package-test-manifests/packages-factory-ops.json",
      "config/testing/package-test-manifests/packages-factory-telemetry.json",
    ],
  );
});

test("validatePackageManifest rejects malformed suites", () => {
  const diagnostics = validatePackageManifest({
    schema: "wrong.schema",
    package_name: "hatch",
    package_path: "apps/hatch",
    default_suite: "default",
    suites: [{ name: "default" }],
  }, {
    packageName: "hatch",
    packagePath: "apps/hatch",
  });

  assert.match(diagnostics.join("\n"), /schema must be "hatch\.package-test-manifest\.v1"/);
  assert.match(diagnostics.join("\n"), /suites\[0\]\.runner must be a non-empty string/);
});

test("validateManifestCollection accepts the canonical manifest set", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(validateManifestCollection({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    manifest_count: 3,
    suite_count: 5,
    manifest_entries: 3,
  });
});

test("CLI emits telemetry and json", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\[test_manifest_contract\] result=ok manifests=3 suites=5 errors=0/);
  assert.match(out.stdout, /"ok":true/);
});
