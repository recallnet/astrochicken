import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeSharedSurfaceOwnership,
  parseArgs,
} from "./check-shared-surface-ownership.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-shared-surface-ownership.ts");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path, content = "export {};") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "shared-surface-ownership-"));
  writeJson(join(dir, "config", "testing", "shared-surface-ownership.json"), {
    schema: "hatch.shared-surface-ownership.v1",
    scan_roots: [
      { path: "packages", extensions: [".mjs"] },
      { path: "apps", extensions: [".ts"] },
    ],
    surfaces: [
      {
        id: "github_transport",
        description: "GitHub CLI transport lives in github-adapter",
        owner_prefixes: ["packages/github-adapter/src/"],
        detectors: [
          {
            id: "direct_gh_spawn",
            message: "Route GitHub CLI transport through github-adapter.",
            regex: "\\b(?:spawnSync|spawn)\\s*\\(\\s*['\\\"]gh['\\\"]",
          },
        ],
      },
    ],
  });
  writeFile(join(dir, "packages", "github-adapter", "src", "github-adapter.mjs"), "spawnSync('gh', ['issue']);\n");
  writeFile(join(dir, "packages", "factory-ops", "src", "bad.mjs"), "spawnSync('gh', ['issue']);\n");
  writeFile(join(dir, "apps", "hatch", "src", "okay.ts"), "export const x = 1;\n");
  return dir;
}

test("parseArgs reads repo-root, config, and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--config", "x.json", "--staged-file-list", "paths.list", "--json"]), {
    repoRoot: "/tmp/repo",
    configPath: "x.json",
    stagedFileList: "paths.list",
    allTracked: false,
    json: true,
  });
});

test("analyzeSharedSurfaceOwnership ignores owner paths and fails on non-owner direct gh transport", () => {
  const dir = createFixtureRepo();
  const result = analyzeSharedSurfaceOwnership({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.equal(result.surface_count, 1);
  assert.equal(result.violation_count, 1);
  assert.match(
    result.diagnostics.join("\n"),
    /shared surface 'github_transport' violation in packages\/factory-ops\/src\/bad\.mjs: direct_gh_spawn/,
  );
  assert.doesNotMatch(result.diagnostics.join("\n"), /packages\/github-adapter\/src\/github-adapter\.mjs/);
});

test("analyzeSharedSurfaceOwnership respects staged-file scope", () => {
  const dir = createFixtureRepo();
  const stagedListPath = join(dir, "staged.list");
  writeFileSync(stagedListPath, Buffer.from("apps/hatch/src/okay.ts\0", "utf8"));
  const result = analyzeSharedSurfaceOwnership({ repoRoot: dir, stagedFileList: stagedListPath });
  assert.equal(result.ok, true);
  assert.equal(result.file_count, 1);
  assert.equal(result.violation_count, 0);
});

test("CLI emits telemetry and JSON for a failing fixture", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /\[shared_surface_ownership\] result=fail surfaces=1 files=3 violations=1/);
  assert.match(out.stdout, /"ok":false/);
});
