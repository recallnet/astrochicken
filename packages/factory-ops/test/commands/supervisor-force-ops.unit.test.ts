import assert from "node:assert/strict";
import test from "node:test";

import { guardDisposableCleanup } from "../../src/lib/git-mutation-guard.ts";

test("supervisor-force-ops canonical guard blocks removal of canonical checkout worktree", () => {
  const result = guardDisposableCleanup({
    worktreePath: "/tmp/ws/astrochicken",
    repoPath: "/tmp/ws/astrochicken",
    canonicalCheckoutPath: "/tmp/ws/astrochicken",
    operation: "force_reset_worktree_remove",
  });
  assert.equal(result.blocked, true);
  assert.ok(result.reason.includes("canonical"));
});

test("supervisor-force-ops canonical guard allows removal of disposable worktree", () => {
  const result = guardDisposableCleanup({
    worktreePath: "/tmp/ws/.hatch-worktrees/wave/run-1",
    repoPath: "/tmp/ws/astrochicken",
    canonicalCheckoutPath: "/tmp/ws/astrochicken",
    operation: "force_reset_worktree_remove",
  });
  assert.equal(result.blocked, false);
});
