import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "../..");
const workflowDir = join(repoRoot, ".github/workflows");

const WORKFLOWS = [
  { file: "pre-merge-quality.yml", jobName: "pre-merge-quality" },
  { file: "docs-quality.yml", jobName: "docs-quality" },
];

for (const { file, jobName } of WORKFLOWS) {
  test(`${file}: has ci-failure-ticket step with if: failure()`, () => {
    const content = readFileSync(join(workflowDir, file), "utf8");

    assert.ok(
      content.includes("if: failure()"),
      `${file} should have an if: failure() step`,
    );
    assert.ok(
      content.includes("ci-failure-ticket.sh"),
      `${file} should reference ci-failure-ticket.sh`,
    );
    assert.ok(
      content.includes(`"${jobName}"`),
      `${file} should pass job name "${jobName}" to the script`,
    );
    assert.ok(
      content.includes("GH_TOKEN"),
      `${file} should set GH_TOKEN env var`,
    );
  });
}

test("ci-failure-ticket.sh exists and is executable", () => {
  const scriptPath = join(repoRoot, ".github/scripts/ci-failure-ticket.sh");
  const content = readFileSync(scriptPath, "utf8");

  assert.ok(content.startsWith("#!/usr/bin/env bash"), "script should have bash shebang");
  assert.ok(content.includes("set -euo pipefail"), "script should use strict mode");
  assert.ok(content.includes("--label bug"), "script should use bug label");
  assert.ok(content.includes("gh issue list"), "script should search for existing issues");
  assert.ok(content.includes("gh issue create"), "script should create issues");
  assert.ok(content.includes("gh issue comment"), "script should comment on existing issues");
});
