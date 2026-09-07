import type { Event } from "./events.js";

export interface QualitySignalInput {
	nodeId: string;
	traceId: string;
	trustPartition: string;
	trustDomain: string;
	trustRole: string;
	attempt: number;
	outcome: "pass" | "fail";
	failureClass: string;
	guardState: string;
	handlerType: string;
	model: string;
}

export interface QualitySignal {
	quality_score: string;
	quality_grade: "high" | "medium" | "low";
	quality_reason: string;
	quality_outcome: "pass" | "fail";
	quality_failure_class: string;
	quality_guard_state: string;
	quality_skill: string;
	quality_model: string;
	quality_attempt: string;
	quality_schema_version: "hatch.quality_signal.v1";
	langfuse_quality_score: string;
	langfuse_quality_grade: "high" | "medium" | "low";
	langfuse_quality_reason: string;
	langfuse_quality_outcome: "pass" | "fail";
	langfuse_failure_class: string;
	langfuse_skill: string;
	langfuse_quality_model: string;
	langfuse_quality_attempt: string;
	langfuse_quality_schema_version: "hatch.quality_signal.v1";
}

export interface RetryTelemetryInput {
	attempt: number;
	outcome: "pass" | "fail";
}

export interface RetryTelemetryMetadata {
	"hatch.retry_class": "first_pass" | "retry_pass" | "first_fail" | "retry_fail";
	"hatch.first_attempt_pass": "true" | "false";
}

export function deriveQualitySignal(input: QualitySignalInput): QualitySignal {
	let score = 1;
	const reasons: string[] = ["base=1.00"];

	if (input.outcome === "fail") {
		score -= 0.4;
		reasons.push("outcome=fail:-0.40");
	}
	if (input.failureClass !== "none") {
		score -= 0.2;
		reasons.push("failure_class!=none:-0.20");
	}
	if (input.guardState === "guarded" || input.guardState === "guarded_terminal") {
		score -= 0.3;
		reasons.push("guarded:-0.30");
	}
	if (input.attempt > 1) {
		const retryPenalty = Math.min(0.3, (input.attempt - 1) * 0.1);
		score -= retryPenalty;
		reasons.push(`retries=${input.attempt - 1}:-${retryPenalty.toFixed(2)}`);
	}

	const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
	const grade: QualitySignal["quality_grade"] = boundedScore >= 0.8 ? "high" : boundedScore >= 0.5 ? "medium" : "low";
	const scoreText = boundedScore.toFixed(2);
	const reason = reasons.join(";");
	const skill = input.handlerType || "unknown";
	const model = input.model || "unknown";
	const attempt = String(input.attempt);
	const schemaVersion = "hatch.quality_signal.v1" as const;

	return {
		quality_score: scoreText,
		quality_grade: grade,
		quality_reason: reason,
		quality_outcome: input.outcome,
		quality_failure_class: input.failureClass,
		quality_guard_state: input.guardState,
		quality_skill: skill,
		quality_model: model,
		quality_attempt: attempt,
		quality_schema_version: schemaVersion,
		langfuse_quality_score: scoreText,
		langfuse_quality_grade: grade,
		langfuse_quality_reason: reason,
		langfuse_quality_outcome: input.outcome,
		langfuse_failure_class: input.failureClass,
		langfuse_skill: skill,
		langfuse_quality_model: model,
		langfuse_quality_attempt: attempt,
		langfuse_quality_schema_version: schemaVersion,
	};
}

export function deriveRetryTelemetry(input: RetryTelemetryInput): RetryTelemetryMetadata {
	const firstAttemptPass = input.attempt === 1 && input.outcome === "pass";
	const retryClass: RetryTelemetryMetadata["hatch.retry_class"] = input.outcome === "pass"
		? (input.attempt === 1 ? "first_pass" : "retry_pass")
		: (input.attempt === 1 ? "first_fail" : "retry_fail");
	return {
		"hatch.retry_class": retryClass,
		"hatch.first_attempt_pass": firstAttemptPass ? "true" : "false",
	};
}

export function buildQualitySignalEventData(event: Event): Record<string, string> | null {
	if (event.kind !== "stage.finish" && event.kind !== "stage.error") return null;
	const traceId = String(event.traceId || "");
	if (!traceId) return null;

	const data = event.data || {};
	const attempt = Number.parseInt(String(data.attempt || "1"), 10) || 1;
	const outcome: "pass" | "fail" = event.kind === "stage.finish" ? "pass" : "fail";
	const failureClass = event.kind === "stage.error"
		? classifyFailureMessage(event.error?.message || event.message || "")
		: "none";
	const signal = deriveQualitySignal({
		nodeId: String(event.nodeId || ""),
		traceId,
		trustPartition: String(data.trust_partition || "builder"),
		trustDomain: String(data.trust_domain || data.trust_partition || "builder"),
		trustRole: String(data.trust_role || data.agent_role || "unknown"),
		attempt,
		outcome,
		failureClass,
		guardState: normalizeGuardState(data.guard_circuit_state),
		handlerType: String(data.handler_type || "unknown"),
		model: String(data.model || "unknown"),
	});
	const retryTelemetry = deriveRetryTelemetry({ attempt, outcome });

	return {
		...data,
		...signal,
		...retryTelemetry,
		"hatch.kpi.quality.skill": signal.quality_skill,
		"hatch.kpi.retry.failure_class": signal.quality_failure_class,
	};
}

export function classifyFailureMessage(message: string): string {
	const text = String(message || "").toLowerCase();
	if (!text) return "unknown";
	if (text.includes("timed out")) return "timeout";
	if (text.includes("guard")) return "guard";
	if (text.includes("validation")) return "validation";
	if (text.includes("schema")) return "schema";
	if (text.includes("length") || text.includes("context limit")) return "length";
	return "runtime";
}

function normalizeGuardState(value: string | undefined): string {
	const state = String(value || "").trim().toLowerCase();
	if (state === "open") return "guarded";
	if (state === "terminal") return "guarded_terminal";
	if (state === "closed") return "closed";
	return state || "closed";
}
