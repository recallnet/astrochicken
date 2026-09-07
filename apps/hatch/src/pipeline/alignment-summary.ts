import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

import type { StageRecord } from "./context.js";
import type { DecisionObjectiveIdSource, JudgeVerdict } from "./decision-artifacts.js";

export const RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION = "hatch.run_alignment_summary.v1";
export const RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION = "hatch.alignment_counters.v1";
export const RUN_ALIGNMENT_SUMMARY_FILE = "alignment-summary.json";

const DECISION_RECORD_FILE_RE = /^\d+\..+\.attempt-\d+\.json$/;

export type TerminalRunStatus = "completed" | "failed" | "guarded" | "guarded_terminal";

export interface RunAlignmentCounters {
	intent_violations_count: number;
	escalations_count: number;
	needs_review_count: number;
	judge_pass_count: number;
	judge_fail_count: number;
	decision_records_count: number;
	blocked_actions_count: number;
}

export interface ObjectiveAlignmentCounters extends RunAlignmentCounters {
	objective_id: string;
	objective_id_source: DecisionObjectiveIdSource;
}

export interface RunAlignmentSummary {
	schema_version: string;
	counter_taxonomy_version: string;
	run_id: string;
	pipeline: string;
	status: TerminalRunStatus;
	started_at: string;
	terminal_at: string;
	written_at: string;
	intent_violations_count: number;
	escalations_count: number;
	needs_review_count: number;
	judge_pass_count: number;
	judge_fail_count: number;
	decision_records_count: number;
	blocked_actions_count: number;
	objective_counters: ObjectiveAlignmentCounters[];
}

export interface WriteRunAlignmentSummaryInput {
	runId: string;
	runDirectory: string;
	pipelineFile: string;
	status: string;
	startedAt: string;
	terminalAt: string;
	context?: Record<string, string>;
	records?: StageRecord[];
	now?: Date;
}

export interface AlignmentDecisionCounterRecord {
	identity: string;
	objectiveId: string;
	objectiveSource: DecisionObjectiveIdSource;
	judgeVerdict: JudgeVerdict;
	needsReview: boolean;
	blockedAction: boolean;
	intentViolation: boolean;
	escalation: boolean;
	countAsDecisionRecord: boolean;
}

export interface AlignmentCounterDerivation {
	totals: RunAlignmentCounters;
	objectives: Map<string, ObjectiveAlignmentCounters>;
}

export function isTerminalRunStatus(status: string): status is TerminalRunStatus {
	return status === "completed" || status === "failed" || status === "guarded" || status === "guarded_terminal";
}

export function runAlignmentSummaryPath(runId: string, cwd = process.cwd()): string {
	return join(cwd, ".hatch", "runs", runId, RUN_ALIGNMENT_SUMMARY_FILE);
}

export function runAlignmentSummaryPathFromRunDir(runDirectory: string): string {
	return join(runDirectory, RUN_ALIGNMENT_SUMMARY_FILE);
}

export function loadRunAlignmentSummary(runId: string, cwd = process.cwd()): RunAlignmentSummary | null {
	const path = runAlignmentSummaryPath(runId, cwd);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object") return null;
		return parsed as RunAlignmentSummary;
	} catch {
		return null;
	}
}

export function writeRunAlignmentSummary(input: WriteRunAlignmentSummaryInput): RunAlignmentSummary | null {
	if (!isTerminalRunStatus(input.status)) return null;
	const now = input.now ?? new Date();
	const summary = buildRunAlignmentSummary({
		...input,
		status: input.status,
		now,
	});
	const path = runAlignmentSummaryPathFromRunDir(input.runDirectory);
	assertPathDoesNotRecreateConfiguredRepo(path, { label: "alignment_summary_path" });
	mkdirSync(input.runDirectory, { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(summary, null, 2));
	renameSync(tmpPath, path);
	return summary;
}

function buildRunAlignmentSummary(
	input: Omit<WriteRunAlignmentSummaryInput, "status"> & { status: TerminalRunStatus; now: Date },
): RunAlignmentSummary {
	const decisionRows = loadDecisionCounterRecords(input.runDirectory);
	const artifactDerived = deriveAlignmentCountersFromDecisionRecords(decisionRows);
	const stageDerived = deriveAlignmentCountersFromStageRecords(input.records ?? []);
	const mergedObjectives = mergeObjectiveCounters(artifactDerived.objectives, stageDerived.objectives);
	const mergedTotals = mergeCounterTotals(artifactDerived.totals, stageDerived.totals);

	const contextDecisionCount = toCount(input.context?.["decision_records_count"]);
	mergedTotals.decision_records_count = Math.max(mergedTotals.decision_records_count, contextDecisionCount);

	if (input.status === "guarded" || input.status === "guarded_terminal") {
		mergedTotals.blocked_actions_count += 1;
	}

	const objectiveCounters = [...mergedObjectives.values()].sort((a, b) => {
		const byObjective = a.objective_id.localeCompare(b.objective_id);
		if (byObjective !== 0) return byObjective;
		return a.objective_id_source.localeCompare(b.objective_id_source);
	});

	const writtenAt = input.now.toISOString();
	return {
		schema_version: RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION,
		counter_taxonomy_version: RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION,
		run_id: input.runId,
		pipeline: input.pipelineFile,
		status: input.status,
		started_at: input.startedAt,
		terminal_at: input.terminalAt || writtenAt,
		written_at: writtenAt,
		intent_violations_count: mergedTotals.intent_violations_count,
		escalations_count: mergedTotals.escalations_count,
		needs_review_count: mergedTotals.needs_review_count,
		judge_pass_count: mergedTotals.judge_pass_count,
		judge_fail_count: mergedTotals.judge_fail_count,
		decision_records_count: mergedTotals.decision_records_count,
		blocked_actions_count: mergedTotals.blocked_actions_count,
		objective_counters: objectiveCounters,
	};
}

function loadDecisionCounterRecords(runDirectory: string): AlignmentDecisionCounterRecord[] {
	const decisionsDir = join(runDirectory, "decisions");
	if (!existsSync(decisionsDir)) return [];
	const names = readdirSync(decisionsDir)
		.filter((name) => DECISION_RECORD_FILE_RE.test(name))
		.sort((a, b) => a.localeCompare(b));
	const rows: AlignmentDecisionCounterRecord[] = [];
	for (const name of names) {
		const path = join(decisionsDir, name);
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8"));
			const normalized = normalizeDecisionRecord(parsed, name);
			if (normalized) rows.push(normalized);
		} catch {
			// deterministic ignore: malformed files are excluded from derivation
		}
	}
	return rows;
}

function normalizeDecisionRecord(value: unknown, fallbackIdentity: string): AlignmentDecisionCounterRecord | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	const objectiveId = normalizeObjectiveId(asTrimmedString(row["objective_id"]));
	const objectiveSource = normalizeObjectiveSource(row["objective_id_source"], objectiveId);
	const decision = asTrimmedString(row["decision"]).toLowerCase();
	const marker = asTrimmedString(row["marker"]).toLowerCase();
	const judgeVerdict = normalizeJudgeVerdict(row["judge_verdict"], marker, decision);
	const needsReview = parseBoolean(row["needs_review"]) ?? deriveNeedsReview(decision, judgeVerdict);
	const blockedAction = parseBoolean(row["blocked_action"]) ?? decision === "blocked";
	const escalation = parseBoolean(row["escalation"]) ?? false;
	const intentViolation =
		parseBoolean(row["intent_violation"]) ??
		(marker === "violation" || blockedAction || hasNonEmptyArray(row["constraint_violations"]));
	const identity = asTrimmedString(row["decision_id"]) || fallbackIdentity;
	return {
		identity,
		objectiveId,
		objectiveSource,
		judgeVerdict,
		needsReview,
		blockedAction,
		intentViolation,
		escalation,
		countAsDecisionRecord: true,
	};
}

function deriveAlignmentCountersFromStageRecords(records: StageRecord[]): AlignmentCounterDerivation {
	const totals = createZeroCounters();
	const objectives = new Map<string, ObjectiveAlignmentCounters>();
	const seen = new Set<string>();
	for (const record of records) {
		const outcome = record.outcome;
		if (!outcome || typeof outcome.output !== "string" || !outcome.output.trim()) continue;
		const parsed = parseObject(outcome.output);
		if (!parsed) continue;
		const identity = `${record.nodeId}:attempt-${Math.max(1, record.attempt || 1)}`;
		if (seen.has(identity)) continue;
		seen.add(identity);
		const objectiveId = normalizeObjectiveId(asTrimmedString(parsed["objective_id"]));
		const objectiveSource = normalizeObjectiveSource(parsed["objective_id_source"], objectiveId);
		const decision = resolveDecision(parsed);
		const judgeVerdict =
			parseBoolean(parsed["pass"]) === true
				? "pass"
				: parseBoolean(parsed["pass"]) === false
					? "fail"
					: parseBoolean(parsed["judge_pass"]) === true
						? "pass"
						: parseBoolean(parsed["judge_pass"]) === false
							? "fail"
							: "none";
		const needsReview = parseBoolean(parsed["needs_review"]) ?? deriveNeedsReview(decision, judgeVerdict);
		const blockedAction = parseBoolean(parsed["blocked_action"]) ?? decision === "blocked";
		const escalation = parseBoolean(parsed["escalation"]) ?? false;
		const intentViolation =
			parseBoolean(parsed["intent_violation"]) ??
			(hasNonEmptyArray(parsed["constraint_violations"]) || blockedAction || decision === "blocked");
		const hasSignal =
			judgeVerdict !== "none" || needsReview || blockedAction || intentViolation || escalation || decision.length > 0;
		if (!hasSignal) continue;
		const row: AlignmentDecisionCounterRecord = {
			identity,
			objectiveId,
			objectiveSource,
			judgeVerdict,
			needsReview,
			blockedAction,
			intentViolation,
			escalation,
			countAsDecisionRecord: false,
		};
		applyRecordCounters(totals, objectives, row);
	}
	return { totals, objectives };
}

export function deriveAlignmentCountersFromDecisionRecords(
	records: ReadonlyArray<AlignmentDecisionCounterRecord | Record<string, unknown>>,
): AlignmentCounterDerivation {
	const totals = createZeroCounters();
	const objectives = new Map<string, ObjectiveAlignmentCounters>();
	const seen = new Set<string>();
	let syntheticIdx = 0;
	let decisionRecordCount = 0;
	for (const entry of records) {
		const record = isAlignmentDecisionCounterRecord(entry)
			? entry
			: normalizeDecisionRecord(entry, `record-${String(++syntheticIdx).padStart(4, "0")}`);
		if (!record) continue;
		if (seen.has(record.identity)) continue;
		seen.add(record.identity);
		if (record.countAsDecisionRecord) decisionRecordCount += 1;
		applyRecordCounters(totals, objectives, record);
	}
	totals.decision_records_count = decisionRecordCount;
	for (const row of objectives.values()) {
		row.decision_records_count = Math.max(row.decision_records_count, 0);
	}
	return { totals, objectives };
}

function applyRecordCounters(
	totals: RunAlignmentCounters,
	objectives: Map<string, ObjectiveAlignmentCounters>,
	record: AlignmentDecisionCounterRecord,
): void {
	if (record.countAsDecisionRecord) totals.decision_records_count += 1;
	if (record.intentViolation) totals.intent_violations_count += 1;
	if (record.escalation) totals.escalations_count += 1;
	if (record.needsReview) totals.needs_review_count += 1;
	if (record.judgeVerdict === "pass") totals.judge_pass_count += 1;
	if (record.judgeVerdict === "fail") totals.judge_fail_count += 1;
	if (record.blockedAction) totals.blocked_actions_count += 1;

	const key = `${record.objectiveSource}|${record.objectiveId}`;
	const objective =
		objectives.get(key) ??
		({
			objective_id: record.objectiveId,
			objective_id_source: record.objectiveSource,
			...createZeroCounters(),
		} satisfies ObjectiveAlignmentCounters);
	if (record.countAsDecisionRecord) objective.decision_records_count += 1;
	if (record.intentViolation) objective.intent_violations_count += 1;
	if (record.escalation) objective.escalations_count += 1;
	if (record.needsReview) objective.needs_review_count += 1;
	if (record.judgeVerdict === "pass") objective.judge_pass_count += 1;
	if (record.judgeVerdict === "fail") objective.judge_fail_count += 1;
	if (record.blockedAction) objective.blocked_actions_count += 1;
	objectives.set(key, objective);
}

function mergeObjectiveCounters(
	primary: Map<string, ObjectiveAlignmentCounters>,
	secondary: Map<string, ObjectiveAlignmentCounters>,
): Map<string, ObjectiveAlignmentCounters> {
	const merged = new Map<string, ObjectiveAlignmentCounters>();
	for (const [key, value] of primary.entries()) {
		merged.set(key, { ...value });
	}
	for (const [key, value] of secondary.entries()) {
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, { ...value });
			continue;
		}
		merged.set(key, {
			...existing,
			intent_violations_count: Math.max(existing.intent_violations_count, value.intent_violations_count),
			escalations_count: Math.max(existing.escalations_count, value.escalations_count),
			needs_review_count: Math.max(existing.needs_review_count, value.needs_review_count),
			judge_pass_count: Math.max(existing.judge_pass_count, value.judge_pass_count),
			judge_fail_count: Math.max(existing.judge_fail_count, value.judge_fail_count),
			decision_records_count: Math.max(existing.decision_records_count, value.decision_records_count),
			blocked_actions_count: Math.max(existing.blocked_actions_count, value.blocked_actions_count),
		});
	}
	return merged;
}

function mergeCounterTotals(primary: RunAlignmentCounters, secondary: RunAlignmentCounters): RunAlignmentCounters {
	return {
		intent_violations_count: Math.max(primary.intent_violations_count, secondary.intent_violations_count),
		escalations_count: Math.max(primary.escalations_count, secondary.escalations_count),
		needs_review_count: Math.max(primary.needs_review_count, secondary.needs_review_count),
		judge_pass_count: Math.max(primary.judge_pass_count, secondary.judge_pass_count),
		judge_fail_count: Math.max(primary.judge_fail_count, secondary.judge_fail_count),
		decision_records_count: Math.max(primary.decision_records_count, secondary.decision_records_count),
		blocked_actions_count: Math.max(primary.blocked_actions_count, secondary.blocked_actions_count),
	};
}

function createZeroCounters(): RunAlignmentCounters {
	return {
		intent_violations_count: 0,
		escalations_count: 0,
		needs_review_count: 0,
		judge_pass_count: 0,
		judge_fail_count: 0,
		decision_records_count: 0,
		blocked_actions_count: 0,
	};
}

function resolveDecision(payload: Record<string, unknown>): string {
	const decision = asTrimmedString(payload["decision"]).toLowerCase();
	if (decision) return decision;
	const reviewVerdict = asTrimmedString(payload["review_verdict"]).toLowerCase();
	if (reviewVerdict) return reviewVerdict;
	const pass = parseBoolean(payload["pass"]);
	if (pass !== null) return pass ? "approved" : "revise";
	const judgePass = parseBoolean(payload["judge_pass"]);
	if (judgePass !== null) return judgePass ? "approved" : "revise";
	return "";
}

function deriveNeedsReview(decision: string, judgeVerdict: JudgeVerdict): boolean {
	if (judgeVerdict === "fail") return true;
	return (
		decision === "revise" ||
		decision === "needs_review" ||
		decision === "needs_human" ||
		decision === "escalate" ||
		decision === "blocked"
	);
}

function normalizeObjectiveId(value: string): string {
	return value || "intent.unbound";
}

/**
 * Deterministic objective source mapping:
 * 1) explicit objective_id_source when present
 * 2) intent.identity when objective_id matches intent_ref@profile shape
 * 3) intent.unbound for sentinel objective
 * 4) node.objective_id fallback for all other explicit objective ids
 */
function normalizeObjectiveSource(value: unknown, objectiveId: string): DecisionObjectiveIdSource {
	const raw = asTrimmedString(value);
	if (raw === "node.objective_id" || raw === "intent.identity" || raw === "intent.unbound") return raw;
	if (objectiveId === "intent.unbound") return "intent.unbound";
	if (objectiveId.startsWith("intent.") && objectiveId.includes("@")) return "intent.identity";
	return "node.objective_id";
}

function normalizeJudgeVerdict(value: unknown, marker: string, decision: string): JudgeVerdict {
	const raw = asTrimmedString(value).toLowerCase();
	if (raw === "pass" || raw === "fail" || raw === "none") return raw;
	if (marker === "judge") return decision === "approved" ? "pass" : "fail";
	return "none";
}

function isAlignmentDecisionCounterRecord(value: unknown): value is AlignmentDecisionCounterRecord {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row["identity"] === "string" &&
		typeof row["objectiveId"] === "string" &&
		typeof row["objectiveSource"] === "string" &&
		typeof row["judgeVerdict"] === "string" &&
		typeof row["needsReview"] === "boolean" &&
		typeof row["blockedAction"] === "boolean" &&
		typeof row["intentViolation"] === "boolean" &&
		typeof row["escalation"] === "boolean" &&
		typeof row["countAsDecisionRecord"] === "boolean"
	);
}

function parseObject(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function hasNonEmptyArray(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	return value.some((entry) => asTrimmedString(entry).length > 0);
}

function parseBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return null;
}

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function toCount(value: unknown): number {
	const parsed = Number.parseInt(String(value ?? "0"), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
