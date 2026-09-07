import { CONTROL_PLANE_RELEASE_STATUSES } from "./release-manifest.ts";
import { trim, gh, ghJson } from "../lib/cli-helpers.ts";
import {
  parseControlPlaneBlocker,
  serializeControlPlaneBlocker,
} from "../lib/control-plane-blocker.ts";


function normalizeReleaseIdentity(releaseIdentity = {}) {
  const releaseTag = trim(releaseIdentity?.release_tag || releaseIdentity?.tag || "");
  const releaseSha = trim(releaseIdentity?.release_sha || releaseIdentity?.sha || "");
  const releaseId = trim(releaseIdentity?.release_id || releaseIdentity?.id || releaseTag || releaseSha || "");
  return {
    release_id: releaseId,
    release_tag: releaseTag,
    release_sha: releaseSha,
  };
}

const DISPOSITION_TO_BLOCKER_STATUS = Object.freeze({
  fixed_released: "resumed",
  fixed_main_unreleased: "blocked",
  rejected: "rejected",
  superseded: "superseded",
  blocked_upstream: "blocked",
});

function normalizeDisposition(disposition = "") {
  const normalized = trim(disposition).toLowerCase();
  return CONTROL_PLANE_RELEASE_STATUSES.includes(normalized) ? normalized : "";
}

export function buildFixedInVersionComment({ releaseIdentity = {}, manifestPath = "" } = {}) {
  const identity = normalizeReleaseIdentity(releaseIdentity);
  const resolvedManifestPath = trim(manifestPath || "");
  if (!identity.release_id) throw new Error("missing_release_identity");
  if (!resolvedManifestPath) throw new Error("missing_manifest_path");

  const renderedTag = identity.release_tag || "(none)";
  const renderedSha = identity.release_sha || "(none)";
  return `Fixed in version ${identity.release_id} (${renderedTag}, ${renderedSha}) — manifest: ${resolvedManifestPath}`;
}

function issueComment({ repo = "", issueNumber = 0, body = "" } = {}) {
  const command = [
    "issue",
    "comment",
    String(Number(issueNumber) || 0),
    "--repo",
    String(repo || ""),
    "--body",
    String(body || ""),
  ];

  const proc = gh(command);
  return {
    ok: proc.status === 0,
    stdout: String(proc.stdout || ""),
    stderr: String(proc.stderr || ""),
    exit_code: Number(proc.status ?? 1),
  };
}

function listIssueComments({ repo = "", issueNumber = 0 } = {}) {
  const comments = [];
  const perPage = 100;
  for (let page = 1; page <= 100; page += 1) {
    const parsed = ghJson([
      "api",
      `repos/${String(repo || "")}/issues/${String(Number(issueNumber) || 0)}/comments?per_page=${perPage}&page=${page}`,
    ], null);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        comments: [],
        stdout: "",
        stderr: "comments_query_failed",
        exit_code: 1,
      };
    }
    comments.push(...parsed);
    if (parsed.length < perPage) break;
  }

  return {
    ok: true,
    comments,
    stdout: "",
    stderr: "",
    exit_code: 0,
  };
}

export function shouldSkipFixedInVersionFeedback({ manifestEntry = {}, releaseIdentity = {}, manifestPath = "" } = {}) {
  const entry = manifestEntry && typeof manifestEntry === "object" ? manifestEntry : {};
  const linkage = entry?.linkage && typeof entry.linkage === "object" ? entry.linkage : {};
  const identity = normalizeReleaseIdentity(releaseIdentity);
  const normalizedManifestPath = trim(manifestPath || "");

  return (
    trim(linkage.fixed_in_version || "") === identity.release_id
    && trim(linkage.fixed_in_manifest || "") === normalizedManifestPath
  );
}

export function buildDispositionComment({
  disposition = "",
  blockerRef = "",
  releaseIdentity = {},
  manifestPath = "",
} = {}) {
  const normalizedDisposition = normalizeDisposition(disposition);
  if (!normalizedDisposition) {
    throw new Error("invalid_disposition");
  }

  const identity = normalizeReleaseIdentity(releaseIdentity);
  const normalizedBlockerRef = trim(blockerRef);
  const normalizedManifestPath = trim(manifestPath);
  const releaseLabel = identity.release_id || identity.release_tag || identity.release_sha || "release";

  if (normalizedDisposition === "fixed_released") {
    return [
      `Control-plane disposition: fixed_released (${releaseLabel}).`,
      serializeControlPlaneBlocker({
        kind: "upstream_bug",
        blockerRef: normalizedBlockerRef || releaseLabel,
        unblockCondition: `Released in ${releaseLabel}.`,
        status: "resumed",
        releaseId: identity.release_id,
        releaseTag: identity.release_tag,
        releaseSha: identity.release_sha,
        manifestPath: normalizedManifestPath,
      }),
    ].join("\n");
  }

  if (normalizedDisposition === "fixed_main_unreleased") {
    return [
      `Control-plane disposition: fixed_main_unreleased (${releaseLabel}).`,
      serializeControlPlaneBlocker({
        kind: "release_floor",
        blockerRef: identity.release_id || normalizedBlockerRef || "pending_release",
        unblockCondition: identity.release_id
          ? `Requires release of ${identity.release_id}`
          : "Pending release",
        status: "blocked",
        releaseId: identity.release_id,
        releaseTag: identity.release_tag,
        releaseSha: identity.release_sha,
        manifestPath: normalizedManifestPath,
      }),
    ].join("\n");
  }

  if (normalizedDisposition === "rejected") {
    return [
      `Control-plane disposition: rejected (${normalizedBlockerRef || "no_blocker_ref"}).`,
      serializeControlPlaneBlocker({
        kind: "upstream_rejected",
        blockerRef: normalizedBlockerRef,
        unblockCondition: "Upstream rejected requested control-plane change.",
        status: "rejected",
      }),
    ].join("\n");
  }

  if (normalizedDisposition === "superseded") {
    return [
      `Control-plane disposition: superseded (${normalizedBlockerRef || "no_blocker_ref"}).`,
      serializeControlPlaneBlocker({
        kind: "upstream_rejected",
        blockerRef: normalizedBlockerRef,
        unblockCondition: "Upstream superseded this blocker with a replacement path.",
        status: "superseded",
      }),
    ].join("\n");
  }

  return [
    `Control-plane disposition: blocked_upstream (${normalizedBlockerRef || "no_blocker_ref"}).`,
    serializeControlPlaneBlocker({
      kind: "upstream_bug",
      blockerRef: normalizedBlockerRef,
      unblockCondition: normalizedBlockerRef
        ? `Blocked on upstream dependency ${normalizedBlockerRef}.`
        : "Blocked on upstream dependency.",
      status: "blocked",
    }),
  ].join("\n");
}

export function shouldSkipDispositionFeedback({ existingComments = [], disposition = "" } = {}) {
  const normalizedDisposition = normalizeDisposition(disposition);
  if (!normalizedDisposition) return { skip: false };

  const targetStatus = DISPOSITION_TO_BLOCKER_STATUS[normalizedDisposition] || "";
  if (!targetStatus) return { skip: false };

  const targetKind = normalizedDisposition === "fixed_main_unreleased"
    ? "release_floor"
    : (normalizedDisposition === "blocked_upstream" ? "upstream_bug" : "");

  for (const comment of Array.isArray(existingComments) ? existingComments : []) {
    const body = String(comment?.body || comment || "");
    if (!body.includes("control_plane_blocker.v1:")) continue;
    const parsed = parseControlPlaneBlocker({ body });
    const parsedStatus = String(parsed?.status || "").trim().toLowerCase();
    if (parsedStatus !== targetStatus) continue;

    if (targetKind) {
      const parsedKind = String(parsed?.kind || "").trim().toLowerCase();
      if (parsedKind !== targetKind) continue;
    }

    return { skip: true, reason: "already_recorded" };
  }

  return { skip: false };
}

export function postDispositionFeedback({
  source_repo = "",
  source_issue = 0,
  disposition = "",
  blockerRef = "",
  releaseIdentity = {},
  manifestPath = "",
  issueCommentFn = issueComment,
  listCommentsFn = listIssueComments,
} = {}) {
  const sourceRepo = trim(source_repo);
  const sourceIssue = Number(source_issue || 0);

  if (!sourceRepo || !Number.isFinite(sourceIssue) || sourceIssue <= 0) {
    return {
      ok: false,
      skipped: false,
      reason: "missing_source_reference",
      source_repo: sourceRepo,
      source_issue: Number.isFinite(sourceIssue) ? sourceIssue : 0,
    };
  }

  const normalizedDisposition = normalizeDisposition(disposition);
  if (!normalizedDisposition) {
    return {
      ok: false,
      skipped: false,
      reason: "invalid_disposition",
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      disposition: trim(disposition).toLowerCase(),
    };
  }

  const listed = listCommentsFn({ repo: sourceRepo, issueNumber: sourceIssue });
  if (!listed?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: "comment_failed",
      stderr: trim(listed?.stderr || listed?.stdout || "list_comments_failed"),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      disposition: normalizedDisposition,
    };
  }

  const skip = shouldSkipDispositionFeedback({
    existingComments: listed?.comments || [],
    disposition: normalizedDisposition,
  });
  if (skip.skip) {
    return {
      ok: true,
      skipped: true,
      reason: "already_recorded",
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      disposition: normalizedDisposition,
    };
  }

  let body;
  try {
    body = buildDispositionComment({
      disposition: normalizedDisposition,
      blockerRef,
      releaseIdentity,
      manifestPath,
    });
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "invalid_disposition",
      stderr: trim(error?.message || "invalid_disposition"),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      disposition: normalizedDisposition,
    };
  }

  const commented = issueCommentFn({
    repo: sourceRepo,
    issueNumber: sourceIssue,
    body,
  });

  if (!commented?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: "comment_failed",
      stderr: trim(commented?.stderr || commented?.stdout || "gh_issue_comment_failed"),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      disposition: normalizedDisposition,
    };
  }

  return {
    ok: true,
    skipped: false,
    disposition: normalizedDisposition,
    source_repo: sourceRepo,
    source_issue: sourceIssue,
  };
}

export function postFixedInVersionArtifactFeedback({
  source_repo = "",
  source_issue = 0,
  releaseIdentity = {},
  manifestPath = "",
  manifestEntry = {},
  issueCommentFn = issueComment,
} = {}) {
  const sourceRepo = trim(source_repo);
  const sourceIssue = Number(source_issue || 0);

  if (!sourceRepo || !Number.isFinite(sourceIssue) || sourceIssue <= 0) {
    return {
      ok: false,
      skipped: false,
      reason: "missing_source_reference",
      source_repo: sourceRepo,
      source_issue: Number.isFinite(sourceIssue) ? sourceIssue : 0,
    };
  }

  const identity = normalizeReleaseIdentity(releaseIdentity);
  const resolvedManifestPath = trim(manifestPath || "");

  if (!identity.release_id) {
    return {
      ok: false,
      skipped: false,
      reason: "missing_release_identity",
      source_repo: sourceRepo,
      source_issue: sourceIssue,
    };
  }

  if (!resolvedManifestPath) {
    return {
      ok: false,
      skipped: false,
      reason: "missing_manifest_path",
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      release_id: identity.release_id,
    };
  }

  if (shouldSkipFixedInVersionFeedback({
    manifestEntry,
    releaseIdentity: identity,
    manifestPath: resolvedManifestPath,
  })) {
    return {
      ok: true,
      skipped: true,
      reason: "already_recorded",
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      release_id: identity.release_id,
      manifest_path: resolvedManifestPath,
    };
  }

  const body = buildFixedInVersionComment({
    releaseIdentity: identity,
    manifestPath: resolvedManifestPath,
  });

  const commented = issueCommentFn({
    repo: sourceRepo,
    issueNumber: sourceIssue,
    body,
  });

  if (!commented?.ok) {
    const error = trim(commented?.stderr || commented?.stdout || "gh_issue_comment_failed");
    console.error(`[artifact-feedback] status=error repo=${sourceRepo} issue=${sourceIssue} release=${identity.release_id} reason=${error}`);
    return {
      ok: false,
      skipped: false,
      reason: "issue_comment_failed",
      error,
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      release_id: identity.release_id,
      manifest_path: resolvedManifestPath,
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: "comment_posted",
    source_repo: sourceRepo,
    source_issue: sourceIssue,
    release_id: identity.release_id,
    manifest_path: resolvedManifestPath,
    comment_body: body,
  };
}
