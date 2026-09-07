import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("goal build-fallback-features accepts stdin payload transport", () => {
  const goalIssue = {
    number: 321,
    title: "Goal: stdin payload fallback",
    body: "Ensure fallback works for O'Hare and quoted \"payload\" bodies",
  };

  const run = spawnSync(
    "node",
    [opsCliPath, "goal", "build-fallback-features", "--goal-number", "321"],
    { cwd: repoRoot, encoding: "utf8", input: JSON.stringify(goalIssue) },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout || "[]");
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
});
