import { describe, it, expect } from "vitest";
import {
	stripCodeFences,
	extractEmbeddedJsonFence,
	checkOutputFormat,
	checkOutputConstraints,
	REVIEWER_REASON_CODES,
} from "./constraints.js";
import { Context } from "./context.js";

function node(attrs: Record<string, string> = {}) {
	return { id: "test", attrs: { handler: "llm", ...attrs } } as any;
}

function ctx(initial?: Record<string, string>) {
	return new Context(initial);
}

// ---------------------------------------------------------------------------
// stripCodeFences
// ---------------------------------------------------------------------------
describe("stripCodeFences", () => {
	it("strips ```json fences", () => {
		expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
	});

	it("strips fences without language tag", () => {
		expect(stripCodeFences("```\nsome content\n```")).toBe("some content");
	});

	it("returns plain text unchanged", () => {
		expect(stripCodeFences("hello world")).toBe("hello world");
	});

	it("trims surrounding whitespace", () => {
		expect(stripCodeFences("  hello  ")).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// extractEmbeddedJsonFence
// ---------------------------------------------------------------------------
describe("extractEmbeddedJsonFence", () => {
	it("extracts JSON from prose followed by ```json block", () => {
		const text = 'Here is my analysis.\n\n```json\n{"result": true}\n```';
		expect(extractEmbeddedJsonFence(text)).toBe('{"result": true}');
	});

	it("returns the last valid JSON fence when multiple exist", () => {
		const text = [
			"First analysis:",
			'```json\n{"first": 1}\n```',
			"Second analysis:",
			'```json\n{"second": 2}\n```',
		].join("\n\n");
		expect(JSON.parse(extractEmbeddedJsonFence(text)!)).toEqual({ second: 2 });
	});

	it("returns null when no fences exist", () => {
		expect(extractEmbeddedJsonFence("just plain text")).toBeNull();
	});

	it("returns null when fences contain invalid JSON", () => {
		const text = "```json\nnot json at all\n```";
		expect(extractEmbeddedJsonFence(text)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// checkOutputFormat
// ---------------------------------------------------------------------------
describe("checkOutputFormat", () => {
	it("always passes for non-json format", () => {
		const result = checkOutputFormat(node({ output_format: "text" }), "anything");
		expect(result.passed).toBe(true);
	});

	it("always passes when no output_format is set", () => {
		const result = checkOutputFormat(node(), "anything");
		expect(result.passed).toBe(true);
	});

	it("passes for valid JSON", () => {
		const result = checkOutputFormat(node({ output_format: "json" }), '{"a":1}');
		expect(result.passed).toBe(true);
		expect(result.cleaned).toBeUndefined();
	});

	it("passes and cleans JSON wrapped in code fences", () => {
		const result = checkOutputFormat(node({ output_format: "json" }), '```json\n{"a":1}\n```');
		expect(result.passed).toBe(true);
		expect(result.cleaned).toBe('{"a":1}');
	});

	it("passes and cleans JSON embedded in prose fence", () => {
		const output = 'Here is the result:\n\n```json\n{"ok": true}\n```';
		const result = checkOutputFormat(node({ output_format: "json" }), output);
		expect(result.passed).toBe(true);
		expect(result.cleaned).toBe('{"ok": true}');
	});

	it("fails for invalid non-JSON", () => {
		const result = checkOutputFormat(node({ output_format: "json" }), "not json");
		expect(result.passed).toBe(false);
		expect(result.violations).toContain("output is not valid JSON");
	});
});

// ---------------------------------------------------------------------------
// checkOutputConstraints — basic string constraints
// ---------------------------------------------------------------------------
describe("checkOutputConstraints", () => {
	describe("output_must_contain", () => {
		it("passes when output contains required string", () => {
			const n = node({ output_must_contain: "hello" });
			const result = checkOutputConstraints(n, "hello world", ctx());
			expect(result.passed).toBe(true);
		});

		it("fails when output is missing required string", () => {
			const n = node({ output_must_contain: "missing" });
			const result = checkOutputConstraints(n, "hello world", ctx());
			expect(result.passed).toBe(false);
			expect(result.violations[0]).toContain("missing");
		});

		it("handles multiple comma-separated constraints", () => {
			const n = node({ output_must_contain: "aaa,bbb" });
			const result = checkOutputConstraints(n, "aaa is here", ctx());
			expect(result.passed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0]).toContain("bbb");
		});
	});

	describe("output_must_not_contain", () => {
		it("passes when output does not contain forbidden string", () => {
			const n = node({ output_must_not_contain: "secret" });
			const result = checkOutputConstraints(n, "hello world", ctx());
			expect(result.passed).toBe(true);
		});

		it("fails when output contains forbidden string", () => {
			const n = node({ output_must_not_contain: "bad" });
			const result = checkOutputConstraints(n, "this is bad", ctx());
			expect(result.passed).toBe(false);
			expect(result.violations[0]).toContain("bad");
		});

		it("handles multiple comma-separated constraints", () => {
			const n = node({ output_must_not_contain: "foo,bar" });
			const result = checkOutputConstraints(n, "foo and bar", ctx());
			expect(result.passed).toBe(false);
			expect(result.violations).toHaveLength(2);
		});
	});

	describe("no constraints", () => {
		it("passes with no constraints set", () => {
			const result = checkOutputConstraints(node(), "anything", ctx());
			expect(result.passed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// REVIEWER_REASON_CODES
// ---------------------------------------------------------------------------
describe("REVIEWER_REASON_CODES", () => {
	it("contains expected codes", () => {
		expect(REVIEWER_REASON_CODES).toContain("APPROVED");
		expect(REVIEWER_REASON_CODES).toContain("EVIDENCE_MISSING");
		expect(REVIEWER_REASON_CODES).toContain("TESTS_MISSING");
		expect(REVIEWER_REASON_CODES).toContain("SCOPE_MISMATCH");
		expect(REVIEWER_REASON_CODES).toContain("LOGIC_INCORRECT");
		expect(REVIEWER_REASON_CODES).toContain("SECURITY_CONCERN");
	});
});

// ---------------------------------------------------------------------------
// Reviewer output normalization (via checkOutputConstraints)
// ---------------------------------------------------------------------------
describe("reviewer output normalization", () => {
	const reviewerNode = node({ reviewer: "true" });

	function reviewerOutput(obj: Record<string, unknown>): string {
		return JSON.stringify(obj);
	}

	it("passes with valid approve verdict", () => {
		const output = reviewerOutput({
			review_verdict: "approve",
			review_reason_codes: ["APPROVED"],
			review_notes: "Looks good.",
		});
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(true);
		expect(result.normalizedOutput).toBeDefined();
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.review_verdict).toBe("approve");
		expect(parsed.review_reason_codes).toEqual(["APPROVED"]);
	});

	it("passes with valid revise verdict and valid codes", () => {
		const output = reviewerOutput({
			review_verdict: "revise",
			review_reason_codes: ["TESTS_MISSING", "EVIDENCE_MISSING"],
			review_notes: "Need more tests.",
		});
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.review_verdict).toBe("revise");
		expect(parsed.review_reason_codes).toEqual(["TESTS_MISSING", "EVIDENCE_MISSING"]);
	});

	it("fails when approve has wrong reason codes", () => {
		const output = reviewerOutput({
			review_verdict: "approve",
			review_reason_codes: ["TESTS_MISSING"],
			review_notes: "Looks good.",
		});
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(false);
	});

	it("fails when revise includes APPROVED code", () => {
		const output = reviewerOutput({
			review_verdict: "revise",
			review_reason_codes: ["APPROVED"],
			review_notes: "Something is wrong.",
		});
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(false);
	});

	it("fails when required keys are missing", () => {
		const output = reviewerOutput({ review_verdict: "approve" });
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(false);
	});

	it("fails with invalid verdict", () => {
		const output = reviewerOutput({
			review_verdict: "reject",
			review_reason_codes: ["APPROVED"],
			review_notes: "No.",
		});
		const result = checkOutputConstraints(reviewerNode, output, ctx());
		expect(result.passed).toBe(false);
	});

	it("fails with non-JSON output", () => {
		const result = checkOutputConstraints(reviewerNode, "not json", ctx());
		expect(result.passed).toBe(false);
		const diag = JSON.parse(result.violations[0]);
		expect(diag.code).toBe("reviewer_output_not_json");
	});
});

// ---------------------------------------------------------------------------
// Judge output normalization (via checkOutputConstraints)
// ---------------------------------------------------------------------------
describe("judge output normalization", () => {
	const judgeNode = node({
		judge: "true",
		judge_rubric: "test-rubric",
		objective_id: "test-objective",
	});

	function judgeOutput(obj: Record<string, unknown>): string {
		return JSON.stringify(obj);
	}

	const canonicalPayload = {
		alignment_score: 0.9,
		constraint_violations: [],
		missing_evidence: [],
		recommendations: ["looks good"],
		pass: true,
	};

	it("passes with canonical schema containing all required keys", () => {
		const output = judgeOutput(canonicalPayload);
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(true);
		expect(result.normalizedOutput).toBeDefined();
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(true);
		expect(parsed.alignment_score).toBe(0.9);
		expect(parsed.judge_rubric).toBe("test-rubric");
		expect(parsed.objective_id).toBe("test-objective");
		expect(parsed.judge_pass).toBe("true");
		expect(parsed.decision).toBe("approved");
	});

	it("passes with legacy judge_pass schema", () => {
		const output = judgeOutput({
			judge_pass: "true",
			judge_notes: "all good",
		});
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(true);
		expect(parsed.alignment_score).toBe(1);
		expect(parsed.decision).toBe("approved");
	});

	it("passes with legacy decision schema", () => {
		const output = judgeOutput({
			decision: "approved",
			review_notes: "ship it",
		});
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(true);
		expect(parsed.decision).toBe("approved");
	});

	it("passes with legacy decision=revise schema", () => {
		const output = judgeOutput({
			decision: "revise",
			review_notes: "needs work",
		});
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(false);
		expect(parsed.decision).toBe("revise");
	});

	it("fails when no recognized schema is present", () => {
		const output = judgeOutput({ random_key: "value" });
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(false);
		const diag = JSON.parse(result.violations[0]);
		expect(diag.code).toBe("judge_output_invalid");
	});

	it("fails with non-JSON output", () => {
		const result = checkOutputConstraints(judgeNode, "not json at all", ctx());
		expect(result.passed).toBe(false);
		const diag = JSON.parse(result.violations[0]);
		expect(diag.code).toBe("judge_output_not_json");
	});

	it("resolves default rubric and objective from intent binding", () => {
		const bareJudge = node({ judge: "true" });
		const binding = { intentRef: "goal-123", profile: "strict", patches: [] };
		const output = judgeOutput(canonicalPayload);
		const result = checkOutputConstraints(bareJudge, output, ctx(), binding);
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.judge_rubric).toBe("alignment.strict");
		expect(parsed.objective_id).toBe("goal-123@strict");
	});

	it("resolves default rubric and objective when no binding", () => {
		const bareJudge = node({ judge: "true" });
		const output = judgeOutput(canonicalPayload);
		const result = checkOutputConstraints(bareJudge, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.judge_rubric).toBe("alignment.default");
		expect(parsed.objective_id).toBe("intent.unbound");
	});

	it("preserves custom (non-reserved) fields in judge output", () => {
		const output = judgeOutput({ ...canonicalPayload, custom_field: "hello" });
		const result = checkOutputConstraints(judgeNode, output, ctx());
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.custom_field).toBe("hello");
	});

	it("forces pass=false when judge_required_evidence is missing from context", () => {
		const evidenceJudge = node({
			judge: "true",
			judge_rubric: "test-rubric",
			objective_id: "test-objective",
			judge_required_evidence: "test_result",
		});
		const output = judgeOutput(canonicalPayload);
		// Context has no "test_result" key -> missing evidence
		const result = checkOutputConstraints(evidenceJudge, output, ctx());
		expect(result.passed).toBe(true); // validation passes but pass is forced false
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(false);
		expect(parsed.missing_evidence).toContain("test_result");
	});

	it("keeps pass=true when judge_required_evidence is present in context", () => {
		const evidenceJudge = node({
			judge: "true",
			judge_rubric: "test-rubric",
			objective_id: "test-objective",
			judge_required_evidence: "test_result",
		});
		const output = judgeOutput(canonicalPayload);
		const c = ctx({ test_result: "some value" });
		const result = checkOutputConstraints(evidenceJudge, output, c);
		expect(result.passed).toBe(true);
		const parsed = JSON.parse(result.normalizedOutput!);
		expect(parsed.pass).toBe(true);
	});
});
