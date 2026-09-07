import { expandVariables } from "./engine.js";
import { DEFAULT_INTENT_PROFILE, type IntentBinding } from "./intent.js";

import type { Context } from "./context.js";
import type { Node } from "./graph.js";

/** ConstraintResult indicates whether output passed constraints. */
export interface ConstraintResult {
	passed: boolean;
	violations: string[];
	normalizedOutput?: string;
}

const REQUIRED_JUDGE_KEYS = [
	"alignment_score",
	"constraint_violations",
	"missing_evidence",
	"recommendations",
	"pass",
] as const;

const RESERVED_JUDGE_OUTPUT_KEYS = new Set<string>([
	...REQUIRED_JUDGE_KEYS,
	"judge_rubric",
	"objective_id",
	"judge_pass",
	"judge_notes",
	"decision",
	"review_notes",
	"human_questions_md",
]);

const REQUIRED_REVIEWER_KEYS = ["review_verdict", "review_reason_codes", "review_notes"] as const;
const REVIEWER_VERDICTS = ["approve", "revise"] as const;
export const REVIEWER_REASON_CODES = [
	"APPROVED",
	"EVIDENCE_MISSING",
	"QA_EVIDENCE_REQUIRED",
	"REVIEW_CONTEXT_INVALID",
	"SCOPE_MISMATCH",
	"TESTS_MISSING",
	"LOGIC_INCORRECT",
	"SECURITY_CONCERN",
	"REVIEW_OUTPUT_SCHEMA_INVALID",
] as const;

interface NormalizedReviewerOutput {
	review_verdict: "approve" | "revise";
	review_reason_codes: string[];
	review_notes: string;
}

interface NormalizedJudgeOutput {
	alignment_score: number;
	constraint_violations: string[];
	missing_evidence: string[];
	recommendations: string[];
	pass: boolean;
	judge_rubric: string;
	objective_id: string;
	judge_pass: string;
	judge_notes: string;
	decision: string;
	review_notes: string;
	human_questions_md: string;
	[key: string]: unknown;
}

/** Check output against node-level constraints. */
export function checkOutputConstraints(
	node: Node,
	output: string,
	ctx: Context,
	intentBinding?: IntentBinding | null,
): ConstraintResult {
	const violations: string[] = [];

	// output_must_contain: comma-separated strings that must all appear
	const mustContain = node.attrs["output_must_contain"] ?? "";
	if (mustContain) {
		for (const raw of mustContain.split(",")) {
			const needle = expandVariables(raw.trim(), ctx);
			if (needle && !output.includes(needle)) {
				violations.push(`output must contain "${needle}"`);
			}
		}
	}

	// output_must_not_contain: comma-separated strings that must not appear
	const mustNotContain = node.attrs["output_must_not_contain"] ?? "";
	if (mustNotContain) {
		for (const raw of mustNotContain.split(",")) {
			const needle = expandVariables(raw.trim(), ctx);
			if (needle && output.includes(needle)) {
				violations.push(`output must not contain "${needle}"`);
			}
		}
	}

	if (isJudgeNode(node)) {
		const judgeValidation = validateAndNormalizeJudgeOutput(node, output, ctx, intentBinding);
		if (!judgeValidation.passed) {
			violations.push(...judgeValidation.violations);
		}
		return {
			passed: violations.length === 0,
			violations,
			normalizedOutput: judgeValidation.normalizedOutput,
		};
	}

	if (isReviewerNode(node)) {
		const reviewerValidation = validateAndNormalizeReviewerOutput(node, output);
		if (!reviewerValidation.passed) {
			violations.push(...reviewerValidation.violations);
		}
		return {
			passed: violations.length === 0,
			violations,
			normalizedOutput: reviewerValidation.normalizedOutput,
		};
	}

	return {
		passed: violations.length === 0,
		violations,
	};
}

interface JudgeValidationResult {
	passed: boolean;
	violations: string[];
	normalizedOutput?: string;
}

function validateAndNormalizeJudgeOutput(
	node: Node,
	rawOutput: string,
	ctx: Context,
	intentBinding?: IntentBinding | null,
): JudgeValidationResult {
	const payload = parseObject(rawOutput);
	if (!payload) {
		return {
			passed: false,
			violations: [
				diagnostic("judge_output_not_json", node.id, {
					required_keys: [...REQUIRED_JUDGE_KEYS],
				}),
			],
		};
	}

	const normalized = normalizeJudgePayload(node, payload, ctx, intentBinding);
	if (!normalized.ok) {
		return {
			passed: false,
			violations: [
				diagnostic("judge_output_invalid", node.id, {
					issues: normalized.issues,
					required_keys: [...REQUIRED_JUDGE_KEYS],
				}),
			],
		};
	}

	return {
		passed: true,
		violations: [],
		normalizedOutput: JSON.stringify(normalized.value),
	};
}

function normalizeJudgePayload(
	node: Node,
	payload: Record<string, unknown>,
	ctx: Context,
	intentBinding?: IntentBinding | null,
): { ok: true; value: NormalizedJudgeOutput } | { ok: false; issues: string[] } {
	const issues: string[] = [];
	const rubric = resolveJudgeRubric(node, intentBinding);
	const objectiveId = resolveJudgeObjectiveId(node, intentBinding);

	const hasCanonical = REQUIRED_JUDGE_KEYS.every((key) => key in payload);
	const hasLegacyJudge = "judge_pass" in payload;
	const hasLegacyDecision = "decision" in payload;

	let base: {
		alignmentScore: number;
		constraintViolations: string[];
		missingEvidence: string[];
		recommendations: string[];
		pass: boolean;
		humanQuestionsMd: string;
	} | null = null;

	if (hasCanonical) {
		const passVal = payload["pass"];
		if (typeof passVal !== "boolean") {
			issues.push("pass must be boolean when canonical judge schema is used");
		}

		const alignmentScore = toFiniteNumber(payload["alignment_score"]);
		if (alignmentScore === null) issues.push("alignment_score must be a finite number");

		const constraintViolations = normalizeStringArray(payload["constraint_violations"]);
		const missingEvidence = normalizeStringArray(payload["missing_evidence"]);
		const recommendations = normalizeStringArray(payload["recommendations"]);
		const humanQuestionsMd = toTrimmedString(payload["human_questions_md"]);

		if (issues.length === 0) {
			base = {
				alignmentScore: alignmentScore!,
				constraintViolations,
				missingEvidence,
				recommendations,
				pass: passVal as boolean,
				humanQuestionsMd,
			};
		}
	} else if (hasLegacyJudge) {
		const pass = parseBoolean(payload["judge_pass"]);
		if (pass === null) {
			issues.push("legacy judge schema requires judge_pass=true|false");
		} else {
			base = {
				alignmentScore: toFiniteNumber(payload["alignment_score"]) ?? (pass ? 1 : 0),
				constraintViolations: normalizeStringArray(payload["constraint_violations"]),
				missingEvidence: normalizeStringArray(payload["missing_evidence"]),
				recommendations: normalizeStringArray(payload["recommendations"], toTrimmedString(payload["judge_notes"])),
				pass,
				humanQuestionsMd: toTrimmedString(payload["human_questions_md"]),
			};
		}
	} else if (hasLegacyDecision) {
		const decision = toTrimmedString(payload["decision"]).toLowerCase();
		if (decision !== "approved" && decision !== "revise") {
			issues.push("legacy decision schema requires decision=approved|revise");
		} else {
			const pass = decision === "approved";
			base = {
				alignmentScore: toFiniteNumber(payload["alignment_score"]) ?? (pass ? 1 : 0),
				constraintViolations: normalizeStringArray(payload["constraint_violations"]),
				missingEvidence: normalizeStringArray(payload["missing_evidence"]),
				recommendations: normalizeStringArray(payload["recommendations"], toTrimmedString(payload["review_notes"])),
				pass,
				humanQuestionsMd: toTrimmedString(payload["human_questions_md"]),
			};
		}
	} else {
		issues.push(
			"judge output must be canonical schema (alignment_score,constraint_violations,missing_evidence,recommendations,pass) or explicit legacy schema (judge_pass/* or decision/*)",
		);
	}

	if (!base) return { ok: false, issues };

	const requiredEvidence = parseCsv(node.attrs["judge_required_evidence"]);
	const lookup = ctx.lookup();
	const missingRequiredEvidence = requiredEvidence.filter((key) => lookup(key).trim() === "");

	const missingEvidence = uniqueSorted([...base.missingEvidence, ...missingRequiredEvidence]);
	const recommendations = uniquePreserveOrder(base.recommendations);
	const constraintViolations = uniquePreserveOrder(base.constraintViolations);
	const pass = missingEvidence.length > 0 ? false : base.pass;
	const judgeNotes = recommendations.join("\n");

	const passthroughFields = extractCustomJudgeFields(payload);
	const normalized: NormalizedJudgeOutput = {
		alignment_score: base.alignmentScore,
		constraint_violations: constraintViolations,
		missing_evidence: missingEvidence,
		recommendations,
		pass,
		judge_rubric: rubric,
		objective_id: objectiveId,
		judge_pass: pass ? "true" : "false",
		judge_notes: judgeNotes,
		decision: pass ? "approved" : "revise",
		review_notes: judgeNotes,
		human_questions_md: base.humanQuestionsMd,
		...passthroughFields,
	};

	const normalizedIssues = validateNormalizedJudgeOutput(normalized);
	if (normalizedIssues.length > 0) {
		return { ok: false, issues: [...issues, ...normalizedIssues] };
	}
	return { ok: true, value: normalized };
}

function extractCustomJudgeFields(payload: Record<string, unknown>): Record<string, unknown> {
	const passthrough: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (RESERVED_JUDGE_OUTPUT_KEYS.has(key)) continue;
		passthrough[key] = value;
	}
	return passthrough;
}

function validateNormalizedJudgeOutput(output: NormalizedJudgeOutput): string[] {
	const issues: string[] = [];
	if (!Number.isFinite(output.alignment_score)) issues.push("alignment_score must be finite number");
	if (!Array.isArray(output.constraint_violations)) issues.push("constraint_violations must be array");
	if (!Array.isArray(output.missing_evidence)) issues.push("missing_evidence must be array");
	if (!Array.isArray(output.recommendations)) issues.push("recommendations must be array");
	if (typeof output.pass !== "boolean") issues.push("pass must be boolean");
	if (!output.judge_rubric) issues.push("judge_rubric must be non-empty");
	if (!output.objective_id) issues.push("objective_id must be non-empty");
	return issues;
}

function resolveJudgeRubric(node: Node, intentBinding?: IntentBinding | null): string {
	const explicit = toTrimmedString(node.attrs["judge_rubric"]);
	if (explicit) return explicit;
	const profile = intentBinding?.profile || DEFAULT_INTENT_PROFILE;
	return `alignment.${profile}`;
}

function resolveJudgeObjectiveId(node: Node, intentBinding?: IntentBinding | null): string {
	const explicit = toTrimmedString(node.attrs["objective_id"]);
	if (explicit) return explicit;
	if (intentBinding?.intentRef) {
		const profile = intentBinding.profile || DEFAULT_INTENT_PROFILE;
		return `${intentBinding.intentRef}@${profile}`;
	}
	return "intent.unbound";
}

function validateAndNormalizeReviewerOutput(node: Node, rawOutput: string): JudgeValidationResult {
	const payload = parseObject(rawOutput);
	if (!payload) {
		return {
			passed: false,
			violations: [
				diagnostic("reviewer_output_not_json", node.id, {
					required_keys: [...REQUIRED_REVIEWER_KEYS],
					allowed_review_verdicts: [...REVIEWER_VERDICTS],
					allowed_review_reason_codes: [...REVIEWER_REASON_CODES],
				}),
			],
		};
	}

	const normalized = normalizeReviewerPayload(payload);
	if (!normalized.ok) {
		return {
			passed: false,
			violations: [
				diagnostic("reviewer_output_invalid", node.id, {
					issues: normalized.issues,
					required_keys: [...REQUIRED_REVIEWER_KEYS],
					allowed_review_verdicts: [...REVIEWER_VERDICTS],
					allowed_review_reason_codes: [...REVIEWER_REASON_CODES],
				}),
			],
		};
	}

	return {
		passed: true,
		violations: [],
		normalizedOutput: JSON.stringify(normalized.value),
	};
}

function normalizeReviewerPayload(
	payload: Record<string, unknown>,
): { ok: true; value: NormalizedReviewerOutput } | { ok: false; issues: string[] } {
	const issues: string[] = [];
	const requiredKeys = [...REQUIRED_REVIEWER_KEYS];
	for (const key of requiredKeys) {
		if (!(key in payload)) issues.push(`${key} is required`);
	}

	const verdict = toTrimmedString(payload["review_verdict"]).toLowerCase();
	if (verdict !== "approve" && verdict !== "revise") {
		issues.push(`review_verdict must be one of ${REVIEWER_VERDICTS.join("|")}`);
	}

	const reviewNotes = toTrimmedString(payload["review_notes"]);
	if (!reviewNotes) issues.push("review_notes must be non-empty");

	const normalizedCodes: string[] = [];
	const rawCodes = payload["review_reason_codes"];
	if (!Array.isArray(rawCodes)) {
		issues.push("review_reason_codes must be a non-empty array");
	} else {
		for (const entry of rawCodes) {
			const code = toTrimmedString(entry).toUpperCase();
			if (!code) continue;
			if (!REVIEWER_REASON_CODES.includes(code as (typeof REVIEWER_REASON_CODES)[number])) {
				issues.push(`review_reason_codes contains unsupported code: ${code}`);
				continue;
			}
			if (!normalizedCodes.includes(code)) normalizedCodes.push(code);
		}
		if (normalizedCodes.length === 0) {
			issues.push("review_reason_codes must contain at least one supported code");
		}
	}

	if (verdict === "approve") {
		if (normalizedCodes.length !== 1 || normalizedCodes[0] !== "APPROVED") {
			issues.push('approve verdict requires review_reason_codes=["APPROVED"]');
		}
	}
	if (verdict === "revise" && normalizedCodes.includes("APPROVED")) {
		issues.push('revise verdict must not include "APPROVED" reason code');
	}

	if (issues.length > 0) return { ok: false, issues: uniqueSorted(issues) };
	return {
		ok: true,
		value: {
			review_verdict: verdict as "approve" | "revise",
			review_reason_codes: normalizedCodes,
			review_notes: reviewNotes,
		},
	};
}

/** Strip markdown code fences from LLM output (e.g. ```json ... ```). */
export function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	const fenceMatch = trimmed.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?\s*```$/);
	return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * Extract JSON from an embedded code fence within prose output.
 *
 * LLMs commonly return prose analysis followed by a ```json ... ``` block.
 * `stripCodeFences` only handles fence-only output (anchored ^ ... $).
 * This function handles the prose+fence case by scanning for the last
 * ```json or ``` fence in the output and extracting its content.
 *
 * Returns the extracted JSON string if a valid JSON block is found,
 * or null if no embedded fence with valid JSON is present.
 */
export function extractEmbeddedJsonFence(text: string): string | null {
	// Match all ```json or ``` fences in the text, prefer the last one
	// since LLMs typically end with the structured output after prose reasoning.
	const fencePattern = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/g;
	let lastCandidate: string | null = null;
	let match: RegExpExecArray | null;
	while ((match = fencePattern.exec(text)) !== null) {
		const candidate = match[1].trim();
		try {
			JSON.parse(candidate);
			lastCandidate = candidate;
		} catch {
			// keep looking for a later fence that is valid JSON
		}
	}
	return lastCandidate;
}

/** Check output_format="json" constraint. Returns cleaned output if fences were stripped. */
export function checkOutputFormat(node: Node, output: string): ConstraintResult & { cleaned?: string } {
	const format = node.attrs["output_format"] ?? "";
	if (format !== "json") return { passed: true, violations: [] };

	// Try raw output first
	try {
		JSON.parse(output);
		return { passed: true, violations: [] };
	} catch {
		// Try stripping a fence-only output (```json ... ``` with no surrounding prose)
		const stripped = stripCodeFences(output);
		if (stripped !== output) {
			try {
				JSON.parse(stripped);
				return { passed: true, violations: [], cleaned: stripped };
			} catch {
				// Fall through to embedded-fence extraction
			}
		}
		// Try extracting JSON from an embedded fence in prose output.
		// This handles the common LLM pattern of prose analysis followed by a
		// ```json ... ``` block, which stripCodeFences cannot handle because its
		// regex is anchored to the full string (^ ... $).
		const embedded = extractEmbeddedJsonFence(output);
		if (embedded !== null) {
			return { passed: true, violations: [], cleaned: embedded };
		}
		return { passed: false, violations: ["output is not valid JSON"] };
	}
}

function isJudgeNode(node: Node): boolean {
	const raw = toTrimmedString(node.attrs["judge"]).toLowerCase();
	return raw === "true" || raw === "1" || raw === "yes";
}

function isReviewerNode(node: Node): boolean {
	const explicit = toTrimmedString(node.attrs["reviewer"]).toLowerCase();
	return explicit === "true" || explicit === "1" || explicit === "yes";
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

function parseCsv(raw: string): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((v) => v.trim())
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

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return null;
}

function normalizeStringArray(value: unknown, fallback = ""): string[] {
	const out: string[] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			const normalized = toTrimmedString(item);
			if (normalized) out.push(normalized);
		}
		return out;
	}
	const asText = toTrimmedString(value);
	if (asText) return [asText];
	if (fallback.trim()) return [fallback.trim()];
	return [];
}

function uniquePreserveOrder(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

function uniqueSorted(values: string[]): string[] {
	const out = [...new Set(values.filter(Boolean))];
	out.sort((a, b) => a.localeCompare(b));
	return out;
}

function toTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function diagnostic(code: string, nodeId: string, details: Record<string, unknown>): string {
	return JSON.stringify({ code, node_id: nodeId, ...details });
}
