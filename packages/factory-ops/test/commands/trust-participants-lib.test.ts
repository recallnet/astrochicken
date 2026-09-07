import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedTrustIdentityForHandlerType,
  expectedTrustRoleForHandlerType,
  isLegacyTrustIdentityKey,
  isTrustParticipatingHandlerType,
  isValidTrustDomain,
  isValidTrustRole,
  parseLegacyTrustIdentity,
  resolveHandlerTypeFromAttrs,
  shapeToHandlerType,
} from "../../src/lib/trust-participants.ts";

test("trust-participants helpers cover expected role/domain derivation paths", () => {
  assert.equal(isTrustParticipatingHandlerType("tool"), true);
  assert.equal(isTrustParticipatingHandlerType(undefined), false);

  assert.equal(expectedTrustRoleForHandlerType("tool"), "mothership.local.tool");
  assert.equal(expectedTrustRoleForHandlerType("missing.type"), "");

  assert.deepEqual(expectedTrustIdentityForHandlerType("tool"), {
    trust_domain: "mothership.local",
    trust_role: "mothership.local.tool",
  });
  assert.equal(expectedTrustIdentityForHandlerType("missing.type"), null);
});

test("trust-participants helpers parse and validate trust identity strings", () => {
  assert.equal(isLegacyTrustIdentityKey(" trust_participant "), true);
  assert.equal(isLegacyTrustIdentityKey("trust_domain"), false);

  assert.equal(parseLegacyTrustIdentity(""), null);
  assert.equal(parseLegacyTrustIdentity("noslash"), null);
  assert.equal(parseLegacyTrustIdentity("/role"), null);
  assert.equal(parseLegacyTrustIdentity("domain/"), null);
  assert.deepEqual(parseLegacyTrustIdentity("mothership.local/mothership.local.tool"), {
    domain: "mothership.local",
    role: "mothership.local.tool",
  });

  assert.equal(isValidTrustDomain("mothership.local"), true);
  assert.equal(isValidTrustDomain("EXAMPLE.LOCAL"), false);

  assert.equal(isValidTrustRole("mothership.local.tool"), true);
  assert.equal(isValidTrustRole("example local tool"), false);
});

test("trust-participants shape/type resolver handles explicit and fallback paths", () => {
  assert.equal(shapeToHandlerType("Mdiamond"), "start");
  assert.equal(shapeToHandlerType("Msquare"), "exit");
  assert.equal(shapeToHandlerType("parallelogram"), "tool");
  assert.equal(shapeToHandlerType("unknown-shape"), "codergen");

  assert.equal(resolveHandlerTypeFromAttrs({ type: "agent.worktree", shape: "parallelogram" }), "agent.worktree");
  assert.equal(resolveHandlerTypeFromAttrs({ shape: "parallelogram" }), "tool");
});
