import { describe, expect, it } from "vitest";

import { parseValidateCommandArgs } from "./validate-args.js";
import { IDENTITY_RULE_CODES } from "../pipeline/identity.js";
import { parse as parseGraph } from "../pipeline/parse.js";
import { validate } from "../pipeline/validate.js";

describe("validate CLI args", () => {
	it("parses --identity-mode", () => {
		const parsed = parseValidateCommandArgs(["--identity-mode", "strict", "graph.dot"]);
		expect(parsed).toEqual({ ok: true, value: { file: "graph.dot", identityMode: "strict" } });
	});

	it("rejects invalid --identity-mode with non-zero exit code", () => {
		const parsed = parseValidateCommandArgs(["--identity-mode", "unknown", "graph.dot"]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.exitCode).toBe(1);
		expect(parsed.error.message).toContain("invalid --identity-mode");
	});

	it("keeps legacy behavior when --identity-mode is omitted", () => {
		const parsed = parseValidateCommandArgs(["graph.dot"]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const graph = parseGraph(`
	digraph legacy_by_default {
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]
		start -> runner -> done
	}
		`);

		const errors = validate(graph, { identityMode: parsed.value.identityMode });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED }),
				expect.objectContaining({ code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED }),
			]),
		);
	});
});
