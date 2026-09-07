import { upsertFactoryDistributedLeaseInComment } from "./lease-codec.ts";
import {
  FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_RECLAIM_GRACE_MS,
  normalizeLeaseSeconds,
  buildDeterministicLeaseHolderId,
  resolveManagedLeaseHostId,
  resolveManagedLeaseInstallationId,
  resolveManagedLeaseRuntimeVersion,
  validateManagedInstanceLeaseRecord,
} from "./lease-holder.ts";
import {
  DEFAULT_MAX_ATTEMPTS,
  CONFLICT_BACKOFF_MS,
  toInt,
  toIso,
  parseEpochMs,
  parseIssueNumber,
  sleepMs,
  sameOwner,
  matchingIdempotency,
  evaluateLeaseSnapshot,
  loadLeaseSnapshot,
  createFactoryDistributedLeaseGhClient,
} from "./lease-http-client.ts";
import { trim } from "../lib/cli-helpers.ts";
import { enforceLeaseSafetyForSnapshot } from "../lib/lease-safety.ts";

function buildValidationFailureResult({
  trackingIssueNumber,
  factoryId,
  leaseName,
  runId,
  holderId,
  attempt,
  validation,
  lease = null,
  commentId = 0,
  commentEtag = "",
} = {}) {
  return buildAcquireResult({
    ok: false,
    acquired: false,
    reason: trim(validation?.reason_code || "missing-field"),
    reasonDetail: trim(validation?.reason_detail || "missing-field:record"),
    error: trim(validation?.reason_detail || "invalid_lease_payload"),
    lease,
    commentId,
    commentEtag,
    trackingIssueNumber,
    factoryId,
    leaseName,
    runId,
    holderId,
    attempt,
  });
}

function makeActiveLeasePayload({
  current = null,
  nowIso,
  nowEpochMs,
  leaseSeconds,
  factoryId,
  leaseName,
  holderId,
  runId,
  trackingIssueNumber,
  idempotencyKey,
  clockSkewToleranceMs,
  reclaimGraceMs,
  reclaiming = false,
  releaseEtag = "",
  instanceId = "",
  installationId = "",
  hostId = "",
  leaseOwner = "",
  runtimeVersion = "",
} = {}) {
  const startedAt = current && !reclaiming && trim(current.acquired_at)
    ? trim(current.acquired_at)
    : nowIso;
  const normalizedLeaseSeconds = normalizeLeaseSeconds(leaseSeconds, DEFAULT_LEASE_SECONDS);
  const expiresAt = toIso((Number(nowEpochMs) || Date.now()) + normalizedLeaseSeconds * 1000);
  const nextVersion = Math.max(0, toInt(current?.version, 0)) + 1;
  const resolvedLeaseOwner = trim(leaseOwner || holderId);
  const resolvedHostId = resolveManagedLeaseHostId({
    hostId,
    leaseOwner: resolvedLeaseOwner,
    holderId,
  });
  const resolvedInstanceId = trim(instanceId || factoryId);
  const resolvedInstallationId = resolveManagedLeaseInstallationId({
    installationId,
    instanceId: resolvedInstanceId,
    hostId: resolvedHostId,
  });

  return {
    schema_version: FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
    status: "active",
    factory_id: trim(factoryId),
    lease_name: trim(leaseName),
    holder_id: trim(holderId),
    run_id: trim(runId),
    acquired_at: startedAt,
    heartbeat_at: nowIso,
    expires_at: expiresAt,
    updated_at: nowIso,
    tracking_issue_number: String(trackingIssueNumber),
    idempotency_key: trim(idempotencyKey),
    clock_skew_tolerance_ms: Math.max(0, Number(clockSkewToleranceMs) || DEFAULT_CLOCK_SKEW_TOLERANCE_MS),
    reclaim_grace_ms: Math.max(0, Number(reclaimGraceMs) || DEFAULT_RECLAIM_GRACE_MS),
    version: nextVersion,
    version_token: String(nextVersion),
    last_seen_comment_etag: trim(releaseEtag),
    reclaim_count: Math.max(0, toInt(current?.reclaim_count, 0)) + (reclaiming ? 1 : 0),
    reclaimed_from_holder_id: reclaiming ? trim(current?.holder_id) : "",
    reclaimed_from_run_id: reclaiming ? trim(current?.run_id) : "",
    reclaimed_at: reclaiming ? nowIso : "",
    released_at: "",
    release_reason: "",
    instance_id: resolvedInstanceId,
    installation_id: resolvedInstallationId,
    host_id: resolvedHostId,
    lease_owner: resolvedLeaseOwner,
    lease_acquired_at: startedAt,
    lease_expires_at: expiresAt,
    lease_ttl_sec: normalizedLeaseSeconds,
    runtime_version: resolveManagedLeaseRuntimeVersion(runtimeVersion),
  };
}

function buildAcquireResult({
  ok,
  acquired,
  reason,
  reasonDetail = "",
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
  incidentFingerprint = "",
  incidentPacketId = "",
  incidentPacketPath = "",
  incidentPacketPersisted = false,
  incidentPacketPersistError = "",
  leaseAmbiguityEvidence = null,
} = {}) {
  return {
    ok: Boolean(ok),
    acquired: Boolean(acquired),
    reason: trim(reason),
    reason_detail: trim(reasonDetail),
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
    incident_fingerprint: trim(incidentFingerprint),
    incident_packet_id: trim(incidentPacketId),
    incident_packet_path: trim(incidentPacketPath),
    incident_packet_persisted: Boolean(incidentPacketPersisted),
    incident_packet_persist_error: trim(incidentPacketPersistError),
    lease_ambiguity_evidence: leaseAmbiguityEvidence,
  };
}

export function acquireFactoryDistributedLease({
  repo = "",
  trackingIssueNumber = "",
  factoryId = "",
  leaseName = "",
  runId = "",
  holderId = "",
  idempotencyKey = "",
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  clockSkewToleranceMs = DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  reclaimGraceMs = DEFAULT_RECLAIM_GRACE_MS,
  nowEpochMs = Date.now(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  client = createFactoryDistributedLeaseGhClient(),
  instanceId = "",
  installationId = "",
  hostId = "",
  leaseOwner = "",
  runtimeVersion = "",
  packetRepo = process.cwd(),
  controlStateRootDir = process.cwd(),
  leaseSafetyFn = enforceLeaseSafetyForSnapshot,
} = {}) {
  const trackingIssue = parseIssueNumber(trackingIssueNumber);
  const factory = trim(factoryId);
  const lane = trim(leaseName);
  const run = trim(runId);
  const holder = trim(holderId || buildDeterministicLeaseHolderId({ factoryId: factory, leaseName: lane }));
  const idempotency = trim(idempotencyKey || `${factory}:${lane}:${run}`);

  if (!repo || !trackingIssue || !factory || !lane || !run) {
    return buildAcquireResult({
      ok: false,
      acquired: false,
      reason: "missing_repo_tracking_issue_factory_lease_or_run",
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

    if (!snapshot.ok) {
      return buildAcquireResult({
        ok: false,
        acquired: false,
        reason: "lease_backend_unavailable",
        error: snapshot.error || "lease_snapshot_failed",
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    if (snapshot.present && snapshot.payload_invalid) {
      return buildAcquireResult({
        ok: false,
        acquired: false,
        reason: trim(snapshot.payload_invalid_reason_code || "missing-field"),
        reasonDetail: trim(snapshot.payload_invalid_reason_detail || "missing-field:record"),
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

    const leaseSafety = leaseSafetyFn({
      repo,
      packetRepo,
      controlStateRootDir,
      factoryId: factory,
      leaseName: lane,
      runId: run,
      holderId: holder,
      instanceId: instanceId || factory,
      hostId,
      runtimeVersion,
      snapshot,
    });
    if (leaseSafety.ambiguous) {
      return buildAcquireResult({
        ok: true,
        acquired: false,
        reason: "lease_ambiguous",
        reasonDetail: "lease_ambiguous:multiple_active_candidates",
        lease: snapshot.lease,
        commentId: snapshot.comment_id,
        commentEtag: snapshot.etag,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
        incidentFingerprint: leaseSafety.incident_fingerprint,
        incidentPacketId: leaseSafety.incident_packet_id,
        incidentPacketPath: leaseSafety.incident_packet_path,
        incidentPacketPersisted: leaseSafety.incident_packet_persisted,
        incidentPacketPersistError: leaseSafety.incident_packet_persist_error,
        leaseAmbiguityEvidence: leaseSafety,
      });
    }

    const nowIso = snapshot.now_iso;
    const nowMs = parseEpochMs(nowIso);
    const current = snapshot.lease;
    const currentState = evaluateLeaseSnapshot(current, {
      nowIso,
      clockSkewToleranceMs,
      reclaimGraceMs,
    });

    let action = "acquire";
    let reason = "lease_acquired";
    let deny = "";

    if (currentState.present) {
      if (currentState.released) {
        action = "acquire";
        reason = "lease_acquired";
      } else if (currentState.active) {
        if (sameOwner(current, { holder_id: holder, run_id: run })) {
          if (!matchingIdempotency(current, idempotency)) {
            deny = "lease_refresh_idempotency_mismatch";
          } else {
            action = "refresh";
            reason = "lease_refreshed";
          }
        } else {
          deny = "lease_owned_by_other";
        }
      } else if (currentState.reclaimable) {
        action = "reclaim";
        reason = "lease_reclaimed_stale";
      }
    }

    if (deny) {
      return buildAcquireResult({
        ok: true,
        acquired: false,
        reason: deny,
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

    const nextLease = makeActiveLeasePayload({
      current,
      nowIso,
      nowEpochMs: Number.isFinite(nowMs) ? nowMs : nowEpochMs,
      leaseSeconds,
      factoryId: factory,
      leaseName: lane,
      holderId: holder,
      runId: run,
      trackingIssueNumber: trackingIssue,
      idempotencyKey: idempotency,
      clockSkewToleranceMs,
      reclaimGraceMs,
      reclaiming: action === "reclaim",
      releaseEtag: snapshot.etag,
      instanceId,
      installationId,
      hostId,
      leaseOwner,
      runtimeVersion,
    });

    const validation = validateManagedInstanceLeaseRecord(nextLease, {
      nowIso,
      clockSkewToleranceMs,
    });
    if (!validation.ok) {
      return buildValidationFailureResult({
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
        validation,
        lease: nextLease,
        commentId: snapshot.comment_id,
        commentEtag: snapshot.etag,
      });
    }

    if (!snapshot.present) {
      const created = client.createComment({
        repo,
        issueNumber: trackingIssue,
        body: upsertFactoryDistributedLeaseInComment("", nextLease),
      });

      if (!created?.ok) {
        return buildAcquireResult({
          ok: false,
          acquired: false,
          reason: "lease_backend_unavailable",
          error: created?.error || "lease_comment_create_failed",
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }

      const verify = loadLeaseSnapshot({
        repo,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        client,
        nowEpochMs,
      });

      if (!verify.ok) {
        return buildAcquireResult({
          ok: false,
          acquired: false,
          reason: "lease_backend_unavailable",
          error: verify.error || "lease_verify_failed",
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }

      if (verify.present && verify.payload_invalid) {
        return buildAcquireResult({
          ok: false,
          acquired: false,
          reason: trim(verify.payload_invalid_reason_code || "missing-field"),
          reasonDetail: trim(verify.payload_invalid_reason_detail || "missing-field:record"),
          error: trim(verify.payload_invalid_reason_detail || "invalid_lease_payload"),
          lease: verify.lease,
          commentId: verify.comment_id,
          commentEtag: verify.etag,
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }

      const createdId = Number(created?.comment?.id || 0);
      if (verify.present && createdId && Number(verify.comment_id || 0) !== createdId) {
        return buildAcquireResult({
          ok: true,
          acquired: false,
          reason: "lease_comment_race_lost",
          lease: verify.lease,
          commentId: verify.comment_id,
          commentEtag: verify.etag,
          trackingIssueNumber: trackingIssue,
          factoryId: factory,
          leaseName: lane,
          runId: run,
          holderId: holder,
          attempt,
        });
      }

      return buildAcquireResult({
        ok: true,
        acquired: true,
        reason,
        lease: verify.lease || nextLease,
        commentId: verify.comment_id || createdId,
        commentEtag: verify.etag,
        trackingIssueNumber: trackingIssue,
        factoryId: factory,
        leaseName: lane,
        runId: run,
        holderId: holder,
        attempt,
      });
    }

    // Preserve non-lease comment text by patching against current body from getComment.
    const currentComment = client.getComment({ repo, commentId: snapshot.comment_id });
    if (!currentComment?.ok) {
      return buildAcquireResult({
        ok: false,
        acquired: false,
        reason: "lease_backend_unavailable",
        error: currentComment?.error || "lease_comment_reload_failed",
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
      body: upsertFactoryDistributedLeaseInComment(String(currentComment?.comment?.body || ""), nextLease),
      etag: trim(snapshot.etag || currentComment?.etag || ""),
    });

    if (patched?.ok) {
      return buildAcquireResult({
        ok: true,
        acquired: true,
        reason,
        lease: nextLease,
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

    return buildAcquireResult({
      ok: false,
      acquired: false,
      reason: "lease_backend_unavailable",
      error: patched?.error || "lease_comment_patch_failed",
      trackingIssueNumber: trackingIssue,
      factoryId: factory,
      leaseName: lane,
      runId: run,
      holderId: holder,
      attempt,
    });
  }

  return buildAcquireResult({
    ok: true,
    acquired: false,
    reason: "lease_cas_conflict_retry_exhausted",
    trackingIssueNumber: trackingIssue,
    factoryId: factory,
    leaseName: lane,
    runId: run,
    holderId: holder,
  });
}
