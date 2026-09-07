import { createHash } from "node:crypto";

import { toGuardEventData, trustEnvelopeFromContext, type GuardDecisionTelemetryView } from "@recallnet/factory-telemetry";

import type { RunState } from "./run.js";

type GuardEventKind = "guard.decision" | "guard.transition";

export function buildGuardEventTelemetry(args: {
	runState: RunState;
	decision: GuardDecisionTelemetryView;
	nodeId: string;
	kind: GuardEventKind;
	artifactPath: string;
	policyRevision: string;
	factoryScope: string;
	workerPeriod: string;
	eventContext?: Record<string, string>;
}): { traceId: string; data: Record<string, string> } {
	const trustEnvelope = trustEnvelopeFromContext(args.eventContext);
	const tracePartition = normalizeGuardPartition(trustEnvelope.trust_partition);
	const traceId = deriveGuardTraceId({
		runState: args.runState,
		decision: args.decision,
		nodeId: args.nodeId,
		partition: tracePartition,
		kind: args.kind,
		policyRevision: args.policyRevision,
		factoryScope: args.factoryScope,
		workerPeriod: args.workerPeriod,
	});
	const guardCircuitState = args.decision.circuitState || args.runState.guard.circuitState || "closed";
	const factoryId = String(
		args.eventContext?.factory_id
		|| args.eventContext?.factoryId
		|| args.runState.context?.factory_id
		|| "",
	).trim();
	const extras = {
		artifact_path: args.artifactPath,
		reason_code: args.decision.reasonCode || "",
		scope: args.decision.scope || "none",
		policy_revision: args.decision.policyRevision || args.policyRevision,
		factory_scope: args.factoryScope,
		worker_period: args.workerPeriod,
		guard_circuit_state: guardCircuitState,
		trace_partition: tracePartition,
		guard_trace_id: traceId,
		...(factoryId ? { factory_id: factoryId } : {}),
		...trustEnvelope,
	};
	try {
		return {
			traceId,
			data: toGuardEventData(args.decision, extras),
		};
	} catch {
		return {
			traceId,
			data: {
				allowed: args.decision.allowed ? "true" : "false",
				reason_code: args.decision.reasonCode || "",
				scope: args.decision.scope || "none",
				policy_revision: args.decision.policyRevision || args.policyRevision,
				factory_scope: args.factoryScope,
				worker_period: args.workerPeriod,
				guard_circuit_state: guardCircuitState,
				artifact_path: args.artifactPath,
				trace_partition: tracePartition,
				guard_trace_id: traceId,
				...trustEnvelope,
			},
		};
	}
}

function normalizeGuardPartition(value: string | undefined): "builder" | "judge" {
	return String(value || "").trim().toLowerCase() === "judge" ? "judge" : "builder";
}

function deriveGuardTraceId(args: {
	runState: RunState;
	decision: GuardDecisionTelemetryView;
	nodeId: string;
	partition: "builder" | "judge";
	kind: GuardEventKind;
	policyRevision: string;
	factoryScope: string;
	workerPeriod: string;
}): string {
	const fallback = `${args.partition}-guard-unscoped`;
	try {
		const fingerprint = JSON.stringify({
			runId: args.runState.runId,
			nodeId: args.nodeId || "guard.unknown",
			kind: args.kind,
			counter: args.decision.counter || "",
			reasonCode: args.decision.reasonCode || "",
			scope: args.decision.scope || "none",
			transition: args.decision.transition,
			policyRevision: args.decision.policyRevision || args.policyRevision,
			factoryScope: args.factoryScope,
			workerPeriod: args.workerPeriod,
			guardCircuitState: args.decision.circuitState || args.runState.guard.circuitState || "closed",
			runCounters: args.decision.runCounters,
			factoryCounters: args.decision.factoryCounters,
		});
		const digest = createHash("sha256").update(fingerprint).digest("hex").slice(0, 20);
		return `${args.partition}-guard-${digest}`;
	} catch {
		return fallback;
	}
}
