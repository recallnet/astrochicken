import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { runGitPull } from "../../src/lib/daemon.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-git-pull-unit-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test("runGitPull uses explicit fetch plus ff-only merge instead of branch-upstream-dependent pull", () => {
  const repoRoot = makeTmpDir();
  const daemonLogPath = path.join(repoRoot, "daemon.log");
  writeFileSync(daemonLogPath, "", "utf8");

  const calls = [];
  runGitPull({
    repoRoot,
    daemonLogPath,
    canonicalCheckoutPath: repoRoot,
    repoRoleContext: {
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
      repoSlug: "recallnet/astrochicken",
      enforceRepoRoles: true,
      allowControlPlaneMainSafeFlow: true,
    },
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls.map((entry) => [entry.command, entry.args]), [
    ["git", ["-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "origin", "main"]],
    ["git", ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", "FETCH_HEAD"]],
  ]);
  assert.equal(calls[0].options.cwd, repoRoot);
  assert.equal(calls[1].options.cwd, repoRoot);
});
