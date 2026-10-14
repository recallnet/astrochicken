import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { revertToSnapshot } from "../src/commands/wave-issue-worktree.ts";

test("managed snapshot rollback identifies the actual checkout independently of factory identity", () => {
  const root = mkdtempSync(join(tmpdir(), "managed-snapshot-"));
  const previous = process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "-b", "feature/fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Local fixture");
    git("remote", "add", "origin", "https://github.com/example-org/home.git");
    writeFileSync(join(root, "fixture.txt"), "first\n"); git("add", "."); git("commit", "-m", "first");
    const snapshot = git("rev-parse", "HEAD");
    writeFileSync(join(root, "fixture.txt"), "second\n"); git("add", "."); git("commit", "-m", "second");
    process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = JSON.stringify({ target_repo: "example-org/home", destinations: {}, control_plane_repo: "example-org/control-plane", instance_id: "fixture" });
    assert.equal(revertToSnapshot({ worktreeDir: root, snapshotSha: snapshot }).reverted, "true");
    assert.equal(git("rev-parse", "HEAD"), snapshot);
    git("remote", "set-url", "origin", "https://github.com/example-org/unrelated.git");
    const denied = revertToSnapshot({ worktreeDir: root, snapshotSha: snapshot });
    assert.equal(denied.reverted, "false");
    assert.equal(denied.reason, "mutation_policy_unknown_boundary");
  } finally {
    if (previous === undefined) delete process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
    else process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
