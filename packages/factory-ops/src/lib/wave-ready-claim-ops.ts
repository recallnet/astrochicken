import { trim, gh, ghJson } from "./cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "./factory-label-contract.ts";
import {
  acquireWaveMarkerClaim,
  releaseWaveMarkerClaim,
  validateWaveMarkerClaimOwnership,
} from "./wave-marker-claim.ts";
import { buildWaveReadyLeaseEvent } from "./wave-ready-lease-cloudevents.ts";
import {
  renderWaveReadyLeaseComment,
} from "./wave-ready-lease.ts";

const WAVE_IN_PROGRESS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS);

function listMilestoneOpenIssues(repo, milestoneTitle) {
  if (!repo || !milestoneTitle) return [];
  return ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--milestone", milestoneTitle,
    "--limit", "300", "--json", "number,title,labels",
  ], []);
}

function isWaveMarker(issue = {}) {
  return /^Wave Ready:\s+/.test(String(issue?.title || ""));
}

export function lockReadyWaveIssue({
  repo,
  readyIssueNumber,
  milestoneTitle = "",
  claimToken = "",
  claimOwnerId = "",
  claimRunId = "",
  leaseSeconds = 1200,
  nowEpochMs = Date.now(),
  claimAcquire = acquireWaveMarkerClaim,
  claimReleaser = releaseWaveMarkerClaim,
  execGh = gh,
} = {}) {
  const issueNumber = Number(readyIssueNumber || 0);
  if (!repo || !issueNumber) {
    return {
      ok: false,
      lock_granted: "false",
      milestone_title: "",
      ready_issue_number: "",
      claim_token: "",
      claim_owner_id: String(claimOwnerId || ""),
      claim_run_id: String(claimRunId || ""),
      claim_lease_expires_at: "",
      reason: "missing_repo_or_issue",
    };
  }

  const claim = claimAcquire({
    repo,
    issueNumber,
    milestoneTitle,
    ownerId: claimOwnerId,
    runId: claimRunId,
    claimToken,
    leaseSeconds,
    nowEpochMs,
  });

  if (!claim?.ok || !claim?.acquired) {
    return {
      ok: claim?.ok !== false,
      lock_granted: "false",
      milestone_title: String(milestoneTitle || ""),
      ready_issue_number: issueNumber,
      claim_token: String(claim?.claim?.claim_token || claimToken || ""),
      claim_owner_id: String(claimOwnerId || ""),
      claim_run_id: String(claimRunId || ""),
      claim_lease_expires_at: String(claim?.claim?.lease_expires_at || ""),
      reason: String(claim?.reason || "claim_not_acquired"),
      claim_error: String(claim?.error || ""),
    };
  }

  const edit = execGh(["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", WAVE_IN_PROGRESS_LABEL]);
  if (!edit?.ok) {
    const releaseResult = claimReleaser({
      repo,
      issueNumber,
      claimToken: String(claim?.claim?.claim_token || claimToken || ""),
      ownerId: claimOwnerId,
      runId: claimRunId,
      reason: "failed_to_set_wave_in_progress",
    });
    return {
      ok: false,
      lock_granted: "false",
      milestone_title: "",
      ready_issue_number: "",
      claim_token: String(claim?.claim?.claim_token || claimToken || ""),
      claim_owner_id: String(claimOwnerId || ""),
      claim_run_id: String(claimRunId || ""),
      claim_lease_expires_at: String(claim?.claim?.lease_expires_at || ""),
      reason: "failed_to_set_wave_in_progress",
      claim_error: String(edit?.stderr || ""),
      claim_release: {
        ok: Boolean(releaseResult?.ok),
        released: Boolean(releaseResult?.released),
        reason: String(releaseResult?.reason || "claim_release_unknown"),
      },
    };
  }

  return {
    ok: true,
    lock_granted: "true",
    milestone_title: String(milestoneTitle || claim?.claim?.milestone_title || ""),
    ready_issue_number: issueNumber,
    claim_token: String(claim?.claim?.claim_token || claimToken || ""),
    claim_owner_id: String(claimOwnerId || ""),
    claim_run_id: String(claimRunId || ""),
    claim_lease_expires_at: String(claim?.claim?.lease_expires_at || ""),
    reason: String(claim?.reason || "claim_acquired"),
  };
}

export function completeReadyWaveIssue({
  repo,
  readyIssueNumber,
  milestoneTitle = "",
  claimToken = "",
  claimOwnerId = "",
  claimRunId = "",
  claimValidator = validateWaveMarkerClaimOwnership,
  claimReleaser = releaseWaveMarkerClaim,
  execGh = gh,
  listMilestoneOpenIssuesFn = listMilestoneOpenIssues,
} = {}) {
  const issueNumber = Number(readyIssueNumber || 0);
  if (!repo || !issueNumber) {
    return {
      ok: false,
      completed: false,
      ownership_valid: false,
      reason: "missing_repo_or_issue",
      claim_release: { ok: false, released: false, reason: "not_attempted" },
    };
  }

  const ownership = claimValidator({
    repo,
    issueNumber,
    claimToken,
    ownerId: claimOwnerId,
    runId: claimRunId,
  });

  if (!ownership?.ok || !ownership?.valid) {
    return {
      ok: true,
      completed: false,
      ownership_valid: false,
      reason: String(ownership?.reason || "claim_validation_failed"),
      short_circuited: true,
      claim_release: { ok: true, released: false, reason: "not_owner_no_release" },
    };
  }

  const milestoneIssues = listMilestoneOpenIssuesFn(repo, String(milestoneTitle || "").trim());
  const openMilestoneIssues = Array.isArray(milestoneIssues) ? milestoneIssues : [];
  const remainingOpenIssues = openMilestoneIssues.filter((issue) => !isWaveMarker(issue));
  if (remainingOpenIssues.length > 0) {
    return {
      ok: true,
      completed: false,
      ownership_valid: true,
      reason: "milestone_open_issues_remaining",
      short_circuited: true,
      remaining_open_issue_count: remainingOpenIssues.length,
      remaining_open_issue_numbers: remainingOpenIssues
        .map((issue) => Number(issue?.number || 0))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => String(Math.trunc(n))),
      claim_release: { ok: true, released: false, reason: "not_attempted_open_issues_remaining" },
    };
  }

  // Write structured lease release event BEFORE closing — this permanently blocks re-dispatch
  const leaseEvent = buildWaveReadyLeaseEvent({
    action: "release",
    milestoneTitle: String(milestoneTitle || "").trim(),
    readyIssueNumber: String(issueNumber),
    runId: claimRunId,
    pipeline: "wave_execute",
    reason: "wave_completed",
  });
  execGh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", renderWaveReadyLeaseComment(leaseEvent)]);

  execGh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", "Wave complete. Closing ready marker."]);
  const close = execGh(["issue", "close", String(issueNumber), "--repo", repo, "--reason", "completed"]);
  if (!close?.ok) {
    return {
      ok: false,
      completed: false,
      ownership_valid: true,
      reason: "ready_issue_close_failed",
      claim_release: { ok: false, released: false, reason: "not_attempted" },
    };
  }

  const claimRelease = claimReleaser({
    repo,
    issueNumber,
    claimToken,
    ownerId: claimOwnerId,
    runId: claimRunId,
    reason: "wave_completed",
  });

  return {
    ok: true,
    completed: true,
    ownership_valid: true,
    reason: "wave_completed",
    short_circuited: false,
    claim_release: claimRelease,
  };
}

export function releaseReadyWaveClaim({
  repo,
  readyIssueNumber,
  claimToken = "",
  claimOwnerId = "",
  claimRunId = "",
  reason = "wave_terminal_release",
  force = false,
  claimReleaser = releaseWaveMarkerClaim,
} = {}) {
  const issueNumber = Number(readyIssueNumber || 0);
  if (!repo || !issueNumber) {
    return {
      ok: false,
      released: false,
      reason: "missing_repo_or_issue",
    };
  }

  const out = claimReleaser({
    repo,
    issueNumber,
    claimToken,
    ownerId: claimOwnerId,
    runId: claimRunId,
    reason,
    force,
  });

  return {
    ok: Boolean(out?.ok),
    released: Boolean(out?.released),
    reason: String(out?.reason || "claim_release_unknown"),
    claim: out?.claim || null,
  };
}
