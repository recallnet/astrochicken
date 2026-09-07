import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlignmentDecisionCounterRecord, RunAlignmentSummary } from "./alignment-summary.js";
import {
	RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION,
	RUN_ALIGNMENT_SUMMARY_FILE,
	RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION,
	deriveAlignmentCountersFromDecisionRecords,
	isTerminalRunStatus,
	runAlignmentSummaryPath,
	runAlignmentSummaryPathFromRunDir,
	writeRunAlignmentSummary,
} from "./alignment-summary.js";

// Mock the repo-path-health module so writeRunAlignmentSummary doesn't reject temp paths.
vi.mock("../factory/repo-path-health.js", () => ({
	assertPathDoesNotRecreateConfiguredRepo: () => {},
}));

function makeRecord(overrides: Partial<AlignmentDecisionCounterRecord> = {}): AlignmentDecisionCounterRecord {
	return {
		identity: "test-record-1",
		objectiveId: "intent.unbound",
		objectiveSource: "intent.unbound",
		judgeVerdict: "none",
		needsReview: false,
		blockedAction: false,
		intentViolation: false,
		escalation: false,
		countAsDecisionRecord: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// isTerminalRunStatus
// ---------------------------------------------------------------------------
describe("isTerminalRunStatus", () => {
	it.each([
		["completed", true],
		["failed", true],
		["guarded", true],
		["guarded_terminal", true],
		["running", false],
		["", false],
	] as const)("status %j → %s", (status, expected) => {
		expect(isTerminalRunStatus(status)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
describe("runAlignmentSummaryPath", () => {
	it("constructs .hatch/runs/<runId>/alignment-summary.json under cwd", () => {
		const result = runAlignmentSummaryPath("run-123", "/fake/project");
		expect(result).toBe(join("/fake/project", ".hatch", "runs", "run-123", RUN_ALIGNMENT_SUMMARY_FILE));
	});

	it("defaults cwd to process.cwd()", () => {
		const result = runAlignmentSummaryPath("run-456");
		expect(result).toBe(join(process.cwd(), ".hatch", "runs", "run-456", RUN_ALIGNMENT_SUMMARY_FILE));
	});
});

describe("runAlignmentSummaryPathFromRunDir", () => {
	it("appends alignment-summary.json to the run directory", () => {
		const result = runAlignmentSummaryPathFromRunDir("/tmp/runs/run-789");
		expect(result).toBe(join("/tmp/runs/run-789", RUN_ALIGNMENT_SUMMARY_FILE));
	});
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
	it("exports expected schema version", () => {
		expect(RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION).toBe("hatch.run_alignment_summary.v1");
	});

	it("exports expected counter taxonomy version", () => {
		expect(RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION).toBe("hatch.alignment_counters.v1");
	});
});

// ---------------------------------------------------------------------------
// deriveAlignmentCountersFromDecisionRecords
// ---------------------------------------------------------------------------
describe("deriveAlignmentCountersFromDecisionRecords", () => {
	it("empty array → zero counters", () => {
		const { totals, objectives } = deriveAlignmentCountersFromDecisionRecords([]);
		expect(totals).toEqual({
			intent_violations_count: 0,
			escalations_count: 0,
			needs_review_count: 0,
			judge_pass_count: 0,
			judge_fail_count: 0,
			decision_records_count: 0,
			blocked_actions_count: 0,
		});
		expect(objectives.size).toBe(0);
	});

	it("single record with judgeVerdict=pass → judge_pass_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ judgeVerdict: "pass" }),
		]);
		expect(totals.judge_pass_count).toBe(1);
		expect(totals.judge_fail_count).toBe(0);
	});

	it("single record with judgeVerdict=fail → judge_fail_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ judgeVerdict: "fail" }),
		]);
		expect(totals.judge_fail_count).toBe(1);
		expect(totals.judge_pass_count).toBe(0);
	});

	it("record with needsReview=true → needs_review_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ needsReview: true }),
		]);
		expect(totals.needs_review_count).toBe(1);
	});

	it("record with blockedAction=true → blocked_actions_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ blockedAction: true }),
		]);
		expect(totals.blocked_actions_count).toBe(1);
	});

	it("record with intentViolation=true → intent_violations_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ intentViolation: true }),
		]);
		expect(totals.intent_violations_count).toBe(1);
	});

	it("record with escalation=true → escalations_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ escalation: true }),
		]);
		expect(totals.escalations_count).toBe(1);
	});

	it("record with countAsDecisionRecord=true → decision_records_count=1", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ countAsDecisionRecord: true }),
		]);
		expect(totals.decision_records_count).toBe(1);
	});

	it("record with countAsDecisionRecord=false → decision_records_count=0", () => {
		const { totals } = deriveAlignmentCountersFromDecisionRecords([
			makeRecord({ countAsDecisionRecord: false }),
		]);
		expect(totals.decision_records_count).toBe(0);
	});

	it("multiple records grouped by objective → objective counters match", () => {
		const records = [
			makeRecord({ identity: "r1", objectiveId: "obj-A", objectiveSource: "node.objective_id", judgeVerdict: "pass" }),
			makeRecord({ identity: "r2", objectiveId: "obj-A", objectiveSource: "node.objective_id", judgeVerdict: "fail" }),
			makeRecord({ identity: "r3", objectiveId: "obj-B", objectiveSource: "node.objective_id", judgeVerdict: "pass" }),
		];
		const { totals, objectives } = deriveAlignmentCountersFromDecisionRecords(records);
		expect(totals.judge_pass_count).toBe(2);
		expect(totals.judge_fail_count).toBe(1);
		expect(totals.decision_records_count).toBe(3);

		const objA = objectives.get("node.objective_id|obj-A");
		expect(objA).toBeDefined();
		expect(objA!.judge_pass_count).toBe(1);
		expect(objA!.judge_fail_count).toBe(1);

		const objB = objectives.get("node.objective_id|obj-B");
		expect(objB).toBeDefined();
		expect(objB!.judge_pass_count).toBe(1);
		expect(objB!.judge_fail_count).toBe(0);
	});

	it("duplicate identities are deduplicated", () => {
		const records = [
			makeRecord({ identity: "dup", judgeVerdict: "pass" }),
			makeRecord({ identity: "dup", judgeVerdict: "fail" }),
		];
		const { totals } = deriveAlignmentCountersFromDecisionRecords(records);
		// Second record with same identity is skipped; first one wins.
		expect(totals.judge_pass_count).toBe(1);
		expect(totals.judge_fail_count).toBe(0);
		expect(totals.decision_records_count).toBe(1);
	});

	it("raw Record<string, unknown> objects are normalized before counting", () => {
		const rawRecord: Record<string, unknown> = {
			decision_id: "raw-1",
			objective_id: "obj-X",
			objective_id_source: "node.objective_id",
			judge_verdict: "pass",
			needs_review: false,
			blocked_action: false,
			intent_violation: false,
			escalation: false,
		};
		const { totals } = deriveAlignmentCountersFromDecisionRecords([rawRecord]);
		expect(totals.judge_pass_count).toBe(1);
		// Raw records normalized through normalizeDecisionRecord always set countAsDecisionRecord=true
		expect(totals.decision_records_count).toBe(1);
	});

	it("raw record with decision=approved and marker=judge → judgeVerdict=pass", () => {
		const rawRecord: Record<string, unknown> = {
			decision_id: "judge-approved",
			decision: "approved",
			marker: "judge",
		};
		const { totals } = deriveAlignmentCountersFromDecisionRecords([rawRecord]);
		expect(totals.judge_pass_count).toBe(1);
		expect(totals.judge_fail_count).toBe(0);
	});

	it("raw record with decision=revise and marker=judge → judgeVerdict=fail", () => {
		const rawRecord: Record<string, unknown> = {
			decision_id: "judge-revise",
			decision: "revise",
			marker: "judge",
		};
		const { totals } = deriveAlignmentCountersFromDecisionRecords([rawRecord]);
		expect(totals.judge_fail_count).toBe(1);
		expect(totals.judge_pass_count).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// writeRunAlignmentSummary
// ---------------------------------------------------------------------------
describe("writeRunAlignmentSummary", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "hatch-alignment-summary-test-"));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns null when status is not terminal", () => {
		const result = writeRunAlignmentSummary({
			runId: "run-1",
			runDirectory: join(tmpRoot, "run-1"),
			pipelineFile: "test.dot",
			status: "running",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
		});
		expect(result).toBeNull();
	});

	it("returns valid summary when status is completed", () => {
		const now = new Date("2026-03-22T12:00:00Z");
		const runDir = join(tmpRoot, "run-2");
		const result = writeRunAlignmentSummary({
			runId: "run-2",
			runDirectory: runDir,
			pipelineFile: "pipeline.dot",
			status: "completed",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
			now,
		});
		expect(result).not.toBeNull();
		expect(result!.run_id).toBe("run-2");
		expect(result!.status).toBe("completed");
		expect(result!.pipeline).toBe("pipeline.dot");
	});

	it("writes JSON file to the specified runDirectory", () => {
		const runDir = join(tmpRoot, "run-3");
		const now = new Date("2026-03-22T12:00:00Z");
		writeRunAlignmentSummary({
			runId: "run-3",
			runDirectory: runDir,
			pipelineFile: "test.dot",
			status: "completed",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
			now,
		});
		const filePath = join(runDir, RUN_ALIGNMENT_SUMMARY_FILE);
		expect(existsSync(filePath)).toBe(true);
		const content = JSON.parse(readFileSync(filePath, "utf-8")) as RunAlignmentSummary;
		expect(content.run_id).toBe("run-3");
	});

	it("summary has correct schema_version and counter_taxonomy_version", () => {
		const runDir = join(tmpRoot, "run-4");
		const now = new Date("2026-03-22T12:00:00Z");
		const result = writeRunAlignmentSummary({
			runId: "run-4",
			runDirectory: runDir,
			pipelineFile: "test.dot",
			status: "failed",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
			now,
		});
		expect(result!.schema_version).toBe(RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION);
		expect(result!.counter_taxonomy_version).toBe(RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION);
	});

	it("guarded status increments blocked_actions_count by 1", () => {
		const runDir = join(tmpRoot, "run-5");
		const now = new Date("2026-03-22T12:00:00Z");
		const result = writeRunAlignmentSummary({
			runId: "run-5",
			runDirectory: runDir,
			pipelineFile: "test.dot",
			status: "guarded",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
			now,
		});
		expect(result!.blocked_actions_count).toBe(1);
	});

	it("guarded_terminal status also increments blocked_actions_count by 1", () => {
		const runDir = join(tmpRoot, "run-6");
		const now = new Date("2026-03-22T12:00:00Z");
		const result = writeRunAlignmentSummary({
			runId: "run-6",
			runDirectory: runDir,
			pipelineFile: "test.dot",
			status: "guarded_terminal",
			startedAt: "2026-01-01T00:00:00Z",
			terminalAt: "2026-01-01T00:01:00Z",
			now,
		});
		expect(result!.blocked_actions_count).toBe(1);
	});
});
