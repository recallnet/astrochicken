import { randomUUID } from "node:crypto";

import { trim } from "./cli-helpers.ts";

export const CANONICAL_DOMAIN_EVENT_SCHEMA = "canonical_event_envelope/v1";

export const CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES = Object.freeze({
  GOAL_SELECTED: "factory.goal.selected",
  GOAL_CLOSE_REQUESTED: "factory.goal.close_requested",
  GOAL_CLOSE_APPLIED: "factory.goal.close_applied",
  ISSUE_CREATED: "factory.issue.created",
  ISSUE_SUB_ISSUE_LINK_APPLIED: "factory.issue.sub_issue_link_applied",
  ISSUE_CLOSE_APPLIED: "factory.issue.close_applied",
  ISSUE_EXECUTION_STARTED: "factory.issue.execution_started",
  ISSUE_EXECUTION_COMPLETED: "factory.issue.execution_completed",
  REVIEW_VERDICT_APPLIED: "factory.review.verdict_applied",
  MERGE_COMPLETED: "factory.merge.completed",
  CONTROL_ACTION_APPLIED: "factory.control.action_applied",
  PACKET_PUBLISHED: "factory.packet.published",
  PACKET_STATE_UPDATED: "factory.packet.state_updated",
});

function buildCanonicalFactoryDomainEvent({
  eventFamily = "",
  factoryId = "",
  runId = "",
  emitter = "",
  payload = {},
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedEmitter = trim(emitter);
  const normalizedFamily = trim(eventFamily);
  if (!normalizedFactoryId || !normalizedEmitter || !normalizedFamily) {
    return null;
  }
  return {
    schema: CANONICAL_DOMAIN_EVENT_SCHEMA,
    event_id: randomUUID(),
    event_family: normalizedFamily,
    event_version: 1,
    factory_id: normalizedFactoryId,
    run_id: trim(runId) || undefined,
    emitter: normalizedEmitter,
    emitted_at: new Date().toISOString(),
    event_origin: "runtime",
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

export function dispatchCanonicalDomainEvents({
  events = [],
  emitDomainEventFn,
} = {}) {
  const emitted = Array.isArray(events) ? events.filter(Boolean) : [];
  if (typeof emitDomainEventFn === "function") {
    for (const event of emitted) {
      emitDomainEventFn(event);
    }
  }
  return emitted;
}

export function buildGoalSelectedEvent({
  factoryId = "",
  runId = "",
  goalIssueNumber = "",
  repo = "",
  emitter = "packages.factory-ops.goal-run-state.markGoalDispatched",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_SELECTED,
    factoryId,
    runId,
    emitter,
    payload: {
      goal_issue_number: trim(goalIssueNumber),
      repo: trim(repo),
      selected_for: "dispatch",
    },
  });
}

export function buildGoalCloseRequestedEvent({
  factoryId = "",
  runId = "",
  goalIssueNumber = "",
  repo = "",
  requestStatus = "",
  reason = "",
  error = "",
  emitter = "packages.factory-ops.goal-final-state-review.reconcileGoalFinalState",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED,
    factoryId,
    runId,
    emitter,
    payload: {
      goal_issue_number: trim(goalIssueNumber),
      repo: trim(repo),
      request_status: trim(requestStatus),
      reason: trim(reason),
      error: trim(error),
    },
  });
}

export function buildGoalCloseAppliedEvent({
  factoryId = "",
  runId = "",
  goalIssueNumber = "",
  repo = "",
  closeStatus = "",
  reason = "",
  error = "",
  emitter = "packages.factory-ops.goal-final-state-review.reconcileGoalFinalState",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED,
    factoryId,
    runId,
    emitter,
    payload: {
      goal_issue_number: trim(goalIssueNumber),
      repo: trim(repo),
      close_status: trim(closeStatus),
      reason: trim(reason),
      error: trim(error),
    },
  });
}

export function buildIssueCreatedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  issueUrl = "",
  repo = "",
  appliedLabels = [],
  rejectedLabels = [],
  emitter = "packages.factory-ops.common-create-issue.createGitHubIssueFromSpec",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CREATED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      issue_url: trim(issueUrl),
      repo: trim(repo),
      applied_labels: Array.isArray(appliedLabels) ? appliedLabels.map((label) => trim(label)).filter(Boolean) : [],
      rejected_labels: Array.isArray(rejectedLabels) ? rejectedLabels.map((label) => trim(label)).filter(Boolean) : [],
    },
  });
}

export function buildIssueSubIssueLinkAppliedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  parentIssueNumber = "",
  repo = "",
  linkStatus = "",
  error = "",
  emitter = "packages.factory-ops.goal-sub-issues.addSubIssue",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      parent_issue_number: trim(parentIssueNumber),
      repo: trim(repo),
      link_status: trim(linkStatus),
      error: trim(error),
    },
  });
}

export function buildIssueCloseAppliedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  repo = "",
  closeStatus = "",
  reason = "",
  error = "",
  emitter = "packages.factory-ops.wave-close-merged.closeMergedIssues",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CLOSE_APPLIED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      repo: trim(repo),
      close_status: trim(closeStatus),
      reason: trim(reason),
      error: trim(error),
    },
  });
}

export function buildIssueExecutionStartedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  branch = "",
  worktreeDir = "",
  agentSessionId = "",
  emitter = "packages.factory-ops.wave-issue-init.initWaveIssueWorktree",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_EXECUTION_STARTED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      branch: trim(branch),
      worktree_dir: trim(worktreeDir),
      agent_session_id: trim(agentSessionId),
    },
  });
}

export function buildIssueExecutionCompletedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  branch = "",
  worktreeDir = "",
  disposition = "",
  reviewFailed = "",
  merged = "",
  reviewEvidencePath = "",
  emitter = "packages.factory-ops.wave-issue-review.buildWaveIssueImplResult",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_EXECUTION_COMPLETED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      branch: trim(branch),
      worktree_dir: trim(worktreeDir),
      disposition: trim(disposition),
      review_failed: trim(reviewFailed),
      merged: trim(merged),
      review_evidence_path: trim(reviewEvidencePath),
    },
  });
}

export function buildReviewVerdictAppliedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  disposition = "",
  reviewNotes = "",
  decisionConfidence = "",
  decisionEvidence = "",
  zeroDeltaRetry = "",
  zeroDeltaRetryCount = "",
  emitter = "packages.factory-ops.wave-issue-review.buildWaveIssueImplResult",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.REVIEW_VERDICT_APPLIED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      disposition: trim(disposition),
      review_notes: trim(reviewNotes),
      decision_confidence: trim(decisionConfidence),
      decision_evidence: trim(decisionEvidence),
      zero_delta_retry: trim(zeroDeltaRetry),
      zero_delta_retry_count: trim(zeroDeltaRetryCount),
    },
  });
}

export function buildMergeCompletedEvent({
  factoryId = "",
  runId = "",
  issueNumber = "",
  repo = "",
  branch = "",
  mergeStatus = "",
  mergeNotes = "",
  pathTaken = "",
  mergeResolver = "",
  emitter = "packages.factory-ops.wave-merge-results.buildWaveMergeResults",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.MERGE_COMPLETED,
    factoryId,
    runId,
    emitter,
    payload: {
      issue_number: trim(issueNumber),
      repo: trim(repo),
      branch: trim(branch),
      merge_status: trim(mergeStatus),
      merge_notes: trim(mergeNotes),
      path_taken: trim(pathTaken),
      merge_resolver: trim(mergeResolver),
    },
  });
}

export function buildControlActionAppliedEvent({
  factoryId = "",
  runId = "",
  action = "",
  reason = "",
  actor = "",
  retryTarget = "",
  stateVersion = "",
  stateAction = "",
  statePath = "",
  emitter = "packages.factory-ops.factory-control-state.runFactoryControlAction",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.CONTROL_ACTION_APPLIED,
    factoryId,
    runId,
    emitter,
    payload: {
      action: trim(action),
      reason: trim(reason),
      actor: trim(actor),
      retry_target: trim(retryTarget),
      state_version: Number.isFinite(Number(stateVersion)) ? Number(stateVersion) : trim(stateVersion),
      state_action: trim(stateAction),
      state_path: trim(statePath),
    },
  });
}

export function buildPacketPublishedEvent({
  factoryId = "",
  runId = "",
  packet = {},
  packetPath = "",
  storageClass = "",
  family = "",
  durable = false,
  emitter = "packages.factory-ops.packet-core.persistNamedPacket",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.PACKET_PUBLISHED,
    factoryId,
    runId,
    emitter,
    payload: {
      packet: packet && typeof packet === "object" ? packet : {},
      packet_path: trim(packetPath),
      storage_class: trim(storageClass),
      family: trim(family),
      durable: durable === true,
    },
  });
}

export function buildPacketStateUpdatedEvent({
  factoryId = "",
  runId = "",
  packet = {},
  packetPath = "",
  storageClass = "",
  family = "",
  durable = false,
  statusReason = "",
  emitter = "packages.factory-ops.packet-core.updatePersistedPacketState",
} = {}) {
  return buildCanonicalFactoryDomainEvent({
    eventFamily: CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.PACKET_STATE_UPDATED,
    factoryId,
    runId,
    emitter,
    payload: {
      packet: packet && typeof packet === "object" ? packet : {},
      packet_path: trim(packetPath),
      storage_class: trim(storageClass),
      family: trim(family),
      durable: durable === true,
      status_reason: trim(statusReason),
    },
  });
}
