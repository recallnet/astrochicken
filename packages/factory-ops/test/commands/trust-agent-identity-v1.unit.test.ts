import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_ID_KEY,
  AGENT_ROLE_KEY,
  AGENT_IDS_V1,
  AGENT_ROLES_V1,
  isValidAgentIdV1,
  isValidAgentRoleV1,
} from "../../src/lib/trust-agent-identity-v1.ts";

describe("trust-agent-identity-v1 constants", () => {
  it("AGENT_ID_KEY equals 'agent_id'", () => {
    assert.equal(AGENT_ID_KEY, "agent_id");
  });

  it("AGENT_ROLE_KEY equals 'agent_role'", () => {
    assert.equal(AGENT_ROLE_KEY, "agent_role");
  });

  it("AGENT_IDS_V1 is frozen with 8 entries", () => {
    assert.ok(Object.isFrozen(AGENT_IDS_V1));
    assert.equal(AGENT_IDS_V1.length, 8);
  });

  it("AGENT_IDS_V1 contains expected members", () => {
    assert.ok(AGENT_IDS_V1.includes("unknown"));
    assert.ok(AGENT_IDS_V1.includes("tool.shell"));
    assert.ok(AGENT_IDS_V1.includes("agent.worktree"));
  });

  it("AGENT_ROLES_V1 is frozen with 5 entries", () => {
    assert.ok(Object.isFrozen(AGENT_ROLES_V1));
    assert.equal(AGENT_ROLES_V1.length, 5);
  });

  it("AGENT_ROLES_V1 contains expected members", () => {
    assert.ok(AGENT_ROLES_V1.includes("unknown"));
    assert.ok(AGENT_ROLES_V1.includes("tool.operator"));
    assert.ok(AGENT_ROLES_V1.includes("worktree.implementer"));
  });
});

describe("isValidAgentIdV1", () => {
  it("accepts 'tool.shell'", () => {
    assert.equal(isValidAgentIdV1("tool.shell"), true);
  });

  it("accepts 'agent.worktree'", () => {
    assert.equal(isValidAgentIdV1("agent.worktree"), true);
  });

  it("accepts 'unknown'", () => {
    assert.equal(isValidAgentIdV1("unknown"), true);
  });

  it("rejects unrecognised id", () => {
    assert.equal(isValidAgentIdV1("not_real"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isValidAgentIdV1(""), false);
  });

  it("rejects null", () => {
    assert.equal(isValidAgentIdV1(null), false);
  });

  it("rejects undefined", () => {
    assert.equal(isValidAgentIdV1(undefined), false);
  });
});

describe("isValidAgentRoleV1", () => {
  it("accepts 'tool.operator'", () => {
    assert.equal(isValidAgentRoleV1("tool.operator"), true);
  });

  it("accepts 'worktree.implementer'", () => {
    assert.equal(isValidAgentRoleV1("worktree.implementer"), true);
  });

  it("rejects unrecognised role", () => {
    assert.equal(isValidAgentRoleV1("not_real"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isValidAgentRoleV1(""), false);
  });
});

describe("consistency: every array entry passes its validator", () => {
  it("all AGENT_IDS_V1 entries pass isValidAgentIdV1", () => {
    for (const id of AGENT_IDS_V1) {
      assert.equal(isValidAgentIdV1(id), true, `expected '${id}' to be valid`);
    }
  });

  it("all AGENT_ROLES_V1 entries pass isValidAgentRoleV1", () => {
    for (const role of AGENT_ROLES_V1) {
      assert.equal(isValidAgentRoleV1(role), true, `expected '${role}' to be valid`);
    }
  });
});
