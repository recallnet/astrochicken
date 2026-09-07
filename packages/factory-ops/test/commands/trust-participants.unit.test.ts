import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TRUST_DOMAIN_KEY,
  TRUST_ROLE_KEY,
  LEGACY_TRUST_IDENTITY_KEY,
  LOCAL_INTENTS_TRUST_DOMAIN,
  LOCAL_INTENTS_TRUST_ROLE_NAMESPACE,
  TRUST_ROLE_BY_HANDLER_TYPE,
  TRUST_ROLE_ALLOWLIST,
  TRUST_DOMAIN_ALLOWLIST,
  isTrustParticipatingHandlerType,
  expectedTrustRoleForHandlerType,
  expectedTrustIdentityForHandlerType,
  isLegacyTrustIdentityKey,
  parseLegacyTrustIdentity,
  isValidTrustDomain,
  isValidTrustRole,
  shapeToHandlerType,
  resolveHandlerTypeFromAttrs,
} from "../../src/lib/trust-participants.ts";

describe("trust-participants constants", () => {
  it("TRUST_DOMAIN_KEY equals 'trust_domain'", () => {
    assert.equal(TRUST_DOMAIN_KEY, "trust_domain");
  });

  it("TRUST_ROLE_KEY equals 'trust_role'", () => {
    assert.equal(TRUST_ROLE_KEY, "trust_role");
  });

  it("LEGACY_TRUST_IDENTITY_KEY equals 'trust_participant'", () => {
    assert.equal(LEGACY_TRUST_IDENTITY_KEY, "trust_participant");
  });

  it("LOCAL_INTENTS_TRUST_DOMAIN equals 'mothership.local'", () => {
    assert.equal(LOCAL_INTENTS_TRUST_DOMAIN, "mothership.local");
  });

  it("LOCAL_INTENTS_TRUST_ROLE_NAMESPACE equals 'mothership.local'", () => {
    assert.equal(LOCAL_INTENTS_TRUST_ROLE_NAMESPACE, "mothership.local");
  });

  it("TRUST_ROLE_BY_HANDLER_TYPE is frozen with all expected keys", () => {
    assert.ok(Object.isFrozen(TRUST_ROLE_BY_HANDLER_TYPE));
    const expectedKeys = [
      "codergen",
      "tool",
      "agent.worktree",
      "stack.manager_loop",
      "pipeline",
      "fan_out.dynamic",
      "fan_in.dynamic",
    ];
    assert.deepEqual(Object.keys(TRUST_ROLE_BY_HANDLER_TYPE).sort(), expectedKeys.sort());
  });

  it("all TRUST_ROLE_BY_HANDLER_TYPE values start with role namespace", () => {
    for (const [key, value] of Object.entries(TRUST_ROLE_BY_HANDLER_TYPE)) {
      assert.ok(
        value.startsWith(LOCAL_INTENTS_TRUST_ROLE_NAMESPACE + "."),
        `${key} role "${value}" should start with "${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}."`
      );
    }
  });

  it("TRUST_ROLE_ALLOWLIST is a Set of all role values", () => {
    assert.ok(TRUST_ROLE_ALLOWLIST instanceof Set);
    for (const value of Object.values(TRUST_ROLE_BY_HANDLER_TYPE)) {
      assert.ok(TRUST_ROLE_ALLOWLIST.has(value), `allowlist should contain "${value}"`);
    }
    assert.equal(TRUST_ROLE_ALLOWLIST.size, Object.values(TRUST_ROLE_BY_HANDLER_TYPE).length);
  });

  it("TRUST_DOMAIN_ALLOWLIST contains only the local domain", () => {
    assert.ok(TRUST_DOMAIN_ALLOWLIST instanceof Set);
    assert.equal(TRUST_DOMAIN_ALLOWLIST.size, 1);
    assert.ok(TRUST_DOMAIN_ALLOWLIST.has(LOCAL_INTENTS_TRUST_DOMAIN));
  });
});

describe("isTrustParticipatingHandlerType", () => {
  it("returns true for all known handler types", () => {
    for (const key of Object.keys(TRUST_ROLE_BY_HANDLER_TYPE)) {
      assert.equal(isTrustParticipatingHandlerType(key), true, `${key} should be participating`);
    }
  });

  it("returns false for unknown handler types", () => {
    assert.equal(isTrustParticipatingHandlerType("unknown"), false);
    assert.equal(isTrustParticipatingHandlerType("start"), false);
    assert.equal(isTrustParticipatingHandlerType("exit"), false);
    assert.equal(isTrustParticipatingHandlerType("conditional"), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isTrustParticipatingHandlerType(undefined), false);
  });

  it("returns false for null", () => {
    assert.equal(isTrustParticipatingHandlerType(null), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isTrustParticipatingHandlerType(""), false);
  });

  it("returns false for numeric input", () => {
    assert.equal(isTrustParticipatingHandlerType(42), false);
  });
});

describe("expectedTrustRoleForHandlerType", () => {
  it("returns correct role for each known handler type", () => {
    assert.equal(expectedTrustRoleForHandlerType("codergen"), "mothership.local.codergen");
    assert.equal(expectedTrustRoleForHandlerType("tool"), "mothership.local.tool");
    assert.equal(expectedTrustRoleForHandlerType("agent.worktree"), "mothership.local.agent.worktree");
    assert.equal(expectedTrustRoleForHandlerType("stack.manager_loop"), "mothership.local.stack.manager_loop");
    assert.equal(expectedTrustRoleForHandlerType("pipeline"), "mothership.local.pipeline");
    assert.equal(expectedTrustRoleForHandlerType("fan_out.dynamic"), "mothership.local.fan_out.dynamic");
    assert.equal(expectedTrustRoleForHandlerType("fan_in.dynamic"), "mothership.local.fan_in.dynamic");
  });

  it("returns empty string for unknown handler type", () => {
    assert.equal(expectedTrustRoleForHandlerType("unknown"), "");
    assert.equal(expectedTrustRoleForHandlerType("start"), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(expectedTrustRoleForHandlerType(undefined), "");
  });

  it("returns empty string for null", () => {
    assert.equal(expectedTrustRoleForHandlerType(null), "");
  });

  it("returns empty string for empty string", () => {
    assert.equal(expectedTrustRoleForHandlerType(""), "");
  });
});

describe("expectedTrustIdentityForHandlerType", () => {
  it("returns trust identity object for known handler type", () => {
    const identity = expectedTrustIdentityForHandlerType("tool");
    assert.deepEqual(identity, {
      trust_domain: "mothership.local",
      trust_role: "mothership.local.tool",
    });
  });

  it("returns identity for each participating handler type", () => {
    for (const [key, role] of Object.entries(TRUST_ROLE_BY_HANDLER_TYPE)) {
      const identity = expectedTrustIdentityForHandlerType(key);
      assert.ok(identity !== null, `${key} should produce an identity`);
      assert.equal(identity.trust_domain, LOCAL_INTENTS_TRUST_DOMAIN);
      assert.equal(identity.trust_role, role);
    }
  });

  it("returns null for unknown handler type", () => {
    assert.equal(expectedTrustIdentityForHandlerType("unknown"), null);
  });

  it("returns null for undefined", () => {
    assert.equal(expectedTrustIdentityForHandlerType(undefined), null);
  });

  it("returns null for null", () => {
    assert.equal(expectedTrustIdentityForHandlerType(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(expectedTrustIdentityForHandlerType(""), null);
  });
});

describe("isLegacyTrustIdentityKey", () => {
  it("returns true for exact legacy key", () => {
    assert.equal(isLegacyTrustIdentityKey("trust_participant"), true);
  });

  it("returns true for legacy key with surrounding whitespace", () => {
    assert.equal(isLegacyTrustIdentityKey(" trust_participant "), true);
    assert.equal(isLegacyTrustIdentityKey("\ttrust_participant\n"), true);
  });

  it("returns false for trust_domain key", () => {
    assert.equal(isLegacyTrustIdentityKey("trust_domain"), false);
  });

  it("returns false for trust_role key", () => {
    assert.equal(isLegacyTrustIdentityKey("trust_role"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isLegacyTrustIdentityKey(""), false);
  });

  it("returns false for null", () => {
    assert.equal(isLegacyTrustIdentityKey(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isLegacyTrustIdentityKey(undefined), false);
  });

  it("returns false for partial match", () => {
    assert.equal(isLegacyTrustIdentityKey("trust_participantx"), false);
    assert.equal(isLegacyTrustIdentityKey("xtrust_participant"), false);
  });
});

describe("parseLegacyTrustIdentity", () => {
  it("parses valid domain/role format", () => {
    assert.deepEqual(parseLegacyTrustIdentity("mothership.local/mothership.local.tool"), {
      domain: "mothership.local",
      role: "mothership.local.tool",
    });
  });

  it("trims whitespace from domain and role", () => {
    assert.deepEqual(parseLegacyTrustIdentity(" domain / role "), {
      domain: "domain",
      role: "role",
    });
  });

  it("returns null for empty string", () => {
    assert.equal(parseLegacyTrustIdentity(""), null);
  });

  it("returns null for null", () => {
    assert.equal(parseLegacyTrustIdentity(null), null);
  });

  it("returns null for undefined", () => {
    assert.equal(parseLegacyTrustIdentity(undefined), null);
  });

  it("returns null for string without slash", () => {
    assert.equal(parseLegacyTrustIdentity("noslash"), null);
  });

  it("returns null for string starting with slash (no domain)", () => {
    assert.equal(parseLegacyTrustIdentity("/role"), null);
  });

  it("returns null for string ending with slash (no role)", () => {
    assert.equal(parseLegacyTrustIdentity("domain/"), null);
  });

  it("returns null for only a slash", () => {
    assert.equal(parseLegacyTrustIdentity("/"), null);
  });

  it("returns null for whitespace-only string", () => {
    assert.equal(parseLegacyTrustIdentity("   "), null);
  });

  it("handles multiple slashes by splitting on first", () => {
    const result = parseLegacyTrustIdentity("a/b/c");
    assert.deepEqual(result, { domain: "a", role: "b/c" });
  });

  it("returns null when domain is whitespace-only before slash", () => {
    assert.equal(parseLegacyTrustIdentity("  /role"), null);
  });

  it("returns null when role is whitespace-only after slash", () => {
    assert.equal(parseLegacyTrustIdentity("domain/  "), null);
  });
});

describe("isValidTrustDomain", () => {
  it("returns true for valid simple domain", () => {
    assert.equal(isValidTrustDomain("example"), true);
  });

  it("returns true for valid dotted domain", () => {
    assert.equal(isValidTrustDomain("mothership.local"), true);
  });

  it("returns true for hyphenated domain", () => {
    assert.equal(isValidTrustDomain("my-domain"), true);
  });

  it("returns true for underscored domain", () => {
    assert.equal(isValidTrustDomain("my_domain"), true);
  });

  it("returns false for uppercase letters", () => {
    assert.equal(isValidTrustDomain("EXAMPLE.LOCAL"), false);
    assert.equal(isValidTrustDomain("MyDomain"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isValidTrustDomain(""), false);
  });

  it("returns false for null", () => {
    assert.equal(isValidTrustDomain(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isValidTrustDomain(undefined), false);
  });

  it("returns false for spaces", () => {
    assert.equal(isValidTrustDomain("my domain"), false);
  });

  it("returns false for leading dot", () => {
    assert.equal(isValidTrustDomain(".domain"), false);
  });

  it("returns false for trailing dot", () => {
    assert.equal(isValidTrustDomain("domain."), false);
  });

  it("returns false for consecutive dots", () => {
    assert.equal(isValidTrustDomain("domain..local"), false);
  });
});

describe("isValidTrustRole", () => {
  it("returns true for valid dotted role with two segments", () => {
    assert.equal(isValidTrustRole("mothership.local.tool"), true);
  });

  it("returns true for multi-segment dotted role", () => {
    assert.equal(isValidTrustRole("mothership.local.agent.worktree"), true);
  });

  it("returns true for role with underscores", () => {
    assert.equal(isValidTrustRole("mothership.local.fan_out.dynamic"), true);
  });

  it("returns false for single segment (no dots)", () => {
    assert.equal(isValidTrustRole("tool"), false);
  });

  it("returns false for spaces", () => {
    assert.equal(isValidTrustRole("example local tool"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isValidTrustRole(""), false);
  });

  it("returns false for null", () => {
    assert.equal(isValidTrustRole(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isValidTrustRole(undefined), false);
  });

  it("returns false for uppercase", () => {
    assert.equal(isValidTrustRole("Mothership.Local.Tool"), false);
  });

  it("returns false for leading dot", () => {
    assert.equal(isValidTrustRole(".role.tool"), false);
  });

  it("returns false for trailing dot", () => {
    assert.equal(isValidTrustRole("role.tool."), false);
  });

  it("all roles in TRUST_ROLE_ALLOWLIST pass validation", () => {
    for (const role of TRUST_ROLE_ALLOWLIST) {
      assert.equal(isValidTrustRole(role), true, `allowlisted role "${role}" should be valid`);
    }
  });

  it("all domains in TRUST_DOMAIN_ALLOWLIST pass domain validation", () => {
    for (const domain of TRUST_DOMAIN_ALLOWLIST) {
      assert.equal(isValidTrustDomain(domain), true, `allowlisted domain "${domain}" should be valid`);
    }
  });
});

describe("shapeToHandlerType", () => {
  it("maps Mdiamond to start", () => {
    assert.equal(shapeToHandlerType("Mdiamond"), "start");
  });

  it("maps Msquare to exit", () => {
    assert.equal(shapeToHandlerType("Msquare"), "exit");
  });

  it("maps box to codergen", () => {
    assert.equal(shapeToHandlerType("box"), "codergen");
  });

  it("maps empty string to codergen", () => {
    assert.equal(shapeToHandlerType(""), "codergen");
  });

  it("maps hexagon to wait.human", () => {
    assert.equal(shapeToHandlerType("hexagon"), "wait.human");
  });

  it("maps diamond to conditional", () => {
    assert.equal(shapeToHandlerType("diamond"), "conditional");
  });

  it("maps component to parallel", () => {
    assert.equal(shapeToHandlerType("component"), "parallel");
  });

  it("maps tripleoctagon to parallel.fan_in", () => {
    assert.equal(shapeToHandlerType("tripleoctagon"), "parallel.fan_in");
  });

  it("maps parallelogram to tool", () => {
    assert.equal(shapeToHandlerType("parallelogram"), "tool");
  });

  it("maps house to stack.manager_loop", () => {
    assert.equal(shapeToHandlerType("house"), "stack.manager_loop");
  });

  it("maps octagon to assert", () => {
    assert.equal(shapeToHandlerType("octagon"), "assert");
  });

  it("defaults unknown shapes to codergen", () => {
    assert.equal(shapeToHandlerType("unknown-shape"), "codergen");
    assert.equal(shapeToHandlerType("ellipse"), "codergen");
    assert.equal(shapeToHandlerType("rectangle"), "codergen");
  });

  it("defaults null to codergen", () => {
    assert.equal(shapeToHandlerType(null), "codergen");
  });

  it("defaults undefined to codergen", () => {
    assert.equal(shapeToHandlerType(undefined), "codergen");
  });
});

describe("resolveHandlerTypeFromAttrs", () => {
  it("returns explicit type when provided", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ type: "agent.worktree" }), "agent.worktree");
  });

  it("explicit type takes precedence over shape", () => {
    assert.equal(
      resolveHandlerTypeFromAttrs({ type: "agent.worktree", shape: "parallelogram" }),
      "agent.worktree"
    );
  });

  it("falls back to shape-based resolution when no explicit type", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ shape: "parallelogram" }), "tool");
    assert.equal(resolveHandlerTypeFromAttrs({ shape: "Mdiamond" }), "start");
    assert.equal(resolveHandlerTypeFromAttrs({ shape: "house" }), "stack.manager_loop");
  });

  it("returns codergen when no type and no shape", () => {
    assert.equal(resolveHandlerTypeFromAttrs({}), "codergen");
  });

  it("returns codergen when called with no arguments", () => {
    assert.equal(resolveHandlerTypeFromAttrs(), "codergen");
  });

  it("trims whitespace from explicit type", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ type: " tool " }), "tool");
  });

  it("ignores whitespace-only type and falls back to shape", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ type: "   ", shape: "diamond" }), "conditional");
  });

  it("handles null attrs by returning codergen", () => {
    assert.equal(resolveHandlerTypeFromAttrs(null), "codergen");
  });

  it("handles type as non-string", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ type: 0 }), "codergen");
  });

  it("uses shape fallback when type is empty string", () => {
    assert.equal(resolveHandlerTypeFromAttrs({ type: "", shape: "octagon" }), "assert");
  });
});
