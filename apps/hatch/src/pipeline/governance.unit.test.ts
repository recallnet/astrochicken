import { describe, it, expect } from "vitest";
import {
	TOOL_IDENTIFIERS_V1,
	ACTION_IDENTIFIERS_V1,
	GOVERNANCE_KINDS_V1,
	GOVERNANCE_DECISIONS_V1,
	AGENT_IDS_V1,
	AGENT_ROLES_V1,
	TRUST_PARTICIPATING_HANDLER_TYPES,
	DEFAULT_AGENT_IDENTITY_FALLBACK_V1,
	isToolIdentifierV1,
	isActionIdentifierV1,
	isGovernanceKindV1,
	isGovernanceDecisionV1,
	isAgentIdV1,
	isAgentRoleV1,
	isTrustParticipatingHandlerType,
} from "./governance.js";

describe("governance type guards", () => {
	describe("isToolIdentifierV1", () => {
		it("accepts 'shell'", () => expect(isToolIdentifierV1("shell")).toBe(true));
		it("accepts 'python'", () => expect(isToolIdentifierV1("python")).toBe(true));
		it("accepts 'http'", () => expect(isToolIdentifierV1("http")).toBe(true));
		it("rejects 'unknown'", () => expect(isToolIdentifierV1("unknown")).toBe(false));
		it("rejects empty string", () => expect(isToolIdentifierV1("")).toBe(false));
	});

	describe("isActionIdentifierV1", () => {
		it("accepts 'context.capture'", () => expect(isActionIdentifierV1("context.capture")).toBe(true));
		it("accepts 'file.write'", () => expect(isActionIdentifierV1("file.write")).toBe(true));
		it("accepts 'git.commit'", () => expect(isActionIdentifierV1("git.commit")).toBe(true));
		it("rejects 'not_an_action'", () => expect(isActionIdentifierV1("not_an_action")).toBe(false));
		it("rejects empty string", () => expect(isActionIdentifierV1("")).toBe(false));
	});

	describe("isGovernanceKindV1", () => {
		it("accepts 'reversible'", () => expect(isGovernanceKindV1("reversible")).toBe(true));
		it("accepts 'irreversible'", () => expect(isGovernanceKindV1("irreversible")).toBe(true));
		it("rejects 'other'", () => expect(isGovernanceKindV1("other")).toBe(false));
		it("rejects empty string", () => expect(isGovernanceKindV1("")).toBe(false));
	});

	describe("isGovernanceDecisionV1", () => {
		it("accepts 'allow'", () => expect(isGovernanceDecisionV1("allow")).toBe(true));
		it("accepts 'review'", () => expect(isGovernanceDecisionV1("review")).toBe(true));
		it("accepts 'deny'", () => expect(isGovernanceDecisionV1("deny")).toBe(true));
		it("rejects 'other'", () => expect(isGovernanceDecisionV1("other")).toBe(false));
		it("rejects empty string", () => expect(isGovernanceDecisionV1("")).toBe(false));
	});

	describe("isAgentIdV1", () => {
		it("accepts 'unknown'", () => expect(isAgentIdV1("unknown")).toBe(true));
		it("accepts 'tool.shell'", () => expect(isAgentIdV1("tool.shell")).toBe(true));
		it("accepts 'agent.worktree'", () => expect(isAgentIdV1("agent.worktree")).toBe(true));
		it("rejects 'unknown_agent'", () => expect(isAgentIdV1("unknown_agent")).toBe(false));
		it("rejects empty string", () => expect(isAgentIdV1("")).toBe(false));
	});

	describe("isAgentRoleV1", () => {
		it("accepts 'unknown'", () => expect(isAgentRoleV1("unknown")).toBe(true));
		it("accepts 'tool.operator'", () => expect(isAgentRoleV1("tool.operator")).toBe(true));
		it("accepts 'worktree.implementer'", () => expect(isAgentRoleV1("worktree.implementer")).toBe(true));
		it("rejects 'unknown_role'", () => expect(isAgentRoleV1("unknown_role")).toBe(false));
		it("rejects empty string", () => expect(isAgentRoleV1("")).toBe(false));
	});

	describe("isTrustParticipatingHandlerType", () => {
		it("accepts 'tool'", () => expect(isTrustParticipatingHandlerType("tool")).toBe(true));
		it("accepts 'agent.worktree'", () => expect(isTrustParticipatingHandlerType("agent.worktree")).toBe(true));
		it("accepts 'stack.manager_loop'", () => expect(isTrustParticipatingHandlerType("stack.manager_loop")).toBe(true));
		it("accepts 'agent.kw'", () => expect(isTrustParticipatingHandlerType("agent.kw")).toBe(true));
		it("rejects 'llm'", () => expect(isTrustParticipatingHandlerType("llm")).toBe(false));
		it("rejects empty string", () => expect(isTrustParticipatingHandlerType("")).toBe(false));
	});
});

describe("governance constants", () => {
	describe("TOOL_IDENTIFIERS_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(TOOL_IDENTIFIERS_V1)).toBe(true));
		it("contains exactly [shell, python, http]", () => {
			expect([...TOOL_IDENTIFIERS_V1]).toEqual(["shell", "python", "http"]);
		});
	});

	describe("GOVERNANCE_KINDS_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(GOVERNANCE_KINDS_V1)).toBe(true));
		it("contains exactly [reversible, irreversible]", () => {
			expect([...GOVERNANCE_KINDS_V1]).toEqual(["reversible", "irreversible"]);
		});
	});

	describe("GOVERNANCE_DECISIONS_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(GOVERNANCE_DECISIONS_V1)).toBe(true));
		it("contains exactly [allow, review, deny]", () => {
			expect([...GOVERNANCE_DECISIONS_V1]).toEqual(["allow", "review", "deny"]);
		});
	});

	describe("ACTION_IDENTIFIERS_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(ACTION_IDENTIFIERS_V1)).toBe(true));
		it("is non-empty", () => expect(ACTION_IDENTIFIERS_V1.length).toBeGreaterThan(0));
		it("all entries are non-empty strings", () => {
			for (const entry of ACTION_IDENTIFIERS_V1) {
				expect(typeof entry).toBe("string");
				expect(entry.length).toBeGreaterThan(0);
			}
		});
	});

	describe("AGENT_IDS_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(AGENT_IDS_V1)).toBe(true));
		it("is non-empty", () => expect(AGENT_IDS_V1.length).toBeGreaterThan(0));
	});

	describe("AGENT_ROLES_V1", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(AGENT_ROLES_V1)).toBe(true));
		it("is non-empty", () => expect(AGENT_ROLES_V1.length).toBeGreaterThan(0));
	});

	describe("TRUST_PARTICIPATING_HANDLER_TYPES", () => {
		it("is a readonly tuple (as const)", () => expect(Array.isArray(TRUST_PARTICIPATING_HANDLER_TYPES)).toBe(true));
		it("contains expected entries", () => {
			expect([...TRUST_PARTICIPATING_HANDLER_TYPES]).toEqual(["tool", "stack.manager_loop", "agent.worktree", "agent.kw"]);
		});
	});
});

describe("DEFAULT_AGENT_IDENTITY_FALLBACK_V1", () => {
	it("has required agentId field", () => {
		expect(DEFAULT_AGENT_IDENTITY_FALLBACK_V1).toHaveProperty("agentId");
	});

	it("has required agentRole field", () => {
		expect(DEFAULT_AGENT_IDENTITY_FALLBACK_V1).toHaveProperty("agentRole");
	});

	it("agentId is a valid AGENT_IDS_V1 entry", () => {
		expect(isAgentIdV1(DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId)).toBe(true);
	});

	it("agentRole is a valid AGENT_ROLES_V1 entry", () => {
		expect(isAgentRoleV1(DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole)).toBe(true);
	});
});

describe("consistency invariants", () => {
	it("every ACTION_IDENTIFIERS_V1 entry passes isActionIdentifierV1", () => {
		for (const action of ACTION_IDENTIFIERS_V1) {
			expect(isActionIdentifierV1(action)).toBe(true);
		}
	});

	it("every TOOL_IDENTIFIERS_V1 entry passes isToolIdentifierV1", () => {
		for (const tool of TOOL_IDENTIFIERS_V1) {
			expect(isToolIdentifierV1(tool)).toBe(true);
		}
	});

	it("every AGENT_IDS_V1 entry passes isAgentIdV1", () => {
		for (const id of AGENT_IDS_V1) {
			expect(isAgentIdV1(id)).toBe(true);
		}
	});

	it("every AGENT_ROLES_V1 entry passes isAgentRoleV1", () => {
		for (const role of AGENT_ROLES_V1) {
			expect(isAgentRoleV1(role)).toBe(true);
		}
	});
});
