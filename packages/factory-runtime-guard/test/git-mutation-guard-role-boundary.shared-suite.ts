import assert from "node:assert/strict";
import test from "node:test";

export const BASE_ROLE_CONTEXT = {
  targetRepo: "example-org/home",
  controlPlaneRepo: "example-org/control-plane",
  destinationRepos: ["example-org/destination"],
  enforceRepoRoles: true,
};

export const BASE_MUTATION_CONTEXT = {
  target_repo: "example-org/home",
  destinations: {
    astrochicken: { repo: "example-org/destination" },
  },
  control_plane_repo: "example-org/control-plane",
  instance_id: "fac_123",
};


export function registerSharedCases({ failClosedForUnknownContext, guardDisposableCleanup, guardGitMutation }) {
test("guardGitMutation role matrix: mutating ops allow home, deny destination/control-plane/unknown", () => {
  const home = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/home",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(home.ok, true);

  const destination = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/destination",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(destination.ok, false);
  assert.equal(destination.reason, "repo_role_destination_mutation_blocked");

  const controlPlane = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/control-plane",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(controlPlane.ok, false);
  assert.equal(controlPlane.reason, "repo_role_control_plane_mutation_blocked");

  const unknown = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/unknown",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "repo_role_undeclared_destination_repo");
});

test("guardGitMutation allows read-only ops with role enforcement enabled", () => {
  const guard = guardGitMutation({
    operation: "status",
    repoSlug: "",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.reason, "");
});

test("guardGitMutation fails closed for mutating ops when repo slug cannot be resolved", () => {
  const guard = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "repo_role_unresolved_slug");
});

test("guardGitMutation preserves canonical checkout deny reasons", () => {
  const guard = guardGitMutation({
    operation: "merge_branch",
    repoPath: "/tmp/repo",
    canonicalCheckoutPath: "/tmp/repo",
    repoSlug: "example-org/home",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "canonical_checkout_merge_branch_blocked");
});

test("guardGitMutation allows canonical control-plane main-safe flow only when explicitly enabled", () => {
  const blocked = guardGitMutation({
    operation: "pull_ff_only_main",
    repoPath: "/tmp/control",
    canonicalCheckoutPath: "/tmp/control",
    currentBranch: "main",
    targetBranch: "main",
    repoSlug: "example-org/control-plane",
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "repo_role_control_plane_mutation_blocked");

  const allowed = guardGitMutation({
    operation: "pull_ff_only_main",
    repoPath: "/tmp/control",
    canonicalCheckoutPath: "/tmp/control",
    currentBranch: "main",
    targetBranch: "main",
    repoSlug: "example-org/control-plane",
    allowControlPlaneMainSafeFlow: true,
    ...BASE_ROLE_CONTEXT,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.reason, "");
});

test("guardGitMutation blocks control-plane mutation from managed-factory mutation context", () => {
  const guard = guardGitMutation({
    operation: "push_main_verified",
    repoSlug: "example-org/control-plane",
    mutationContext: BASE_MUTATION_CONTEXT,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_policy_control_plane_git_mutation_forbidden");
});

test("guardGitMutation fails closed for managed-factory mutation context with missing identity", () => {
  const guard = guardGitMutation({
    operation: "merge_branch",
    repoSlug: "example-org/home",
    mutationContext: {
      target_repo: "example-org/home",
      control_plane_repo: "example-org/control-plane",
      instance_id: "fac_123",
    },
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "mutation_context_missing_required_identity:destinations");
});

test("guardGitMutation resolves mutation_context from env and blocks control-plane mutation", () => {
  const previous = process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
  process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = JSON.stringify(BASE_MUTATION_CONTEXT);

  try {
    const guard = guardGitMutation({
      operation: "push_main_verified",
      repoSlug: "example-org/control-plane",
    });

    assert.equal(guard.ok, false);
    assert.equal(guard.reason, "mutation_policy_control_plane_git_mutation_forbidden");
  } finally {
    if (previous === undefined) {
      delete process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
    } else {
      process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = previous;
    }
  }
});


test("guardDisposableCleanup blocks paths outside instance scope when mutation context is enforced", () => {
  const blocked = guardDisposableCleanup({
    worktreePath: "/tmp/outside/fac_123/worktree",
    repoPath: "/tmp/repo",
    canonicalCheckoutPath: "/tmp/repo",
    operation: "worktree_remove",
    mutationContext: BASE_MUTATION_CONTEXT,
    enforceMutationContext: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "mutation_policy_local_filesystem_path_forbidden");

  const stillBlocked = guardDisposableCleanup({
    worktreePath: "/tmp/repo/.hatch-worktrees/wave/run-1",
    repoPath: "/tmp/repo",
    canonicalCheckoutPath: "/tmp/repo/canonical",
    operation: "worktree_remove",
    mutationContext: BASE_MUTATION_CONTEXT,
    enforceMutationContext: true,
  });
  assert.equal(stillBlocked.ok, false);
  assert.equal(stillBlocked.reason, "mutation_policy_local_filesystem_path_forbidden");
});

test("failClosedForUnknownContext validates canonical identity requirements", () => {
  const missing = failClosedForUnknownContext({ mutationContext: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "mutation_context_missing");

  const unresolved = failClosedForUnknownContext({
    mutationContext: {
      target_repo: "",
      destinations: {},
      control_plane_repo: "example-org/control-plane",
      instance_id: "fac_123",
    },
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.reason, "mutation_context_unresolved_identity:target_repo");
});

}
