import {
	acquireFactoryDistributedLease,
	buildDeterministicLeaseHolderId,
	normalizeLeaseSeconds,
	releaseFactoryDistributedLease,
	resolveFactoryTrackingIssueNumber,
} from "../../../packages/factory-ops/src/commands/factory-distributed-lease.ts";
import { blockReadyWaveIssue } from "../../../packages/factory-ops/src/commands/wave-block-ready.ts";
import { checkControlPlaneBlocker } from "../../../packages/factory-ops/src/commands/wave-blocker-check.ts";
import {
	completeReadyWaveIssue,
	lockReadyWaveIssue,
	releaseReadyWaveClaimOps,
} from "../../../packages/factory-ops/src/commands/wave-claim.ts";
import { createReadyMarkersFromArgs } from "../../../packages/factory-ops/src/commands/wave-create-ready.ts";
import { selectDispatchWavesFromArgs } from "../../../packages/factory-ops/src/commands/wave-dispatch-select.ts";
import { waveEnsureLabels } from "../../../packages/factory-ops/src/commands/wave-ensure-labels.ts";
import { pickReadyWaveFromRepo } from "../../../packages/factory-ops/src/commands/wave-find-ready.ts";
import { waveListMilestonesB64 } from "../../../packages/factory-ops/src/commands/wave-list-milestones-b64.ts";
import { waveListPrioritiesB64 } from "../../../packages/factory-ops/src/commands/wave-list-priorities-b64.ts";
import { waveListReadyIssuesB64 } from "../../../packages/factory-ops/src/commands/wave-list-ready-issues-b64.ts";
import { openJudgeFollowupArtifact } from "../../../packages/factory-ops/src/commands/wave-open-judge-followup.ts";
import { requeueAfterJudgeFailure, sanitizeWaveState } from "../../../packages/factory-ops/src/commands/wave-sanitize-state.ts";

function trim(value = "") {
	return String(value || "").trim();
}

export function resolveDispatchTrackingIssue({
	repo = "",
	trackingIssue = "",
	factoryRoot = "",
} = {}) {
	const out = resolveFactoryTrackingIssueNumber({
		repo,
		trackingIssueNumber: trackingIssue,
		factoryRoot,
	});
	return trim(out.tracking_issue_number || "");
}

export function acquireDispatchLease({
	repo = "",
	factoryId = "mothership/factory_supervisor",
	leaseName = "",
	runId = "",
	trackingIssue = "",
	holderId = "",
	leaseSeconds = "",
} = {}) {
	const resolvedTracking = resolveFactoryTrackingIssueNumber({
		repo,
		trackingIssueNumber: trackingIssue,
	});
	const resolvedHolderId = holderId || buildDeterministicLeaseHolderId({
		factoryId,
		leaseName,
	});

	if (!resolvedTracking.ok) {
		return {
			ok: false,
			lease_acquired: "false",
			lease_reason: String(resolvedTracking.reason || "tracking_issue_not_found"),
			lease_error: "",
			lease_tracking_issue_number: "",
			lease_factory_id: factoryId,
			lease_name: leaseName,
			lease_run_id: runId,
			lease_holder_id: resolvedHolderId,
			lease_expires_at: "",
			lease_version: "0",
			lease_comment_id: "",
			lease_comment_etag: "",
		};
	}

	const out = acquireFactoryDistributedLease({
		repo,
		trackingIssueNumber: resolvedTracking.tracking_issue_number,
		factoryId,
		leaseName,
		runId,
		holderId: resolvedHolderId,
		idempotencyKey: `${factoryId}:${leaseName}:${runId}`,
		leaseSeconds: normalizeLeaseSeconds(leaseSeconds, 600),
	});

	return {
		ok: Boolean(out.ok),
		lease_acquired: out.acquired ? "true" : "false",
		lease_reason: String(out.reason || "lease_unknown"),
		lease_error: String(out.error || ""),
		lease_tracking_issue_number: String(out.tracking_issue_number || resolvedTracking.tracking_issue_number || ""),
		lease_factory_id: String(out.factory_id || factoryId),
		lease_name: String(out.lease_name || leaseName),
		lease_run_id: String(out.run_id || runId),
		lease_holder_id: String(out.holder_id || resolvedHolderId),
		lease_expires_at: String(out?.lease?.expires_at || out?.lease?.lease_expires_at || ""),
		lease_version: String(out?.lease?.version || 0),
		lease_comment_id: String(out.comment_id || ""),
		lease_comment_etag: String(out.comment_etag || ""),
	};
}

export function releaseDispatchLease({
	repo = "",
	factoryId = "mothership/factory_supervisor",
	leaseName = "",
	runId = "",
	trackingIssue = "",
	holderId = "",
	reason = "released",
} = {}) {
	const resolvedTracking = resolveFactoryTrackingIssueNumber({
		repo,
		trackingIssueNumber: trackingIssue,
	});
	const resolvedHolderId = holderId || buildDeterministicLeaseHolderId({
		factoryId,
		leaseName,
	});

	if (!resolvedTracking.ok) {
		return {
			ok: false,
			lease_released: "false",
			lease_release_reason: String(resolvedTracking.reason || "tracking_issue_not_found"),
			lease_error: "",
			lease_tracking_issue_number: "",
			lease_factory_id: factoryId,
			lease_name: leaseName,
			lease_run_id: runId,
			lease_holder_id: resolvedHolderId,
			lease_comment_id: "",
			lease_comment_etag: "",
		};
	}

	const out = releaseFactoryDistributedLease({
		repo,
		trackingIssueNumber: resolvedTracking.tracking_issue_number,
		factoryId,
		leaseName,
		runId,
		holderId: resolvedHolderId,
		reason,
	});

	return {
		ok: Boolean(out.ok),
		lease_released: out.released ? "true" : "false",
		lease_release_reason: String(out.reason || "lease_release_unknown"),
		lease_error: String(out.error || ""),
		lease_tracking_issue_number: String(out.tracking_issue_number || resolvedTracking.tracking_issue_number || ""),
		lease_factory_id: String(out.factory_id || factoryId),
		lease_name: String(out.lease_name || leaseName),
		lease_run_id: String(out.run_id || runId),
		lease_holder_id: String(out.holder_id || resolvedHolderId),
		lease_comment_id: String(out.comment_id || ""),
		lease_comment_etag: String(out.comment_etag || ""),
	};
}

export {
	blockReadyWaveIssue,
	checkControlPlaneBlocker,
	completeReadyWaveIssue,
	createReadyMarkersFromArgs,
	lockReadyWaveIssue,
	openJudgeFollowupArtifact,
	pickReadyWaveFromRepo,
	requeueAfterJudgeFailure,
	releaseReadyWaveClaimOps,
	selectDispatchWavesFromArgs,
	sanitizeWaveState,
	waveEnsureLabels,
	waveListMilestonesB64,
	waveListPrioritiesB64,
	waveListReadyIssuesB64,
};
