import {
	type GuardCounterKey,
	type GuardDecision,
	type GuardGateOptions,
	type GuardMutationOptions,
	resolvePolicy,
	factoryKey,
	loadFactoryGuardState,
	saveFactoryGuardState,
	nowIso,
	finalizeOpenToClosed,
	snapshotOwner,
	persistRunGuard,
	isOpenAndActive,
	emitDecision,
} from "./guard-core.js";
import {
	buildBlockedDecision,
	recordGuardMetadata,
	incrementGuardCounter,
	statusForGuardDecision,
	resetGuardBudgets,
} from "./guard-recovery.js";
import {
	type RunState,
	type RunStatus,
	type GuardCounters,
	type GuardCircuitState,
	type RunGuardState,
	normalizeRunGuardState,
} from "./run.js";

import type { EventBus } from "@recallnet/factory-telemetry";

const LLM_HANDLER_TYPES = new Set(["codergen", "stack.manager_loop", "agent.worktree", "agent.kw"]);

export interface GuardResetOptions {
	runState: RunState;
	actorId: string;
	force?: boolean;
	eventBus?: EventBus;
	now?: Date;
	context?: Record<string, string>;
}

export interface GuardResetResult {
	ok: boolean;
	reason: string;
	artifactPath: string;
	runState: RunGuardState;
	factoryState: {
		factoryScope: string;
		workerPeriod: string;
		counters: GuardCounters;
		circuitState: GuardCircuitState;
		reasonCode: string;
		resetCount: number;
	};
}

export function guardCounterForHandlerType(handlerType: string): GuardCounterKey | null {
	if (handlerType === "tool") return "tool_calls";
	if (handlerType === "pipeline") return "pipeline_transition_calls";
	if (LLM_HANDLER_TYPES.has(handlerType)) return "llm_calls";
	return null;
}

export function guardCounterForTransition(fromNodeId: string, toNodeId: string, context: Record<string, string>): GuardCounterKey | null {
	const from = String(fromNodeId || "").toLowerCase();
	const to = String(toNodeId || "").toLowerCase();
	const verdict = String(context.review_verdict || "").toLowerCase();
	const isReviewReentry = from.includes("retry") || verdict === "revise";
	if (to === "build" && isReviewReentry) {
		return "review_retry_calls";
	}
	return null;
}

export function evaluateGuardGate(options: GuardGateOptions): GuardDecision {
	const now = options.now ?? new Date();
	const nodeId = options.nodeId ?? "";
	const runState = options.runState;
	runState.guard = normalizeRunGuardState(runState.runId, runState.guard);
	const policy = resolvePolicy(runState, options.context);
	runState.guard.owner.ownerId = runState.guard.owner.ownerId || `run:${runState.runId}`;

	const leaseName = `factory-guard-${factoryKey(policy.factoryScope, policy.workerPeriod)}`;
	const ownerId = runState.guard.owner.ownerId;
	const factoryState = loadFactoryGuardState(policy, ownerId, now);
	let changed = false;
	if (finalizeOpenToClosed(runState.guard, now)) changed = true;
	if (finalizeOpenToClosed(factoryState, now)) {
		factoryState.updatedAt = nowIso(now);
		saveFactoryGuardState(policy, factoryState);
	}

	runState.guard.factoryCounters = { ...factoryState.counters };
	if (changed) persistRunGuard(runState, policy);

	const guardContext = {
		nodeId: String(nodeId || options.context?.last_stage || ""),
		issueNumber: String(options.context?.current_issue_number || options.context?.issue_number || options.context?.target_issue_number || ""),
		branch: String(options.context?.branch || options.context?.last_branch || "").trim(),
		milestoneTitle: String(options.context?.milestone_title || ""),
	};

	if (runState.guard.circuitState === "terminal") {
		const decision = buildBlockedDecision(runState, factoryState, policy, "", "guard_terminal_state", "terminal", "run");
		recordGuardMetadata({ runState, decision, context: guardContext, now });
		emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
		persistRunGuard(runState, policy);
		return decision;
	}

	if (isOpenAndActive(runState.guard, now)) {
		const decision = buildBlockedDecision(runState, factoryState, policy, "", "guard_backoff_active", "open", "run");
		recordGuardMetadata({ runState, decision, context: guardContext, now });
		emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
		persistRunGuard(runState, policy);
		return decision;
	}

	if (factoryState.circuitState === "terminal") {
		runState.guard.circuitState = "terminal";
		runState.guard.reasonCode = factoryState.reasonCode || "guard_terminal_state";
		runState.guard.terminalAt = factoryState.terminalAt || nowIso(now);
		const decision = buildBlockedDecision(runState, factoryState, policy, "", "guard_terminal_state", "terminal", "factory");
		recordGuardMetadata({ runState, decision, context: guardContext, now });
		emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
		persistRunGuard(runState, policy);
		return decision;
	}

	if (isOpenAndActive(factoryState, now)) {
		runState.guard.circuitState = "open";
		runState.guard.reasonCode = factoryState.reasonCode || "guard_backoff_active";
		runState.guard.openedAt = factoryState.openedAt;
		runState.guard.expiresAt = factoryState.expiresAt;
		const decision = buildBlockedDecision(runState, factoryState, policy, "", "guard_backoff_active", "open", "factory");
		recordGuardMetadata({ runState, decision, context: guardContext, now });
		emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
		persistRunGuard(runState, policy);
		return decision;
	}

	const owner = snapshotOwner(runState, leaseName);
	runState.guard.owner = owner;
	persistRunGuard(runState, policy);

	return {
		allowed: true,
		counter: "",
		reasonCode: "",
		circuitState: runState.guard.circuitState,
		transition: "none",
		policyRevision: policy.revision,
		threshold: 0,
		scope: "none",
		backoffMs: 0,
		nextAttemptAt: "",
		runCounters: { ...runState.guard.counters },
		factoryCounters: { ...factoryState.counters },
		ownerId: owner.ownerId,
		leaseName: owner.leaseName,
		leaseGeneration: owner.leaseGeneration,
	};
}

export {
	type GuardCounterKey,
	type GuardDecision,
	type GuardGateOptions,
	type GuardMutationOptions,
	incrementGuardCounter,
	statusForGuardDecision,
	resetGuardBudgets,
};
