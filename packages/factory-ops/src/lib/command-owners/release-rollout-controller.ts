import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveHostRuntimeVersion } from "./host-runtime-lifecycle.ts";
import { markArtifactInManifest } from "./release-manifest.ts";
import { postFixedInVersionArtifactFeedback } from "../../commands/artifact-feedback.ts";
import { createGhReleaseAssetClient, publishControlPlaneReleaseAsset } from "../../commands/control-plane-release-asset.ts";
import {
  acquireFactoryDistributedLease,
  buildDeterministicLeaseHolderId,
  normalizeLeaseSeconds,
  releaseFactoryDistributedLease,
  resolveFactoryTrackingIssueNumber,
} from "../../commands/factory-distributed-lease.ts";
import { collectFactoryOutcomes } from "../../commands/factory-outcomes.ts";
import { factoryStatus } from "../../commands/factory-status.ts";
import { tickStatus } from "../../commands/factory-tick-status.ts";
import {
  defaultReleaseRolloutSleep,
  evaluateReleaseCanaryHealth,
  pollReleaseCanaryHealth,
} from "../../commands/release-rollout-controller-health.ts";
import {
  buildReconciledControllerState,
  latestTelemetryRecord,
  normalizePublishedManifest,
  publishManifestAssetAndRecord,
  reconcilePromotedChannelPins,
  reconcileRolledBackChannelPins,
} from "../../commands/release-rollout-controller-state.ts";
import { stableStringify } from "../../commands/tick-artifact.ts";
import { trim, parseJson } from "../cli-helpers.ts";
import {
  RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
  buildReleaseRolloutCloudEvent,
  normalizeReleaseRolloutEvent,
  validateReleaseRolloutCloudEvent,
} from "../release-rollout-asyncapi-contract.ts";
import { evaluateManifestRolloutGate, resolveReleaseIdentity } from "../release-rollout-gate.ts";

export { evaluateReleaseCanaryHealth, pollReleaseCanaryHealth };
export { RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION };

export const RELEASE_ROLLOUT_STATE_SCHEMA_VERSION = "release_rollout_state/v1";
export const RELEASE_ROLLOUT_EVENT_PREFIX = "CLOUDEVENT ";
const RELEASE_MANIFEST_FILENAME = "release-manifest.json";
const DEFAULT_CANARY_MANIFEST_PATH = ".hatch/releases/canary/release-manifest.json";
const DEFAULT_GENERAL_MANIFEST_PATH = ".hatch/releases/stable/release-manifest.json";
const ROLLOUT_CHANNEL_ALIASES = {
  general: "stable",
};
const ROLLOUT_CHANNELS = new Set(["stable", "canary", "pinned"]);

function normalizeRolloutChannel(value = "", fallback = "stable") {
  const raw = trim(value || "").toLowerCase();
  const aliased = ROLLOUT_CHANNEL_ALIASES[raw] || raw;
  if (ROLLOUT_CHANNELS.has(aliased)) return aliased;
  const fallbackRaw = trim(fallback || "stable").toLowerCase();
  const fallbackAliased = ROLLOUT_CHANNEL_ALIASES[fallbackRaw] || fallbackRaw;
  return ROLLOUT_CHANNELS.has(fallbackAliased) ? fallbackAliased : "stable";
}

function inferControllerChannel({ channel = "", status = "", stage = "" } = {}) {
  const explicit = trim(channel);
  if (explicit) return normalizeRolloutChannel(explicit, "stable");
  const normalizedStatus = trim(status);
  const normalizedStage = trim(stage);
  if (normalizedStatus === "canary_in_progress" || normalizedStage === "canary") return "canary";
  if (normalizedStatus === "promoted" || normalizedStage === "general" || normalizedStage === "stable") return "stable";
  if (normalizedStatus === "pinned" || normalizedStage === "pinned") return "pinned";
  return "stable";
}

function normalizeReleaseRef(value = "") {
  const normalized = trim(value || "").toLowerCase();
  return normalized.startsWith("v") ? normalized.slice(1) : normalized;
}

function pinnedReleaseMatches({ requiredPinnedReleaseId = "", releaseId = "" } = {}) {
  const required = normalizeReleaseRef(requiredPinnedReleaseId);
  const actual = normalizeReleaseRef(releaseId);
  if (!required || !actual) return false;
  return required === actual;
}


function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(1, Math.trunc(parsed));
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(parsed));
}

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = trim(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function normalizeStringArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => trim(value))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeReleaseId(value = "") {
  const base = trim(value || "unversioned") || "unversioned";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "unversioned";
}

function ensureDir(filePath = "") {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function readReleaseManifestFile(path = "") {
  const manifestPath = trim(path);
  if (!manifestPath || !existsSync(manifestPath)) return null;
  const parsed = parseJson(readFileSync(manifestPath, "utf8"), null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function writeReleaseManifestFile(path = "", manifest = {}) {
  const manifestPath = trim(path);
  if (!manifestPath) throw new Error("missing_manifest_path");
  ensureDir(manifestPath);
  writeFileSync(manifestPath, `${stableStringify(manifest)}\n`, "utf8");
  return manifestPath;
}

function resolveCatalogManifestPath({ releasesDir = ".hatch/releases", releaseId = "" } = {}) {
  const normalizedReleaseId = normalizeReleaseId(releaseId || "unversioned");
  return join(trim(releasesDir || ".hatch/releases"), normalizedReleaseId, RELEASE_MANIFEST_FILENAME);
}

function copyManifestFile({ sourcePath = "", destinationPath = "" } = {}) {
  const sourceManifest = readReleaseManifestFile(sourcePath);
  if (!sourceManifest) return { ok: false, reason: "manifest_not_found", manifest: null };
  writeReleaseManifestFile(destinationPath, sourceManifest);
  return { ok: true, reason: "manifest_copied", manifest: sourceManifest };
}

function removeManifestFile(path = "") {
  const manifestPath = trim(path);
  if (!manifestPath) return { ok: true, reason: "manifest_path_missing" };
  rmSync(manifestPath, { force: true });
  return { ok: true, reason: "manifest_removed" };
}

function buildDefaultControllerState() {
  return {
    status: "",
    stage: "",
    channel: "stable",
    pinned_release_id: "",
    resume_blocked: false,
    rollback_reason: "",
    canary_factory_ids: [],
    canary_max_factories: 0,
    previous_canary_release_id: "",
    previous_general_release_id: "",
    candidate_manifest_path: "",
    canary_manifest_path: DEFAULT_CANARY_MANIFEST_PATH,
    general_manifest_path: DEFAULT_GENERAL_MANIFEST_PATH,
    lease: {},
    health: {
      status: "",
      reason: "",
      poll_count: 0,
      last_checked_at: "",
      snapshots: [],
    },
    publish: normalizePublishedManifest(),
    events: [],
    updated_at: "",
  };
}

function normalizeEvent(event = {}) {
  const cloudEvent = validateReleaseRolloutCloudEvent(event);
  if (cloudEvent.ok && cloudEvent.value) {
    return cloudEvent.value;
  }
  const payload = normalizeReleaseRolloutEvent(event);
  return buildReleaseRolloutCloudEvent({
    id: `${payload.action}:${payload.channel}:${payload.release_id}:${payload.at}`,
    subject: payload.release_id || payload.channel || "release-rollout",
    time: payload.at,
    data: payload,
  });
}

function normalizedEventData(event = {}) {
  return normalizeEvent(event).data;
}

function eventIdentity(event = {}) {
  const normalized = normalizedEventData(event);
  return stableStringify({
    action: normalized.action,
    channel: normalized.channel,
    status: normalized.status,
    reason: normalized.reason,
    release_id: normalized.release_id,
    previous_release_id: normalized.previous_release_id,
    run_id: normalized.run_id,
  });
}

export function buildReleaseRolloutEvent({
  action = "",
  channel = "",
  status = "",
  reason = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  previousReleaseId = "",
  runId = "",
  holderId = "",
  trackingIssueNumber = "",
  assetId = "",
  assetUrl = "",
  manifestPath = "",
  at = "",
  traceparent = "",
  tracestate = "",
} = {}) {
  const payload = normalizeReleaseRolloutEvent({
    schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
    action,
    channel,
    status,
    reason,
    release_id: releaseId,
    release_tag: releaseTag,
    release_sha: releaseSha,
    previous_release_id: previousReleaseId,
    run_id: runId,
    holder_id: holderId,
    tracking_issue_number: trackingIssueNumber,
    asset_id: assetId,
    asset_url: assetUrl,
    manifest_path: manifestPath,
    at: trim(at || new Date().toISOString()),
  });
  return buildReleaseRolloutCloudEvent({
    id: `${payload.action}:${payload.channel}:${payload.release_id}:${payload.at}`,
    subject: payload.release_id || payload.channel || "release-rollout",
    time: payload.at,
    traceparent,
    tracestate,
    data: payload,
  });
}

export function renderReleaseRolloutEvent(event = {}) {
  return `${RELEASE_ROLLOUT_EVENT_PREFIX}${JSON.stringify(normalizeEvent(event))}`;
}

function appendReleaseRolloutEvent(events = [], event = {}) {
  const normalizedEvents = Array.isArray(events) ? events.map((item) => normalizeEvent(item)) : [];
  const normalizedEvent = normalizeEvent(event);
  if (!normalizedEvent.data?.action) return normalizedEvents;
  const existing = normalizedEvents.some((item) => eventIdentity(item) === eventIdentity(normalizedEvent));
  if (existing) return normalizedEvents;
  return [...normalizedEvents, normalizedEvent];
}

function normalizeControllerState(controller = {}) {
  const fallback = buildDefaultControllerState();
  const health = controller?.health && typeof controller.health === "object" ? controller.health : {};
  return {
    ...fallback,
    ...controller,
    status: trim(controller?.status || fallback.status),
    stage: trim(controller?.stage || fallback.stage),
    channel: inferControllerChannel({
      channel: controller?.channel,
      status: controller?.status || fallback.status,
      stage: controller?.stage || fallback.stage,
    }),
    pinned_release_id: trim(controller?.pinned_release_id || fallback.pinned_release_id),
    resume_blocked: normalizeBool(controller?.resume_blocked, fallback.resume_blocked),
    rollback_reason: trim(controller?.rollback_reason || fallback.rollback_reason),
    canary_factory_ids: normalizeStringArray(controller?.canary_factory_ids || fallback.canary_factory_ids),
    canary_max_factories: toPositiveInt(controller?.canary_max_factories, fallback.canary_max_factories),
    previous_canary_release_id: trim(controller?.previous_canary_release_id || fallback.previous_canary_release_id),
    previous_general_release_id: trim(controller?.previous_general_release_id || fallback.previous_general_release_id),
    candidate_manifest_path: trim(controller?.candidate_manifest_path || fallback.candidate_manifest_path),
    canary_manifest_path: trim(controller?.canary_manifest_path || fallback.canary_manifest_path),
    general_manifest_path: trim(controller?.general_manifest_path || fallback.general_manifest_path),
    lease: controller?.lease && typeof controller.lease === "object" ? { ...controller.lease } : {},
    health: {
      ...fallback.health,
      ...health,
      status: trim(health?.status || fallback.health.status),
      reason: trim(health?.reason || fallback.health.reason),
      poll_count: toNonNegativeInt(health?.poll_count, fallback.health.poll_count),
      last_checked_at: trim(health?.last_checked_at || fallback.health.last_checked_at),
      snapshots: Array.isArray(health?.snapshots) ? health.snapshots : [],
    },
    publish: normalizePublishedManifest(controller?.publish || fallback.publish),
    events: Array.isArray(controller?.events) ? controller.events.map((item) => normalizeEvent(item)) : [],
    updated_at: trim(controller?.updated_at || fallback.updated_at),
  };
}

function readControllerState(manifest = {}) {
  const rollout = manifest?.rollout && typeof manifest.rollout === "object" ? manifest.rollout : {};
  return normalizeControllerState(rollout.controller || {});
}

function writeControllerState(manifest = {}, controllerPatch = {}) {
  const current = readControllerState(manifest);
  const nextHealth = controllerPatch?.health && typeof controllerPatch.health === "object"
    ? { ...current.health, ...controllerPatch.health }
    : current.health;
  const next = normalizeControllerState({
    ...current,
    ...controllerPatch,
    health: nextHealth,
    events: Array.isArray(controllerPatch?.events) ? controllerPatch.events : current.events,
  });

  return {
    ...manifest,
    rollout: {
      schema_version: RELEASE_ROLLOUT_STATE_SCHEMA_VERSION,
      controller: next,
    },
  };
}

function releaseIdForManifest(manifest = null) {
  if (!manifest || typeof manifest !== "object") return "";
  return resolveReleaseIdentity(manifest).release_id;
}

function channelMatchesRelease(path = "", releaseId = "") {
  const manifest = readReleaseManifestFile(path);
  if (!manifest) return false;
  return releaseIdForManifest(manifest) === trim(releaseId);
}

export function selectCanaryFactoryIds({ manifest = {}, maxFactories = 1 } = {}) {
  const byFactory = Array.isArray(manifest?.compatibility_matrix?.by_factory)
    ? manifest.compatibility_matrix.by_factory
    : [];
  const candidates = byFactory.length > 0
    ? byFactory.map((entry) => trim(entry?.factory_id || "")).filter(Boolean)
    : (Array.isArray(manifest?.artifacts) ? manifest.artifacts.map((entry) => trim(entry?.factory_id || entry?.linkage?.factory_id || "")).filter(Boolean) : []);
  const ordered = normalizeStringArray(candidates);
  return ordered.slice(0, Math.max(1, toPositiveInt(maxFactories, 1)));
}

function buildLeasePayload({ leaseAcquireResult = {}, resolvedTracking = {}, leaseName = "", holderId = "", runId = "", factoryId = "" } = {}) {
  return {
    acquired: Boolean(leaseAcquireResult?.acquired),
    reason: trim(leaseAcquireResult?.reason || ""),
    reason_detail: trim(leaseAcquireResult?.reason_detail || ""),
    tracking_issue_number: trim(leaseAcquireResult?.tracking_issue_number || resolvedTracking?.tracking_issue_number || ""),
    lease_name: trim(leaseAcquireResult?.lease_name || leaseName),
    holder_id: trim(leaseAcquireResult?.holder_id || holderId),
    run_id: trim(leaseAcquireResult?.run_id || runId),
    factory_id: trim(leaseAcquireResult?.factory_id || factoryId),
    comment_id: trim(leaseAcquireResult?.comment_id || ""),
    comment_etag: trim(leaseAcquireResult?.comment_etag || ""),
    expires_at: trim(leaseAcquireResult?.lease?.expires_at || leaseAcquireResult?.lease?.lease_expires_at || ""),
    instance_id: trim(leaseAcquireResult?.lease?.instance_id || ""),
    installation_id: trim(leaseAcquireResult?.lease?.installation_id || ""),
    host_id: trim(leaseAcquireResult?.lease?.host_id || ""),
    lease_owner: trim(leaseAcquireResult?.lease?.lease_owner || ""),
    lease_ttl_sec: trim(leaseAcquireResult?.lease?.lease_ttl_sec || ""),
    runtime_version: trim(leaseAcquireResult?.lease?.runtime_version || ""),
  };
}

function loadHealthPolicy(raw = "") {
  if (!trim(raw)) return {};
  const parsed = parseJson(raw, {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

function restoreChannelPin({ channelManifestPath = "", previousReleaseId = "", releasesDir = ".hatch/releases" } = {}) {
  const previousId = trim(previousReleaseId || "");
  if (!previousId) {
    return removeManifestFile(channelManifestPath);
  }
  const sourcePath = resolveCatalogManifestPath({ releasesDir, releaseId: previousId });
  return copyManifestFile({ sourcePath, destinationPath: channelManifestPath });
}

async function annotatePromotedManifestArtifacts({
  manifest = {},
  releaseIdentity = {},
  manifestPath = "",
  postArtifactFeedbackFn = postFixedInVersionArtifactFeedback,
  persistManifestFn = null,
} = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const workingArtifacts = [...artifacts];
  const feedback = [];

  const persistCheckpoint = (nextManifest) => {
    if (typeof persistManifestFn !== "function") return;
    persistManifestFn(nextManifest);
  };

  for (let index = 0; index < workingArtifacts.length; index += 1) {
    const artifact = workingArtifacts[index];
    const markResult = markArtifactInManifest(artifact, releaseIdentity, manifestPath);

    if (markResult.already_recorded) {
      workingArtifacts[index] = markResult.entry;
      feedback.push({
        ok: true,
        skipped: true,
        reason: "already_recorded",
        source_repo: String(artifact?.source_repo || ""),
        source_issue: Number(artifact?.source_issue || 0),
      });
      continue;
    }

    const feedbackResult = await Promise.resolve(postArtifactFeedbackFn({
      source_repo: String(artifact?.source_repo || ""),
      source_issue: Number(artifact?.source_issue || 0),
      releaseIdentity,
      manifestPath,
      manifestEntry: artifact,
    }));

    if (!feedbackResult?.ok) {
      return {
        ok: false,
        reason: "artifact_feedback_failed",
        failed_feedback: feedbackResult,
        feedback,
        manifest: {
          ...manifest,
          artifacts: workingArtifacts,
        },
      };
    }

    workingArtifacts[index] = markResult.entry;
    const checkpointManifest = {
      ...manifest,
      artifacts: workingArtifacts,
    };
    persistCheckpoint(checkpointManifest);
    feedback.push(feedbackResult);
  }

  return {
    ok: true,
    feedback,
    manifest: {
      ...manifest,
      artifacts: workingArtifacts,
    },
  };
}

export async function runReleaseRolloutController({
  repo = "",
  repoPath = ".",
  candidateManifestPath = "",
  releasesDir = ".hatch/releases",
  runsDir = ".hatch/runs",
  canaryManifestPath = DEFAULT_CANARY_MANIFEST_PATH,
  generalManifestPath = DEFAULT_GENERAL_MANIFEST_PATH,
  canaryMaxFactories = 1,
  healthPolicyJson = "",
  trackingIssue = "",
  factoryId = "mothership/release_rollout_controller",
  runId = "",
  holderId = "",
  hostId = "",
  processId = "",
  leaseSeconds = 600,
  lookbackHours = 24,
  nowIsoFn = () => new Date().toISOString(),
  sleepFn = defaultReleaseRolloutSleep,
  factoryStatusFn = factoryStatus,
  tickStatusFn = tickStatus,
  outcomesFn = collectFactoryOutcomes,
  resolveTrackingIssueFn = resolveFactoryTrackingIssueNumber,
  acquireLeaseFn = acquireFactoryDistributedLease,
  releaseLeaseFn = releaseFactoryDistributedLease,
  postArtifactFeedbackFn = postFixedInVersionArtifactFeedback,
  publishManifestAssetFn = publishControlPlaneReleaseAsset,
  createReleaseAssetGithubClientFn = createGhReleaseAssetClient,
  releaseAssetGithubClient = null,
} = {}) {
  const manifestPath = trim(candidateManifestPath);
  if (!manifestPath) {
    return { ok: false, decision: "invalid", reason: "missing_candidate_manifest_path" };
  }

  let candidateManifest = readReleaseManifestFile(manifestPath);
  if (!candidateManifest) {
    return { ok: false, decision: "invalid", reason: "candidate_manifest_not_found", candidate_manifest_path: manifestPath };
  }

  const releaseIdentity = resolveReleaseIdentity(candidateManifest);
  const normalizedFactoryId = trim(factoryId || "mothership/release_rollout_controller") || "mothership/release_rollout_controller";
  const effectiveRunId = trim(runId || `release-rollout:${releaseIdentity.release_id}`);
  const effectiveHolderId = trim(holderId || buildDeterministicLeaseHolderId({
    hostId,
    processId,
    factoryId: normalizedFactoryId,
    leaseName: `release_rollout:${releaseIdentity.release_id}`,
  }));
  const leaseName = `release_rollout:${releaseIdentity.release_id}`;
  const healthPolicy = loadHealthPolicy(healthPolicyJson);
  let resolvedReleaseAssetClient = releaseAssetGithubClient;
  if (!resolvedReleaseAssetClient && typeof createReleaseAssetGithubClientFn === "function") {
    try {
      resolvedReleaseAssetClient = createReleaseAssetGithubClientFn({ repo });
    } catch {
      resolvedReleaseAssetClient = null;
    }
  }
  const controllerBefore = readControllerState(candidateManifest);
  const canaryPinnedBefore = channelMatchesRelease(canaryManifestPath, releaseIdentity.release_id);
  const generalPinnedBefore = channelMatchesRelease(generalManifestPath, releaseIdentity.release_id);
  const previousCanaryReleaseIdBefore = trim(
    controllerBefore.previous_canary_release_id
      || (canaryPinnedBefore ? "" : releaseIdForManifest(readReleaseManifestFile(canaryManifestPath)))
      || "",
  );
  const previousGeneralReleaseIdBefore = trim(
    controllerBefore.previous_general_release_id
      || (generalPinnedBefore ? "" : releaseIdForManifest(readReleaseManifestFile(generalManifestPath)))
      || "",
  );

  if (controllerBefore.status === "promoted") {
    reconcilePromotedChannelPins({
      candidateManifest,
      canaryManifestPath,
      generalManifestPath,
      writeReleaseManifestFileFn: writeReleaseManifestFile,
    });
    return {
      ok: true,
      decision: "promoted",
      noop: true,
      reason: "release_already_promoted",
      release_id: releaseIdentity.release_id,
      candidate_manifest_path: manifestPath,
      canary_manifest_path: trim(canaryManifestPath),
      general_manifest_path: trim(generalManifestPath),
      canary_factory_ids: controllerBefore.canary_factory_ids,
      published_manifest: normalizePublishedManifest(controllerBefore.publish),
      telemetry_record: latestTelemetryRecord({ controller: controllerBefore, renderEventFn: renderReleaseRolloutEvent }),
    };
  }

  if (controllerBefore.status === "rolled_back") {
    candidateManifest = buildReconciledControllerState({
      manifest: candidateManifest,
      controller: {
        ...controllerBefore,
        channel: inferControllerChannel({
          channel: controllerBefore.channel,
          status: controllerBefore.status,
          stage: controllerBefore.stage,
        }),
      },
      status: "rolled_back",
      stage: "rollback",
      resumeBlocked: true,
      rollbackReason: trim(controllerBefore.rollback_reason || "release_already_rolled_back") || "release_already_rolled_back",
      lease: controllerBefore.lease,
      updatedAt: nowIsoFn(),
      writeControllerStateFn: writeControllerState,
    });
    writeReleaseManifestFile(manifestPath, candidateManifest);
    reconcileRolledBackChannelPins({
      releasesDir,
      canaryManifestPath,
      generalManifestPath,
      previousCanaryReleaseId: previousCanaryReleaseIdBefore,
      previousGeneralReleaseId: previousGeneralReleaseIdBefore,
      restoreChannelPinFn: restoreChannelPin,
    });
    const reconciledController = readControllerState(candidateManifest);
    return {
      ok: true,
      decision: "rolled_back",
      noop: true,
      reason: trim(reconciledController.rollback_reason || "release_already_rolled_back") || "release_already_rolled_back",
      release_id: releaseIdentity.release_id,
      candidate_manifest_path: manifestPath,
      canary_manifest_path: trim(canaryManifestPath),
      general_manifest_path: trim(generalManifestPath),
      canary_factory_ids: reconciledController.canary_factory_ids,
      published_manifest: normalizePublishedManifest(reconciledController.publish),
      telemetry_record: latestTelemetryRecord({ controller: reconciledController, renderEventFn: renderReleaseRolloutEvent }),
    };
  }

  const resolvedTracking = resolveTrackingIssueFn({ repo, trackingIssueNumber: trackingIssue });
  if (!resolvedTracking?.ok) {
    return {
      ok: false,
      decision: "deferred",
      reason: trim(resolvedTracking?.reason || "tracking_issue_not_found"),
      release_id: releaseIdentity.release_id,
      candidate_manifest_path: manifestPath,
    };
  }

  const leaseAcquireResult = acquireLeaseFn({
    repo,
    trackingIssueNumber: resolvedTracking.tracking_issue_number,
    factoryId: normalizedFactoryId,
    leaseName,
    runId: effectiveRunId,
    holderId: effectiveHolderId,
    idempotencyKey: `${normalizedFactoryId}:${leaseName}:${effectiveRunId}`,
    leaseSeconds: normalizeLeaseSeconds(leaseSeconds, 600),
    instanceId: normalizedFactoryId,
    hostId,
    leaseOwner: effectiveHolderId,
    runtimeVersion: resolveHostRuntimeVersion(),
  });

  if (!leaseAcquireResult?.ok || !leaseAcquireResult?.acquired) {
    return {
      ok: Boolean(leaseAcquireResult?.ok),
      decision: "deferred",
      reason: trim(leaseAcquireResult?.reason || "lease_unavailable"),
      error: trim(leaseAcquireResult?.error || ""),
      release_id: releaseIdentity.release_id,
      candidate_manifest_path: manifestPath,
      lease: buildLeasePayload({
        leaseAcquireResult,
        resolvedTracking,
        leaseName,
        holderId: effectiveHolderId,
        runId: effectiveRunId,
        factoryId: normalizedFactoryId,
      }),
    };
  }

  let releaseResult = null;

  try {
    candidateManifest = readReleaseManifestFile(manifestPath) || candidateManifest;
    const currentController = readControllerState(candidateManifest);
    const canaryManifest = readReleaseManifestFile(canaryManifestPath);
    const generalManifest = readReleaseManifestFile(generalManifestPath);
    const previousCanaryReleaseId = trim(
      currentController.previous_canary_release_id
        || (canaryPinnedBefore ? "" : releaseIdForManifest(canaryManifest))
        || "",
    );
    const previousGeneralReleaseId = trim(
      currentController.previous_general_release_id
        || (generalPinnedBefore ? "" : releaseIdForManifest(generalManifest))
        || "",
    );
    const selectedCanaryFactoryIds = currentController.canary_factory_ids.length > 0
      ? currentController.canary_factory_ids
      : selectCanaryFactoryIds({ manifest: candidateManifest, maxFactories: canaryMaxFactories });
    const leasePayload = buildLeasePayload({
      leaseAcquireResult,
      resolvedTracking,
      leaseName,
      holderId: effectiveHolderId,
      runId: effectiveRunId,
      factoryId: normalizedFactoryId,
    });

    const startEvent = buildReleaseRolloutEvent({
      action: "canary_start",
      channel: "canary",
      status: "canary_in_progress",
      reason: "canary_manifest_pinned",
      releaseId: releaseIdentity.release_id,
      releaseTag: releaseIdentity.release_tag,
      releaseSha: releaseIdentity.release_sha,
      previousReleaseId: previousCanaryReleaseId || previousGeneralReleaseId,
      runId: effectiveRunId,
      holderId: effectiveHolderId,
      trackingIssueNumber: resolvedTracking.tracking_issue_number,
      at: nowIsoFn(),
    });

    const stagedController = normalizeControllerState({
      ...currentController,
      status: "canary_in_progress",
      stage: "canary",
      channel: "canary",
      pinned_release_id: "",
      resume_blocked: false,
      rollback_reason: "",
      canary_factory_ids: selectedCanaryFactoryIds,
      canary_max_factories: toPositiveInt(canaryMaxFactories, selectedCanaryFactoryIds.length || 1),
      previous_canary_release_id: previousCanaryReleaseId,
      previous_general_release_id: previousGeneralReleaseId,
      candidate_manifest_path: manifestPath,
      canary_manifest_path: trim(canaryManifestPath),
      general_manifest_path: trim(generalManifestPath),
      lease: leasePayload,
      updated_at: nowIsoFn(),
      events: appendReleaseRolloutEvent(currentController.events, startEvent),
    });

    candidateManifest = writeControllerState(candidateManifest, stagedController);
    writeReleaseManifestFile(manifestPath, candidateManifest);
    writeReleaseManifestFile(canaryManifestPath, candidateManifest);

    // @context:regression !critical rollout health polling must carry factory identity into
    // factory/tick projections; otherwise Postgres-backed readers fail closed with
    // "factoryId is required" and the controller wrongly rolls back healthy canaries.
    const health = await pollReleaseCanaryHealth({
      repo,
      repoPath,
      runsDir,
      lookbackHours,
      healthPolicy,
      factoryStatusFn: (args = {}) => factoryStatusFn({
        ...args,
        runsDir,
        context: {
          ...(args?.context || {}),
          factory_id: normalizedFactoryId,
        },
      }),
      tickStatusFn: (args = {}) => tickStatusFn({
        ...args,
        runsDir,
        context: {
          ...(args?.context || {}),
          factory_id: normalizedFactoryId,
        },
      }),
      outcomesFn,
      sleepFn,
      nowIsoFn,
    });

    candidateManifest = readReleaseManifestFile(manifestPath) || candidateManifest;
    const refreshedController = readControllerState(candidateManifest);

    if (!health.ok || !health.passed) {
      const rollbackReason = trim(health.reason || refreshedController.rollback_reason || "health_check_failed");
      const rollbackEvent = buildReleaseRolloutEvent({
        action: "rollback",
        channel: "canary",
        status: "rolled_back",
        reason: rollbackReason,
        releaseId: releaseIdentity.release_id,
        releaseTag: releaseIdentity.release_tag,
        releaseSha: releaseIdentity.release_sha,
        previousReleaseId: previousCanaryReleaseId || previousGeneralReleaseId,
        runId: effectiveRunId,
        holderId: effectiveHolderId,
        trackingIssueNumber: resolvedTracking.tracking_issue_number,
        at: nowIsoFn(),
      });

      const rolledBackController = normalizeControllerState({
        ...refreshedController,
        status: "rolled_back",
        stage: "rollback",
        channel: inferControllerChannel({
          channel: refreshedController.channel,
          status: refreshedController.status,
          stage: refreshedController.stage,
        }),
        resume_blocked: true,
        rollback_reason: rollbackReason,
        lease: leasePayload,
        updated_at: nowIsoFn(),
        health: {
          ...refreshedController.health,
          status: trim(health.verdict || "failed"),
          reason: rollbackReason,
          poll_count: toNonNegativeInt(health.poll_count, refreshedController.health.poll_count),
          last_checked_at: trim(health.snapshots?.[health.snapshots.length - 1]?.checked_at || nowIsoFn()),
          snapshots: Array.isArray(health.snapshots) ? health.snapshots : refreshedController.health.snapshots,
        },
        events: appendReleaseRolloutEvent(refreshedController.events, rollbackEvent),
      });

      candidateManifest = writeControllerState(candidateManifest, rolledBackController);
      writeReleaseManifestFile(manifestPath, candidateManifest);
      reconcileRolledBackChannelPins({
        releasesDir,
        canaryManifestPath,
        generalManifestPath,
        previousCanaryReleaseId,
        previousGeneralReleaseId,
        restoreChannelPinFn: restoreChannelPin,
      });

      let publishedManifest = normalizePublishedManifest(rolledBackController.publish);
      let publishTelemetryRecord = "";
      try {
        const publishResult = await publishManifestAssetAndRecord({
          manifest: candidateManifest,
          manifestPath,
          releaseIdentity,
          repo,
          runId: effectiveRunId,
          holderId: effectiveHolderId,
          trackingIssueNumber: resolvedTracking.tracking_issue_number,
          publishManifestAssetFn,
          releaseAssetGithubClient: resolvedReleaseAssetClient,
          nowIsoFn,
          readControllerStateFn: readControllerState,
          writeControllerStateFn: writeControllerState,
          appendReleaseRolloutEventFn: appendReleaseRolloutEvent,
          buildReleaseRolloutEventFn: buildReleaseRolloutEvent,
          renderReleaseRolloutEventFn: renderReleaseRolloutEvent,
        });
        candidateManifest = publishResult.manifest;
        writeReleaseManifestFile(manifestPath, candidateManifest);
        publishedManifest = publishResult.published_manifest;
        publishTelemetryRecord = publishResult.publish_telemetry_record;
      } catch (error) {
        releaseResult = {
          ok: false,
          decision: "blocked",
          reason: "release_asset_publish_failed",
          error: trim(error?.message || error),
          release_id: releaseIdentity.release_id,
          candidate_manifest_path: manifestPath,
          canary_manifest_path: trim(canaryManifestPath),
          general_manifest_path: trim(generalManifestPath),
          canary_factory_ids: rolledBackController.canary_factory_ids,
          health,
          lease: leasePayload,
          telemetry_record: renderReleaseRolloutEvent(rollbackEvent),
        };
        return releaseResult;
      }

      releaseResult = {
        ok: true,
        decision: "rolled_back",
        reason: rollbackReason,
        release_id: releaseIdentity.release_id,
        candidate_manifest_path: manifestPath,
        canary_manifest_path: trim(canaryManifestPath),
        general_manifest_path: trim(generalManifestPath),
        canary_factory_ids: rolledBackController.canary_factory_ids,
        published_manifest: publishedManifest,
        health,
        lease: leasePayload,
        telemetry_record: renderReleaseRolloutEvent(rollbackEvent),
        publish_telemetry_record: publishTelemetryRecord,
      };
      return releaseResult;
    }

    const annotated = await annotatePromotedManifestArtifacts({
      manifest: candidateManifest,
      releaseIdentity,
      manifestPath: manifestPath,
      postArtifactFeedbackFn,
      persistManifestFn: (nextManifest) => {
        writeReleaseManifestFile(manifestPath, nextManifest);
      },
    });

    if (!annotated.ok) {
      candidateManifest = annotated.manifest || candidateManifest;
      writeReleaseManifestFile(manifestPath, candidateManifest);
      releaseResult = {
        ok: false,
        decision: "blocked",
        reason: String(annotated.reason || "artifact_feedback_failed"),
        release_id: releaseIdentity.release_id,
        candidate_manifest_path: manifestPath,
        canary_manifest_path: trim(canaryManifestPath),
        general_manifest_path: trim(generalManifestPath),
        canary_factory_ids: refreshedController.canary_factory_ids,
        health,
        lease: leasePayload,
        failed_feedback: annotated.failed_feedback || null,
        feedback: Array.isArray(annotated.feedback) ? annotated.feedback : [],
      };
      return releaseResult;
    }

    candidateManifest = annotated.manifest;

    const promoteEvent = buildReleaseRolloutEvent({
      action: "promote",
      channel: "stable",
      status: "promoted",
      reason: "canary_health_passed",
      releaseId: releaseIdentity.release_id,
      releaseTag: releaseIdentity.release_tag,
      releaseSha: releaseIdentity.release_sha,
      previousReleaseId: previousGeneralReleaseId,
      runId: effectiveRunId,
      holderId: effectiveHolderId,
      trackingIssueNumber: resolvedTracking.tracking_issue_number,
      at: nowIsoFn(),
    });

    const promotedController = normalizeControllerState({
      ...refreshedController,
      status: "promoted",
      stage: "general",
      channel: "stable",
      pinned_release_id: releaseIdentity.release_id,
      resume_blocked: false,
      rollback_reason: "",
      lease: leasePayload,
      updated_at: nowIsoFn(),
      health: {
        ...refreshedController.health,
        status: trim(health.verdict || "passed"),
        reason: trim(health.reason || "health_check_passed"),
        poll_count: toNonNegativeInt(health.poll_count, refreshedController.health.poll_count),
        last_checked_at: trim(health.snapshots?.[health.snapshots.length - 1]?.checked_at || nowIsoFn()),
        snapshots: Array.isArray(health.snapshots) ? health.snapshots : refreshedController.health.snapshots,
      },
      events: appendReleaseRolloutEvent(refreshedController.events, promoteEvent),
    });

    candidateManifest = writeControllerState(candidateManifest, promotedController);
    writeReleaseManifestFile(manifestPath, candidateManifest);
    reconcilePromotedChannelPins({
      candidateManifest,
      canaryManifestPath,
      generalManifestPath,
      writeReleaseManifestFileFn: writeReleaseManifestFile,
    });

    let publishedManifest = normalizePublishedManifest(promotedController.publish);
    let publishTelemetryRecord = "";
    try {
      const publishResult = await publishManifestAssetAndRecord({
        manifest: candidateManifest,
        manifestPath,
        releaseIdentity,
        repo,
        runId: effectiveRunId,
        holderId: effectiveHolderId,
        trackingIssueNumber: resolvedTracking.tracking_issue_number,
        publishManifestAssetFn,
        releaseAssetGithubClient: resolvedReleaseAssetClient,
        nowIsoFn,
        readControllerStateFn: readControllerState,
        writeControllerStateFn: writeControllerState,
        appendReleaseRolloutEventFn: appendReleaseRolloutEvent,
        buildReleaseRolloutEventFn: buildReleaseRolloutEvent,
        renderReleaseRolloutEventFn: renderReleaseRolloutEvent,
      });
      candidateManifest = publishResult.manifest;
      writeReleaseManifestFile(manifestPath, candidateManifest);
      reconcilePromotedChannelPins({
        candidateManifest,
        canaryManifestPath,
        generalManifestPath,
        writeReleaseManifestFileFn: writeReleaseManifestFile,
      });
      publishedManifest = publishResult.published_manifest;
      publishTelemetryRecord = publishResult.publish_telemetry_record;
    } catch (error) {
      releaseResult = {
        ok: false,
        decision: "blocked",
        reason: "release_asset_publish_failed",
        error: trim(error?.message || error),
        release_id: releaseIdentity.release_id,
        candidate_manifest_path: manifestPath,
        canary_manifest_path: trim(canaryManifestPath),
        general_manifest_path: trim(generalManifestPath),
        canary_factory_ids: promotedController.canary_factory_ids,
        health,
        lease: leasePayload,
        feedback: annotated.feedback,
        telemetry_record: renderReleaseRolloutEvent(promoteEvent),
      };
      return releaseResult;
    }

    releaseResult = {
      ok: true,
      decision: "promoted",
      reason: "canary_health_passed",
      release_id: releaseIdentity.release_id,
      candidate_manifest_path: manifestPath,
      canary_manifest_path: trim(canaryManifestPath),
      general_manifest_path: trim(generalManifestPath),
      canary_factory_ids: promotedController.canary_factory_ids,
      published_manifest: publishedManifest,
      health,
      lease: leasePayload,
      feedback: annotated.feedback,
      telemetry_record: renderReleaseRolloutEvent(promoteEvent),
      publish_telemetry_record: publishTelemetryRecord,
    };
    return releaseResult;
  } finally {
    releaseLeaseFn({
      repo,
      trackingIssueNumber: resolvedTracking.tracking_issue_number,
      factoryId,
      leaseName,
      runId: effectiveRunId,
      holderId: effectiveHolderId,
      reason: releaseResult?.decision === "rolled_back"
        ? `rolled_back:${releaseResult.reason}`
        : (releaseResult?.decision === "promoted"
          ? "promoted"
          : (releaseResult?.decision === "blocked" ? `blocked:${releaseResult.reason}` : "released")),
    });
  }
}
