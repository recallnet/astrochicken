import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";
import { validate } from "./validate.js";

import type { ValidationError } from "./validate.js";

function expectFailure(errors: ValidationError[], nodeId: string, rule: string, messagePrefix?: string): void {
	expect(errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				nodeId,
				rule,
				...(messagePrefix ? { message: expect.stringMatching(new RegExp(`^${messagePrefix}`)) } : {}),
			}),
		]),
	);
}

describe("agent identity validation modes", () => {
	const legacyGraphSource = `
	digraph identity_legacy_graph {
		start [shape=Mdiamond]
		legacy_tool [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> legacy_tool -> done
	}
	`;

	it("defaults to legacy mode when omitted", () => {
		const graph = parse(`
	digraph identity_legacy_default {
		start [shape=Mdiamond]
		trusted [type="tool" governance="reversible"]
		non_trusted [type="codergen" agent_id="tool.shell" agent_version="1.0.0"]
		done [shape=Msquare]

		start -> trusted -> non_trusted -> done
	}
		`);

		const defaultErrors = validate(graph);
		const defaultIdentityErrors = defaultErrors.filter((error) => ["agent_id", "agent_version", "agent_identity_scope"].includes(error.rule));
		expect(defaultIdentityErrors).toEqual([]);

		const legacyErrors = validate(graph, { validationMode: "legacy" });
		const legacyIdentityErrors = legacyErrors.filter((error) => ["agent_id", "agent_version", "agent_identity_scope"].includes(error.rule));
		expect(legacyIdentityErrors).toEqual([]);
	});

	it("accepts old-style trust graph in explicit legacy mode", () => {
		const graph = parse(legacyGraphSource);
		const legacyErrors = validate(graph, { validationMode: "legacy" });
		expect(legacyErrors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "legacy_tool", rule: "agent_id" }),
				expect.objectContaining({ nodeId: "legacy_tool", rule: "agent_version" }),
			]),
		);
	});

	it("fails the same old-style graph in strict mode with explicit identity rules", () => {
		const graph = parse(legacyGraphSource);
		const strictErrors = validate(graph, { validationMode: "strict" });

		expectFailure(strictErrors, "legacy_tool", "agent_id", "invalid agent_id");
		expectFailure(strictErrors, "legacy_tool", "agent_version", "invalid agent_version");
	});

	it("enforces strict agent identity rules on trust-participating and non-participating nodes", () => {
		const graph = parse(`
	digraph identity_strict {
		start [shape=Mdiamond]
		trusted_missing [type="tool" governance="reversible"]
		trusted_bad [type="agent.worktree" governance="reversible" agent_id=" tool.shell " agent_version="v1"]
		non_trusted [type="codergen" agent_id="tool.shell"]
		done [shape=Msquare]

		start -> trusted_missing -> trusted_bad -> non_trusted -> done
	}
		`);

		const errors = validate(graph, { validationMode: "strict" });

		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "agent_id", nodeId: "trusted_missing" }),
				expect.objectContaining({ rule: "agent_version", nodeId: "trusted_missing" }),
				expect.objectContaining({ rule: "agent_id", nodeId: "trusted_bad" }),
				expect.objectContaining({ rule: "agent_version", nodeId: "trusted_bad" }),
				expect.objectContaining({ rule: "agent_identity_scope", nodeId: "non_trusted" }),
			]),
		);
	});

	it("accepts valid strict identity attributes", () => {
		const graph = parse(`
	digraph identity_strict_valid {
		start [shape=Mdiamond]
		trusted_tool [type="tool" governance="reversible" agent_id="tool.shell" agent_version="1.2.3"]
		trusted_kw [type="agent.kw" governance="irreversible" agent_id="agent.kw" agent_version="2.0.0-beta.1"]
		non_trusted [type="codergen"]
		done [shape=Msquare]

		start -> trusted_tool -> trusted_kw -> non_trusted -> done
	}
		`);

		const errors = validate(graph, { validationMode: "strict" });
		const identityErrors = errors.filter((error) => ["agent_id", "agent_version", "agent_identity_scope"].includes(error.rule));
		expect(identityErrors).toEqual([]);
	});

	it("asserts exact rule attribution for invalid identity contract values", () => {
		const graph = parse(`
	digraph identity_invalid_values {
		start [shape=Mdiamond]
		bad_agent_id [type="tool" governance="reversible" agent_id=" tool.shell" agent_version="1.0.0"]
		bad_agent_version [type="tool" governance="reversible" agent_id="tool.shell" agent_version="1"]
		bad_scope [type="codergen" agent_id="tool.shell"]
		done [shape=Msquare]

		start -> bad_agent_id -> bad_agent_version -> bad_scope -> done
	}
		`);

		const errors = validate(graph, { validationMode: "strict" });
		expectFailure(errors, "bad_agent_id", "agent_id", "invalid agent_id");
		expectFailure(errors, "bad_agent_version", "agent_version", "invalid agent_version");
		expectFailure(errors, "bad_scope", "agent_identity_scope", "agent identity attrs are only allowed");
	});

	it("rejects unknown validation mode deterministically", () => {
		const graph = parse(`
	digraph identity_unknown_mode {
		start [shape=Mdiamond]
		done [shape=Msquare]
		start -> done
	}
		`);

		const errors = validate(graph, { validationMode: "future" as any });
		expect(errors).toEqual([
			expect.objectContaining({
				rule: "validation_mode",
				message: expect.stringContaining("invalid validation mode"),
			}),
		]);
	});
});
