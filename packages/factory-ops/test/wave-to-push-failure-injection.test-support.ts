import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attemptDeterministicMerge, pushMainBranch } from "../src/commands/merge-item-ops.ts";
import { withInjectedGitFailure } from "./shared/helpers/failure-injection.ts";

export function registerWaveToPushFailureInjectionCases() {
function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-failure-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

test("failure injection: git merge command failure maps to merge_status=error (not crash)", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feature\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = withInjectedGitFailure({
    match: "merge --no-ff wave/1",
    code: 23,
    stderr: "injected merge failure",
  }, () => attemptDeterministicMerge({ repo, branch: "wave/1" }));

  assert.equal(out.merge_status, "error");
  assert.match(out.merge_stderr, /injected merge failure/);
});

test("failure injection: git push command hard failure maps to push_status=error/conflict", () => {
  const repo = initRepo();
  const remote = mkdtempSync(join(tmpdir(), "taxi-failure-remote-"));
  sh(["git", "init", "--bare", "-b", "main"], remote);
  sh(["git", "remote", "add", "origin", remote], repo);
  sh(["git", "push", "-u", "origin", "main"], repo);

  writeFileSync(join(repo, "bump.txt"), "bump\n", "utf8");
  sh(["git", "add", "bump.txt"], repo);
  sh(["git", "commit", "-m", "bump"], repo);

  const out = withInjectedGitFailure({
    match: "push origin main:main",
    code: 1,
    stderr: "failed to push some refs",
  }, () => pushMainBranch({ repo, branch: "main", remote: "origin" }));

  assert.ok(["error", "conflict"].includes(out.push_status));
});

}
