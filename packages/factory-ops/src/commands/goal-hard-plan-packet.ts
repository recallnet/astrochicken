import { existsSync, readFileSync } from "node:fs";

import { holdGoalForHumanReview } from "./goal-run-state.ts";
import { gh, ghJson, parseJson, trim } from "../lib/cli-helpers.ts";
import {
  buildGoalHardPlanIssueComment,
  buildGoalHardPlanPacket,
  inspectGoalHardPlanAttachment,
  parseGoalHardPlanCommentMarker,
  persistGoalHardPlanPacket,
} from "../lib/goal-hard-plan-packet.ts";

function readUtf8(path = "") {
  const resolvedPath = trim(path);
  if (!resolvedPath) return "";
  return readFileSync(resolvedPath, "utf8");
}

function parseObject(raw = "") {
  const parsed = parseJson(trim(raw), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseArray(raw = "") {
  const parsed = parseJson(trim(raw), []);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeGoalNumber(goalNumber = "") {
  const normalized = trim(goalNumber);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizeSummary({ summary = "", summaryPath = "", metadata = {} } = {}) {
  const explicitSummaryPath = trim(summaryPath);
  if (explicitSummaryPath) {
    return trim(readUtf8(explicitSummaryPath));
  }

  const summaryFromArgs = trim(summary);
  if (summaryFromArgs && existsSync(summaryFromArgs)) {
    return trim(readUtf8(summaryFromArgs));
  }
  if (summaryFromArgs) return summaryFromArgs;

  const metadataSummary = trim(metadata.plan_summary || metadata.summary || "");
  if (metadataSummary && existsSync(metadataSummary)) {
    return trim(readUtf8(metadataSummary));
  }
  return metadataSummary;
}

function normalizeArtifactRefs({ artifactRefsRaw = "", artifactRefsPath = "", metadata = {} } = {}) {
  const explicitPath = trim(artifactRefsPath);
  if (explicitPath) {
    return parseArray(readUtf8(explicitPath));
  }

  const explicitRaw = trim(artifactRefsRaw);
  if (explicitRaw) {
    if (existsSync(explicitRaw)) {
      return parseArray(readUtf8(explicitRaw));
    }
    return parseArray(explicitRaw);
  }

  return Array.isArray(metadata.artifact_refs) ? metadata.artifact_refs : [];
}

function loadPlanMetadata({ planMetadataRaw = "", planMetadataPath = "" } = {}) {
  const metadataFromPath = trim(planMetadataPath)
    ? parseObject(readUtf8(planMetadataPath))
    : {};
  const metadataFromRaw = trim(planMetadataRaw)
    ? (existsSync(trim(planMetadataRaw))
      ? parseObject(readUtf8(planMetadataRaw))
      : parseObject(planMetadataRaw))
    : {};

  return {
    ...metadataFromPath,
    ...metadataFromRaw,
  };
}

function listGoalIssueComments({
  repo = "",
  goalNumber = "",
  ghJsonFn = ghJson,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  if (!normalizedRepo || !normalizedGoalNumber) return [];

  const comments = [];
  const perPage = 100;
  for (let page = 1; page <= 20; page += 1) {
    const parsed = ghJsonFn([
      "api",
      `repos/${normalizedRepo}/issues/${normalizedGoalNumber}/comments?per_page=${perPage}&page=${page}`,
    ], []);
    if (!Array.isArray(parsed)) return [];
    comments.push(...parsed);
    if (parsed.length < perPage) break;
  }
  return comments;
}

function findGoalHardPlanComment({ comments = [], goalNumber = "" } = {}) {
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  let match = null;

  for (const comment of Array.isArray(comments) ? comments : []) {
    const marker = parseGoalHardPlanCommentMarker(comment?.body || "");
    if (!marker.found) continue;
    if (marker.goal_number !== normalizedGoalNumber) continue;
    const commentId = Number(comment?.id || 0);
    if (!commentId) continue;
    match = {
      comment_id: String(commentId),
      comment_url: trim(comment?.html_url || comment?.url || ""),
      marker,
    };
  }

  return match;
}

function patchIssueComment({
  repo = "",
  commentId = "",
  body = "",
  ghExec = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedCommentId = trim(commentId);
  const normalizedBody = String(body || "");
  const out = ghExec([
    "api",
    `repos/${normalizedRepo}/issues/comments/${normalizedCommentId}`,
    "-X",
    "PATCH",
    "--input",
    "-",
  ], {
    input: JSON.stringify({ body: normalizedBody }),
  });

  if (!out?.ok) {
    throw new Error(trim(out?.stderr || out?.stdout || "goal_hard_plan_comment_update_failed"));
  }

  const parsed = parseJson(trim(out?.stdout), {});
  return {
    comment_id: trim(parsed?.id || normalizedCommentId),
    comment_url: trim(parsed?.html_url || parsed?.url || ""),
    action: "updated",
  };
}

function createIssueComment({
  repo = "",
  goalNumber = "",
  body = "",
  ghExec = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  const normalizedBody = String(body || "");
  const out = ghExec([
    "api",
    `repos/${normalizedRepo}/issues/${normalizedGoalNumber}/comments`,
    "-X",
    "POST",
    "--input",
    "-",
  ], {
    input: JSON.stringify({ body: normalizedBody }),
  });

  if (!out?.ok) {
    throw new Error(trim(out?.stderr || out?.stdout || "goal_hard_plan_comment_create_failed"));
  }

  const parsed = parseJson(trim(out?.stdout), {});
  return {
    comment_id: trim(parsed?.id),
    comment_url: trim(parsed?.html_url || parsed?.url || ""),
    action: "created",
  };
}

export function upsertGoalHardPlanComment({
  repo = "",
  goalNumber = "",
  body = "",
  ghJsonFn = ghJson,
  ghExec = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  if (!normalizedRepo) throw new Error("goal hard-plan attach requires --repo <owner/repo>");
  if (!normalizedGoalNumber) throw new Error("goal hard-plan attach requires --goal <number>");

  const comments = listGoalIssueComments({
    repo: normalizedRepo,
    goalNumber: normalizedGoalNumber,
    ghJsonFn,
  });
  const existing = findGoalHardPlanComment({
    comments,
    goalNumber: normalizedGoalNumber,
  });

  if (existing?.comment_id) {
    return patchIssueComment({
      repo: normalizedRepo,
      commentId: existing.comment_id,
      body,
      ghExec,
    });
  }

  return createIssueComment({
    repo: normalizedRepo,
    goalNumber: normalizedGoalNumber,
    body,
    ghExec,
  });
}

export function parseGoalHardPlanAttachmentInput({
  goalNumber = "",
  planId = "",
  summary = "",
  summaryPath = "",
  artifactRefsRaw = "",
  artifactRefsPath = "",
  planMetadataRaw = "",
  planMetadataPath = "",
  attachedBy = "",
} = {}) {
  const metadata = loadPlanMetadata({ planMetadataRaw, planMetadataPath });

  const normalizedGoalNumber = normalizeGoalNumber(goalNumber || metadata.goal_number || metadata.goalNumber || "");
  const normalizedPlanId = trim(planId || metadata.packet_id || metadata.plan_id || metadata.planId || "");
  const normalizedSummary = normalizeSummary({
    summary,
    summaryPath,
    metadata,
  });
  const normalizedArtifactRefs = normalizeArtifactRefs({
    artifactRefsRaw,
    artifactRefsPath,
    metadata,
  });
  const normalizedAttachedBy = trim(attachedBy || metadata.attached_by || metadata.attachedBy || "");

  if (!normalizedGoalNumber) {
    throw new Error("goal hard-plan attach requires --goal <number>");
  }
  if (!normalizedPlanId) {
    throw new Error("goal hard-plan attach requires --plan-id <id>");
  }
  if (!normalizedSummary) {
    throw new Error("goal hard-plan attach requires --summary <text|path>");
  }
  if (!Array.isArray(normalizedArtifactRefs) || normalizedArtifactRefs.length === 0) {
    throw new Error("goal hard-plan attach requires artifact refs (pass --artifact-refs/--artifact-refs-path or include artifact_refs in --plan-metadata)");
  }

  return {
    goal_number: normalizedGoalNumber,
    packet_id: normalizedPlanId,
    plan_summary: normalizedSummary,
    artifact_refs: normalizedArtifactRefs,
    attached_by: normalizedAttachedBy,
  };
}

export function attachGoalHardPlanPacket({
  repoRoot = ".",
  repo = "",
  goalNumber = "",
  planId = "",
  summary = "",
  summaryPath = "",
  artifactRefsRaw = "",
  artifactRefsPath = "",
  planMetadataRaw = "",
  planMetadataPath = "",
  attachedBy = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  holdForHumanReview = true,
  ghJsonFn = ghJson,
  ghExec = gh,
} = {}) {
  const normalizedRepoRoot = trim(repoRoot || ".");
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    throw new Error("goal hard-plan attach requires --repo <owner/repo>");
  }

  const normalized = parseGoalHardPlanAttachmentInput({
    goalNumber,
    planId,
    summary,
    summaryPath,
    artifactRefsRaw,
    artifactRefsPath,
    planMetadataRaw,
    planMetadataPath,
    attachedBy,
  });

  const attachedAt = new Date().toISOString();

  const draftPacket = buildGoalHardPlanPacket({
    version: "v1",
    goalNumber: normalized.goal_number,
    packetId: normalized.packet_id,
    planSummary: normalized.plan_summary,
    artifactRefs: normalized.artifact_refs,
    attachedBy: normalized.attached_by,
    attachedAt,
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const commentBody = buildGoalHardPlanIssueComment({
    goalNumber: normalized.goal_number,
    packetId: draftPacket.packet_id,
    planSummary: draftPacket.plan_summary,
    artifactRefs: draftPacket.artifact_refs,
    attachedAt,
  });

  const commentResult = upsertGoalHardPlanComment({
    repo: normalizedRepo,
    goalNumber: normalized.goal_number,
    body: commentBody,
    ghJsonFn,
    ghExec,
  });

  const packet = buildGoalHardPlanPacket({
    version: "v1",
    goalNumber: normalized.goal_number,
    packetId: draftPacket.packet_id,
    planSummary: draftPacket.plan_summary,
    artifactRefs: draftPacket.artifact_refs,
    attachedBy: draftPacket.attached_by,
    attachedAt,
    goalIssueCommentId: commentResult.comment_id,
    goalIssueCommentUrl: commentResult.comment_url,
    commentMarker: draftPacket.comment_marker,
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persisted = persistGoalHardPlanPacket({
    repo: normalizedRepoRoot,
    packet,
  });

  let reviewHold = {
    ok: true,
    label_status: 0,
    comment_status: 0,
    comment_marker: "",
    comment_body: "",
  };
  if (holdForHumanReview) {
    reviewHold = holdGoalForHumanReview({
      repo: normalizedRepo,
      issueNumber: normalized.goal_number,
      packetId: persisted.packet_ref.packet_id,
      packetPath: persisted.packet_path,
      artifactCount: String(packet.artifact_refs.length),
      ghExec,
    });
  }

  return {
    ok: reviewHold.ok,
    goal_number: normalized.goal_number,
    packet_id: persisted.packet_ref.packet_id,
    packet_type: persisted.packet_ref.packet_type,
    schema_version: persisted.packet_ref.schema_version,
    packet_path: persisted.packet_path,
    storage_class: persisted.storage_class,
    comment_action: commentResult.action,
    comment_id: commentResult.comment_id,
    comment_url: commentResult.comment_url,
    comment_marker: packet.comment_marker,
    plan_summary: packet.plan_summary,
    artifact_count: packet.artifact_refs.length,
    awaiting_review: holdForHumanReview,
    awaiting_review_marker: reviewHold.comment_marker,
    hold_label_status: reviewHold.label_status,
    hold_comment_status: reviewHold.comment_status,
  };
}

export function inspectGoalHardPlanPacketAttachment({
  repoRoot = ".",
  goalNumber = "",
  factoryId = "",
} = {}) {
  return inspectGoalHardPlanAttachment({
    repo: trim(repoRoot || "."),
    goalNumber,
    factoryId,
  });
}
