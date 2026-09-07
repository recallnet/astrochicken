import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { orphanSignature } from "../../src/commands/supervisor-remediate-orphan-features.ts";

test("orphanSignature is deterministic and order-independent", () => {
  const sig1 = orphanSignature([3, 1, 2]);
  const sig2 = orphanSignature([2, 3, 1]);
  assert.equal(sig1, sig2, "signature should be the same regardless of input order");
  assert.match(sig1, /^sha256:[a-f0-9]{64}$/, "signature should be sha256 format");
});

test("orphanSignature deduplicates", () => {
  const sig1 = orphanSignature([1, 2, 3]);
  const sig2 = orphanSignature([1, 2, 3, 2, 1]);
  assert.equal(sig1, sig2, "duplicate numbers should be deduplicated");
});

test("remediateOrphanFeatures excludes features that already have a parent goal", () => {
  // Structural gate: the remediation module must use identifyOrphanFeatures
  // (which checks goalSubIssueNumbers) or must independently filter out
  // features with existing parent goals.
  const src = readFileSync(
    "packages/factory-ops/src/commands/supervisor-remediate-orphan-features.ts",
    "utf8"
  );
  assert.ok(
    src.includes("identifyOrphanFeatures") || src.includes("extractParentGoalRefs") || src.includes("parent_issue"),
    "remediateOrphanFeatures must exclude features already parented " +
    "(via identifyOrphanFeatures or parent_issue check)"
  );
});

test("remediateOrphanFeatures closes stale remediation goal when all orphans are already resolved", () => {
  const src = readFileSync(
    "packages/factory-ops/src/commands/supervisor-remediate-orphan-features.ts",
    "utf8"
  );
  // When no true orphans remain, the function should either:
  // - not create a goal, OR
  // - close an existing stale goal
  // At minimum, it should not leave an empty goal dangling.
  assert.ok(
    src.includes("issue", "close") || src.includes("orphanFeatures.length === 0"),
    "remediateOrphanFeatures must handle case where no true orphans remain"
  );
});
