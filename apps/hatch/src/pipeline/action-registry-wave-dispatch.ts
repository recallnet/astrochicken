import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned wave-dispatch capability action owners
import * as waveDispatchActionOwners from "../../../../packages/capability-wave-dispatch/src/in-process-action-owners.mjs";

const {
	acquireDispatchLease,
	createReadyMarkersFromArgs,
	releaseDispatchLease,
	resolveDispatchTrackingIssue,
	sanitizeWaveState,
	selectDispatchWavesFromArgs,
	waveEnsureLabels,
	waveListMilestonesB64,
	waveListPrioritiesB64,
	waveListReadyIssuesB64,
} = waveDispatchActionOwners as {
	acquireDispatchLease: (options?: Record<string, unknown>) => unknown;
	createReadyMarkersFromArgs: (options?: Record<string, unknown>) => unknown;
	releaseDispatchLease: (options?: Record<string, unknown>) => unknown;
	resolveDispatchTrackingIssue: (options?: Record<string, unknown>) => string;
	sanitizeWaveState: (options?: Record<string, unknown>) => unknown;
	selectDispatchWavesFromArgs: (options?: Record<string, unknown>) => unknown;
	waveEnsureLabels: (options?: Record<string, unknown>) => unknown;
	waveListMilestonesB64: (options?: Record<string, unknown>) => string;
	waveListPrioritiesB64: (options?: Record<string, unknown>) => string;
	waveListReadyIssuesB64: (options?: Record<string, unknown>) => string;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function jsonOutcome(value: unknown, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(value),
		contextUpdates,
	};
}

function textOutcome(value: string, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: value,
		contextUpdates,
	};
}

class ResolveDispatchTrackingIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(resolveDispatchTrackingIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			trackingIssue: expandAttr(request.node, request.ctx, "action_tracking_issue"),
			factoryRoot: expandAttr(request.node, request.ctx, "action_factory_root") || request.workDir,
		}));
	}
}

class AcquireDispatchLeaseAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(acquireDispatchLease({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			trackingIssue: expandAttr(request.node, request.ctx, "action_tracking_issue"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			leaseName: expandAttr(request.node, request.ctx, "action_lease_name"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			holderId: expandAttr(request.node, request.ctx, "action_holder_id"),
			leaseSeconds: expandAttr(request.node, request.ctx, "action_lease_seconds"),
		}));
	}
}

class ReleaseDispatchLeaseAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(releaseDispatchLease({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			trackingIssue: expandAttr(request.node, request.ctx, "action_tracking_issue"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			leaseName: expandAttr(request.node, request.ctx, "action_lease_name"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			holderId: expandAttr(request.node, request.ctx, "action_holder_id"),
			reason: expandAttr(request.node, request.ctx, "action_reason"),
		}));
	}
}

class EnsureWaveLabelsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(waveEnsureLabels({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			keys: expandAttr(request.node, request.ctx, "action_keys").split(",").map((item) => item.trim()).filter(Boolean),
		}));
	}
}

class SanitizeWaveStateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(sanitizeWaveState({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			apply: expandAttr(request.node, request.ctx, "action_apply") === "true",
			staleRunMinutes: Number(expandAttr(request.node, request.ctx, "action_stale_run_minutes") || 20),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class WaveListMilestonesB64Action implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(waveListMilestonesB64({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
		}));
	}
}

class WaveListReadyIssuesB64Action implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(waveListReadyIssuesB64({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
		}));
	}
}

class WaveListPrioritiesB64Action implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(waveListPrioritiesB64({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
		}));
	}
}

class DispatchSelectAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(selectDispatchWavesFromArgs({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			maxConcurrent: Number(expandAttr(request.node, request.ctx, "action_max_concurrent") || 1),
			milestonesRaw: Buffer.from(expandAttr(request.node, request.ctx, "action_milestones_b64"), "base64").toString("utf8"),
			readyIssuesRaw: Buffer.from(expandAttr(request.node, request.ctx, "action_ready_issues_b64"), "base64").toString("utf8"),
			prioritiesIssueRaw: Buffer.from(expandAttr(request.node, request.ctx, "action_priorities_issue_b64"), "base64").toString("utf8"),
		}));
	}
}

class CreateReadyMarkersAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(createReadyMarkersFromArgs({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			selectedWavesRaw: expandAttr(request.node, request.ctx, "action_selected_waves"),
		}));
	}
}

export function registerWaveDispatchActions(registry: ActionRegistry): void {
	registry.register("factory.resolve_tracking_issue", new ResolveDispatchTrackingIssueAction());
	registry.register("factory.acquire_lease", new AcquireDispatchLeaseAction());
	registry.register("factory.release_lease", new ReleaseDispatchLeaseAction());
	registry.register("labels.ensure_factory", new EnsureWaveLabelsAction());
	registry.register("wave.sanitize_state", new SanitizeWaveStateAction());
	registry.register("wave.list_milestones_b64", new WaveListMilestonesB64Action());
	registry.register("wave.list_ready_issues_b64", new WaveListReadyIssuesB64Action());
	registry.register("wave.list_priorities_b64", new WaveListPrioritiesB64Action());
	registry.register("wave.dispatch_select", new DispatchSelectAction());
	registry.register("wave.create_ready_markers", new CreateReadyMarkersAction());
}
