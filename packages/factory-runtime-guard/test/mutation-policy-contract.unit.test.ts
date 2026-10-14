import assert from "node:assert/strict";
import test from "node:test";

import { evaluateManagedFactoryMutationPolicy, isControlPlane, isDestination, isTargetRepo, isLocalFilesystemPath, loadManagedFactoryMutationPolicyContract,  } from "../src/mutation-policy-contract.ts";

import { registerSharedCases } from "./mutation-policy-contract.shared-suite.ts";

registerSharedCases({ evaluateManagedFactoryMutationPolicy, isControlPlane, isDestination, isTargetRepo, isLocalFilesystemPath, loadManagedFactoryMutationPolicyContract });

test("resolveBoundary classifies control plane repo before destination when repo is both", () => {
  // example-trading scenario: astrochicken is both a destination (platform_incidents)
  // and the control plane. Control plane should win so git:pull is allowed.
  const result = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      target_repo: "example-org/example-trading",
      destinations: {
        platform_incidents: { repo: "recallnet/astrochicken", labels: ["managed-factory-bug"] },
      },
      control_plane_repo: "recallnet/astrochicken",
      instance_id: "example-trading",
      operation: "git:pull",
      repo_slug: "recallnet/astrochicken",
    },
  });

  assert.equal(result.boundary, "control_plane_repo", "should resolve as control_plane_repo, not destination_repo");
  assert.equal(result.allowed, true, "git:pull on control plane must be allowed");
});
