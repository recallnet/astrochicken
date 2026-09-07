import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runDir, type RunState } from "./run.js";
import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

import type { Context, Outcome } from "./context.js";
import type { Node } from "./graph.js";
import type { IntentBinding } from "./intent.js";

export const DECISION_RECORD_SCHEMA_VERSION = "hatch.decision.v1";
export const ALIGNMENT_SUMMARY_SCHEMA_VERSION = "hatch.alignment_summary.v1";
export const ALIGNMENT_SUMMARY_TAXONOMY_VERSION = "hatch.alignment_taxonomy.v1";
export const DECISION_RECORD_COUNT_KEY = "decision_records_count";
export const DECISION_RECORD_SEQ_KEY = "__decision_record_seq";
export const JUDGE_PASS_COUNT_KEY = "judge_pass_count";
export const JUDGE_FAIL_COUNT_KEY = "judge_fail_count";
export const NEEDS_REVIEW_COUNT_KEY = "needs_review_count";
export const INTENT_VIOLATIONS_COUNT_KEY = "intent_violations_count";
export const ESCALATIONS_COUNT_KEY = "escalations_count";
export const BLOCKED_ACTIONS_COUNT_KEY = "blocked_actions_count";

const EXPLICIT_MARKER_ATTRS = ["judge", "decision", "escalation", "violation", "decision_record"] as const;

export type DecisionObjectiveIdSource = "node.objective_id" | "intent.identity" | "intent.unbound";
export type DecisionMarker =
	| "judge"
	| "violation"
	| "escalation"
	| "decision"
	| "decision_record"
	| "governance_decision"
	| "legacy_output_marker"
	| "unknown";
export type JudgeVerdict = "pass" | "fail" | "none";

const LEGACY_DECISION_MARKERS = new Set([
	"decision",
	"judge_pass",
	"judge_result",
	"review_verdict",
	"escalation",
	"violation",
	"constraint_violations",
	"needs_review",
	"needs_human",
]);
const DECISION_ARTIFACT_FILE_RE = /^(\d+)\..+\.attempt-\d+\.json$/;
const ALIGNMENT_SUMMARY_FILE = "alignment-summary.json";
const ALIGNMENT_COUNTER_KEYS = [
	JUDGE_PASS_COUNT_KEY,
	JUDGE_FAIL_COUNT_KEY,
	NEEDS_REVIEW_COUNT_KEY,
	INTENT_VIOLATIONS_COUNT_KEY,
	ESCALATIONS_COUNT_KEY,
	BLOCKED_ACTIONS_COUNT_KEY,
] as const;

export interface DecisionArtifactRecord {
	schema_version: string;
	decision_id: string;
	node_id: string;
	intent_hash: string;
	objective_id: string;
	objective_id_source: DecisionObjectiveIdSource;
	marker: DecisionMarker;
	judge_verdict: JudgeVerdict;
	needs_review: boolean;
	blocked_action: boolean;
	intent_violation: boolean;
	tradeoff_applied: string;
	options_considered: string[];
	decision: string;
	evidence: string;
	risk_assessment: string;
	escalation: boolean;
	run_id: string;
	pipeline: string;
	node_attempt: number;
	outcome_status: string;
	written_at: string;
}

export interface AlignmentSummaryArtifact {
	schema_version: string;
	taxonomy_version: string;
	run_id: string;
	decision_records_count: number;
	judge_pass_count: number;
	judge_fail_count: number;
	needs_review_count: number;
	intent_violations_count: number;
	escalations_count: number;
	blocked_actions_count: number;
	objective_mapping_rule: string;
	updated_at: string;
}

export interface DecisionArtifactWriteResult {
	ok: boolean;
	written: boolean;
	count: number;
	path?: string;
	error?: string;
}

export interface EmitDecisionArtifactArgs {
	runState?: RunState;
	node: Node;
	outcome: Outcome;
	ctx: Context;
	intentBinding?: IntentBinding | null;
	attempt: number;
	pipeline: string;
	now?: Date;
}

export function decisionsDir(runId: string): string {
	return join(runDir(runId), "decisions");
}

export function alignmentSummaryPath(runId: string): string {
	return join(decisionsDir(runId), ALIGNMENT_SUMMARY_FILE);
}

export function listDecisionArtifacts(runId: string): string[] {
	const dir = decisionsDir(runId);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((name) => ({ name, sequence: parseDecisionArtifactSequence(name) }))
		.filter((entry): entry is { name: string; sequence: number } => entry.sequence !== null)
		.sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name))
		.map((entry) => entry.name);
}

export function initializeDecisionArtifactCounter(runState: RunState | undefined, ctx: Context): number {
	if (!runState) {
		if (!ctx.has(DECISION_RECORD_SEQ_KEY)) ctx.set(DECISION_RECORD_SEQ_KEY, "0");
		if (!ctx.has(DECISION_RECORD_COUNT_KEY)) ctx.set(DECISION_RECORD_COUNT_KEY, "0");
		for (const key of ALIGNMENT_COUNTER_KEYS) {
			if (!ctx.has(key)) ctx.set(key, "0");
		}
		return 0;
	}

	const maxExistingSequence = highestDecisionArtifactSequence(runState.runId);
	const current = toInt(ctx.get(DECISION_RECORD_SEQ_KEY));
	const next = Math.max(maxExistingSequence, current);
	ctx.set(DECISION_RECORD_SEQ_KEY, String(next));
	ctx.set(DECISION_RECORD_COUNT_KEY, String(next));

	hydrateAlignmentCountersFromArtifacts(runState.runId, ctx);
	return next;
}

export function emitDecisionArtifact(args: EmitDecisionArtifactArgs): DecisionArtifactWriteResult {
	const count = toInt(args.ctx.get(DECISION_RECORD_COUNT_KEY));
	if (!args.runState) return { ok: true, written: false, count };
	if (!isDecisionArtifactEligible(args.node)) return { ok: true, written: false, count };

	const sequence = toInt(args.ctx.get(DECISION_RECORD_SEQ_KEY)) + 1;
	const attempt = Math.max(1, args.attempt || 1);
	const safeNodeId = sanitizeNodeId(args.node.id || "node");
	const fileName = `${String(sequence).padStart(4, "0")}.${safeNodeId}.attempt-${attempt}.json`;
	const artifactPath = join(decisionsDir(args.runState.runId), fileName);

	const record = buildDecisionRecord({
		runState: args.runState,
		node: args.node,
		outcome: args.outcome,
		intentBinding: args.intentBinding,
		attempt,
		pipeline: args.pipeline,
		now: args.now ?? new Date(),
	});

	const issues = validateDecisionRecord(record);
	if (issues.length > 0) {
		return {
			ok: false,
			written: false,
			count,
			error: JSON.stringify({ code: "decision_artifact_invalid", node_id: args.node.id, issues }),
		};
	}

	assertPathDoesNotRecreateConfiguredRepo(artifactPath, { label: "decision_artifact_path" });
	mkdirSync(dirname(artifactPath), { recursive: true });
	const tmpPath = `${artifactPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(record, null, 2));
	renameSync(tmpPath, artifactPath);

	args.ctx.set(DECISION_RECORD_SEQ_KEY, String(sequence));
	args.ctx.set(DECISION_RECORD_COUNT_KEY, String(sequence));
	applyAlignmentCounters(args.ctx, record);
	writeAlignmentSummaryArtifact(args.runState.runId, args.ctx, args.now ?? new Date());
	return { ok: true, written: true, count: sequence, path: artifactPath };
}

export function isDecisionArtifactEligible(node: Node): boolean {
	for (const attr of EXPLICIT_MARKER_ATTRS) {
		if (isTruthy(node.attrs[attr])) return true;
	}
	if (normalize(node.attrs["governance_decision"])) return true;

	const outputKey = normalize(node.attrs["output_key"]);
	if (outputKey && LEGACY_DECISION_MARKERS.has(outputKey)) return true;

	const outputs = splitCsv(node.attrs["outputs"]);
	return outputs.some((output) => LEGACY_DECISION_MARKERS.has(output));
}

function buildDecisionRecord({
	runState,
	node,
	outcome,
	intentBinding,
	attempt,
	pipeline,
	now,
}: {
	runState: RunState;
	node: Node;
	outcome: Outcome;
	intentBinding?: IntentBinding | null;
	attempt: number;
	pipeline: string;
	now: Date;
}): DecisionArtifactRecord {
	const parsed = parseJsonObject(outcome.output);
	const objective = resolveObjectiveId(node, intentBinding);
	const marker = resolveDecisionMarker(node);
	const decision = resolveDecision(node, parsed, outcome);
	const judgeVerdict = resolveJudgeVerdict(node, parsed, decision);
	const options = resolveOptions(parsed);
	const evidence = resolveEvidence(parsed, outcome);
	const risk = resolveRiskAssessment(parsed, outcome);
	const escalation = resolveEscalation(node, parsed, decision);
	const needsReview = resolveNeedsReview(parsed, decision, judgeVerdict);
	const blockedAction = resolveBlockedAction(parsed, decision);
	const intentViolation = resolveIntentViolation(node, parsed, decision, blockedAction);
	const intentHash = resolveIntentHash(outcome, intentBinding);
	const decisionId = `${runState.runId}:${sanitizeNodeId(node.id)}:attempt-${attempt}`;

	return {
		schema_version: DECISION_RECORD_SCHEMA_VERSION,
		decision_id: decisionId,
		node_id: node.id,
		intent_hash: intentHash,
		objective_id: objective.id,
		objective_id_source: objective.source,
		marker,
		judge_verdict: judgeVerdict,
		needs_review: needsReview,
		blocked_action: blockedAction,
		intent_violation: intentViolation,
		tradeoff_applied: normalize(parsed["tradeoff_applied"]) || normalize(node.attrs["tradeoff_applied"]),
		options_considered: options,
		decision,
		evidence,
		risk_assessment: risk,
		escalation,
		run_id: runState.runId,
		pipeline: pipeline || runState.pipelineFile || runState.pipeline || "",
		node_attempt: attempt,
		outcome_status: String(outcome.status || "unknown"),
		written_at: now.toISOString(),
	};
}

function validateDecisionRecord(record: DecisionArtifactRecord): string[] {
	const issues: string[] = [];
	if (!record.schema_version) issues.push("schema_version missing");
	if (!record.decision_id) issues.push("decision_id missing");
	if (!record.node_id) issues.push("node_id missing");
	if (!record.intent_hash) issues.push("intent_hash missing");
	if (!record.objective_id) issues.push("objective_id missing");
	if (
		record.objective_id_source !== "node.objective_id" &&
		record.objective_id_source !== "intent.identity" &&
		record.objective_id_source !== "intent.unbound"
	) {
		issues.push("objective_id_source must be node.objective_id|intent.identity|intent.unbound");
	}
	if (
		record.marker !== "judge" &&
		record.marker !== "violation" &&
		record.marker !== "escalation" &&
		record.marker !== "decision" &&
		record.marker !== "decision_record" &&
		record.marker !== "governance_decision" &&
		record.marker !== "legacy_output_marker" &&
		record.marker !== "unknown"
	) {
		issues.push("marker must be deterministic marker enum");
	}
	if (record.judge_verdict !== "pass" && record.judge_verdict !== "fail" && record.judge_verdict !== "none") {
		issues.push("judge_verdict must be pass|fail|none");
	}
	if (typeof record.needs_review !== "boolean") issues.push("needs_review must be boolean");
	if (typeof record.blocked_action !== "boolean") issues.push("blocked_action must be boolean");
	if (typeof record.intent_violation !== "boolean") issues.push("intent_violation must be boolean");
	if (!Array.isArray(record.options_considered)) issues.push("options_considered must be array");
	if (typeof record.decision !== "string") issues.push("decision must be string");
	if (typeof record.evidence !== "string") issues.push("evidence must be string");
	if (typeof record.risk_assessment !== "string") issues.push("risk_assessment must be string");
	if (typeof record.escalation !== "boolean") issues.push("escalation must be boolean");
	if (typeof record.tradeoff_applied !== "string") issues.push("tradeoff_applied must be string");
	return issues;
}

function parseJsonObject(raw: string): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Deterministic objective mapping for decision artifacts:
 * 1) explicit node objective_id
 * 2) intent_ref@intent_profile identity
 * 3) intent.unbound sentinel
 */
function resolveObjectiveId(
	node: Node,
	intentBinding?: IntentBinding | null,
): { id: string; source: DecisionObjectiveIdSource } {
	const explicit = normalize(node.attrs["objective_id"]);
	if (explicit) return { id: explicit, source: "node.objective_id" };
	if (intentBinding?.intentRef) {
		const profile = normalize(intentBinding.profile) || "default";
		return { id: `${intentBinding.intentRef}@${profile}`, source: "intent.identity" };
	}
	return { id: "intent.unbound", source: "intent.unbound" };
}

function resolveIntentHash(outcome: Outcome, intentBinding?: IntentBinding | null): string {
	const digest = normalize((outcome.intent as Record<string, unknown> | undefined)?.digest as string);
	if (digest) return digest;
	if (intentBinding?.intentRef) {
		const profile = normalize(intentBinding.profile) || "default";
		return hashStable(`intent:${intentBinding.intentRef}@${profile}`);
	}
	return hashStable("intent:unbound");
}

function resolveDecisionMarker(node: Node): DecisionMarker {
	if (isTruthy(node.attrs["judge"])) return "judge";
	if (isTruthy(node.attrs["violation"])) return "violation";
	if (isTruthy(node.attrs["escalation"])) return "escalation";
	if (isTruthy(node.attrs["decision"])) return "decision";
	if (isTruthy(node.attrs["decision_record"])) return "decision_record";
	if (normalize(node.attrs["governance_decision"])) return "governance_decision";
	if (hasLegacyDecisionMarker(node)) return "legacy_output_marker";
	return "unknown";
}

function resolveJudgeVerdict(node: Node, parsed: Record<string, unknown>, decision: string): JudgeVerdict {
	const pass = parseBoolean(parsed["pass"]);
	if (pass !== null) return pass ? "pass" : "fail";
	const judgePass = parseBoolean(parsed["judge_pass"]);
	if (judgePass !== null) return judgePass ? "pass" : "fail";
	if (!isTruthy(node.attrs["judge"])) return "none";
	return decision === "approved" ? "pass" : "fail";
}

function resolveNeedsReview(parsed: Record<string, unknown>, decision: string, judgeVerdict: JudgeVerdict): boolean {
	const explicit = parseBoolean(parsed["needs_review"]);
	if (explicit !== null) return explicit;
	if (judgeVerdict === "fail") return true;
	return (
		decision === "revise" ||
		decision === "needs_review" ||
		decision === "needs_human" ||
		decision === "escalate" ||
		decision === "blocked"
	);
}

function resolveBlockedAction(parsed: Record<string, unknown>, decision: string): boolean {
	const explicit = parseBoolean(parsed["blocked_action"]);
	if (explicit !== null) return explicit;
	return decision === "blocked";
}

function resolveIntentViolation(
	node: Node,
	parsed: Record<string, unknown>,
	decision: string,
	blockedAction: boolean,
): boolean {
	const explicit = parseBoolean(parsed["intent_violation"]);
	if (explicit !== null) return explicit;
	if (isTruthy(node.attrs["violation"])) return true;
	const violations = parsed["constraint_violations"];
	if (Array.isArray(violations) && violations.some((entry) => normalize(entry).length > 0)) return true;
	return blockedAction || decision === "blocked";
}

function resolveDecision(node: Node, parsed: Record<string, unknown>, outcome: Outcome): string {
	const decision = normalize(parsed["decision"]);
	if (decision) return decision;
	const verdict = normalize(parsed["review_verdict"]);
	if (verdict) return verdict;
	const pass = parseBoolean(parsed["pass"]);
	if (pass !== null) return pass ? "approved" : "revise";
	const judgePass = parseBoolean(parsed["judge_pass"]);
	if (judgePass !== null) return judgePass ? "approved" : "revise";

	const legacyDecision = resolveLegacyMarkerDecision(node, outcome.output);
	if (legacyDecision) return legacyDecision;

	return String(outcome.status) === "failed" ? "failed" : "completed";
}

function resolveLegacyMarkerDecision(node: Node, rawOutput: string): string {
	if (!hasLegacyDecisionMarker(node)) return "";
	const scalar = parseDecisionScalar(rawOutput);
	if (scalar === null) return "";
	if (typeof scalar === "boolean") return scalar ? "approved" : "revise";

	const normalized = scalar.trim().toLowerCase();
	if (!normalized) return "";
	if (normalized === "true") return "approved";
	if (normalized === "false") return "revise";
	if (
		normalized === "approved" ||
		normalized === "revise" ||
		normalized === "blocked" ||
		normalized === "needs_human" ||
		normalized === "needs_review" ||
		normalized === "escalate"
	) {
		return normalized;
	}
	return "";
}

function hasLegacyDecisionMarker(node: Node): boolean {
	const outputKey = normalize(node.attrs["output_key"]);
	if (outputKey && LEGACY_DECISION_MARKERS.has(outputKey)) return true;
	const outputs = splitCsv(node.attrs["outputs"]);
	return outputs.some((output) => LEGACY_DECISION_MARKERS.has(output));
}

function parseDecisionScalar(rawOutput: string): string | boolean | null {
	const raw = String(rawOutput || "").trim();
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "string" || typeof parsed === "boolean") return parsed;
	} catch {
		// fall through to plain-text scalar handling
	}
	return raw;
}

function resolveOptions(parsed: Record<string, unknown>): string[] {
	const raw = parsed["options_considered"];
	if (Array.isArray(raw)) {
		const normalized = raw.map((entry) => normalize(entry)).filter(Boolean);
		return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
	}
	const single = normalize(raw);
	return single ? [single] : [];
}

function resolveEvidence(parsed: Record<string, unknown>, outcome: Outcome): string {
	const parts: string[] = [];
	for (const key of ["evidence", "review_notes", "judge_notes", "recommendations", "missing_evidence", "constraint_violations"]) {
		const value = parsed[key];
		if (typeof value === "string" && value.trim()) {
			parts.push(value.trim());
			continue;
		}
		if (Array.isArray(value) && value.length > 0) {
			parts.push(JSON.stringify(value));
			continue;
		}
		if (value && typeof value === "object") {
			parts.push(JSON.stringify(value));
		}
	}
	if (outcome.error) parts.push(`error=${outcome.error}`);
	if (parts.length === 0 && outcome.output) parts.push(String(outcome.output).trim());
	return parts.join(" | ").slice(0, 4000);
}

function resolveRiskAssessment(parsed: Record<string, unknown>, outcome: Outcome): string {
	const value = normalize(parsed["risk_assessment"]);
	if (value) return value;
	return String(outcome.status) === "failed" ? "high" : "unknown";
}

function resolveEscalation(node: Node, parsed: Record<string, unknown>, decision: string): boolean {
	const explicit = parseBoolean(parsed["escalation"]);
	if (explicit !== null) return explicit;
	if (isTruthy(node.attrs["escalation"])) return true;
	if (isTruthy(node.attrs["violation"])) return true;
	return decision === "needs_human" || decision === "escalate";
}

function hydrateAlignmentCountersFromArtifacts(runId: string, ctx: Context): void {
	const counts = {
		judgePass: 0,
		judgeFail: 0,
		needsReview: 0,
		intentViolations: 0,
		escalations: 0,
		blockedActions: 0,
	};

	for (const fileName of listDecisionArtifacts(runId)) {
		const record = parseDecisionArtifactRecord(join(decisionsDir(runId), fileName));
		if (!record) continue;
		const deltas = alignmentDeltasForRecord(record);
		counts.judgePass += deltas.judgePass;
		counts.judgeFail += deltas.judgeFail;
		counts.needsReview += deltas.needsReview;
		counts.intentViolations += deltas.intentViolations;
		counts.escalations += deltas.escalations;
		counts.blockedActions += deltas.blockedActions;
	}

	ctx.set(JUDGE_PASS_COUNT_KEY, String(counts.judgePass));
	ctx.set(JUDGE_FAIL_COUNT_KEY, String(counts.judgeFail));
	ctx.set(NEEDS_REVIEW_COUNT_KEY, String(counts.needsReview));
	ctx.set(INTENT_VIOLATIONS_COUNT_KEY, String(counts.intentViolations));
	ctx.set(ESCALATIONS_COUNT_KEY, String(counts.escalations));
	ctx.set(BLOCKED_ACTIONS_COUNT_KEY, String(counts.blockedActions));
	writeAlignmentSummaryArtifact(runId, ctx, new Date());
}

function applyAlignmentCounters(ctx: Context, record: DecisionArtifactRecord): void {
	const deltas = alignmentDeltasForRecord(record);
	incrementCounter(ctx, JUDGE_PASS_COUNT_KEY, deltas.judgePass);
	incrementCounter(ctx, JUDGE_FAIL_COUNT_KEY, deltas.judgeFail);
	incrementCounter(ctx, NEEDS_REVIEW_COUNT_KEY, deltas.needsReview);
	incrementCounter(ctx, INTENT_VIOLATIONS_COUNT_KEY, deltas.intentViolations);
	incrementCounter(ctx, ESCALATIONS_COUNT_KEY, deltas.escalations);
	incrementCounter(ctx, BLOCKED_ACTIONS_COUNT_KEY, deltas.blockedActions);
}

function alignmentDeltasForRecord(record: DecisionArtifactRecord): {
	judgePass: number;
	judgeFail: number;
	needsReview: number;
	intentViolations: number;
	escalations: number;
	blockedActions: number;
} {
	const decision = normalize(record.decision).toLowerCase();
	const judgePass = decision === "approved" ? 1 : 0;
	const blockedActions = decision === "blocked" ? 1 : 0;
	const needsReview = decision === "needs_review" || decision === "needs_human" || decision === "escalate" ? 1 : 0;
	const judgeFail = judgePass === 0 ? 1 : 0;
	const intentViolations = blockedActions;
	const escalations = record.escalation ? 1 : 0;
	return { judgePass, judgeFail, needsReview, intentViolations, escalations, blockedActions };
}

function writeAlignmentSummaryArtifact(runId: string, ctx: Context, now: Date): void {
	const path = alignmentSummaryPath(runId);
	const summary: AlignmentSummaryArtifact = {
		schema_version: ALIGNMENT_SUMMARY_SCHEMA_VERSION,
		taxonomy_version: ALIGNMENT_SUMMARY_TAXONOMY_VERSION,
		run_id: runId,
		decision_records_count: toInt(ctx.get(DECISION_RECORD_COUNT_KEY)),
		judge_pass_count: toInt(ctx.get(JUDGE_PASS_COUNT_KEY)),
		judge_fail_count: toInt(ctx.get(JUDGE_FAIL_COUNT_KEY)),
		needs_review_count: toInt(ctx.get(NEEDS_REVIEW_COUNT_KEY)),
		intent_violations_count: toInt(ctx.get(INTENT_VIOLATIONS_COUNT_KEY)),
		escalations_count: toInt(ctx.get(ESCALATIONS_COUNT_KEY)),
		blocked_actions_count: toInt(ctx.get(BLOCKED_ACTIONS_COUNT_KEY)),
		objective_mapping_rule: "objective_id=node.objective_id|intent.identity|intent.unbound",
		updated_at: now.toISOString(),
	};

	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(summary, null, 2));
	renameSync(tmpPath, path);
}

function parseDecisionArtifactRecord(path: string): DecisionArtifactRecord | null {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Partial<DecisionArtifactRecord>;
		if (typeof record.decision !== "string") return null;
		if (typeof record.escalation !== "boolean") return null;
		return record as DecisionArtifactRecord;
	} catch {
		return null;
	}
}

function incrementCounter(ctx: Context, key: string, delta: number): void {
	if (delta <= 0) return;
	ctx.set(key, String(toInt(ctx.get(key)) + delta));
}

function highestDecisionArtifactSequence(runId: string): number {
	let max = 0;
	for (const name of listDecisionArtifacts(runId)) {
		const sequence = parseDecisionArtifactSequence(name);
		if (sequence !== null) max = Math.max(max, sequence);
	}
	return max;
}

function parseDecisionArtifactSequence(fileName: string): number | null {
	const match = fileName.match(DECISION_ARTIFACT_FILE_RE);
	if (!match) return null;
	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function splitCsv(raw: unknown): string[] {
	if (typeof raw !== "string") return [];
	return raw
		.split(",")
		.map((part) => normalize(part))
		.filter(Boolean);
}

function parseBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return null;
}

function isTruthy(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalize(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function sanitizeNodeId(raw: string): string {
	const sanitized = String(raw || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
	return sanitized.replace(/^_+|_+$/g, "") || "node";
}

function toInt(value: unknown): number {
	const parsed = Number.parseInt(String(value || "0"), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function hashStable(seed: string): string {
	return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}
