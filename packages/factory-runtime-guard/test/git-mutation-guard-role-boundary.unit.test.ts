import assert from "node:assert/strict";
import test from "node:test";

import { failClosedForUnknownContext, guardDisposableCleanup, guardGitMutation } from "../src/git-mutation-guard.ts";

import { registerSharedCases, BASE_MUTATION_CONTEXT } from "./git-mutation-guard-role-boundary.shared-suite.ts";

registerSharedCases({ failClosedForUnknownContext, guardDisposableCleanup, guardGitMutation });

test("managed mutation policy cannot be relabeled by a boundary hint", () => {
  const guard = guardGitMutation({
    operation: "push_main_verified",
    repoSlug: "example-org/control-plane",
    mutationContext: { ...BASE_MUTATION_CONTEXT, boundary: "target_repo" },
  });
  assert.equal(guard.ok, false);
});

test("explicit factory identity overrides a supplied mutation context owner", () => {
  const guard = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/unrelated",
    targetRepo: "example-org/home",
    mutationContext: { ...BASE_MUTATION_CONTEXT, target_repo: "example-org/unrelated" },
  });
  assert.equal(guard.ok, false);
});

test("explicit mutating operation cannot be relabeled as a context read", () => {
  const guard = guardGitMutation({
    operation: "push_main_verified",
    repoSlug: "example-org/control-plane",
    mutationContext: { ...BASE_MUTATION_CONTEXT, operation: "git:pull" },
  });
  assert.equal(guard.ok, false);
});

test("explicit main target branch cannot be disguised as a feature branch", () => {
  const guard = guardGitMutation({
    operation: "push_main_verified",
    repoSlug: "example-org/home",
    targetBranch: "main",
    mutationContext: { ...BASE_MUTATION_CONTEXT, target_branch: "feature/pretend" },
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_policy_target_repo_push_main_forbidden");
});

test("context flags cannot authorize writes to the control plane", () => {
  const guard = guardGitMutation({
    operation: "push_main_verified",
    repoSlug: "example-org/control-plane",
    targetBranch: "main",
    mutationContext: { ...BASE_MUTATION_CONTEXT, flags: { allow_target_repo_main_push: true } },
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_policy_control_plane_git_mutation_forbidden");
});

test("explicit cleanup target cannot be replaced by a context's safe path", () => {
  const guard = guardDisposableCleanup({
    worktreePath: "/tmp/outside/fac_123/worktree",
    repoPath: "/tmp/repo",
    canonicalCheckoutPath: "/tmp/repo",
    enforceMutationContext: true,
    mutationContext: { ...BASE_MUTATION_CONTEXT, target_path: ".hatch/fac_123/state.json" },
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_policy_local_filesystem_path_forbidden");
});

 test("factory identity never supplies a missing operation repository", () => {
  const guard = guardGitMutation({ operation: "reset_hard", targetPath: "/tmp/unrelated-checkout", mutationContext: BASE_MUTATION_CONTEXT });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_context_missing_operation_repo");
});
