import { describe, expect, it } from "vitest";

import { REVIEWER_REASON_CODES, extractEmbeddedJsonFence, checkOutputFormat } from "./constraints.js";
import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";

import type { Node } from "./graph.js";

class StaticNodeOutputHandler implements Handler {
	constructor(private readonly outputsByNode: Record<string, Outcome>) {}

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		return this.outputsByNode[node.id] ?? { status: StageStatus.Completed, output: "" };
	}
}

function reviewerGraph(): ReturnType<typeof parse> {
	return parse(`
		digraph reviewer_schema_path {
			start [shape=Mdiamond]
			review [type="codergen" reviewer="true" output_key="review_result" output_format="json" outputs="review_verdict,review_reason_codes,review_notes"]
			approve [type="codergen" output_key="route"]
			revise [type="codergen" output_key="route"]
			done [shape=Msquare]
			start -> review
			review -> approve [condition="review_verdict=approve"]
			review -> revise [condition="review_verdict!=approve"]
			approve -> done
			revise -> done
		}
	`);
}

function reviewerEngine(review: Outcome): Engine {
	const registry = new HandlerRegistry();
	registry.register("codergen", new StaticNodeOutputHandler({
		review,
		approve: { status: StageStatus.Completed, output: "approve" },
		revise: { status: StageStatus.Completed, output: "revise" },
	}));
	return new Engine(reviewerGraph(), registry, { context: new Context() });
}

describe("reviewer output schema enforcement", () => {
	it("accepts valid reviewer payload and normalizes canonical shape", async () => {
		const engine = reviewerEngine({
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "approve",
						review_reason_codes: ["approved"],
						review_notes: "All checks passed.",
					}),
				});
		await engine.run();

		expect(engine.getContext().get("route")).toBe("approve");
		expect(engine.getContext().get("review_verdict")).toBe("approve");
		expect(engine.getContext().get("review_reason_codes")).toBe('["APPROVED"]');
		const normalized = JSON.parse(engine.getContext().get("review_result"));
		expect(normalized.review_reason_codes).toEqual(["APPROVED"]);
	});

	it("rejects malformed reviewer JSON with deterministic diagnostics and routes revise path", async () => {
		const engine = reviewerEngine({ status: StageStatus.Completed, output: "not-json" });
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		const reviewRecord = engine.getRecords().find((record) => record.nodeId === "review");
		expect(reviewRecord?.outcome?.status).toBe(StageStatus.Failed);
		expect(reviewRecord?.outcome?.error).toContain('"code":"reviewer_output_not_json"');
	});

	it("rejects missing required reviewer keys", async () => {
		const engine = reviewerEngine({
					status: StageStatus.Completed,
					output: JSON.stringify({ review_verdict: "revise", review_notes: "Need additional tests." }),
				});
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		const reviewRecord = engine.getRecords().find((record) => record.nodeId === "review");
		expect(reviewRecord?.outcome?.error).toContain('"code":"reviewer_output_invalid"');
		expect(reviewRecord?.outcome?.error).toContain("review_reason_codes is required");
	});

	it("rejects invalid reviewer verdict enum and unsupported reason code", async () => {
		const engine = reviewerEngine({
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "ship",
						review_reason_codes: ["BOGUS_CODE"],
						review_notes: "Invalid verdict.",
					}),
				});
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		const reviewRecord = engine.getRecords().find((record) => record.nodeId === "review");
		expect(reviewRecord?.outcome?.error).toContain('"code":"reviewer_output_invalid"');
		expect(reviewRecord?.outcome?.error).toContain("review_verdict must be one of approve|revise");
		expect(reviewRecord?.outcome?.error).toContain("unsupported code: BOGUS_CODE");
	});

	it("rejects contradictory payload (approve + non-APPROVED reason code)", async () => {
		const engine = reviewerEngine({
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "approve",
						review_reason_codes: ["QA_EVIDENCE_REQUIRED"],
						review_notes: "Contradictory approval.",
					}),
				});
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		const reviewRecord = engine.getRecords().find((record) => record.nodeId === "review");
		expect(reviewRecord?.outcome?.error).toContain('"code":"reviewer_output_invalid"');
		expect(reviewRecord?.outcome?.error).toContain("approve verdict requires review_reason_codes");
	});

	it("keeps canonical reason-code registry stable for schema checks", () => {
		expect(REVIEWER_REASON_CODES.includes("QA_EVIDENCE_REQUIRED")).toBe(true);
		expect(REVIEWER_REASON_CODES.includes("REVIEW_OUTPUT_SCHEMA_INVALID")).toBe(true);
	});

	it("tool node with review_verdict in outputs but no reviewer=true is NOT treated as reviewer", async () => {
		// This is the validate_review_context pattern: a tool node that outputs
		// review_verdict and review_reason_codes as pass-through/default values,
		// but is not an actual reviewer node. Reviewer schema validation must NOT
		// apply to it — otherwise its output gets rejected and named outputs are
		// never stored in context, silently breaking downstream routing.
		const graph = parse(`
			digraph non_reviewer_tool_passthrough {
				start [shape=Mdiamond]
				validate [type="tool" output_format="json" outputs="gate_pass,review_verdict,review_reason_codes,review_notes"]
				review_path [type="codergen" output_key="result"]
				skip_path [type="codergen" output_key="result"]
				done [shape=Msquare]
				start -> validate
				validate -> review_path [condition="gate_pass=true"]
				validate -> skip_path [condition="gate_pass!=true"]
				review_path -> done
				skip_path -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register(
			"tool",
			new StaticNodeOutputHandler({
				validate: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						gate_pass: "true",
						review_verdict: "",
						review_reason_codes: [],
						review_notes: "",
					}),
				},
			}),
		);
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				review_path: { status: StageStatus.Completed, output: "reviewed" },
				skip_path: { status: StageStatus.Completed, output: "skipped" },
			}),
		);

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		// The critical assertion: gate_pass must be stored in context
		// and routing must go to review_path (gate_pass=true), not skip_path
		expect(engine.getContext().get("gate_pass")).toBe("true");
		expect(engine.getContext().get("result")).toBe("reviewed");

		// validate node must NOT be marked as failed
		const validateRecord = engine.getRecords().find((r) => r.nodeId === "validate");
		expect(validateRecord?.outcome?.status).toBe(StageStatus.Completed);
	});
});

// ── extractEmbeddedJsonFence unit tests ─────────────────────────────────────

describe("extractEmbeddedJsonFence", () => {
	it("returns null for plain text with no fence", () => {
		expect(extractEmbeddedJsonFence("just some text")).toBeNull();
	});

	it("returns null when fence contains invalid JSON", () => {
		const input = "some prose\n```json\nnot-json\n```\n";
		expect(extractEmbeddedJsonFence(input)).toBeNull();
	});

	it("extracts JSON from a fence-only output (no prose)", () => {
		const json = JSON.stringify({ approved: true, approved_features: [] });
		const input = "```json\n" + json + "\n```";
		expect(extractEmbeddedJsonFence(input)).toBe(json);
	});

	it("extracts JSON from prose+fence output (the decompose_retry_exhausted root cause)", () => {
		// This is the exact pattern that caused decompose_retry_exhausted:
		// the LLM returns prose analysis followed by a ```json block.
		const payload = { approved: true, approved_features: [{ id: "F-1", name: "Feature" }], review_notes: "ok" };
		const json = JSON.stringify(payload, null, 2);
		const input =
			"Here is my detailed analysis of the decomposition...\n\n" +
			"**Deliverable extraction:**\n1. Build the thing\n2. Test the thing\n\n" +
			"Coverage mapping:\n- (1): F-1 ✅\n\n" +
			"All checks pass.\n\n" +
			"```json\n" +
			json +
			"\n```";
		const result = extractEmbeddedJsonFence(input);
		expect(result).not.toBeNull();
		expect(JSON.parse(result!)).toEqual(payload);
	});

	it("returns the last valid JSON fence when multiple fences are present", () => {
		const first = JSON.stringify({ approved: false });
		const last = JSON.stringify({ approved: true, approved_features: [{ id: "F-1" }] });
		const input = "First attempt:\n```json\n" + first + "\n```\n\nRevised:\n```json\n" + last + "\n```";
		const result = extractEmbeddedJsonFence(input);
		expect(result).not.toBeNull();
		expect(JSON.parse(result!)).toEqual(JSON.parse(last));
	});
});

// ── checkOutputFormat prose+fence end-to-end engine tests ───────────────────

describe("checkOutputFormat prose+fence extraction (decompose_retry_exhausted regression)", () => {
	function decomposePipelineGraph(): ReturnType<typeof parse> {
		// Use direct edge conditions from the review node to avoid needing a
		// ConditionalHandler registration. Edge conditions are evaluated by
		// the engine's selectNextEdge without a separate handler dispatch.
		return parse(`
			digraph decompose_retry_test {
				start [shape=Mdiamond]
				review [type="codergen" output_key="review_result" output_format="json" outputs="approved,approved_features,review_notes"]
				approved_path [type="codergen" output_key="result"]
				retry_path [type="codergen" output_key="result"]
				done [shape=Msquare]
				start -> review
				review -> approved_path [condition="approved=true"]
				review -> retry_path [condition="approved!=true"]
				approved_path -> done
				retry_path -> done
			}
		`);
	}

	it("extracts approved=true from prose+fence review output and routes approved path", async () => {
		// This is the regression test for the decompose_retry_exhausted root cause.
		// Before the fix, the LLM returning prose+fence caused output_format=json
		// to mark the node as failed, dropping the approved=true signal, and
		// routing the retry path instead of the approved path.
		const features = [{ id: "F-1", name: "Add portability tests", summary: "..." }];
		const reviewJson = JSON.stringify({ approved: true, approved_features: features, review_notes: "Looks good." });

		// Simulate the exact LLM response pattern that caused the bug:
		// prose analysis text + ```json ... ``` fence at the end.
		const proseAndFenceOutput =
			"I have analyzed the decomposition carefully.\n\n" +
			"**Deliverable extraction from goal body:**\n" +
			"1. Add portability tests for CLI context\n\n" +
			"Coverage mapping:\n" +
			"- (1): F-1 covers CLI context tests. ✅\n\n" +
			"All deliverables covered. Accepted.\n\n" +
			"```json\n" +
			reviewJson +
			"\n```";

		const graph = decomposePipelineGraph();
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				review: { status: StageStatus.Completed, output: proseAndFenceOutput },
				approved_path: { status: StageStatus.Completed, output: "approved" },
				retry_path: { status: StageStatus.Completed, output: "retried" },
			}),
		);

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		// The fix: approved path must be taken, not retry path.
		expect(engine.getContext().get("result")).toBe("approved");
		// approved_features must be populated in context from the fence-extracted JSON.
		expect(engine.getContext().get("approved")).toBe("true");
		const approvedFeatures = JSON.parse(engine.getContext().get("approved_features") ?? "[]");
		expect(approvedFeatures).toHaveLength(1);
		expect(approvedFeatures[0].id).toBe("F-1");
		// review node must NOT be marked as failed.
		const reviewRecord = engine.getRecords().find((r) => r.nodeId === "review");
		expect(reviewRecord?.outcome?.status).toBe(StageStatus.Completed);
	});

	it("still fails cleanly when prose+fence contains invalid JSON", async () => {
		const graph = decomposePipelineGraph();
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				review: {
					status: StageStatus.Completed,
					output: "Some analysis.\n\n```json\nnot-valid-json\n```",
				},
				approved_path: { status: StageStatus.Completed, output: "approved" },
				retry_path: { status: StageStatus.Completed, output: "retried" },
			}),
		);

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		// Invalid JSON in fence should still route to retry path
		expect(engine.getContext().get("result")).toBe("retried");
		const reviewRecord = engine.getRecords().find((r) => r.nodeId === "review");
		expect(reviewRecord?.outcome?.status).toBe(StageStatus.Failed);
	});
});
