import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeTestBoundaries } from "./check-test-boundaries.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const scriptPath = join(repoRoot, "scripts", "check-test-boundaries.mjs");

function write(repoRoot, relativePath, content) {
  const absolute = join(repoRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

test("analyzeTestBoundaries ignores contract tests that read graph/source text", () => {
  const root = mkdtempSync(join(tmpdir(), "test-boundaries-"));
  const file = write(
    root,
    "packages/factory-ops/test/goal-run.contract.test.mjs",
    [
      'import { readFileSync } from "node:fs";',
      'const dot = readFileSync("factories/mothership/graphs/goal_run.dot", "utf8");',
      "void dot;",
      "",
    ].join("\n"),
  );

  const out = analyzeTestBoundaries({ files: [file] });
  assert.equal(out.violations.length, 0);
});

test("analyzeTestBoundaries flags non-contract tests that read graph/source text", () => {
  const root = mkdtempSync(join(tmpdir(), "test-boundaries-"));
  const file = write(
    root,
    "packages/factory-ops/test/goal-run.test.mjs",
    [
      'import assert from "node:assert/strict";',
      'import { readFileSync } from "node:fs";',
      'const dotPath = "factories/mothership/graphs/goal_run.dot";',
      'const src = "packages/factory-ops/src/commands/goal-run-state.ts";',
      'const dot = readFileSync(dotPath, "utf8");',
      'const body = readFileSync(src, "utf8");',
      'assert.match(dot, /goal_run/);',
      'assert.doesNotMatch(body, /legacy/);',
      "",
    ].join("\n"),
  );

  const out = analyzeTestBoundaries({ files: [file] });
  assert.equal(out.violations.length, 1);
  assert.equal(out.violations[0].file, file);
  assert.deepEqual(out.violations[0].production_source_reads, [
    "factories/mothership/graphs/goal_run.dot",
    "packages/factory-ops/src/commands/goal-run-state.ts",
  ]);
});

test("CLI exits non-zero when staged behavioral tests read production source text", () => {
  const root = mkdtempSync(join(tmpdir(), "test-boundaries-cli-"));
  const badTest = write(
    root,
    "packages/factory-ops/test/bad.test.mjs",
    [
      'import assert from "node:assert/strict";',
      'import { readFileSync } from "node:fs";',
      'const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");',
      'assert.match(dot, /wave_execute/);',
      "",
    ].join("\n"),
  );
  const stagedPathFile = write(root, "staged.txt", `${badTest}\0`);

  const run = spawnSync("node", [scriptPath, "--staged-file-list", stagedPathFile], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.match(run.stderr, /\[test-boundaries\] violation/);
  assert.match(run.stderr, /wave_execute\.dot/);
});

test("CLI exits zero when staged tests are clean", () => {
  const root = mkdtempSync(join(tmpdir(), "test-boundaries-cli-"));
  const goodTest = write(
    root,
    "packages/factory-ops/test/good.test.mjs",
    [
      'import test from "node:test";',
      'test("ok", () => {});',
      "",
    ].join("\n"),
  );
  const stagedPathFile = write(root, "staged.txt", `${goodTest}\0`);

  const run = spawnSync("node", [scriptPath, "--staged-file-list", stagedPathFile], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[test-boundaries\] result=ok/);
});

test("CLI supports whole-repo boundary checks via --all-tracked", () => {
  const run = spawnSync("node", [scriptPath, "--all-tracked"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[test-boundaries\] result=ok/);
});
