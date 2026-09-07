import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertMainBranch } from "../../src/commands/merge-item-ops.ts";

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-assert-main-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

test("assertMainBranch no-ops when already on main", () => {
  const repo = initRepo();
  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.branch, "main");
  assert.equal(out.corrected, false);
  assert.equal(out.error, "");
});

test("assertMainBranch corrects to main from wave branch", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/goal-42-wave-1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feat\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.branch, "wave/goal-42-wave-1");
  assert.equal(out.corrected, true);

  const current = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(current, "main");
});

test("assertMainBranch returns error for missing repo", () => {
  const out = assertMainBranch({});
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo");
});

test("assertMainBranch cleans up stale merge state while correcting branch", () => {
  const repo = initRepo();

  // Create wave branch with a divergent commit
  sh(["git", "checkout", "-b", "wave/goal-99-wave-2"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  // Start a merge that conflicts to create stale merge state
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "main diverge"], repo);

  // Go back to wave branch (simulating crash left us here)
  sh(["git", "checkout", "wave/goal-99-wave-2"], repo);

  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.corrected, true);

  const current = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(current, "main");
});

test("assertMainBranch blocks canonical checkout correction when branch is not main", () => {
  const repo = initRepo();
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repo;
    sh(["git", "checkout", "-b", "wave/goal-42-wave-2"], repo);

    const out = assertMainBranch({ repo });
    assert.equal(out.ok, false);
    assert.match(out.error, /canonical_checkout_checkout_main_only_blocked/);

    const current = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
    assert.equal(current, "wave/goal-42-wave-2");
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});
