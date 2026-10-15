import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";

import { classifyManagedWorktreePath, resolveCanonicalCheckoutPath } from "../../src/lib/canonical-worktree.ts";

test("resolveCanonicalCheckoutPath honors explicit configured path", () => {
  const resolved = resolveCanonicalCheckoutPath({
    configuredPath: "/tmp/canonical-repo",
    baseDir: "/tmp/ignored",
  });
  assert.equal(resolved, join(realpathSync("/tmp"), "canonical-repo"));
});

test("classifyManagedWorktreePath recognizes canonical path and approved disposable roots", () => {
  const repoPath = "/tmp/ws/astrochicken";
  const canonicalCheckoutPath = "/tmp/ws/astrochicken";
  const canonical = classifyManagedWorktreePath({
    candidatePath: repoPath,
    repoPath,
    canonicalCheckoutPath,
  });
  assert.equal(canonical.canonical, true);
  assert.equal(canonical.approvedDisposable, false);

  const wave = classifyManagedWorktreePath({
    candidatePath: "/tmp/ws/.hatch-worktrees/wave/wave-123",
    repoPath,
    canonicalCheckoutPath,
  });
  assert.equal(wave.canonical, false);
  assert.equal(wave.approvedDisposable, true);
  assert.equal(wave.disposableKind, "wave");

  const proposal = classifyManagedWorktreePath({
    candidatePath: "/tmp/ws/.hatch-worktrees/proposal/proposal-1",
    repoPath,
    canonicalCheckoutPath,
  });
  assert.equal(proposal.approvedDisposable, true);
  assert.equal(proposal.disposableKind, "proposal");

  const rejected = classifyManagedWorktreePath({
    candidatePath: "/tmp/ws/scratch/random-worktree",
    repoPath,
    canonicalCheckoutPath,
  });
  assert.equal(rejected.approvedDisposable, false);
});
