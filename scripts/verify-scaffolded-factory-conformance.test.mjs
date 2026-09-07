import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";

import {
  compareScaffoldSnapshots,
  normalizeScaffoldContent,
} from "./lib/normalize-scaffold-tree.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const verifierPath = join(repoRoot, "scripts", "verify-scaffolded-factory-conformance.mjs");
const goldenPath = join(repoRoot, "scripts", "test", "golden", "scaffolded-factory-structure.json");

function runVerifier(args) {
  return spawnSync("node", [verifierPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("normalizeScaffoldContent is deterministic for issue URLs, paths, and newlines", () => {
  const raw = "path=/tmp/work\r\nissue=https://github.com/owner/repo/issues/123\r\ninstance=fac_01JQ7M8JABCDEFG\r\ninstall=inst_01JQ7ME8ABCDEFG\r\n";
  const once = normalizeScaffoldContent(raw, { workspaceRoot: "/tmp/work" });
  const twice = normalizeScaffoldContent(raw, { workspaceRoot: "/tmp/work" });

  assert.equal(once, twice);
  assert.match(once, /path=<WORKSPACE_ROOT>/);
  assert.match(once, /issues\/<ISSUE_NUMBER>/);
  assert.match(once, /instance=<FACTORY_INSTANCE_ID>/);
  assert.match(once, /install=<FACTORY_INSTALLATION_ID>/);
  assert.doesNotMatch(once, /\r/);
});

test("compareScaffoldSnapshots flags changed file content deterministically", () => {
  const expected = {
    files: [
      { path: "factory.config.json", mode: "0644", content: "one" },
    ],
  };
  const actual = {
    files: [
      { path: "factory.config.json", mode: "0644", content: "two" },
    ],
  };

  const comparison = compareScaffoldSnapshots(expected, actual);
  assert.equal(comparison.ok, false);
  assert.deepEqual(comparison.changedFiles, [
    { path: "factory.config.json", changedFields: ["content"] },
  ]);
});

test("verifier rejects intentionally drifted golden snapshot", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "scaffolded-golden-drift-"));
  const driftedGoldenPath = join(tempDir, "drifted.json");
  const drifted = JSON.parse(readFileSync(goldenPath, "utf8"));
  drifted.files[0].content = `${drifted.files[0].content}\nDRIFT`;
  writeFileSync(driftedGoldenPath, `${JSON.stringify(drifted, null, 2)}\n`);

  ensureHatchBuild({ repoRoot });
  const run = runVerifier(["--skip-unit-contracts", "--skip-build", "--golden", driftedGoldenPath]);
  rmSync(tempDir, { recursive: true, force: true });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /scaffold_conformance result=diff/);
});

test("verifier succeeds against current scaffold template and golden snapshot", () => {
  ensureHatchBuild({ repoRoot });
  const run = runVerifier(["--skip-unit-contracts", "--skip-build"]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /scaffold_conformance phase=shared_harness result=ok phases=5/);
  assert.match(run.stdout, /scaffold_conformance result=ok/);
});

test("verifier default build path does not redundantly rebuild inside shared harness", () => {
  ensureHatchBuild({ repoRoot });
  const run = runVerifier(["--skip-unit-contracts"]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /scaffold_conformance phase=build_hatch result=ok exit=0/);
  assert.match(run.stdout, /scaffold_conformance phase=shared_harness result=ok phases=5/);
  assert.doesNotMatch(run.stderr, /factory_health phase=build_hatch result=fail/);
});
