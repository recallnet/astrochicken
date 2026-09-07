import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanupLegacyWorktree,
  ensureWorktreeToolchain,
  setupWaveIssueWorktree,
} from "../src/commands/wave-issue-state.ts";
import { bootstrapWorkspace, isBootstrapManagedWorkspace } from "../src/lib/workspace-package-manager.ts";

function sh(args, cwd) {
  const run = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return String(run.stdout || "").trim();
}

test("cleanup/setup/toolchain helper ops are deterministic", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-setup-helpers-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  mkdirSync(join(repoDir, "node_modules"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "package.json"), "{}\n", "utf8");
  const existingWorktreeDir = join(repoDir, "..", ".hatch-worktrees", "wave", "wave-issue-existing-worktree");
  mkdirSync(join(repoDir, "..", ".hatch-worktrees", "wave"), { recursive: true });
  sh(["git", "-C", repoDir, "worktree", "add", "-b", "wave/900", existingWorktreeDir, "main"], repoDir);
  assert.deepEqual(
    setupWaveIssueWorktree({ repo: repoDir, branch: "wave/900", worktreeDir: existingWorktreeDir }),
    { reason: "worktree_exists", setup: "true" },
  );
  sh(["git", "-C", repoDir, "worktree", "remove", existingWorktreeDir, "--force"], repoDir);
  const freshWorktreeDir = mkdtempSync(join(tmpdir(), "wave-issue-toolchain-worktree-"));
  assert.deepEqual(
    ensureWorktreeToolchain({
      repo: repoDir,
      worktreeDir: freshWorktreeDir,
      bootstrapWorkspaceFn: ({ repoRoot, workspaceDir }) => {
        assert.equal(repoRoot, repoDir);
        assert.equal(workspaceDir, freshWorktreeDir);
        return { ok: true, reason: "workspace_bootstrapped", install_code: "0", build_code: "0" };
      },
    }),
    { bootstrapped: "true", build_code: "0", install_code: "0", linked: "false", reason: "workspace_bootstrapped" },
  );
  assert.deepEqual(
    cleanupLegacyWorktree({ repo: repoDir, legacyWorktreeDir: join(repoDir, "..", "missing-legacy-900") }),
    { reason: "legacy_worktree_missing", removed: "false" },
  );
});

test("ensureWorktreeToolchain fails closed when pnpm bootstrap fails", () => {
  assert.deepEqual(
    ensureWorktreeToolchain({
      repo: "/repo",
      worktreeDir: "/repo/.hatch-worktrees/wave/900",
      bootstrapWorkspaceFn: () => ({ ok: false, reason: "pnpm install exploded", install_code: "1", build_code: "" }),
    }),
    { bootstrapped: "false", build_code: "", install_code: "1", linked: "false", reason: "pnpm install exploded" },
  );
});

test("bootstrapWorkspace skips synthetic non-workspace repos deterministically", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-bootstrap-skip-"));
  writeFileSync(join(repoDir, "README.md"), "not a workspace\n", "utf8");

  assert.equal(isBootstrapManagedWorkspace(repoDir), false);
  assert.deepEqual(
    bootstrapWorkspace({ repoRoot: repoDir, workspaceDir: repoDir }),
    { ok: true, reason: "bootstrap_not_required", install_code: "", build_code: "" },
  );
});

test("bootstrapWorkspace detects managed pnpm workspaces by root package.json and lockfile", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-bootstrap-managed-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  assert.equal(isBootstrapManagedWorkspace(repoDir), true);
});
