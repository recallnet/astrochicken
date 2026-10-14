import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeDailyLensCollectorOwnership,
  parseArgs,
} from "./check-daily-lens-collector-ownership.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-daily-lens-collector-ownership.ts");
const repoRoot = resolve(scriptsDir, "..");

function writeFile(path, content = "export {};") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "daily-lens-collector-ownership-"));
  writeFile(join(dir, "packages/factory-ops/src/lib/analysis/index.ts"), 'export { collectGithubState } from "@hatch/github-adapter/daily-lens-github-state";\n');
  return dir;
}

test("parseArgs reads repo-root and staged-file flags", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--staged-file-list", "paths.list", "--json"]), {
    repoRoot: "/tmp/repo",
    stagedFileList: "paths.list",
    allTracked: false,
    json: true,
  });
});

test("analyzeDailyLensCollectorOwnership passes when factory-ops only composes owner packages", () => {
  const dir = createFixtureRepo();
  const result = analyzeDailyLensCollectorOwnership({ repoRoot: dir });
  assert.equal(result.ok, true);
  assert.equal(result.violation_count, 0);
});

test("analyzeDailyLensCollectorOwnership fails on forbidden collector files and local imports", () => {
  const dir = createFixtureRepo();
  writeFile(join(dir, "packages/factory-ops/src/lib/analysis/collect-langfuse.ts"), "export const bad = true;\n");
  writeFile(join(dir, "packages/factory-ops/src/lib/analysis/collectors.ts"), 'export { collectLangfuse } from "./collect-langfuse.mjs";\n');

  const result = analyzeDailyLensCollectorOwnership({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.equal(result.violation_count, 2);
  assert.match(result.diagnostics.join("\n"), /collect-langfuse\.mjs must move into its owner package/);
  assert.match(result.diagnostics.join("\n"), /factory_ops_local_langfuse_collector/);
});

test("analyzeDailyLensCollectorOwnership respects staged-file scope for import scanning", () => {
  const dir = createFixtureRepo();
  writeFile(join(dir, "packages/factory-ops/src/lib/analysis/collectors.ts"), 'export { collectLangfuse } from "./collect-langfuse.mjs";\n');
  const stagedListPath = join(dir, "staged.list");
  writeFileSync(stagedListPath, Buffer.from("packages/factory-ops/src/lib/analysis/index.ts\0", "utf8"));

  const result = analyzeDailyLensCollectorOwnership({ repoRoot: dir, stagedFileList: stagedListPath });
  assert.equal(result.ok, true);
  assert.equal(result.file_count, 1);
});

test("CLI emits telemetry and JSON for a failing fixture", () => {
  const dir = createFixtureRepo();
  writeFile(join(dir, "packages/factory-ops/src/lib/analysis/collect-github-state.ts"), "export const bad = true;\n");

  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 1);
  assert.match(out.stdout, /\[daily_lens_collector_ownership\] result=fail files=2 violations=1/);
  assert.match(out.stdout, /"ok":false/);
});
