import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scriptPath = join(repoRoot, "scripts", "sync-shared-factory-surfaces.mjs");

function setupTempRepo() {
  const tempRoot = mkdtempSync(join(tmpdir(), "shared-surfaces-"));
  const copyPaths = [
    "scripts/sync-shared-factory-surfaces.mjs",
    "scripts/lib/factory-shared-surface-manifest.ts",
    "factories/_shared/surfaces/graphs/write_scenarios.dot.template",
    "factories/_shared/surfaces/graphs/write_scenario_item.dot.template",
    "factories/mothership/graphs/write_scenarios.dot",
    "factories/mothership/graphs/write_scenario_item.dot",
  ];

  for (const relPath of copyPaths) {
    cpSync(join(repoRoot, relPath), join(tempRoot, relPath), { recursive: true });
  }

  return tempRoot;
}

test("sync-shared-factory-surfaces check passes with zero shared surfaces", () => {
  const tempRoot = setupTempRepo();
  try {
    const run = spawnSync("node", [scriptPath, "--check", "--repo-root", tempRoot], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr.trim(), "");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sync-shared-factory-surfaces --check ignores release graph edits", () => {
  const tempRoot = setupTempRepo();
  try {
    const checkRun = spawnSync("node", [scriptPath, "--check", "--repo-root", tempRoot], { encoding: "utf8" });
    assert.equal(checkRun.status, 0, checkRun.stderr);
    assert.equal(checkRun.stderr.trim(), "");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
