import { trim } from "./cli-helpers.ts";

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

function normalizeReleaseId(value = "") {
  const base = trim(value || "unversioned") || "unversioned";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "unversioned";
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

function readControllerState(manifest = {}) {
  const rollout = manifest?.rollout && typeof manifest.rollout === "object" ? manifest.rollout : {};
  const controller = rollout?.controller && typeof rollout.controller === "object" ? rollout.controller : {};
  return {
    status: trim(controller.status || ""),
    stage: trim(controller.stage || ""),
    channel: trim(controller.channel || ""),
    pinned_release_id: trim(controller.pinned_release_id || ""),
    rollback_reason: trim(controller.rollback_reason || ""),
    resume_blocked: normalizeBool(controller.resume_blocked, false),
    canary_factory_ids: normalizeStringArray(controller.canary_factory_ids),
  };
}

export function resolveReleaseIdentity(manifest = {}) {
  const tag = trim(manifest?.release?.tag || "");
  const sha = trim(manifest?.release?.sha || "");
  const releaseId = normalizeReleaseId(tag || sha || "unversioned");
  return {
    release_id: releaseId,
    release_tag: tag,
    release_sha: sha,
  };
}

export function evaluateManifestRolloutGate({ manifest = {}, manifestEntry = null, rolloutChannel = "stable" } = {}) {
  const controller = readControllerState(manifest);
  const status = trim(controller.status || "");
  const channel = normalizeRolloutChannel(rolloutChannel, "stable");
  const controllerChannel = normalizeRolloutChannel(
    controller.channel || inferControllerChannel({ status, stage: controller.stage }),
    "stable",
  );
  const factoryId = trim(manifestEntry?.factory_id || manifestEntry?.linkage?.factory_id || "");
  const releaseId = resolveReleaseIdentity(manifest).release_id;
  const pinnedReleaseId = trim(controller.pinned_release_id || "");

  if (!status && controller.resume_blocked !== true) {
    return {
      ok: true,
      allowed: true,
      reason: "rollout_unmanaged",
      rollout_status: status,
      rollout_channel: channel,
      controller_channel: controllerChannel,
      pinned_release_id: pinnedReleaseId,
      release_id: releaseId,
      resume_blocked: false,
      canary_factory_ids: [],
      selected_for_canary: true,
    };
  }

  if (controller.resume_blocked || status === "rolled_back" || status === "blocked") {
    return {
      ok: true,
      allowed: false,
      reason: "release_rollout_blocked",
      rollout_status: status || "blocked",
      rollout_channel: channel,
      controller_channel: controllerChannel,
      pinned_release_id: pinnedReleaseId,
      release_id: releaseId,
      rollback_reason: trim(controller.rollback_reason || ""),
      resume_blocked: true,
      canary_factory_ids: controller.canary_factory_ids,
      selected_for_canary: false,
    };
  }

  if (channel === "pinned") {
    const requestedPinnedReleaseId = trim(
      manifestEntry?.required_factory_release
        || manifestEntry?.linkage?.required_factory_release
        || "",
    );
    const requiredPinnedReleaseId = trim(requestedPinnedReleaseId || pinnedReleaseId || releaseId);
    const pinMatches = pinnedReleaseMatches({
      requiredPinnedReleaseId,
      releaseId,
    });
    return {
      ok: true,
      allowed: pinMatches,
      reason: pinMatches ? "release_pinned" : "release_not_pinned_match",
      rollout_status: status,
      rollout_channel: channel,
      controller_channel: controllerChannel,
      pinned_release_id: requiredPinnedReleaseId,
      release_id: releaseId,
      resume_blocked: false,
      canary_factory_ids: controller.canary_factory_ids,
      selected_for_canary: false,
    };
  }

  if (channel !== "canary" && status === "canary_in_progress") {
    return {
      ok: true,
      allowed: false,
      reason: "release_not_promoted_to_general",
      rollout_status: status,
      rollout_channel: channel,
      controller_channel: controllerChannel,
      pinned_release_id: pinnedReleaseId,
      release_id: releaseId,
      resume_blocked: false,
      canary_factory_ids: controller.canary_factory_ids,
      selected_for_canary: false,
    };
  }

  if (channel === "canary" && controller.canary_factory_ids.length > 0) {
    const selected = controller.canary_factory_ids.includes(factoryId);
    if (!selected) {
      return {
        ok: true,
        allowed: false,
        reason: "release_not_selected_for_canary",
        rollout_status: status || "canary_in_progress",
        rollout_channel: channel,
        controller_channel: controllerChannel,
        pinned_release_id: pinnedReleaseId,
        release_id: releaseId,
        resume_blocked: false,
        canary_factory_ids: controller.canary_factory_ids,
        selected_for_canary: false,
      };
    }
  }

  return {
    ok: true,
    allowed: true,
    reason: status === "promoted" ? "release_promoted" : "release_selected_for_canary",
    rollout_status: status,
    rollout_channel: channel,
    controller_channel: controllerChannel,
    pinned_release_id: pinnedReleaseId,
    release_id: releaseId,
    resume_blocked: false,
    canary_factory_ids: controller.canary_factory_ids,
    selected_for_canary: true,
  };
}
