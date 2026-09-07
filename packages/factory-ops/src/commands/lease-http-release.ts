import { upsertFactoryDistributedLeaseInComment } from "./lease-codec.ts";
import {
  FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
  buildDeterministicLeaseHolderId,
} from "./lease-holder.ts";
import {
  DEFAULT_MAX_ATTEMPTS,
  CONFLICT_BACKOFF_MS,
  toInt,
  parseIssueNumber,
  resolveFactoryConfigLeaseDefaults,
  sleepMs,
  sameOwner,
  loadLeaseSnapshot,
  createFactoryDistributedLeaseGhClient,
} from "./lease-http-client.ts";
import { trim } from "../lib/cli-helpers.ts";

function makeReleasedLeasePayload({
  current,
  nowIso,
  reason,
  etag,
} = {}) {
  const nextVersion = Math.max(0, toInt(current?.version, 0)) + 1;
  return {
    ...current,
    schema_version: FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
    status: "released",
    heartbeat_at: nowIso,
    updated_at: nowIso,
    released_at: nowIso,
    release_reason: trim(reason || "released"),
    version: nextVersion,
    version_token: String(nextVersion),
    last_seen_comment_etag: trim(etag),
  };
}

function buildReleaseResult({
  ok,
  released,
  reason,
  error = "",
  lease = null,
  commentId = 0,
  commentEtag = "",
  trackingIssueNumber = "",
  factoryId = "",
  leaseName = "",
  runId = "",
  holderId = "",
  attempt = 1,
} = {}) {
  return {
    ok: Boolean(ok),
    released: Boolean(released),
    reason: trim(reason),
    error: trim(error),
    lease,
    comment_id: Number(commentId || 0),
    comment_etag: trim(commentEtag),
    tracking_issue_number: String(trackingIssueNumber || ""),
    factory_id: trim(factoryId),
    lease_name: trim(leaseName),
    run_id: trim(runId),
    holder_id: trim(holderId),
    attempt: Number(attempt || 1),
  };
}

export function releaseFactoryDistributedLease({
  repo = "",
  trackingIssueNumber = "",
  factoryId = "",
  leaseName = "",
  runId = "",
  holderId = "",
  reason = "released",
  force = false,
  nowEpochMs = Date.now(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  client = createFactoryDistributedLeaseGhClient(),
} = {}) {
  const trackingIssue = parseIssueNumber(trackingIssueNumber);
  const factory = trim(factoryId);
  const lane = trim(leaseName);
  const run = trim(runId);
  const holder = trim(holderId || buildDeterministicLeaseHolderId({ factoryId: factory, leaseName: lane }));

  if (!repo || !trackingIssue || !factory || !lane) {
    return buildReleaseResult({
      ok: false,
      released: false,
      reason: "missing_repo_tracking_issue_factory_or_lease",
      trackingIssueNumber: trackingIssue,
      factoryId: factory,
      leaseName: lane,
      runId: run,
      holderId: holder,
    });
  }

  for (let attempt = 1; attempt <= Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS); attempt += 1) {
    const snapshot = loadLeaseSnapshot({
      repo,
      trackingIssueNumber: trackingIssue,
      factoryId: factory,
      leaseName: lane,
      client,
      nowEpochMs,
    });

    if (!snapshot?.ok) {
      return buildReleaseResult({
        ok: false,
        released: false,
        reason: "lease_backend_unavailable",
        error: snapshot?.error || "lease_snapshot_failed",
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    if (!snapshot.present || !snapshot.lease) {
      return buildReleaseResult({
        ok: true,
        released: false,
        reason: "lease_missing",
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    if (snapshot.payload_invalid) {
      return buildReleaseResult({
        ok: false,
        released: false,
        reason: trim(snapshot.payload_invalid_reason_code || "missing-field"),
        error: trim(snapshot.payload_invalid_reason_detail || "invalid_lease_payload"),
        lease: snapshot.lease,
        commentId: snapshot.comment_id,
        commentEtag: snapshot.etag,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    const current = snapshot.lease;
    if (trim(current.status) === "released") {
      return buildReleaseResult({
        ok: true,
        released: false,
        reason: "lease_already_released",
        lease: current,
        commentId: snapshot.comment_id,
        commentEtag: snapshot.etag,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    if (!force) {
      if (!run || !holder) {
        return buildReleaseResult({
          ok: false,
          released: false,
          reason: "missing_run_or_holder_id",
          lease: current,
          commentId: snapshot.comment_id,
          commentEtag: snapshot.etag,
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }

      if (!sameOwner(current, { holder_id: holder, run_id: run })) {
        return buildReleaseResult({
          ok: true,
          released: false,
          reason: "lease_owned_by_other",
          lease: current,
          commentId: snapshot.comment_id,
          commentEtag: snapshot.etag,
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }
    }

    const nowIso = snapshot.now_iso;
    const releasedLease = makeReleasedLeasePayload({
      current,
      nowIso,
      reason,
      etag: snapshot.etag,
    });

    const currentComment = client.getComment({ repo, commentId: snapshot.comment_id });
    if (!currentComment?.ok) {
      return buildReleaseResult({
        ok: false,
        released: false,
        reason: "lease_backend_unavailable",
        error: currentComment?.error || "lease_comment_reload_failed",
        lease: current,
        commentId: snapshot.comment_id,
        commentEtag: snapshot.etag,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    const patched = client.updateComment({
      repo,
      commentId: snapshot.comment_id,
      body: upsertFactoryDistributedLeaseInComment(String(currentComment?.comment?.body || ""), releasedLease),
      etag: trim(snapshot.etag || currentComment?.etag || ""),
    });

    if (patched?.ok) {
      return buildReleaseResult({
        ok: true,
        released: true,
        reason: "lease_released",
        lease: releasedLease,
        commentId: snapshot.comment_id,
        commentEtag: trim(patched?.etag || ""),
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    if (patched?.precondition_failed) {
      sleepMs(CONFLICT_BACKOFF_MS[Math.min(attempt - 1, CONFLICT_BACKOFF_MS.length - 1)]);
      continue;
    }

    return buildReleaseResult({
      ok: false,
      released: false,
      reason: "lease_backend_unavailable",
      error: patched?.error || "lease_comment_patch_failed",
      lease: current,
      commentId: snapshot.comment_id,
      commentEtag: snapshot.etag,
      trackingIssueNumber: trackingIssue,
      factoryId: factory,
      leaseName: lane,
      runId: run,
      holderId: holder,
      attempt,
    });
  }

  return buildReleaseResult({
    ok: true,
    released: false,
    reason: "lease_cas_conflict_retry_exhausted",
    trackingIssueNumber: trackingIssue,
    factoryId: factory,
    leaseName: lane,
    runId: run,
    holderId: holder,
  });
}

export function resolveFactoryTrackingIssueNumber({
  repo = "",
  trackingIssueNumber = "",
  factoryRoot = "",
  configPath = "",
  factoryConfig = null,
  client = createFactoryDistributedLeaseGhClient(),
} = {}) {
  const explicit = parseIssueNumber(trackingIssueNumber);
  if (explicit > 0) {
    return { ok: true, tracking_issue_number: String(explicit), source: "arg", reason: "resolved" };
  }

  const fromEnv = parseIssueNumber(process.env.FACTORY_TRACKING_ISSUE_NUMBER || "");
  if (fromEnv > 0) {
    return { ok: true, tracking_issue_number: String(fromEnv), source: "env", reason: "resolved" };
  }

  const configDefaults = resolveFactoryConfigLeaseDefaults({
    repo,
    factoryRoot,
    configPath,
    factoryConfig,
  });
  const resolvedRepo = trim(configDefaults.repo);
  const repoMatchesConfigTarget = !trim(repo)
    || !configDefaults.configTargetRepo
    || trim(repo) === configDefaults.configTargetRepo;

  if (repoMatchesConfigTarget && configDefaults.trackingIssueNumber > 0) {
    return {
      ok: true,
      tracking_issue_number: String(configDefaults.trackingIssueNumber),
      source: "factory_config",
      reason: "resolved",
    };
  }

  if (!resolvedRepo) {
    return { ok: false, tracking_issue_number: "", source: "none", reason: "missing_repo" };
  }

  const labels = ["factory-tracking", "priorities"];
  for (const label of labels) {
    const listed = client.listOpenIssues({ repo: resolvedRepo, label });
    if (!listed?.ok) continue;
    const issues = (Array.isArray(listed.issues) ? listed.issues : [])
      .map((issue) => Number(issue?.number || 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (issues.length > 0) {
      return {
        ok: true,
        tracking_issue_number: String(issues[0]),
        source: `label:${label}`,
        reason: "resolved",
      };
    }
  }

  return {
    ok: false,
    tracking_issue_number: "",
    source: "none",
    reason: "tracking_issue_not_found",
  };
}
