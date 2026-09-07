import { createHash } from "node:crypto";

export interface GuardCountersLike {
	tool_calls: number;
	llm_calls: number;
	review_retry_calls: number;
	pipeline_transition_calls: number;
}

export type GuardReasonCodeLike = string;

export interface RunStateLike {
	runId: string;
}

export interface GuardDecisionTelemetryView {
	allowed: boolean;
	counter: string;
	reasonCode: GuardReasonCodeLike | "";
	circuitState: string;
	transition: string;
	policyRevision: string;
	threshold: number;
	scope: string;
	backoffMs: number;
	nextAttemptAt: string;
	runCounters: GuardCountersLike;
	factoryCounters: GuardCountersLike;
	ownerId: string;
	leaseName: string;
	leaseGeneration: number;
	gateName?: string;
	gateOutcome?: "pass" | "fail";
	gateEvidenceRef?: string;
}

export function toGuardEventData(decision: GuardDecisionTelemetryView, extras: Record<string, string> = {}): Record<string, string> {
	return {
		allowed: decision.allowed ? "true" : "false",
		counter: decision.counter,
		reason_code: decision.reasonCode,
		circuit_state: decision.circuitState,
		transition: decision.transition,
		policy_revision: decision.policyRevision,
		threshold: String(decision.threshold),
		scope: decision.scope,
		backoff_ms: String(decision.backoffMs),
		next_attempt_at: decision.nextAttemptAt,
		owner_id: decision.ownerId,
		lease_name: decision.leaseName,
		lease_generation: String(decision.leaseGeneration),
		tool_calls: String(decision.runCounters.tool_calls),
		llm_calls: String(decision.runCounters.llm_calls),
		review_retry_calls: String(decision.runCounters.review_retry_calls),
		pipeline_transition_calls: String(decision.runCounters.pipeline_transition_calls),
		factory_tool_calls: String(decision.factoryCounters.tool_calls),
		factory_llm_calls: String(decision.factoryCounters.llm_calls),
		factory_review_retry_calls: String(decision.factoryCounters.review_retry_calls),
		factory_pipeline_transition_calls: String(decision.factoryCounters.pipeline_transition_calls),
		gate_name: decision.gateName || gateNameForDecision(decision),
		gate_outcome: decision.gateOutcome || gateOutcomeForDecision(decision),
		gate_evidence_ref: decision.gateEvidenceRef || "",
		...extras,
	};
}

export function gateNameForDecision(decision: GuardDecisionTelemetryView): string {
	if (decision.transition === "reset") return "guard.reset";
	if (!decision.counter) return "guard.circuit";
	return `guard.${decision.counter}`;
}

export function gateOutcomeForDecision(decision: GuardDecisionTelemetryView): "pass" | "fail" {
	return decision.allowed ? "pass" : "fail";
}

export function gateEvidenceRefForArtifact(args: {
	runState: RunStateLike;
	nodeId: string;
	artifactPath: string;
	decision: GuardDecisionTelemetryView;
	nowIso: string;
}): string {
	const digest = createHash("sha256").update(JSON.stringify({
		runId: args.runState.runId,
		nodeId: args.nodeId,
		artifactPath: args.artifactPath,
		transition: args.decision.transition,
		reasonCode: args.decision.reasonCode,
		ts: args.nowIso,
	})).digest("hex");
	return `sha256:${digest}`;
}

export function trustEnvelopeFromContext(context: Record<string, string> | undefined): Record<string, string> {
	const trustPartition = normalizeTrustPartition(context?.trust_partition);
	const trustDomain = String(context?.trust_domain || trustPartition || "builder");
	const trustRole = String(context?.trust_role || context?.agent_role || "unknown");
	const trustPartitionKey = String(context?.trust_partition_key || `${trustPartition}/${trustRole}`);
	return {
		trust_partition: trustPartition,
		trust_domain: trustDomain,
		trust_role: trustRole,
		trust_partition_key: trustPartitionKey,
	};
}

function normalizeTrustPartition(value: string | undefined): "builder" | "judge" {
	const normalized = String(value || "").trim().toLowerCase();
	return normalized === "judge" ? "judge" : "builder";
}
