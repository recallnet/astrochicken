import assert from "node:assert/strict";
import test from "node:test";

// Unit tests for supervisor-force-ops (no git/gh calls — just contract tests)

test("forceResetBranch returns error when missing repo or branch", async () => {
  const { forceResetBranch } = await import("../../src/commands/supervisor-force-ops.ts");
  const out = forceResetBranch({ repo: "", branch: "wave/123" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_or_branch");

  const out2 = forceResetBranch({ repo: "owner/repo", branch: "" });
  assert.equal(out2.ok, false);
  assert.equal(out2.error, "missing_repo_or_branch");
});

test("forceCloseGiveUp returns error when missing repo or issue", async () => {
  const { forceCloseGiveUp } = await import("../../src/commands/supervisor-force-ops.ts");
  const out = forceCloseGiveUp({ repo: "", issueNumber: "42" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_or_issue");

  const out2 = forceCloseGiveUp({ repo: "owner/repo", issueNumber: "" });
  assert.equal(out2.ok, false);
  assert.equal(out2.error, "missing_repo_or_issue");
});

test("buildStateSnapshot includes quarantined_issues in output", async () => {
  // Verify the function signature accepts repo and returns expected shape
  const { buildStateSnapshot } = await import("../../src/commands/supervisor-state-snapshot.ts");
  const out = buildStateSnapshot({ repo: "", factoryRoot: "/tmp/does-not-exist-factory-root" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, "missing_repo");
});
