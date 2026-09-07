import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus } from "./context.js";
import {
	ALIGNMENT_SUMMARY_SCHEMA_VERSION,
	BLOCKED_ACTIONS_COUNT_KEY,
	DECISION_RECORD_COUNT_KEY,
	DECISION_RECORD_SCHEMA_VERSION,
	DECISION_RECORD_SEQ_KEY,
	ESCALATIONS_COUNT_KEY,
	INTENT_VIOLATIONS_COUNT_KEY,
	JUDGE_FAIL_COUNT_KEY,
	JUDGE_PASS_COUNT_KEY,
	NEEDS_REVIEW_COUNT_KEY,
	alignmentSummaryPath,
	decisionsDir,
	emitDecisionArtifact,
	isDecisionArtifactEligible,
} from "./decision-artifacts.js";

// Mock runDir so filesystem operations go to a temp directory,
// and mock assertPathDoesNotRecreateConfiguredRepo as a no-op.
let tempRoot: string;

vi.mock("./run.js", async () => {
	const actual = await vi.importActual<typeof import("./run.js")>("./run.js");
	return {
		...actual,
		runDir: (runId: string) => join(tempRoot, runId),
	};
});

vi.mock("../factory/repo-path-health.js", () => ({
	assertPathDoesNotRecreateConfiguredRepo: () => {},
}));

function makeNode(attrs: Record<string, string> = {}, id = "test-node") {
	return { id, attrs: { handler: "llm", ...attrs } } as any;
}

function makeOutcome(overrides: Partial<{ status: StageStatus; output: string; error?: string }> = {}) {
	return {
		status: overrides.status ?? StageStatus.Completed,
		output:
			overrides.output ??
			JSON.stringify({
				pass: true,
				alignment_score: 0.9,
				constraint_violations: [],
				missing_evidence: [],
				recommendations: [],
			}),
		...(overrides.error !== undefined ? { error: overrides.error } : {}),
	};
}

function makeRunState(runId = "run-test-123") {
	return {
		runId,
		pipeline: "test-pipeline",
		pipelineFile: "test.dot",
		context: {},
		guard: { counters: {}, owner: "" },
	} as any;
}

describe("decision-artifacts", () => {
	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "hatch-decision-test-"));
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	// ── Constants ──────────────────────────────────────────────────────
	describe("exported constants", () => {
		it("DECISION_RECORD_SCHEMA_VERSION", () => {
			expect(DECISION_RECORD_SCHEMA_VERSION).toBe("hatch.decision.v1");
		});

		it("ALIGNMENT_SUMMARY_SCHEMA_VERSION", () => {
			expect(ALIGNMENT_SUMMARY_SCHEMA_VERSION).toBe("hatch.alignment_summary.v1");
		});

		it("counter keys are exported strings", () => {
			expect(DECISION_RECORD_COUNT_KEY).toBe("decision_records_count");
			expect(JUDGE_PASS_COUNT_KEY).toBe("judge_pass_count");
			expect(JUDGE_FAIL_COUNT_KEY).toBe("judge_fail_count");
			expect(NEEDS_REVIEW_COUNT_KEY).toBe("needs_review_count");
			expect(INTENT_VIOLATIONS_COUNT_KEY).toBe("intent_violations_count");
			expect(ESCALATIONS_COUNT_KEY).toBe("escalations_count");
			expect(BLOCKED_ACTIONS_COUNT_KEY).toBe("blocked_actions_count");
		});
	});

	// ── Path helpers ───────────────────────────────────────────────────
	describe("decisionsDir", () => {
		it("returns path ending in runId/decisions", () => {
			const dir = decisionsDir("run-123");
			expect(dir).toContain("run-123");
			expect(dir).toMatch(/run-123[/\\]decisions$/);
		});
	});

	describe("alignmentSummaryPath", () => {
		it("returns path ending in runId/decisions/alignment-summary.json", () => {
			const p = alignmentSummaryPath("run-123");
			expect(p).toContain("run-123");
			expect(p).toMatch(/run-123[/\\]decisions[/\\]alignment-summary\.json$/);
		});
	});

	// ── isDecisionArtifactEligible ─────────────────────────────────────
	describe("isDecisionArtifactEligible", () => {
		describe("explicit marker attrs (truthy check)", () => {
			it("judge=true → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ judge: "true" }))).toBe(true);
			});

			it("judge=1 → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ judge: "1" }))).toBe(true);
			});

			it("judge=yes → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ judge: "yes" }))).toBe(true);
			});

			it("judge=false → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ judge: "false" }))).toBe(false);
			});

			it("decision=true → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ decision: "true" }))).toBe(true);
			});

			it("escalation=true → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ escalation: "true" }))).toBe(true);
			});

			it("violation=true → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ violation: "true" }))).toBe(true);
			});

			it("decision_record=true → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ decision_record: "true" }))).toBe(true);
			});
		});

		describe("governance_decision (normalize, not isTruthy)", () => {
			it("governance_decision=some_value → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ governance_decision: "some_value" }))).toBe(true);
			});

			it("governance_decision=empty string → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ governance_decision: "" }))).toBe(false);
			});

			it("governance_decision=whitespace only → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ governance_decision: "   " }))).toBe(false);
			});
		});

		describe("legacy output_key markers", () => {
			it("output_key=decision → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "decision" }))).toBe(true);
			});

			it("output_key=judge_pass → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "judge_pass" }))).toBe(true);
			});

			it("output_key=judge_result → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "judge_result" }))).toBe(true);
			});

			it("output_key=review_verdict → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "review_verdict" }))).toBe(true);
			});

			it("output_key=escalation → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "escalation" }))).toBe(true);
			});

			it("output_key=violation → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "violation" }))).toBe(true);
			});

			it("output_key=constraint_violations → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "constraint_violations" }))).toBe(true);
			});

			it("output_key=needs_review → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "needs_review" }))).toBe(true);
			});

			it("output_key=needs_human → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "needs_human" }))).toBe(true);
			});

			it("output_key=random_key → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ output_key: "random_key" }))).toBe(false);
			});
		});

		describe("legacy outputs (comma-separated)", () => {
			it("outputs containing a legacy marker → eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ outputs: "foo,review_verdict,bar" }))).toBe(true);
			});

			it("outputs with no legacy markers → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ outputs: "foo,bar,baz" }))).toBe(false);
			});
		});

		describe("no matching attrs", () => {
			it("plain node → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({}))).toBe(false);
			});

			it("node with unrelated attrs → NOT eligible", () => {
				expect(isDecisionArtifactEligible(makeNode({ model: "gpt-4", prompt: "hello" }))).toBe(false);
			});
		});
	});

	// ── emitDecisionArtifact ───────────────────────────────────────────
	describe("emitDecisionArtifact", () => {
		it("returns { ok: true, written: false } when runState is undefined", () => {
			const ctx = new Context({});
			const result = emitDecisionArtifact({
				runState: undefined,
				node: makeNode({ judge: "true" }),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			expect(result.ok).toBe(true);
			expect(result.written).toBe(false);
		});

		it("returns { ok: true, written: false } when node is not eligible", () => {
			const ctx = new Context({});
			const result = emitDecisionArtifact({
				runState: makeRunState(),
				node: makeNode({}),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			expect(result.ok).toBe(true);
			expect(result.written).toBe(false);
		});

		it("returns { ok: true, written: true } with correct path for eligible judge node", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-emit-test");
			const result = emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }, "my-judge"),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
				now: new Date("2026-01-01T00:00:00Z"),
			});
			expect(result.ok).toBe(true);
			expect(result.written).toBe(true);
			expect(result.path).toBeDefined();
			expect(result.path).toContain("run-emit-test");
			expect(result.path).toContain("decisions");
			expect(result.path).toMatch(/0001\.my-judge\.attempt-1\.json$/);
		});

		it("writes a valid JSON file to the decisions directory", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-json-test");
			const result = emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }, "judge-node"),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "my-pipeline.dot",
				now: new Date("2026-01-01T00:00:00Z"),
			});

			expect(result.path).toBeDefined();
			expect(existsSync(result.path!)).toBe(true);

			const content = JSON.parse(readFileSync(result.path!, "utf8"));
			expect(content.schema_version).toBe(DECISION_RECORD_SCHEMA_VERSION);
			expect(content.node_id).toBe("judge-node");
			expect(content.run_id).toBe("run-json-test");
			expect(content.decision_id).toBe("run-json-test:judge-node:attempt-1");
			expect(content.marker).toBe("judge");
			expect(content.written_at).toBe("2026-01-01T00:00:00.000Z");
		});

		it("increments the sequence counter in context", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-seq-test");
			const node = makeNode({ judge: "true" }, "seq-node");

			emitDecisionArtifact({
				runState,
				node,
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			expect(ctx.get(DECISION_RECORD_SEQ_KEY)).toBe("1");
			expect(ctx.get(DECISION_RECORD_COUNT_KEY)).toBe("1");

			emitDecisionArtifact({
				runState,
				node,
				outcome: makeOutcome(),
				ctx,
				attempt: 2,
				pipeline: "test.dot",
			});
			expect(ctx.get(DECISION_RECORD_SEQ_KEY)).toBe("2");
			expect(ctx.get(DECISION_RECORD_COUNT_KEY)).toBe("2");
		});

		it("updates alignment counters in context for a passing judge", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-align-test");
			emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }, "pass-judge"),
				outcome: makeOutcome({ output: JSON.stringify({ pass: true }) }),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			// pass: true → decision="approved" → judgePass=1, judgeFail=0
			expect(Number(ctx.get(JUDGE_PASS_COUNT_KEY))).toBe(1);
			expect(Number(ctx.get(JUDGE_FAIL_COUNT_KEY))).toBe(0);
		});

		it("updates alignment counters for a failing judge", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-fail-test");
			emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }, "fail-judge"),
				outcome: makeOutcome({ output: JSON.stringify({ pass: false }) }),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			// pass: false → decision="revise" → judgePass=0, judgeFail=1
			expect(Number(ctx.get(JUDGE_FAIL_COUNT_KEY))).toBe(1);
			expect(Number(ctx.get(JUDGE_PASS_COUNT_KEY))).toBe(0);
		});

		it("writes alignment summary artifact alongside decision records", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-summary-test");
			emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
				now: new Date("2026-06-15T12:00:00Z"),
			});

			const summaryPath = alignmentSummaryPath("run-summary-test");
			expect(existsSync(summaryPath)).toBe(true);

			const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
			expect(summary.schema_version).toBe(ALIGNMENT_SUMMARY_SCHEMA_VERSION);
			expect(summary.run_id).toBe("run-summary-test");
		});

		it("sanitizes node IDs with special characters", () => {
			const ctx = new Context({});
			const runState = makeRunState("run-sanitize-test");
			const result = emitDecisionArtifact({
				runState,
				node: makeNode({ judge: "true" }, "my node/with:special chars!"),
				outcome: makeOutcome(),
				ctx,
				attempt: 1,
				pipeline: "test.dot",
			});
			expect(result.written).toBe(true);
			// Special chars get replaced with underscores, leading/trailing underscores stripped
			expect(result.path).toMatch(/0001\.my_node_with_special_chars\.attempt-1\.json$/);
		});
	});
});
