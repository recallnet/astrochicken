import { describe, expect, it } from "vitest";

import { checkOutputConstraints } from "./constraints.js";
import { Context } from "./context.js";

import type { Node } from "./graph.js";

describe("judge output normalization", () => {
	it("preserves custom keys so outputs extraction can route on them", () => {
		const node: Node = {
			id: "judge",
			attrs: {
				type: "codergen",
				judge: "true",
				output_format: "json",
				outputs: "pass,eval_1_kill,eval_1_notes",
			},
		};
		const rawOutput = JSON.stringify({
			alignment_score: 0.84,
			constraint_violations: [],
			missing_evidence: [],
			recommendations: ["stop hypothesis"],
			pass: false,
			eval_1_kill: true,
			eval_1_notes: "insufficient evidence",
		});

		const result = checkOutputConstraints(node, rawOutput, new Context());
		expect(result.passed).toBe(true);
		expect(result.normalizedOutput).toBeTruthy();

		const normalized = JSON.parse(result.normalizedOutput!);
		expect(normalized.eval_1_kill).toBe(true);
		expect(normalized.eval_1_notes).toBe("insufficient evidence");
		expect(normalized.pass).toBe(false);
		expect(normalized.decision).toBe("revise");
	});
});
