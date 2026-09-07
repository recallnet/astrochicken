import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateMainBranchHealth } from "../../src/commands/supervisor-validate-main-branch.ts";

const restoreSnippet = "git\", [\"restore\", \"--staged\", \"--worktree\", \".\"]";

test("evaluateMainBranchHealth: all suites pass → healthy", () => {
  const result = evaluateMainBranchHealth({ guardExit: 0, waveClaimExit: 0, failOutput: "" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("evaluateMainBranchHealth: guard fails → not healthy with guard in failures", () => {
  const result = evaluateMainBranchHealth({ guardExit: 1, waveClaimExit: 0, failOutput: "guard failed" });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].suite, "test:guard-gates");
  assert.equal(result.failures[0].exit_code, 1);
});

test("evaluateMainBranchHealth: wave-claim fails → not healthy with wave-claim in failures", () => {
  const result = evaluateMainBranchHealth({ guardExit: 0, waveClaimExit: 1, failOutput: "wave failed" });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].suite, "test:wave-claim-gates");
});

test("evaluateMainBranchHealth: both fail → both in failures", () => {
  const result = evaluateMainBranchHealth({ guardExit: 1, waveClaimExit: 1, failOutput: "both failed" });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
  assert.equal(result.failures[0].suite, "test:guard-gates");
  assert.equal(result.failures[1].suite, "test:wave-claim-gates");
});

test("evaluateMainBranchHealth: build failure → not healthy with build in failures", () => {
  const result = evaluateMainBranchHealth({ buildExit: 1, guardExit: null, waveClaimExit: null, failOutput: "build error" });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].suite, "build");
});

test("evaluateMainBranchHealth: truncates fail output to 3000 chars", () => {
  const longOutput = "x".repeat(5000);
  const result = evaluateMainBranchHealth({ guardExit: 1, waveClaimExit: 0, failOutput: longOutput });
  assert.equal(result.fail_output_excerpt.length, 3000);
});

test("validate-main-branch source imports emitBugIssue for deduped bug filing", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-validate-main-branch.ts", "utf8");
  assert.ok(src.includes("emitBugIssue"), "must use emitBugIssue for deduped bug filing");
});

test("validate-main-branch source runs both test suites", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-validate-main-branch.ts", "utf8");
  assert.ok(src.includes("test:guard-gates"), "must run guard gates");
  assert.ok(src.includes("test:wave-claim-gates"), "must run wave-claim gates");
});

test("validate-main-branch resets working tree before running", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-validate-main-branch.ts", "utf8");
  assert.ok(src.includes(restoreSnippet), "must git restore --staged --worktree before running tests");
});
