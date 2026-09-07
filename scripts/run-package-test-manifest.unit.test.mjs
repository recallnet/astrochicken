import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  resolveSuiteCommand,
  resolveSuite,
  runManifestSuite,
} from "./run-package-test-manifest.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(scriptsDir, "run-package-test-manifest.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "run-package-test-manifest-"));
  writeJson(join(dir, "config", "testing", "package-test-manifests", "fixture.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "fixture",
    package_path: ".",
    default_suite: "pass",
    suites: [
      {
        name: "pass",
        runner: "node",
        working_directory: ".",
        entrypoints: ["fixture"],
        command: "node -e \"process.exit(0)\"",
      },
      {
        name: "fail",
        runner: "node",
        working_directory: ".",
        entrypoints: ["fixture"],
        command: "node -e \"process.exit(9)\"",
      },
    ],
  });
  return dir;
}

test("parseArgs reads manifest and suite", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--manifest", "x.json", "--suite", "default", "a.test.ts"]), {
    repoRoot: "/tmp/repo",
    manifest: "x.json",
    suite: "default",
    extraArgs: ["a.test.ts"],
  });
});

test("resolveSuite selects explicit or default suites", () => {
  const manifest = {
    default_suite: "default",
    package_name: "fixture",
    suites: [{ name: "default" }, { name: "other" }],
  };
  assert.equal(resolveSuite(manifest, "").name, "default");
  assert.equal(resolveSuite(manifest, "other").name, "other");
  assert.throws(() => resolveSuite(manifest, "missing"), /suite "missing" not found/);
});

test("resolveSuiteCommand prefixes vitest suites with pnpm exec", () => {
  assert.equal(
    resolveSuiteCommand(
      { runner: "vitest", command: "vitest --run --reporter=dot" },
      ["src/example.test.ts"],
    ),
    "pnpm exec vitest --run --reporter=dot 'src/example.test.ts'",
  );
  assert.equal(
    resolveSuiteCommand(
      { runner: "node", command: "node -e \"process.exit(0)\"" },
      [],
    ),
    "node -e \"process.exit(0)\"",
  );
  assert.equal(
    resolveSuiteCommand(
      { runner: "vitest", command: "pnpm exec vitest --run" },
      [],
    ),
    "pnpm exec vitest --run",
  );
});

test("runManifestSuite returns the suite exit code", () => {
  const dir = createFixtureRepo();
  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/package-test-manifests/fixture.json",
    suiteName: "pass",
  }), 0);
  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/package-test-manifests/fixture.json",
    suiteName: "fail",
  }), 9);
});

test("CLI executes the default suite", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [runnerPath, "--repo-root", dir, "--manifest", "config/testing/package-test-manifests/fixture.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
});

test("runManifestSuite appends extra args to the suite command", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-package-test-manifest-extra-"));
  writeJson(join(dir, "config", "testing", "package-test-manifests", "fixture.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "fixture",
    package_path: ".",
    default_suite: "record",
    suites: [
      {
        name: "record",
        runner: "node",
        working_directory: ".",
        entrypoints: ["fixture"],
        command: "node -e \"process.stdout.write(process.argv.slice(1).join(','))\"",
      },
    ],
  });

  const out = spawnSync("node", [
    runnerPath,
    "--repo-root",
    dir,
    "--manifest",
    "config/testing/package-test-manifests/fixture.json",
    "alpha.test.ts",
    "beta.test.ts",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /alpha\.test\.ts,beta\.test\.ts/);
});

test("runManifestSuite bootstraps required runtime directories before execution", () => {
  const dir = createFixtureRepo();
  assert.equal(existsSync(join(dir, "apps", "hatch", "coverage", ".tmp")), false);

  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/package-test-manifests/fixture.json",
    suiteName: "pass",
  }), 0);

  assert.equal(existsSync(join(dir, "apps", "hatch", "coverage", ".tmp")), true);
});
