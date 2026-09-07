import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  REQUIRED_PACKAGE_MANIFESTS,
  validateManifestCollection,
  validatePackageManifest,
} from "./check-test-manifest-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-test-manifest-contract.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "test-manifest-contract-"));
  writeJson(join(dir, "config", "testing", "package-test-manifests", "apps-hatch.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "hatch",
    package_path: "apps/hatch",
    default_suite: "default",
    suites: [
      {
        name: "default",
        runner: "vitest",
        working_directory: "apps/hatch",
        entrypoints: ["src/**/*.test.ts"],
        command: "vitest --run --passWithNoTests --reporter=dot",
      },
      {
        name: "guard-gates",
        runner: "vitest",
        working_directory: "apps/hatch",
        entrypoints: ["src/**/*.test.ts"],
        command: "vitest --run --coverage --coverage.reporter=text-summary --reporter=dot",
      },
    ],
  });
  writeJson(join(dir, "config", "testing", "package-test-manifests", "packages-factory-ops.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "@hatch/factory-ops",
    package_path: "packages/factory-ops",
    default_suite: "default",
    suites: [
      {
        name: "default",
        runner: "node:test",
        working_directory: ".",
        entrypoints: [
          "packages/factory-ops/test/commands",
          "packages/factory-ops/test/packets",
          "packages/factory-ops/test/merge",
          "packages/factory-ops/test/wave",
          "packages/factory-ops/test/scenarios",
          "packages/factory-ops/test/supervisor",
          "packages/factory-ops/test/leases",
          "packages/factory-ops/test/shared"
        ],
        command: "node --test --test-reporter=dot $(find packages/factory-ops/test -mindepth 2 -type f -name '*.test.mjs' | sort)",
      },
      {
        name: "wave-claim-gates",
        runner: "node:test+c8",
        working_directory: ".",
        entrypoints: [
          "packages/factory-ops/test/commands",
          "packages/factory-ops/test/packets",
          "packages/factory-ops/test/merge",
          "packages/factory-ops/test/wave",
          "packages/factory-ops/test/scenarios",
          "packages/factory-ops/test/supervisor",
          "packages/factory-ops/test/leases",
          "packages/factory-ops/test/shared"
        ],
        command: "node scripts/run-c8-with-temp-dir.mjs --all --src packages/factory-ops/src --reporter=text-summary --reporter=lcov --check-coverage --statements 57 --lines 57 --functions 55 --branches 61 node --max-old-space-size=8192 --test --test-reporter=dot $(find packages/factory-ops/test -mindepth 2 -type f -name '*.test.mjs' | sort)",
        coverage_policy: {
          src: ["packages/factory-ops/src"],
          exclude: ["packages/factory-ops/src/generated/**"],
          thresholds: { statements: 57, lines: 57, functions: 55, branches: 61 },
        },
      },
    ],
  });
  writeJson(join(dir, "config", "testing", "package-test-manifests", "packages-factory-telemetry.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "@recallnet/factory-telemetry",
    package_path: "packages/factory-telemetry",
    default_suite: "default",
    suites: [
      {
        name: "default",
        runner: "vitest",
        working_directory: "packages/factory-telemetry",
        entrypoints: ["src/**/*.test.ts"],
        command: "vitest --run --passWithNoTests --reporter=dot",
      },
    ],
  });
  return dir;
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
