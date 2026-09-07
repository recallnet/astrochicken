import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pushMainBranch } from "../../src/commands/merge-item-ops.ts";
import { withInjectedGitFailure } from "../shared/helpers/failure-injection.ts";

// ── Helpers ───────────────────────────────────────────────────

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepoWithBareRemote() {
  const remote = mkdtempSync(join(tmpdir(), "taxi-push-remote-"));
  sh(["git", "init", "--bare", "-b", "main"], remote);

  const repo = mkdtempSync(join(tmpdir(), "taxi-push-local-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "base.txt"), "base\n", "utf8");
  sh(["git", "add", "base.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  sh(["git", "remote", "add", "origin", remote], repo);
  sh(["git", "push", "-u", "origin", "main"], repo);

  return { repo, remote };
}

// ── Tests ────────────────────────────────────────────────────

test("pushMainBranch — does NOT use --no-verify on push", () => {
  const { repo } = initRepoWithBareRemote();

  writeFileSync(join(repo, "bump.txt"), "bump\n", "utf8");
  sh(["git", "add", "bump.txt"], repo);
  sh(["git", "commit", "-m", "bump"], repo);

  // Inject a failure matching push WITHOUT --no-verify
  // If pushMainBranch still uses --no-verify, this injection won't match
  // and the push will succeed (test would fail).
  const out = withInjectedGitFailure({
    match: "push origin main:main",
    code: 1,
    stderr: "injected: push intercepted",
  }, () => pushMainBranch({ repo, branch: "main", remote: "origin" }));

  // If --no-verify is gone, the injected failure matches and push fails
  assert.ok(
    out.push_status !== "pushed",
    "push command must not use --no-verify — injection should have matched 'push origin main:main'",
  );
});

test("pushMainBranch — returns push_failure_reason=hook_failed when hooks fail", () => {
  const { repo } = initRepoWithBareRemote();

  writeFileSync(join(repo, "bump.txt"), "bump\n", "utf8");
  sh(["git", "add", "bump.txt"], repo);
  sh(["git", "commit", "-m", "bump"], repo);

  const out = withInjectedGitFailure({
    match: "push origin main:main",
    code: 1,
    stderr: "[pre-push] failed (full log: .hook-logs/pre-push.log)\nrun-gates.mjs exited with code 1",
  }, () => pushMainBranch({ repo, branch: "main", remote: "origin" }));

  assert.equal(out.push_failure_reason, "hook_failed", "must classify hook failures distinctly");
});

test("pushMainBranch — returns push_failure_reason=rejected for non-fast-forward", () => {
  const { repo } = initRepoWithBareRemote();

  writeFileSync(join(repo, "bump.txt"), "bump\n", "utf8");
  sh(["git", "add", "bump.txt"], repo);
  sh(["git", "commit", "-m", "bump"], repo);

  const out = withInjectedGitFailure({
    match: "push origin main:main",
    code: 1,
    stderr: "! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs",
  }, () => pushMainBranch({ repo, branch: "main", remote: "origin" }));

  assert.equal(out.push_failure_reason, "rejected", "must classify rejections distinctly");
});
