import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateManagedFactoryMutationPolicy,
  isControlPlane,
  isDestination,
  isTargetRepo,
  isLocalFilesystemPath,
  loadManagedFactoryMutationPolicyContract,
} from "../../src/lib/mutation-policy-contract.ts";

const BASE_MUTATION_CONTEXT = {
  target_repo: "example-org/home",
  destinations: {
    astrochicken: { repo: "example-org/destination" },
  },
  control_plane_repo: "example-org/control-plane",
  instance_id: "fac_123",
};

test("loadManagedFactoryMutationPolicyContract loads managed-factory policy v1", () => {
  const contract = loadManagedFactoryMutationPolicyContract({ forceReload: true });
  assert.equal(contract.schema_version, "managed_factory_mutation_policy/v1");
  assert.equal(Array.isArray(contract.metadata.required_context_keys), true);
  assert.equal(contract.metadata.required_context_keys.includes("target_repo"), true);
  assert.equal(contract.metadata.required_context_keys.includes("instance_id"), true);
});

test("evaluateManagedFactoryMutationPolicy canonicalizes identities via factory-repo-roles", () => {
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      target_repo: "https://github.com/Example-Org/Home.git",
      destinations: {
        external: { repo: "git@github.com:Example-Org/Destination.git" },
      },
      control_plane_repo: "git@github.com:Example-Org/Control-Plane.git",
      instance_id: "fac_123",
      operation: "git:push",
      target_repo: "example-org/home",
      target_branch: "feature/test",
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.normalized_context.target_repo, "example-org/home");
  assert.deepEqual(result.normalized_context.destinations, ["example-org/destination"]);
  assert.equal(result.normalized_context.control_plane_repo, "example-org/control-plane");
});

test("evaluateManagedFactoryMutationPolicy allows target repo mutating operations by default", () => {
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      ...BASE_MUTATION_CONTEXT,
      operation: "git:branch-create",
      target_repo: "example-org/home",
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "mutation_policy_allowed:target_repo:git:branch-create");
});

test("evaluateManagedFactoryMutationPolicy forbids destination repo git mutations", () => {
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      ...BASE_MUTATION_CONTEXT,
      operation: "git:push",
      target_repo: "example-org/destination",
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denied_reason, "mutation_policy_destination_git_mutation_forbidden");
});

test("evaluateManagedFactoryMutationPolicy fails closed on missing identity keys", () => {
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      target_repo: "example-org/home",
      destinations: {},
      instance_id: "fac_123",
      operation: "git:push",
      target_repo: "example-org/home",
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denied_reason, "mutation_policy_missing_required_context:control_plane_repo");
});

test("evaluateManagedFactoryMutationPolicy denies unknown boundaries", () => {
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      ...BASE_MUTATION_CONTEXT,
      operation: "git:push",
      target_repo: "example-org/unmapped",
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denied_reason, "mutation_policy_unknown_boundary");
});

test("isTargetRepo/isDestination/isControlPlane and isLocalFilesystemPath classify boundaries", () => {
  const context = {
    targetRepo: "Example-Org/Home",
    controlPlaneRepo: "example-org/control-plane",
    destinationRepos: ["example-org/destination"],
  };

  assert.equal(isTargetRepo("example-org/home", context), true);
  assert.equal(isDestination("example-org/destination", context), true);
  assert.equal(isControlPlane("example-org/control-plane", context), true);

  assert.equal(isLocalFilesystemPath(".hatch/fac_123/state.json", { instanceId: "fac_123", cwd: "/tmp/repo" }), true);
  assert.equal(
    isLocalFilesystemPath("~/.hatch-hosts/installations/fac_123/state.json", { instanceId: "fac_123", cwd: "/tmp/repo", homeDirectory: "/Users/tester" }),
    true,
  );
  assert.equal(isLocalFilesystemPath("/tmp/repo/.hatch/fac_other/state.json", { instanceId: "fac_123", cwd: "/tmp/repo" }), false);
  assert.equal(isLocalFilesystemPath("/tmp/outside.txt", { instanceId: "fac_123", cwd: "/tmp/repo" }), false);

  // Approved worktree roots allow paths under .hatch-worktrees/
  assert.equal(
    isLocalFilesystemPath("/tmp/.hatch-worktrees/wave/goal/2140", {
      instanceId: "fac_123", cwd: "/tmp/repo",
      approvedWorktreeRoots: ["/tmp/.hatch-worktrees/wave", "/tmp/.hatch-worktrees/merge"],
    }),
    true,
  );
  assert.equal(
    isLocalFilesystemPath("/tmp/outside/path", {
      instanceId: "fac_123", cwd: "/tmp/repo",
      approvedWorktreeRoots: ["/tmp/.hatch-worktrees/wave"],
    }),
    false,
  );
});
