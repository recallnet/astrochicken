import {
	toGuardEventData,
	trustEnvelopeFromContext,
} from "@recallnet/factory-telemetry";

import {
	type FactoryGuardState,
	type GuardCounterKey,
	type GuardDecision,
	type GuardMutationOptions,
	type GuardPolicy,
	DEFAULT_POLICY_REVISION,
	createCounters,
	normalizeCounterKey,
	resolvePolicy,
	loadFactoryGuardState,
	saveFactoryGuardState,
	mapReason,
	emitDecision,
	nowIso,
	finalizeOpenToClosed,
	factoryKey,
	persistRunGuard,
	isOpenAndActive,
} from "./guard-core.js";
import { evaluateGuardGate } from "./guard.js";
import { acquireLock, readLease } from "./lock.js";
import {
	type GuardDecisionMetadata,
	type RunState,
	type RunStatus,
	normalizeRunGuardState,
	saveRunState,
} from "./run.js";

import type { EventBus } from "@recallnet/factory-telemetry";


interface GuardMetadataContext {
	nodeId: string;
	issueNumber: string;
	branch: string;
	milestoneTitle: string;
}

const CONTEXT_BRANCH_KEYS = ["branch", "last_branch"] as const;

function resolveBranchFromContext(context: Record<string, string> = {}): string {
	for (const key of CONTEXT_BRANCH_KEYS) {
		const candidate = String(context?.[key] || "").trim();
		if (candidate) return candidate;
	}
	return "";
}

function buildGuardMetadataContext({ context = {}, nodeId = "" }: { context?: Record<string, string>; nodeId?: string }): GuardMetadataContext {
	const issueNumber = String(context?.current_issue_number || context?.issue_number || context?.target_issue_number || "");
	const milestoneTitle = String(context?.milestone_title || "");
	const branch = resolveBranchFromContext(context);
	return {
		nodeId: String(nodeId || context?.last_stage || ""),
		issueNumber,
		branch,
		milestoneTitle,
	};
}

function buildGuardDecisionMetadata({
	reasonCode,
	now,
	context,
}: {
	reasonCode: GuardDecision["reasonCode"];
	now: Date;
	context: GuardMetadataContext;
}): GuardDecisionMetadata {
	return {
		reasonCode,
		nodeId: context.nodeId,
		issueNumber: context.issueNumber,
		branch: context.branch,
		milestoneTitle: context.milestoneTitle,
		capturedAt: nowIso(now),
	};
}

export function recordGuardMetadata({
	runState,
	decision,
	context,
	now,
}: {
	runState: RunState;
	decision: GuardDecision;
	context: GuardMetadataContext;
	now: Date;
}): void {
	if (decision.allowed) return;
	if (decision.circuitState !== "open" && decision.circuitState !== "terminal") return;
	runState.guard.metadata = buildGuardDecisionMetadata({ reasonCode: decision.reasonCode || "", now, context });
	runState.guard.reasonCode = decision.reasonCode || runState.guard.reasonCode || "";
}

export function buildBlockedDecision(
	runState: RunState,
	factoryState: FactoryGuardState,
	policy: GuardPolicy,
	counter: GuardCounterKey | "",
	reasonCode: GuardDecision["reasonCode"],
	circuitState: GuardDecision["circuitState"],
	scope: GuardDecision["scope"],
): GuardDecision {
	const threshold =
		scope === "run" && counter
			? policy.runLimits[counter]
			: scope === "factory" && counter
				? policy.factoryLimits[counter]
				: 0;
	return {
		allowed: false,
		counter,
		reasonCode,
		circuitState,
		transition: "none",
		policyRevision: policy.revision,
		threshold,
		scope,
		backoffMs: 0,
		nextAttemptAt: runState.guard.expiresAt || factoryState.expiresAt || "",
		runCounters: { ...runState.guard.counters },
		factoryCounters: { ...factoryState.counters },
		ownerId: runState.guard.owner.ownerId,
		leaseName: runState.guard.owner.leaseName,
		leaseGeneration: runState.guard.owner.leaseGeneration,
	};
}

function computeBackoffMs(policy: GuardPolicy, overflowCount: number): number {
	if (overflowCount <= 0) return 0;
	const exp = Math.max(0, overflowCount - 1);
	return Math.min(policy.backoffCapMs, policy.backoffBaseMs * 2 ** exp);
}

function transitionCircuit(
	state: RunState["guard"] | FactoryGuardState,
	policy: GuardPolicy,
	now: Date,
	reasonCode: GuardDecision["reasonCode"],
): { transition: "open" | "terminal"; backoffMs: number; nextAttemptAt: string } {
	state.overflowCount += 1;
	const backoffMs = computeBackoffMs(policy, state.overflowCount);
	state.reasonCode = reasonCode;
	state.lastDecisionAt = nowIso(now);
	if (state.overflowCount >= policy.terminalOverflowCount) {
		state.circuitState = "terminal";
		state.terminalAt = nowIso(now);
		state.openedAt = "";
		state.expiresAt = "";
		state.lastDecisionType = "terminal";
		return { transition: "terminal", backoffMs: 0, nextAttemptAt: "" };
	}
	state.circuitState = "open";
	state.openedAt = nowIso(now);
	state.expiresAt = new Date(now.getTime() + backoffMs).toISOString();
	state.lastDecisionType = "open";
	return { transition: "open", backoffMs, nextAttemptAt: state.expiresAt };
}

function withFactoryLease<T>(
	policy: GuardPolicy,
	ownerId: string,
	now: Date,
	work: (leaseName: string) => T,
): { ok: true; value: T; leaseName: string; leaseGeneration: number } | { ok: false } {
	const leaseName = `factory-guard-${factoryKey(policy.factoryScope, policy.workerPeriod)}`;
	const release = acquireLock(leaseName, policy.lockTimeoutMs, { ownerId });
	if (!release) return { ok: false };
	try {
		const value = work(leaseName);
		const lease = readLease(leaseName);
		return {
			ok: true,
			value,
			leaseName,
			leaseGeneration: lease?.generation ?? 0,
		};
	} finally {
		release();
	}
}

export function incrementGuardCounter(options: GuardMutationOptions): GuardDecision {
	const now = options.now ?? new Date();
	const nodeId = options.nodeId ?? "";
	const runState = options.runState;
	const counter = normalizeCounterKey(options.counter);
	const guardContext = buildGuardMetadataContext({ context: options.context ?? runState.context, nodeId });
	if (!counter) {
		return {
			allowed: true,
			counter: "",
			reasonCode: "",
			circuitState: "closed",
			transition: "none",
			policyRevision: DEFAULT_POLICY_REVISION,
			threshold: 0,
			scope: "none",
			backoffMs: 0,
			nextAttemptAt: "",
			runCounters: createCounters(),
			factoryCounters: createCounters(),
			ownerId: `run:${runState.runId}`,
			leaseName: "",
			leaseGeneration: 0,
		};
	}

	runState.guard = normalizeRunGuardState(runState.runId, runState.guard);
	if (!runState.guard.owner.ownerId) runState.guard.owner.ownerId = `run:${runState.runId}`;
	const policy = resolvePolicy(runState, options.context);
	const gate = evaluateGuardGate({ runState, nodeId, eventBus: options.eventBus, context: options.context, now });
	if (!gate.allowed) return gate;

	const ownerId = runState.guard.owner.ownerId;
	const leased = withFactoryLease(policy, ownerId, now, (leaseName) => {
		const factoryState = loadFactoryGuardState(policy, ownerId, now);
		finalizeOpenToClosed(factoryState, now);
		if (factoryState.circuitState === "terminal") {
			const decision = buildBlockedDecision(runState, factoryState, policy, counter, "guard_terminal_state", "terminal", "factory");
			decision.ownerId = ownerId;
			decision.leaseName = leaseName;
			recordGuardMetadata({ runState, decision, context: guardContext, now });
			saveRunState(runState, { updateMetadata: true });
			return { factoryState, decision };
		}
		if (isOpenAndActive(factoryState, now)) {
			const decision = buildBlockedDecision(runState, factoryState, policy, counter, "guard_backoff_active", "open", "factory");
			decision.ownerId = ownerId;
			decision.leaseName = leaseName;
			recordGuardMetadata({ runState, decision, context: guardContext, now });
			saveRunState(runState, { updateMetadata: true });
			return { factoryState, decision };
		}

		runState.guard.counters[counter] += 1;
		factoryState.counters[counter] += 1;

		let decision: GuardDecision;
		const runCount = runState.guard.counters[counter];
		const factoryCount = factoryState.counters[counter];
		const runLimit = policy.runLimits[counter];
		const factoryLimit = policy.factoryLimits[counter];

		if (runCount > runLimit) {
			const reasonCode = options.reasonCodeOverride || mapReason("run", counter);
			runState.guard.reasonCode = reasonCode;
			const transition = transitionCircuit(runState.guard, policy, now, reasonCode);
			decision = {
				allowed: false,
				counter,
				reasonCode,
				circuitState: runState.guard.circuitState,
				transition: transition.transition,
				policyRevision: policy.revision,
				threshold: runLimit,
				scope: "run",
				backoffMs: transition.backoffMs,
				nextAttemptAt: transition.nextAttemptAt,
				runCounters: { ...runState.guard.counters },
				factoryCounters: { ...factoryState.counters },
				ownerId,
				leaseName,
				leaseGeneration: 0,
			};
			recordGuardMetadata({ runState, decision, context: guardContext, now });
		} else if (factoryCount > factoryLimit) {
			const reasonCode = mapReason("factory", counter);
			runState.guard.reasonCode = reasonCode;
			const transition = transitionCircuit(factoryState, policy, now, reasonCode);
			runState.guard.circuitState = factoryState.circuitState;
			runState.guard.reasonCode = factoryState.reasonCode;
			runState.guard.openedAt = factoryState.openedAt;
			runState.guard.expiresAt = factoryState.expiresAt;
			runState.guard.terminalAt = factoryState.terminalAt;
			runState.guard.lastDecisionAt = factoryState.lastDecisionAt;
			runState.guard.lastDecisionType = factoryState.lastDecisionType;
			runState.guard.overflowCount = Math.max(runState.guard.overflowCount, factoryState.overflowCount);
			decision = {
				allowed: false,
				counter,
				reasonCode,
				circuitState: factoryState.circuitState,
				transition: transition.transition,
				policyRevision: policy.revision,
				threshold: factoryLimit,
				scope: "factory",
				backoffMs: transition.backoffMs,
				nextAttemptAt: transition.nextAttemptAt,
				runCounters: { ...runState.guard.counters },
				factoryCounters: { ...factoryState.counters },
				ownerId,
				leaseName,
				leaseGeneration: 0,
			};
			recordGuardMetadata({ runState, decision, context: guardContext, now });
		} else {
			decision = {
				allowed: true,
				counter,
				reasonCode: "",
				circuitState: runState.guard.circuitState,
				transition: "none",
				policyRevision: policy.revision,
				threshold: Math.min(runLimit, factoryLimit),
				scope: "none",
				backoffMs: 0,
				nextAttemptAt: "",
				runCounters: { ...runState.guard.counters },
				factoryCounters: { ...factoryState.counters },
				ownerId,
				leaseName,
				leaseGeneration: 0,
			};
		}

		runState.guard.policyRevision = policy.revision;
		runState.guard.factoryScope = policy.factoryScope;
		runState.guard.workerPeriod = policy.workerPeriod;
		runState.guard.factoryCounters = { ...factoryState.counters };
		runState.guard.owner.ownerId = ownerId;
		runState.guard.owner.leaseName = leaseName;
		factoryState.policyRevision = policy.revision;
		factoryState.owner.ownerId = ownerId;
		factoryState.owner.leaseName = leaseName;
		factoryState.updatedAt = nowIso(now);

		saveFactoryGuardState(policy, factoryState);
		saveRunState(runState, { updateMetadata: true });
		return { factoryState, decision };
	});

	if (!leased.ok) {
		const reasonCode: GuardDecision["reasonCode"] = "guard_lease_unavailable";
		runState.guard.reasonCode = reasonCode;
		const transition = transitionCircuit(runState.guard, policy, now, reasonCode);
		runState.guard.policyRevision = policy.revision;
		runState.guard.factoryScope = policy.factoryScope;
		runState.guard.workerPeriod = policy.workerPeriod;
		const decision: GuardDecision = {
			allowed: false,
			counter,
			reasonCode,
			circuitState: runState.guard.circuitState,
			transition: transition.transition,
			policyRevision: policy.revision,
			threshold: 0,
			scope: "run",
			backoffMs: transition.backoffMs,
			nextAttemptAt: transition.nextAttemptAt,
			runCounters: { ...runState.guard.counters },
			factoryCounters: { ...runState.guard.factoryCounters },
			ownerId,
			leaseName: `factory-guard-${factoryKey(policy.factoryScope, policy.workerPeriod)}`,
			leaseGeneration: 0,
		};
		recordGuardMetadata({ runState, decision, context: guardContext, now });
		saveRunState(runState, { updateMetadata: true });
		emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
		return decision;
	}

	const decision = leased.value.decision;
	runState.guard.owner.leaseGeneration = leased.leaseGeneration;
	decision.leaseGeneration = leased.leaseGeneration;
	recordGuardMetadata({ runState, decision, context: guardContext, now });
	saveRunState(runState, { updateMetadata: true });
	emitDecision(runState, policy, decision, nodeId, now, options.eventBus, options.context);
	return decision;
}

export function statusForGuardDecision(decision: GuardDecision): RunStatus {
	return decision.circuitState === "terminal" ? "guarded_terminal" : "guarded";
}

export function resetGuardBudgets(options: {
	runState: RunState;
	actorId: string;
	force?: boolean;
	eventBus?: EventBus;
	now?: Date;
	context?: Record<string, string>;
}): {
	ok: boolean;
	reason: string;
	artifactPath: string;
	runState: RunState["guard"];
	factoryState: {
		factoryScope: string;
		workerPeriod: string;
		counters: RunState["guard"]["factoryCounters"];
		circuitState: RunState["guard"]["circuitState"];
		reasonCode: string;
		resetCount: number;
	};
} {
	const now = options.now ?? new Date();
	const runState = options.runState;
	runState.guard = normalizeRunGuardState(runState.runId, runState.guard);
	const policy = resolvePolicy(runState, options.context);
	const ownerId = runState.guard.owner.ownerId || `run:${runState.runId}`;
	const actorId = options.actorId || ownerId;
	const snapshot = {
		...runState.guard,
		counters: { ...runState.guard.counters },
		factoryCounters: { ...runState.guard.factoryCounters },
		owner: { ...runState.guard.owner },
	};
	if (!options.force && ownerId && ownerId !== actorId) {
		return {
			ok: false,
			reason: "owner_mismatch",
			artifactPath: "",
			runState: snapshot,
			factoryState: {
				factoryScope: policy.factoryScope,
				workerPeriod: policy.workerPeriod,
				counters: snapshot.factoryCounters,
				circuitState: snapshot.circuitState,
				reasonCode: snapshot.reasonCode,
				resetCount: snapshot.resetCount,
			},
		};
	}

	const leaseResult = withFactoryLease(policy, actorId, now, (leaseName) => {
		const factory = loadFactoryGuardState(policy, actorId, now);
		if (!options.force && factory.owner.ownerId && factory.owner.ownerId !== actorId) {
			return { factory, denied: true, leaseName };
		}
		const updatedFactory: FactoryGuardState = {
			...factory,
			counters: createCounters(),
			circuitState: "closed",
			reasonCode: "guard_reset",
			openedAt: "",
			expiresAt: "",
			terminalAt: "",
			overflowCount: 0,
			lastDecisionAt: nowIso(now),
			lastDecisionType: "reset",
			resetCount: factory.resetCount + 1,
			updatedAt: nowIso(now),
			policyRevision: policy.revision,
			owner: {
				...factory.owner,
				ownerId: actorId,
				leaseName,
			},
		};
		saveFactoryGuardState(policy, updatedFactory);
		return { factory: updatedFactory, denied: false, leaseName };
	});

	if (!leaseResult.ok) {
		return {
			ok: false,
			reason: "factory_lease_unavailable",
			artifactPath: "",
			runState: snapshot,
			factoryState: {
				factoryScope: policy.factoryScope,
				workerPeriod: policy.workerPeriod,
				counters: snapshot.factoryCounters,
				circuitState: snapshot.circuitState,
				reasonCode: snapshot.reasonCode,
				resetCount: snapshot.resetCount,
			},
		};
	}

	const denial = leaseResult.value;
	if (denial.denied) {
		return {
			ok: false,
			reason: "factory_owner_mismatch",
			artifactPath: "",
			runState: snapshot,
			factoryState: {
				factoryScope: denial.factory.factoryScope,
				workerPeriod: denial.factory.workerPeriod,
				counters: denial.factory.counters,
				circuitState: denial.factory.circuitState,
				reasonCode: denial.factory.reasonCode,
				resetCount: denial.factory.resetCount,
			},
		};
	}

	runState.guard = {
		...snapshot,
		policyRevision: policy.revision,
		factoryScope: policy.factoryScope,
		workerPeriod: policy.workerPeriod,
		counters: createCounters(),
		factoryCounters: { ...leaseResult.value.factory.counters },
		circuitState: "closed",
		reasonCode: "guard_reset",
		metadata: null,
		overflowCount: 0,
		openedAt: "",
		expiresAt: "",
		terminalAt: "",
		lastDecisionAt: nowIso(now),
		lastDecisionType: "reset",
		resetCount: snapshot.resetCount + 1,
		owner: {
			ownerId: actorId,
			leaseName: leaseResult.value.leaseName,
			leaseGeneration: leaseResult.leaseGeneration,
		},
	};
	saveRunState(runState, { updateMetadata: true });

	const decision: GuardDecision = {
		allowed: true,
		counter: "",
		reasonCode: "guard_reset",
		circuitState: "closed",
		transition: "reset",
		policyRevision: policy.revision,
		threshold: 0,
		scope: "none",
		backoffMs: 0,
		nextAttemptAt: "",
		runCounters: runState.guard.counters,
		factoryCounters: leaseResult.value.factory.counters,
		ownerId: actorId,
		leaseName: leaseResult.value.leaseName,
		leaseGeneration: leaseResult.leaseGeneration,
	};
	runState.guard.metadata = null;

	const artifactPath = emitDecision(runState, policy, decision, "guard.reset", now, options.eventBus, options.context);
	if (options.eventBus) {
		options.eventBus.emit({
			kind: "guard.reset",
			nodeId: "guard.reset",
			message: "guard_reset",
			data: toGuardEventData(decision, {
				artifact_path: artifactPath,
				...trustEnvelopeFromContext(options.context),
			}),
		});
	}

	return {
		ok: true,
		reason: "reset_applied",
		artifactPath,
		runState: runState.guard,
		factoryState: {
			factoryScope: leaseResult.value.factory.factoryScope,
			workerPeriod: leaseResult.value.factory.workerPeriod,
			counters: leaseResult.value.factory.counters,
			circuitState: leaseResult.value.factory.circuitState,
			reasonCode: leaseResult.value.factory.reasonCode,
			resetCount: leaseResult.value.factory.resetCount,
		},
	};
}
