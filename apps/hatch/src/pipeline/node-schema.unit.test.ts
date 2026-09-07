import { describe, it, expect } from "vitest";
import { validateNodeSchemaContract, NODE_SCHEMA_RULE_CODES } from "./node-schema.js";
import type { Graph } from "./graph.js";

/** Helper to build a minimal graph with one node. */
function graphWith(nodeId: string, attrs: Record<string, string>): Graph {
	return {
		name: "test",
		attrs: {},
		nodes: { [nodeId]: { id: nodeId, attrs } },
		edges: [],
	} as any;
}

/** Helper to build a graph with multiple nodes. */
function graphWithNodes(nodes: Record<string, Record<string, string>>): Graph {
	const g: any = { name: "test", attrs: {}, nodes: {}, edges: [] };
	for (const [id, attrs] of Object.entries(nodes)) {
		g.nodes[id] = { id, attrs };
	}
	return g;
}

describe("validateNodeSchemaContract", () => {
	// ── Boolean validation ──

	describe("boolean attributes", () => {
		it("accepts true", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", fail_open: "true" }));
			expect(errors).toEqual([]);
		});

		it("accepts false", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", fail_open: "false" }));
			expect(errors).toEqual([]);
		});

		it("rejects typo like 'tru'", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", fail_open: "tru" }));
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
			expect(errors[0].nodeId).toBe("n1");
		});

		it("rejects '1' as boolean", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", fail_open: "1" }));
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		});

		it("rejects 'yes' for judge attribute", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", judge: "yes" }));
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		});

		it("allows absent boolean attributes (optional)", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm" }));
			expect(errors).toEqual([]);
		});

		it.each([
			"fail_open",
			"goal_gate",
			"auto_status",
			"allow_partial",
			"judge",
			"cleanup_on_success",
			"skip_prompt_if_commits_exist",
			"reuse_existing_commits",
			"inherit_context",
		])("validates boolean attribute '%s'", (attr) => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", [attr]: "bad" }));
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		});
	});

	// ── Enum validation ──

	describe("enum attributes", () => {
		it("accepts valid governance value", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { handler: "llm", governance: "reversible", recovery_owner: "ops" }),
			);
			// No enum error (may have irreversible warning but governance=reversible won't trigger it)
			const enumErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
			expect(enumErrors).toEqual([]);
		});

		it("rejects governance typo", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", governance: "irreversble" }));
			const enumErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
			expect(enumErrors).toHaveLength(1);
			expect(enumErrors[0].nodeId).toBe("n1");
		});

		it("skips empty enum value", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", governance: "" }));
			const enumErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
			expect(enumErrors).toEqual([]);
		});

		it.each([
			["governance", "reversible"],
			["governance_decision", "allow"],
			["recovery_sink_type", "wait"],
			["reasoning_effort", "high"],
			["complexity_class", "medium"],
			["action_runtime", "shell"],
		])("accepts valid %s='%s'", (attr, value) => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", [attr]: value }));
			const enumErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
			expect(enumErrors).toEqual([]);
		});
	});

	// ── Integer validation ──

	describe("integer attributes", () => {
		it("accepts valid integer", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", max_retries: "3" }));
			expect(errors).toEqual([]);
		});

		it("rejects non-integer string", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", max_retries: "three" }));
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(NODE_SCHEMA_RULE_CODES.INTEGER_INVALID);
		});

		it("skips empty integer value", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", max_retries: "" }));
			expect(errors).toEqual([]);
		});

		it("allows template variables like {{retries}}", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", max_retries: "{{retries}}" }));
			expect(errors).toEqual([]);
		});
	});

	// ── Required attributes ──

	describe("required attributes", () => {
		it("errors when pipeline node has neither prompt nor pipeline", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { type: "pipeline" }));
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors.length).toBeGreaterThanOrEqual(1);
		});

		it("accepts pipeline node with prompt", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { type: "pipeline", prompt: "do stuff" }));
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors).toEqual([]);
		});

		it("accepts pipeline node with pipeline attr", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { type: "pipeline", pipeline: "sub.dot" }));
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors).toEqual([]);
		});

		it("errors when fan_out.dynamic node is missing template", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "fan_out.dynamic", source_key: "items" }),
			);
			const reqErrors = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING && e.message?.includes("template"),
			);
			expect(reqErrors).toHaveLength(1);
		});

		it("errors when agent.worktree node is missing repo", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "agent.worktree", branch: "main" }),
			);
			const reqErrors = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING && e.message?.includes("repo"),
			);
			expect(reqErrors).toHaveLength(1);
		});

		it("no required-attr error for handler type llm", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { type: "llm" }));
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors).toEqual([]);
		});
	});

	// ── Cross-attribute constraints ──

	describe("cross-attribute constraints", () => {
		it("warns when governance=irreversible without recovery_owner", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { handler: "llm", governance: "irreversible" }));
			const warnings = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER,
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0].severity).toBe("warning");
		});

		it("no warning when governance=irreversible with recovery_owner", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { handler: "llm", governance: "irreversible", recovery_owner: "ops" }),
			);
			const warnings = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER,
			);
			expect(warnings).toEqual([]);
		});

		it("errors when exit node has fail_open=true", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "exit", fail_open: "true" }),
			);
			const exitErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_EXIT);
			expect(exitErrors).toHaveLength(1);
		});

		it("errors when start node has fail_open=true", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "start", fail_open: "true" }),
			);
			const structErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL);
			expect(structErrors).toHaveLength(1);
		});

		it("errors when conditional node has fail_open=true", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "conditional", fail_open: "true" }),
			);
			const structErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL);
			expect(structErrors).toHaveLength(1);
		});

		it("errors when tool node has action_runtime=in_process without action_id", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "tool", action_runtime: "in_process" }),
			);
			const toolErrors = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID,
			);
			expect(toolErrors).toHaveLength(1);
		});

		it("no error when tool node has action_runtime=in_process with action_id", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "tool", action_runtime: "in_process", action_id: "foo" }),
			);
			const toolErrors = errors.filter(
				(e) => e.code === NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID,
			);
			expect(toolErrors).toEqual([]);
		});

		it("errors when tool node has no prompt or prompt_source (non in_process)", () => {
			const errors = validateNodeSchemaContract(graphWith("n1", { type: "tool" }));
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors).toHaveLength(1);
		});

		it("no error when tool node has prompt", () => {
			const errors = validateNodeSchemaContract(
				graphWith("n1", { type: "tool", prompt: "do stuff" }),
			);
			const reqErrors = errors.filter((e) => e.code === NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
			expect(reqErrors).toEqual([]);
		});
	});

	// ── Multiple nodes ──

	describe("multiple nodes", () => {
		it("collects errors from multiple nodes", () => {
			const g = graphWithNodes({
				a: { handler: "llm", fail_open: "tru" },
				b: { handler: "llm", max_retries: "abc" },
			});
			const errors = validateNodeSchemaContract(g);
			expect(errors.length).toBeGreaterThanOrEqual(2);
			const nodeIds = errors.map((e) => e.nodeId);
			expect(nodeIds).toContain("a");
			expect(nodeIds).toContain("b");
		});
	});

	// ── Rule codes export ──

	describe("NODE_SCHEMA_RULE_CODES", () => {
		it("exports expected rule codes", () => {
			expect(NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID).toBe("schema.boolean.invalid");
			expect(NODE_SCHEMA_RULE_CODES.ENUM_INVALID).toBe("schema.enum.invalid");
			expect(NODE_SCHEMA_RULE_CODES.INTEGER_INVALID).toBe("schema.integer.invalid");
			expect(NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING).toBe("schema.required.missing");
			expect(NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID).toBe("schema.tool.in_process_requires_action_id");
			expect(NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER).toBe("schema.governance.irreversible_without_recovery_owner");
			expect(NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_EXIT).toBe("schema.fail_open.exit_node");
			expect(NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL).toBe("schema.fail_open.structural_node");
		});
	});
});
