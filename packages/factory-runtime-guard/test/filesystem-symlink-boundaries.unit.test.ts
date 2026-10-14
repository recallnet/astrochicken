import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { classifyManagedWorktreePath, isCanonicalCheckout } from "../src/canonical-worktree.ts";
import { isLocalFilesystemPath } from "../src/mutation-policy-contract.ts";
import { resolvePhysicalPath } from "../src/filesystem-path.ts";
import { guardDisposableCleanup, guardGitMutation } from "../src/git-mutation-guard.ts";

function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "hatch-path-boundary-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const outside = path.join(root, "outside");
  const scoped = path.join(repo, ".hatch", "fac_test");
  const worktrees = path.join(root, ".hatch-worktrees", "wave");
  for (const dir of [repo, outside, scoped, worktrees]) mkdirSync(dir, { recursive: true });
  return { root, repo, outside, scoped, worktrees };
}

test("canonical and repo-root classification recognize a symlink alias", (t) => {
  const { root, repo } = fixture(t);
  const alias = path.join(root, "repo-alias");
  symlinkSync(repo, alias, "dir");
  assert.equal(isCanonicalCheckout(alias, { canonicalCheckoutPath: repo }), true);
  const classification = classifyManagedWorktreePath({ candidatePath: alias, repoPath: repo, canonicalCheckoutPath: repo });
  assert.equal(classification.canonical, true);
  assert.equal(classification.repoRoot, true);
});

test("a symlink inside an approved disposable root cannot authorize an outside target", (t) => {
  const { repo, outside, worktrees } = fixture(t);
  const alias = path.join(worktrees, "escape");
  symlinkSync(outside, alias, "dir");
  assert.equal(classifyManagedWorktreePath({ candidatePath: path.join(alias, "new", "worktree"), repoPath: repo }).approvedDisposable, false);
});

test("a disposable-root symlink to the canonical checkout is protected as canonical", (t) => {
  const { repo, worktrees } = fixture(t);
  const alias = path.join(worktrees, "canonical-alias");
  symlinkSync(repo, alias, "dir");
  const classification = classifyManagedWorktreePath({ candidatePath: alias, repoPath: repo, canonicalCheckoutPath: repo });
  assert.equal(classification.canonical, true);
  assert.equal(classification.approvedDisposable, false);
});

test("filesystem scope rejects symlink escapes even when the target does not exist yet", (t) => {
  const { repo, outside, scoped, worktrees } = fixture(t);
  for (const root of [scoped, worktrees]) {
    const alias = path.join(root, "escape");
    symlinkSync(outside, alias, "dir");
    assert.equal(isLocalFilesystemPath(path.join(alias, "new", "state.json"), {
      instanceId: "fac_test", cwd: repo, approvedWorktreeRoots: [worktrees],
    }), false);
  }
});

test("symlinks are resolved before parent traversal and after a missing-path parent traversal", (t) => {
  const { repo, outside, scoped } = fixture(t);
  mkdirSync(path.join(outside, "child"));
  symlinkSync(path.join(outside, "child"), path.join(scoped, "escape"), "dir");
  assert.equal(resolvePhysicalPath(`${scoped}/escape/../new-state.json`), path.join(outside, "new-state.json"));
  for (const suffix of ["escape/../new-state.json", "missing/../escape/new-state.json"]) {
    assert.equal(isLocalFilesystemPath(`${scoped}/${suffix}`, { instanceId: "fac_test", cwd: repo }), false);
  }
});

test("dangling and looping links fail closed instead of receiving lexical approval", (t) => {
  const { root, repo, scoped } = fixture(t);
  symlinkSync(path.join(root, "absent"), path.join(scoped, "dangling"), "dir");
  symlinkSync("loop", path.join(scoped, "loop"), "dir");
  for (const name of ["dangling", "loop"]) {
    assert.equal(isLocalFilesystemPath(path.join(scoped, name, "new.json"), { instanceId: "fac_test", cwd: repo }), false);
  }
});

test("new target paths remain allowed inside the real factory and disposable roots", (t) => {
  const { repo, scoped, worktrees } = fixture(t);
  assert.equal(isLocalFilesystemPath(path.join(scoped, "not-created", "state.json"), { instanceId: "fac_test", cwd: repo }), true);
  assert.equal(isLocalFilesystemPath(path.join(worktrees, "not-created", "state.json"), {
    instanceId: "fac_test", cwd: repo, approvedWorktreeRoots: [worktrees],
  }), true);
  assert.equal(classifyManagedWorktreePath({ candidatePath: path.join(worktrees, "not-created", "worktree"), repoPath: repo }).approvedDisposable, true);
});

test("host installation scope rejects escaped links while allowing new scoped files", (t) => {
  const { root, repo, outside } = fixture(t);
  const home = path.join(root, "home");
  const installation = path.join(home, ".hatch-hosts", "installations", "fac_test");
  mkdirSync(installation, { recursive: true });
  symlinkSync(outside, path.join(installation, "escape"), "dir");
  const options = { instanceId: "fac_test", cwd: repo, homeDirectory: home };
  assert.equal(isLocalFilesystemPath("~/.hatch-hosts/installations/fac_test/escape/new.json", options), false);
  assert.equal(isLocalFilesystemPath("~/.hatch-hosts/installations/fac_test/new/state.json", options), true);
});

test("public mutation guards return an explicit denial when a path cannot be resolved", (t) => {
  const { repo, worktrees } = fixture(t);
  const loop = path.join(worktrees, "loop");
  symlinkSync("loop", loop, "dir");
  const decisions = [
    guardGitMutation({ operation: "reset_hard", repoPath: loop, canonicalCheckoutPath: repo }),
    guardDisposableCleanup({ worktreePath: loop, repoPath: repo, canonicalCheckoutPath: repo }),
  ];
  for (const decision of decisions) {
    assert.equal(decision.ok, false);
    assert.equal(decision.blocked, true);
    assert.equal(decision.reason, "filesystem_path_resolution_failed");
  }
});
