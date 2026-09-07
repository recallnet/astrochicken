import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runManifestSuite } from "./run-repo-test-manifest.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(scriptsDir, "run-repo-test-manifest.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "run-repo-test-manifest-"));
  writeJson(join(dir, "config", "testing", "repo-test-manifests", "default.json"), {
    schema: "hatch.repo-test-manifest.v1",
    repo_name: "astrochicken",
    repo_root: ".",
    default_suite: "pass",
    suites: [
      {
        name: "pass",
        runner: "node:test",
        working_directory: ".",
        entrypoints: ["scripts"],
        command: "node -e \"process.exit(0)\"",
      },
      {
        name: "fail",
        runner: "node:test",
        working_directory: ".",
        entrypoints: ["scripts"],
        command: "node -e \"process.exit(7)\"",
      },
    ],
  });
  return dir;
}

test("runManifestSuite returns the suite exit code", () => {
  const dir = createFixtureRepo();
  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/repo-test-manifests/default.json",
    suiteName: "pass",
  }), 0);
  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/repo-test-manifests/default.json",
    suiteName: "fail",
  }), 7);
});

test("CLI executes the default suite", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [runnerPath, "--repo-root", dir, "--manifest", "config/testing/repo-test-manifests/default.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
});

test("runManifestSuite bootstraps required runtime directories before execution", () => {
  const dir = createFixtureRepo();
  assert.equal(existsSync(join(dir, "apps", "hatch", "coverage", ".tmp")), false);

  assert.equal(runManifestSuite({
    repoRoot: dir,
    manifestPath: "config/testing/repo-test-manifests/default.json",
    suiteName: "pass",
  }), 0);

  assert.equal(existsSync(join(dir, "apps", "hatch", "coverage", ".tmp")), true);
});
