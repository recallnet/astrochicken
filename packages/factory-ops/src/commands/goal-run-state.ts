import {
  buildGoalSelectedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  ensureFactoryLabels,
} from "../lib/factory-label-contract.ts";
import { resolveGitHubProjectionTarget } from "../lib/github-projection-target.ts";

export const GOAL_AWAITING_REVIEW_MARKER = "<!-- goal-run:awaiting-review -->";

function parseLabelCreateArgs(args = []) {
  const values = Array.isArray(args) ? args : [];
  const name = String(values[2] || "").trim();
  const descriptionIndex = values.indexOf("--description");
  const colorIndex = values.indexOf("--color");
  return {
    name,
    description: descriptionIndex >= 0 ? String(values[descriptionIndex + 1] || "").trim() : "",
    color: colorIndex >= 0 ? String(values[colorIndex + 1] || "").trim() : "",
  };
}

export function buildAwaitingHumanReviewCommentBody({
  goalNumber = "",
  packetId = "",
  packetPath = "",
  artifactCount = "",
} = {}) {
  return [
    GOAL_AWAITING_REVIEW_MARKER,
    "Hard-path planning artifacts are attached and awaiting human review.",
    `goal_number=${String(goalNumber || "").trim()}`,
    `packet_id=${String(packetId || "").trim()}`,
    `packet_path=${String(packetPath || "").trim()}`,
    `artifact_count=${String(artifactCount || "").trim()}`,
    "review_state=awaiting_human",
    "Review the hard-plan artifacts, then re-add the ready label to resume execution without re-planning.",
  ].join("\n");
}

export function holdGoalForHumanReview({
  repo,
  issueNumber,
  packetId = "",
  packetPath = "",
  artifactCount = "",
  ghExec,
  githubProjectionTarget,
  factoryId = "mothership",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  const normalizedFactoryId = String(factoryId || "").trim() || "mothership";
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
    ghExec,
    githubProjectionTarget,
    factoryId: normalizedFactoryId,
    runId,
    emitCanonicalEventFn,
  });
  // @context:integration Human-review holds are a real GitHub mutation path, so label ensure/edit
  // and the marker comment must all flow through the adapter boundary and emit projection receipts.
  const ensureResult = ensureFactoryLabels({
    repo,
    factoryId: normalizedFactoryId,
    keys: [FACTORY_LABEL_KEYS.AWAITING_HUMAN],
    ghExec: (args) => projectionTarget.labelCreate(parseLabelCreateArgs(args)),
  });

  const ensureFailed = (ensureResult.results || []).find((entry) => !entry.ok);
  if (ensureFailed) {
    return {
      ok: false,
      ensure_status: ensureFailed.status,
      label_status: ensureFailed.status,
      comment_status: 1,
      comment_marker: GOAL_AWAITING_REVIEW_MARKER,
      comment_body: "",
      error: "awaiting_human_label_ensure_failed",
    };
  }

  const labelArgs = buildIssueLabelEditArgs({
    repo,
    issueNumber,
    factoryId: normalizedFactoryId,
    addKeys: [FACTORY_LABEL_KEYS.AWAITING_HUMAN],
    removeKeys: [FACTORY_LABEL_KEYS.READY],
  });
  const labelResult = projectionTarget.issueEdit({
    number: issueNumber,
    addLabels: labelArgs.flatMap((value, index, array) => value === "--add-label" ? [array[index + 1]] : []).filter(Boolean),
    removeLabels: labelArgs.flatMap((value, index, array) => value === "--remove-label" ? [array[index + 1]] : []).filter(Boolean),
  });

  const commentBody = buildAwaitingHumanReviewCommentBody({
    goalNumber: issueNumber,
    packetId,
    packetPath,
    artifactCount,
  });
  const commentResult = projectionTarget.issueComment({
    number: issueNumber,
    body: commentBody,
  });

  return {
    ok: labelResult.ok && commentResult.ok,
    ensure_status: 0,
    label_status: labelResult.status,
    comment_status: commentResult.status,
    comment_marker: GOAL_AWAITING_REVIEW_MARKER,
    comment_body: commentBody,
  };
}

export function buildGoalRetryCommentBody({
  approvedFeatureCount = "0",
  issueCount = "0",
  decomposeApproved = "",
  decomposeAttempts = "0",
  decomposeParseStatus = "",
  decomposeParseSource = "",
} = {}) {
  return [
    "<!-- goal-run:decompose-retry -->",
    "Goal run did not produce an executable issue flow this tick.",
    `approved_features=${approvedFeatureCount}`,
    `issues_created=${issueCount}`,
    `decompose_approved=${decomposeApproved}`,
    `decompose_attempts=${decomposeAttempts}`,
    `decompose_parse_status=${decomposeParseStatus}`,
    `decompose_parse_source=${decomposeParseSource}`,
    "Keeping ready label for bounded retry on next tick.",
  ].join("\n");
}

export function exhaustDecomposeRetries({
  repo,
  issueNumber,
  decomposeRetryCount = "0",
  ghExec,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  const commentBody = [
    "<!-- goal-run:decompose-exhausted -->",
    `Decompose retry budget exhausted (${decomposeRetryCount} attempts).`,
    "Leaving labels unchanged because decomposition failure is a factory bug, not goal state.",
    "Fix the factory path and retry without mutating workflow labels.",
  ].join("\n");
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
    ghExec,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
  const commentResult = projectionTarget.issueComment({
    number: issueNumber,
    body: commentBody,
  });

  return {
    ok: commentResult.ok,
    label_status: 0,
    comment_status: commentResult.status,
  };
}

export function markGoalDispatched({
  repo,
  issueNumber,
  ghExec,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  emitDomainEventFn,
  emitCanonicalEventFn,
} = {}) {
  const editArgs = buildIssueLabelEditArgs({
    repo,
    issueNumber,
    factoryId: factoryId || "mothership",
    addKeys: [FACTORY_LABEL_KEYS.READY],
  });
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
    ghExec,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
  const edit = projectionTarget.issueEdit({
    number: issueNumber,
    addLabels: editArgs.flatMap((value, index, array) => value === "--add-label" ? [array[index + 1]] : []).filter(Boolean),
    removeLabels: editArgs.flatMap((value, index, array) => value === "--remove-label" ? [array[index + 1]] : []).filter(Boolean),
  });
  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: edit.ok
      ? [
        buildGoalSelectedEvent({
          factoryId,
          runId,
          goalIssueNumber: issueNumber,
          repo,
        }),
      ]
      : [],
    emitDomainEventFn,
  });
  return {
    ok: edit.ok,
    status: edit.status,
    canonical_events: canonicalEvents,
  };
}

export const DECOMPOSE_ATTEMPT_MARKER = "<!-- goal-run:decompose-attempt -->";

export function postDecomposeAttemptMarker({
  repo,
  issueNumber,
  decomposeAttemptNumber = "1",
  ghExec,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  const body = [
    DECOMPOSE_ATTEMPT_MARKER,
    `Decompose attempt ${decomposeAttemptNumber} starting.`,
  ].join("\n");
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
    ghExec,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
  const comment = projectionTarget.issueComment({ number: issueNumber, body });
  return {
    ok: comment.ok,
    status: comment.status,
    body,
  };
}

export function postGoalRetryComment({
  repo,
  issueNumber,
  approvedFeatureCount = "0",
  issueCount = "0",
  decomposeApproved = "",
  decomposeAttempts = "0",
  decomposeParseStatus = "",
  decomposeParseSource = "",
  ghExec,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  const body = buildGoalRetryCommentBody({
    approvedFeatureCount,
    issueCount,
    decomposeApproved,
    decomposeAttempts,
    decomposeParseStatus,
    decomposeParseSource,
  });
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
    ghExec,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
  const comment = projectionTarget.issueComment({ number: issueNumber, body });
  return {
    ok: comment.ok,
    status: comment.status,
    body,
  };
}
