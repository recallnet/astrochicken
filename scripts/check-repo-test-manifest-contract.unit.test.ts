import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  REPO_TEST_MANIFEST_PATH,
  validateManifestCollection,
  validateRepoManifest,
} from "./check-repo-test-manifest-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-repo-test-manifest-contract.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-test-manifest-contract-"));
  writeJson(join(dir, REPO_TEST_MANIFEST_PATH), {
    schema: "hatch.repo-test-manifest.v1",
    repo_name: "astrochicken",
    repo_root: ".",
    default_suite: "default",
    suites: [
      {
        name: "default",
        runner: "node:test",
        working_directory: ".",
        entrypoints: ["scripts", "package.json"],
        command: "node --test --test-reporter=dot scripts/example.test.mjs",
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

test("validateRepoManifest rejects malformed manifests", () => {
  const diagnostics = validateRepoManifest({
    schema: "wrong.schema",
    repo_name: "astrochicken",
    repo_root: ".",
    default_suite: "default",
    suites: [{ name: "default" }],
  });

  assert.match(diagnostics.join("\n"), /schema must be "hatch\.repo-test-manifest\.v1"/);
  assert.match(diagnostics.join("\n"), /suites\[0\]\.runner must be a non-empty string/);
});

test("validateManifestCollection accepts the canonical repo manifest shape", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(validateManifestCollection({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    suite_count: 1,
  });
});

test("CLI emits telemetry and json", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\[repo_test_manifest_contract\] result=ok suites=1 errors=0/);
  assert.match(out.stdout, /"ok":true/);
});
