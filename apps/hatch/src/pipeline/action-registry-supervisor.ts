import { readFileSync } from "node:fs";

import { StageStatus, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";

// @ts-ignore JS-owned package surface without local typings
import * as supervisorActionOwners from "../../../../packages/factory-runtime/src/in-process-action-owners.mjs";

const {
	reconcileRuntimeRecoverySweep,
	computeReviewMetrics,
	resolveReviewVerdictsLogPath,
	produceReleaseManifest,
	postDispositionFeedback,
	syncControlPlaneManifest,
	computeFactoryContractHash,
	buildStateSnapshot,
	evaluateOpenBugGate,
	checkSupervisorHealth,
	evaluateUpstreamBugGate,
	evaluateManagedControlStateGate,
	evaluateManagedActionItemGate,
	classifyManagedLifecycleState,
	selectManagedIntakeIssue,
	classifyManagedFailure,
	persistManagedLifecycleState,
	emitManagedRunSummary,
	runExternalFactoryLifecycleGate,
	applyRejectedUpstream,
	tickIdleCheck,
	detectExternalChanges,
	countOpenDurablePackets,
	loadManagedSupervisorContext,
	evaluateGoalDecomposeBackpressure,
	limitKeptGoalsForTick,
	sweepCompletedGoals,
	closeStaleMergeFollowups,
	ensureGoalExecutionPaths,
	sweepEmptyMilestones,
	releaseWaveQuarantine,
} = supervisorActionOwners;

function expandAttr(node: Node, ctx: ActionExecutionRequest["ctx"], key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function decodeBase64Attr(node: Node, ctx: ActionExecutionRequest["ctx"], key: string): string {
	const raw = expandAttr(node, ctx, key);
	return raw ? Buffer.from(raw, "base64").toString("utf8") : "";
}

function jsonOutcome(value: unknown): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(value),
	};
}

function textOutcome(value: string): Outcome {
	return {
		status: StageStatus.Completed,
		output: value,
	};
}

class FactoryRecoverySweepAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(reconcileRuntimeRecoverySweep({
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			repoPath: expandAttr(request.node, request.ctx, "action_repo_path") || request.workDir,
			staleMinutes: expandAttr(request.node, request.ctx, "action_stale_minutes"),
			apply: expandAttr(request.node, request.ctx, "action_apply") === "true",
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			worktree: expandAttr(request.node, request.ctx, "action_worktree"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			skipWorktreeScan: expandAttr(request.node, request.ctx, "action_skip_worktree_scan") === "true",
		}));
	}
}

class GoalSweepCompletedAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await sweepCompletedGoals({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir") || request.ctx.get("runs_dir"),
		}));
	}
}

class CloseStaleMergeFollowupsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(closeStaleMergeFollowups({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			staleHours: Number(expandAttr(request.node, request.ctx, "action_stale_hours") || "24"),
		}));
	}
}

class WaveReleaseQuarantineAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(releaseWaveQuarantine({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			nowEpoch: Number(expandAttr(request.node, request.ctx, "action_now_epoch") || 0),
		}));
	}
}

class GoalDecomposeBackpressureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(evaluateGoalDecomposeBackpressure({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			maxConcurrentGoals: expandAttr(request.node, request.ctx, "action_max_concurrent_goals"),
			maxConcurrentWaves: expandAttr(request.node, request.ctx, "action_max_concurrent_waves"),
		}));
	}
}

class GoalLimitKeptAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(JSON.stringify(limitKeptGoalsForTick({
			keptGoalsRaw: expandAttr(request.node, request.ctx, "action_kept_goals"),
			maxGoalsPerTick: expandAttr(request.node, request.ctx, "action_max_goals_per_tick"),
		})));
	}
}

class GoalEnsureExecutionPathsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(ensureGoalExecutionPaths({
			repo: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			goalIssueNumbersRaw: expandAttr(request.node, request.ctx, "action_goal_issues"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
		}));
	}
}

class MilestoneSweepEmptyAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(sweepEmptyMilestones({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
		}));
	}
}

class ArtifactReleaseManifestAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(produceReleaseManifest({
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			sourceRepos: expandAttr(request.node, request.ctx, "action_source_repos")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
			states: expandAttr(request.node, request.ctx, "action_states") || "closed",
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			releaseSha: expandAttr(request.node, request.ctx, "action_release_sha"),
			releaseTag: expandAttr(request.node, request.ctx, "action_release_tag"),
			changelogSummary: expandAttr(request.node, request.ctx, "action_changelog_summary"),
			localFactoryRelease: expandAttr(request.node, request.ctx, "action_local_factory_release"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			releasesDir: expandAttr(request.node, request.ctx, "action_releases_dir"),
			outPath: expandAttr(request.node, request.ctx, "action_out_path"),
		}));
	}
}

class FactoryPublishControlPlaneManifestAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(syncControlPlaneManifest({
			manifestPath: expandAttr(request.node, request.ctx, "action_manifest_path"),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
		}));
	}
}

class ArtifactEmitDispositionFeedbackAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const manifestPath = expandAttr(request.node, request.ctx, "action_manifest_path");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
		const results = entries.map((entry: any) => postDispositionFeedback({
			source_repo: entry?.source_repo || "",
			source_issue: entry?.source_issue || 0,
			disposition: entry?.release_status || "",
			blockerRef: entry?.blocker_ref || "",
			releaseIdentity: {
				release_id: manifest?.release_id,
				release_tag: manifest?.release_tag,
				release_sha: manifest?.release_sha,
			},
			manifestPath,
		}));
		return jsonOutcome({
			processed: results.length,
			skipped: results.filter((entry: any) => entry?.skipped).length,
			failed: results.filter((entry: any) => entry?.ok === false).length,
			entries: results,
		});
	}
}

class FactoryStampContractHashAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(computeFactoryContractHash({
			factoryRoot: expandAttr(request.node, request.ctx, "action_factory_root"),
		}) || "");
	}
}

class FactoryReviewMetricsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const factoryId = expandAttr(request.node, request.ctx, "action_factory_id");
		const runsDir = expandAttr(request.node, request.ctx, "action_runs_dir");
		const verdictsLogPath = resolveReviewVerdictsLogPath({ factoryId, runsDir });
		return jsonOutcome(computeReviewMetrics({
			verdictsLogPath,
			lookbackHours: Number(expandAttr(request.node, request.ctx, "action_lookback_hours") || 24),
		}));
	}
}

class SupervisorStateSnapshotAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const isFastSnapshotRoute = request.node.id === "snapshot_state_fast";
		const output = buildStateSnapshot({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			// @context:regression !critical The fast bug gate snapshot must stay read-only and bounded.
			// Recovery sweep belongs to the later maintenance phase; running it here can stall the
			// whole supervisor tick before goal selection even begins.
			skipRecoverySweep: isFastSnapshotRoute,
		});
		return textOutcome(output);
	}
}

class SupervisorOpenBugGateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(evaluateOpenBugGate({
			snapshot: expandAttr(request.node, request.ctx, "action_snapshot"),
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class SupervisorActionItemGateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const snapshotRaw = buildStateSnapshot({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
		});
		let snapshot = {};
		try {
			snapshot = JSON.parse(String(snapshotRaw || "{}"));
		} catch {
			snapshot = {};
		}
		const actionItems = Array.isArray((snapshot as { action_items?: unknown[] }).action_items)
			? (snapshot as { action_items: unknown[] }).action_items
			: [];
		// @context:security Gate evaluation is read-only. Action execution belongs
		// to the explicit governed executor after supervisor review.
		return jsonOutcome({
			has_action_items: actionItems.length > 0 ? "true" : "false",
			action_item_count: actionItems.length,
		});
	}
}

class SupervisorTickIdleCheckAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const factoryId = expandAttr(request.node, request.ctx, "action_factory_id");
		const ghRepo = expandAttr(request.node, request.ctx, "action_gh_repo");
		const runsDir = expandAttr(request.node, request.ctx, "action_runs_dir");
		const externalCheck = detectExternalChanges({ factoryId, ghRepo });
		const openDurablePackets = countOpenDurablePackets({ runsDir });
		return jsonOutcome(tickIdleCheck({
			inFlightCount: expandAttr(request.node, request.ctx, "action_in_flight_count"),
			selectedCount: expandAttr(request.node, request.ctx, "action_selected_count"),
			stalledWaveCount: expandAttr(request.node, request.ctx, "action_stalled_wave_count"),
			spawnSuccessCount: expandAttr(request.node, request.ctx, "action_spawn_success_count"),
			openDurablePacketCount: openDurablePackets,
			externalChangesDetected: externalCheck.changes_detected,
		}));
	}
}

class SupervisorHealthCheckAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(checkSupervisorHealth({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class SupervisorExternalFactoryLifecycleAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await runExternalFactoryLifecycleGate({
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			sourceRepo: expandAttr(request.node, request.ctx, "action_source_repo"),
			sourceIssueNumber: expandAttr(request.node, request.ctx, "action_source_issue_number"),
			blockedItems: expandAttr(request.node, request.ctx, "action_blocked_items"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: request.workDir,
		}));
	}
}

class TriageApplyRejectedUpstreamAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(applyRejectedUpstream({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issue: expandAttr(request.node, request.ctx, "action_issue"),
			blockerRef: expandAttr(request.node, request.ctx, "action_blocker_ref"),
		}));
	}
}

class SupervisorManagedLoadContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(loadManagedSupervisorContext({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			factoryRoot: expandAttr(request.node, request.ctx, "action_factory_root"),
			kindPath: expandAttr(request.node, request.ctx, "action_kind_path"),
			instancePath: expandAttr(request.node, request.ctx, "action_instance_path"),
			kindId: expandAttr(request.node, request.ctx, "action_kind_id"),
			instanceId: expandAttr(request.node, request.ctx, "action_instance_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			destinationsJson: expandAttr(request.node, request.ctx, "action_destinations_json"),
			trustDomain: expandAttr(request.node, request.ctx, "action_trust_domain"),
			trustRole: expandAttr(request.node, request.ctx, "action_trust_role"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
		}));
	}
}

class SupervisorManagedControlStateGateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(evaluateManagedControlStateGate({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
		}));
	}
}

class SupervisorUpstreamBugGateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const labelFilters = decodeBase64Attr(request.node, request.ctx, "action_label_filters_b64")
			|| expandAttr(request.node, request.ctx, "action_label_filters");
		return jsonOutcome(evaluateUpstreamBugGate({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			labelFilters: labelFilters ? JSON.parse(labelFilters) : undefined,
		}));
	}
}

class SupervisorManagedActionItemGateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(evaluateManagedActionItemGate({
			snapshot: expandAttr(request.node, request.ctx, "action_snapshot"),
		}));
	}
}

class SupervisorManagedHealthClassifierAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(classifyManagedLifecycleState({
			controlGate: expandAttr(request.node, request.ctx, "action_control_gate"),
			hasOpenUpstreamBugs: expandAttr(request.node, request.ctx, "action_has_open_upstream_bugs"),
			hasActionItems: expandAttr(request.node, request.ctx, "action_has_action_items"),
			hasSelectedWork: expandAttr(request.node, request.ctx, "action_has_selected_work"),
			hasDomainFailure: expandAttr(request.node, request.ctx, "action_has_domain_failure"),
		}));
	}
}

class SupervisorManagedIntakeSelectorAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(selectManagedIntakeIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			intakeJson: expandAttr(request.node, request.ctx, "action_intake_json"),
		}));
	}
}

class SupervisorManagedFailureClassifierAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(classifyManagedFailure({
			domainError: expandAttr(request.node, request.ctx, "action_domain_error"),
			parseError: expandAttr(request.node, request.ctx, "action_parse_error"),
			gate: expandAttr(request.node, request.ctx, "action_gate"),
		}));
	}
}

class SupervisorManagedPersistStateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(persistManagedLifecycleState({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			instanceId: expandAttr(request.node, request.ctx, "action_instance_id"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
			lifecycleState: expandAttr(request.node, request.ctx, "action_lifecycle_state"),
			lifecycleReason: expandAttr(request.node, request.ctx, "action_lifecycle_reason"),
			failureClassification: expandAttr(request.node, request.ctx, "action_failure_classification"),
			failureReason: expandAttr(request.node, request.ctx, "action_failure_reason"),
			hasOpenUpstreamBugs: expandAttr(request.node, request.ctx, "action_has_open_upstream_bugs"),
			openUpstreamBugCount: expandAttr(request.node, request.ctx, "action_open_upstream_bug_count"),
			openUpstreamBugNumbers: expandAttr(request.node, request.ctx, "action_open_upstream_bug_numbers"),
			hasActionItems: expandAttr(request.node, request.ctx, "action_has_action_items"),
			actionItemCount: expandAttr(request.node, request.ctx, "action_action_item_count"),
			unresolvedActions: expandAttr(request.node, request.ctx, "action_unresolved_actions"),
			queueDepth: expandAttr(request.node, request.ctx, "action_queue_depth"),
			oldestWorkAgeSeconds: expandAttr(request.node, request.ctx, "action_oldest_work_age_seconds"),
			latestIncidents: expandAttr(request.node, request.ctx, "action_latest_incidents"),
			actor: expandAttr(request.node, request.ctx, "action_actor"),
		}));
	}
}

class SupervisorManagedEmitRunSummaryAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(emitManagedRunSummary({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			instanceId: expandAttr(request.node, request.ctx, "action_instance_id"),
			kindId: expandAttr(request.node, request.ctx, "action_kind_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			trustDomain: expandAttr(request.node, request.ctx, "action_trust_domain"),
			trustRole: expandAttr(request.node, request.ctx, "action_trust_role"),
			lifecycleState: expandAttr(request.node, request.ctx, "action_lifecycle_state"),
			healthState: expandAttr(request.node, request.ctx, "action_health_state"),
			failureClassification: expandAttr(request.node, request.ctx, "action_failure_classification"),
			failureReason: expandAttr(request.node, request.ctx, "action_failure_reason"),
			controlGate: expandAttr(request.node, request.ctx, "action_control_gate"),
			controlStateAction: expandAttr(request.node, request.ctx, "action_control_state_action"),
			controlStateReason: expandAttr(request.node, request.ctx, "action_control_state_reason"),
			hasOpenUpstreamBugs: expandAttr(request.node, request.ctx, "action_has_open_upstream_bugs"),
			openUpstreamBugCount: expandAttr(request.node, request.ctx, "action_open_upstream_bug_count"),
			openUpstreamBugNumbers: expandAttr(request.node, request.ctx, "action_open_upstream_bug_numbers"),
			hasActionItems: expandAttr(request.node, request.ctx, "action_has_action_items"),
			actionItemCount: expandAttr(request.node, request.ctx, "action_action_item_count"),
			unresolvedActions: expandAttr(request.node, request.ctx, "action_unresolved_actions"),
			queueDepth: expandAttr(request.node, request.ctx, "action_queue_depth"),
			oldestWorkAgeSeconds: expandAttr(request.node, request.ctx, "action_oldest_work_age_seconds"),
			latestIncidents: expandAttr(request.node, request.ctx, "action_latest_incidents"),
			hasIssue: expandAttr(request.node, request.ctx, "action_has_issue"),
			selectedIssueNumber: expandAttr(request.node, request.ctx, "action_selected_issue_number"),
			domainResult: expandAttr(request.node, request.ctx, "action_domain_result"),
			manifestOk: expandAttr(request.node, request.ctx, "action_manifest_ok"),
			manifestError: expandAttr(request.node, request.ctx, "action_manifest_error"),
			parseError: expandAttr(request.node, request.ctx, "action_parse_error"),
		}));
	}
}

export function registerSupervisorActions(registry: ActionRegistry): void {
	registry.register("factory.recovery_sweep", new FactoryRecoverySweepAction());
	registry.register("goal.sweep_completed", new GoalSweepCompletedAction());
	registry.register("supervisor.close_stale_merge_followups", new CloseStaleMergeFollowupsAction());
	registry.register("wave.release_quarantine", new WaveReleaseQuarantineAction());
	registry.register("goal.decompose_backpressure", new GoalDecomposeBackpressureAction());
	registry.register("goal.limit_kept", new GoalLimitKeptAction());
	registry.register("goal.ensure_execution_paths", new GoalEnsureExecutionPathsAction());
	registry.register("milestone.sweep_empty", new MilestoneSweepEmptyAction());
	registry.register("artifact.release_manifest", new ArtifactReleaseManifestAction());
	registry.register("factory.publish_control_plane_manifest", new FactoryPublishControlPlaneManifestAction());
	registry.register("artifact.emit_disposition_feedback", new ArtifactEmitDispositionFeedbackAction());
	registry.register("factory.stamp_contract_hash", new FactoryStampContractHashAction());
	registry.register("factory.review_metrics", new FactoryReviewMetricsAction());
	registry.register("supervisor.state_snapshot", new SupervisorStateSnapshotAction());
	registry.register("supervisor.open_bug_gate", new SupervisorOpenBugGateAction());
	registry.register("supervisor.action_item_gate", new SupervisorActionItemGateAction());
	registry.register("supervisor.tick_idle_check", new SupervisorTickIdleCheckAction());
	registry.register("supervisor.health_check", new SupervisorHealthCheckAction());
	registry.register("supervisor.external_factory_lifecycle", new SupervisorExternalFactoryLifecycleAction());
	registry.register("triage.apply_rejected_upstream", new TriageApplyRejectedUpstreamAction());
	registry.register("supervisor.managed_load_context", new SupervisorManagedLoadContextAction());
	registry.register("supervisor.managed_control_state_gate", new SupervisorManagedControlStateGateAction());
	registry.register("supervisor.upstream_bug_gate", new SupervisorUpstreamBugGateAction());
	registry.register("supervisor.managed_action_item_gate", new SupervisorManagedActionItemGateAction());
	registry.register("supervisor.managed_health_classifier", new SupervisorManagedHealthClassifierAction());
	registry.register("supervisor.managed_intake_selector", new SupervisorManagedIntakeSelectorAction());
	registry.register("supervisor.managed_failure_classifier", new SupervisorManagedFailureClassifierAction());
	registry.register("supervisor.managed_persist_state", new SupervisorManagedPersistStateAction());
	registry.register("supervisor.managed_emit_run_summary", new SupervisorManagedEmitRunSummaryAction());
}
