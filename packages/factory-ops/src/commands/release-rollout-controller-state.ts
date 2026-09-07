import { readFile } from "node:fs/promises";

import { trim } from "../lib/cli-helpers.ts";
import {
  normalizeReleaseRolloutEvent,
  validateReleaseRolloutCloudEvent,
} from "../lib/release-rollout-asyncapi-contract.ts";


export function normalizePublishedManifest(value = {}) {
  const published = value && typeof value === "object" ? value : {};
  return {
    release_id: trim(published.release_id || ""),
    release_tag: trim(published.release_tag || ""),
    release_sha: trim(published.release_sha || ""),
    asset_id: trim(published.asset_id || ""),
    asset_url: trim(published.asset_url || ""),
    manifest_path: trim(published.manifest_path || ""),
    published_at: trim(published.published_at || ""),
  };
}

export function latestTelemetryRecord({ controller = {}, renderEventFn } = {}) {
  const events = Array.isArray(controller?.events) ? controller.events : [];
  const latest = events.length > 0 ? events[events.length - 1] : null;
  if (!latest || typeof renderEventFn !== "function") return "";
  return renderEventFn(latest);
}

export function reconcilePromotedChannelPins({
  candidateManifest = {},
  canaryManifestPath = "",
  generalManifestPath = "",
  writeReleaseManifestFileFn,
} = {}) {
  if (typeof writeReleaseManifestFileFn !== "function") throw new Error("missing_write_release_manifest_file_fn");
  writeReleaseManifestFileFn(canaryManifestPath, candidateManifest);
  writeReleaseManifestFileFn(generalManifestPath, candidateManifest);
  return {
    canary_manifest_path: trim(canaryManifestPath),
    general_manifest_path: trim(generalManifestPath),
  };
}

export function reconcileRolledBackChannelPins({
  releasesDir = ".hatch/releases",
  canaryManifestPath = "",
  generalManifestPath = "",
  previousCanaryReleaseId = "",
  previousGeneralReleaseId = "",
  restoreChannelPinFn,
} = {}) {
  if (typeof restoreChannelPinFn !== "function") throw new Error("missing_restore_channel_pin_fn");
  restoreChannelPinFn({
    channelManifestPath: canaryManifestPath,
    previousReleaseId: previousCanaryReleaseId,
    releasesDir,
  });
  restoreChannelPinFn({
    channelManifestPath: generalManifestPath,
    previousReleaseId: previousGeneralReleaseId,
    releasesDir,
  });
  return {
    canary_manifest_path: trim(canaryManifestPath),
    general_manifest_path: trim(generalManifestPath),
  };
}

export function buildReconciledControllerState({
  manifest = {},
  controller = {},
  status = "",
  stage = "",
  resumeBlocked = false,
  rollbackReason = "",
  lease = {},
  updatedAt = "",
  writeControllerStateFn,
} = {}) {
  if (typeof writeControllerStateFn !== "function") throw new Error("missing_write_controller_state_fn");
  return writeControllerStateFn(manifest, {
    ...controller,
    status,
    stage,
    resume_blocked: resumeBlocked,
    rollback_reason: rollbackReason,
    channel: controller.channel,
    pinned_release_id: controller.pinned_release_id,
    previous_canary_release_id: controller.previous_canary_release_id,
    previous_general_release_id: controller.previous_general_release_id,
    canary_factory_ids: controller.canary_factory_ids,
    canary_max_factories: controller.canary_max_factories,
    candidate_manifest_path: controller.candidate_manifest_path,
    canary_manifest_path: controller.canary_manifest_path,
    general_manifest_path: controller.general_manifest_path,
    health: controller.health,
    publish: controller.publish,
    events: controller.events,
    lease,
    updated_at: updatedAt,
  });
}

export async function readRolloutEventLog({
  manifestPath = "",
  manifestFetchCmd = "",
  manifestRef = "",
  controlPlaneRepo = "",
  rolloutChannel = "stable",
  fetchControlPlaneReleaseManifestFn = null,
} = {}) {
  const explicitManifestPath = trim(manifestPath);
  if (explicitManifestPath) {
    let raw;
    try {
      raw = await readFile(explicitManifestPath, "utf8");
    } catch (error) {
      throw new Error(`manifest not found at ${explicitManifestPath}: ${String(error?.message || error || "read_failed")}`);
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      throw new Error(`manifest JSON invalid at ${explicitManifestPath}: ${String(error?.message || error || "invalid_json")}`);
    }

    const events = manifest?.rollout?.controller?.events;
    return Array.isArray(events)
      ? events
        .map((event) => {
          const validated = validateReleaseRolloutCloudEvent(event);
          return validated.ok && validated.value ? validated.value.data : normalizeReleaseRolloutEvent(event);
        })
      : [];
  }

  const repo = trim(controlPlaneRepo);
  const fetchCmd = trim(manifestFetchCmd);
  if (!repo && !fetchCmd) {
    throw new Error("--control-plane-repo is required when --manifest-path and --manifest-fetch-cmd are omitted");
  }

  const fetchManifest = typeof fetchControlPlaneReleaseManifestFn === "function"
    ? fetchControlPlaneReleaseManifestFn
    : (await import("./factory-resume-gate.ts")).fetchControlPlaneReleaseManifest;

  const fetched = fetchManifest({
    controlPlaneRepo: repo,
    rolloutChannel: trim(rolloutChannel) || "stable",
    manifestRef: trim(manifestRef),
    manifestFetchCommand: fetchCmd,
  });

  if (!fetched?.ok) {
    const reason = trim(fetched?.reason || "manifest_fetch_failed") || "manifest_fetch_failed";
    const detail = trim(fetched?.error || "");
    throw new Error(detail ? `${reason}: ${detail}` : reason);
  }

  const events = fetched?.manifest?.rollout?.controller?.events;
  return Array.isArray(events)
    ? events
      .map((event) => {
        const validated = validateReleaseRolloutCloudEvent(event);
        return validated.ok && validated.value ? validated.value.data : normalizeReleaseRolloutEvent(event);
      })
    : [];
}

export async function publishManifestAssetAndRecord({
  manifest = {},
  manifestPath = "",
  releaseIdentity = {},
  repo = "",
  runId = "",
  holderId = "",
  trackingIssueNumber = "",
  publishManifestAssetFn,
  releaseAssetGithubClient = null,
  nowIsoFn = () => new Date().toISOString(),
  readControllerStateFn,
  writeControllerStateFn,
  appendReleaseRolloutEventFn,
  buildReleaseRolloutEventFn,
  renderReleaseRolloutEventFn,
} = {}) {
  if (typeof publishManifestAssetFn !== "function") throw new Error("missing_publish_manifest_asset_fn");
  if (typeof readControllerStateFn !== "function") throw new Error("missing_read_controller_state_fn");
  if (typeof writeControllerStateFn !== "function") throw new Error("missing_write_controller_state_fn");
  if (typeof appendReleaseRolloutEventFn !== "function") throw new Error("missing_append_release_rollout_event_fn");
  if (typeof buildReleaseRolloutEventFn !== "function") throw new Error("missing_build_release_rollout_event_fn");
  if (typeof renderReleaseRolloutEventFn !== "function") throw new Error("missing_render_release_rollout_event_fn");

  const published = await Promise.resolve(publishManifestAssetFn({
    manifestPath,
    releaseId: trim(releaseIdentity?.release_id || ""),
    releaseTag: trim(releaseIdentity?.release_tag || ""),
    releaseSha: trim(releaseIdentity?.release_sha || ""),
    githubClient: releaseAssetGithubClient,
    repo,
  }));

  const publishState = normalizePublishedManifest({
    ...published,
    published_at: nowIsoFn(),
  });

  const currentController = readControllerStateFn(manifest);
  const publishEvent = buildReleaseRolloutEventFn({
    action: "publish_manifest_asset",
    channel: "release",
    status: "published",
    reason: "control_plane_manifest_published",
    releaseId: trim(releaseIdentity?.release_id || ""),
    releaseTag: trim(releaseIdentity?.release_tag || ""),
    releaseSha: trim(releaseIdentity?.release_sha || ""),
    runId,
    holderId,
    trackingIssueNumber,
    assetId: publishState.asset_id,
    assetUrl: publishState.asset_url,
    manifestPath: publishState.manifest_path,
    at: nowIsoFn(),
  });

  const nextManifest = writeControllerStateFn(manifest, {
    ...currentController,
    publish: publishState,
    events: appendReleaseRolloutEventFn(currentController.events, publishEvent),
    updated_at: nowIsoFn(),
  });

  return {
    manifest: nextManifest,
    published_manifest: publishState,
    publish_telemetry_record: renderReleaseRolloutEventFn(publishEvent),
  };
}
