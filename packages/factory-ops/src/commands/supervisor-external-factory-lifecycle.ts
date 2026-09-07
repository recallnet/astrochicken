import {
  hostHealth,
  hostRestart,
  resolveHostPaths,
} from "./factory-host-lifecycle.ts";
import { ensureResumeReady } from "./factory-resume-gate.ts";
import {
  getCanonicalControlActiveAction,
  readCanonicalFactoryControlStateSync,
} from "../lib/canonical-control-state.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";

export const EXTERNAL_LIFECYCLE_REASON = Object.freeze({
  MANIFEST_AMBIGUOUS: "manifest_ambiguous",
  ROLLOUT_BLOCKED: "rollout_blocked",
  VERIFICATION_FAILED: "verification_failed",
  SELF_UPDATE_FAILED: "self_update_failed",
  HOST_RESTART_FAILED: "host_restart_failed",
  HOST_HEALTH_FAILED: "host_health_failed",
  OPERATOR_PAUSED: "operator_paused",
  OPERATOR_QUARANTINED: "operator_quarantined",
  READY_TO_RESUME: "ready_to_resume",
  REJECTED_UPSTREAM: "rejected_upstream",
});

export const LIFECYCLE_STATES = Object.freeze([
  "waiting_for_release",
  "ready_to_resume",
  "rejected_upstream",
  "restart_failed",
]);

export const LIFECYCLE_STATE = Object.freeze({
  WAITING_FOR_RELEASE: LIFECYCLE_STATES[0],
  READY_TO_RESUME: LIFECYCLE_STATES[1],
  REJECTED_UPSTREAM: LIFECYCLE_STATES[2],
  RESTART_FAILED: LIFECYCLE_STATES[3],
});

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = trim(value).toLowerCase();
  if (!normalized) return fallback;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function asIssueNumber(value) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBlockedItems(raw = "") {
  if (Array.isArray(raw)) return raw;
  const parsed = parseJson(trim(raw), []);
  return Array.isArray(parsed) ? parsed : [];
}

function pickBlockedIssueNumber(blockedItems = []) {
  for (const item of blockedItems) {
    const issueNumber = asIssueNumber(item?.issue_number ?? item?.issueNumber ?? item?.number);
    if (issueNumber > 0) return issueNumber;
  }
  return 0;
}

function pickBlockedMilestone(blockedItems = []) {
  for (const item of blockedItems) {
    const milestone = trim(item?.milestone ?? item?.milestone_title ?? item?.milestoneTitle);
    if (milestone) return milestone;
  }
  return "";
}

function reasonFromResumeGate(gate = {}) {
  const gateReason = trim(gate?.reason || gate?.resume_reason);
  if (gateReason === EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM) {
    return EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM;
  }
  const rolloutReason = trim(gate?.rollout_gate?.reason || "");
  const mergedReason = rolloutReason || gateReason;

  if (["release_rollout_blocked", "release_not_promoted_to_general", "release_not_selected_for_canary"].includes(mergedReason)) {
    return EXTERNAL_LIFECYCLE_REASON.ROLLOUT_BLOCKED;
  }

  if (gate?.attempted_self_update && gate?.self_update_ok === false) {
    return EXTERNAL_LIFECYCLE_REASON.SELF_UPDATE_FAILED;
  }

  if ([
    "manifest_schema_mismatch",
    "manifest_fetch_failed",
    "manifest_fetch_command_failed",
    "manifest_fetch_command_invalid_json",
    "manifest_invalid_json",
    "missing_manifest_locator",
    "missing_manifest_entry",
  ].includes(mergedReason)) {
    return EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS;
  }

  if (gate?.can_resume === true) return EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME;
  return EXTERNAL_LIFECYCLE_REASON.VERIFICATION_FAILED;
}

function reasonFromControlAction(action = "") {
  if (action === "pause") return EXTERNAL_LIFECYCLE_REASON.OPERATOR_PAUSED;
  if (action === "quarantine") return EXTERNAL_LIFECYCLE_REASON.OPERATOR_QUARANTINED;
  return "";
}

function readOperatorControlAction({ factoryId = "", rootDir = process.cwd(), readExternalFactoryControlStateFn = readCanonicalFactoryControlStateSync } = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId || typeof readExternalFactoryControlStateFn !== "function") {
    return { action: "", reason: "", retry_target: "", state_path: "" };
  }

  try {
    const state = readExternalFactoryControlStateFn({ factoryId: normalizedFactoryId, rootDir });
    return {
      action: getCanonicalControlActiveAction(state),
      reason: trim(state?.reason || ""),
      retry_target: trim(state?.retry_target || ""),
      state_path: trim(state?.state_path || ""),
    };
  } catch {
    return { action: "", reason: "", retry_target: "", state_path: "" };
  }
}

function lifecycleStateFromReason(reason = "") {
  if (reason === EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME) return LIFECYCLE_STATE.READY_TO_RESUME;
  if (reason === EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM) return LIFECYCLE_STATE.REJECTED_UPSTREAM;
  if (reason === EXTERNAL_LIFECYCLE_REASON.HOST_RESTART_FAILED || reason === EXTERNAL_LIFECYCLE_REASON.HOST_HEALTH_FAILED) {
    return LIFECYCLE_STATE.RESTART_FAILED;
  }
  return LIFECYCLE_STATE.WAITING_FOR_RELEASE;
}

function buildManifestId(gate = {}) {
  return trim(
    gate?.manifest_release?.tag
      || gate?.manifest_release?.sha
      || gate?.manifest_release?.release_id
      || gate?.manifest_fetch?.manifest_ref
      || gate?.manifest_fetch?.manifest_path,
  );
}

function buildVersion(gate = {}) {
  return trim(
    gate?.local_factory_release_after
      || gate?.local_factory_release
      || gate?.local_factory_release_before,
  );
}

function resolveDaemonScriptPath(factoryRoot = "", daemonScript = "") {
  const explicit = trim(daemonScript);
  if (explicit) return explicit;
  // Keep the .sh interface stable: scripts/factory-daemon.sh is now a thin wrapper
  // that execs the Node daemon implementation at packages/factory-ops/src/lib/daemon.ts.
  return "scripts/factory-daemon.sh";
}

function buildHostDaemonEnv(factoryId = "", paths = {}) {
  return {
    HATCH_FACTORY_ID: factoryId,
    HATCH_RUNS_DIR: paths.runsDir,
    HATCH_HOST_BASE_DIR: paths.baseDir,
    FACTORY_DAEMON_LOG_DIR: paths.logsDir,
    FACTORY_DAEMON_PID_DIR: paths.pidDir,
    FACTORY_DAEMON_PID_FILE: paths.pidFile,
    FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
    FACTORY_DAEMON_TMP_DIR: paths.tmpDir,
    FACTORY_DAEMON_SOCKET_DIR: paths.socketDir,
  };
}

function buildBaseResult({
  resumeAllowed = false,
  reason = EXTERNAL_LIFECYCLE_REASON.VERIFICATION_FAILED,
  factoryId = "",
  sourceRepo = "",
  sourceIssueNumber = 0,
  milestoneTitle = "",
  requireRestart = false,
  gate = {},
  blockedItems = [],
  extra = {},
} = {}) {
  const manifestId = buildManifestId(gate);
  const rolloutTag = trim(gate?.manifest_release?.tag || "");
  const version = buildVersion(gate);
  const lifecycleState = lifecycleStateFromReason(reason);
  const nowIso = new Date().toISOString();

  const resumeMetadata = resumeAllowed
    ? {
      version,
      manifest_id: manifestId,
      rollout_tag: rolloutTag,
      resume_allowed_at: nowIso,
    }
    : {};

  return {
    ok: resumeAllowed,
    resume_allowed: resumeAllowed,
    lifecycle_state: lifecycleState,
    reason,
    reason_code: reason,
    factory_id: trim(factoryId),
    source_repo: trim(sourceRepo),
    source_issue_number: Number(sourceIssueNumber) || 0,
    milestone_title: trim(milestoneTitle),
    require_restart: Boolean(requireRestart),
    manifest_id: manifestId,
    rollout_tag: rolloutTag,
    version,
    blocked_item_count: Array.isArray(blockedItems) ? blockedItems.length : 0,
    resume_metadata: resumeMetadata,
    rollout: gate?.rollout_gate || {},
    manifest_release: gate?.manifest_release || {},
    gate_metadata: {
      attempted_self_update: Boolean(gate?.attempted_self_update),
      self_update_ok: gate?.self_update_ok === true,
      selected_channel: trim(gate?.selected_channel || ""),
      mode: trim(gate?.mode || ""),
    },
    ...extra,
  };
}

export async function runExternalFactoryLifecycleGate({
  controlPlaneRepo = "",
  sourceRepo = "",
  sourceIssueNumber = 0,
  issueNumber = 0,
  blockedItems = "[]",
  milestoneTitle = "",
  rolloutChannel = "",
  policyPath = "",
  policyJson = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCommand = "",
  localFactoryRelease = "",
  localFactoryReleaseCommand = "",
  selfUpdateCommand = "",
  requireRestart = false,
  factoryId = "",
  factoryRoot = "",
  hostBaseDir = "",
  logsRoot = "",
  runsDir = "",
  tmpDir = "",
  socketDir = "",
  pidDir = "",
  daemonScript = "",
  detach = true,
  signal = "TERM",
  timeoutMs = 5000,
  controlStateRootDir = process.cwd(),
  ensureResumeReadyFn = ensureResumeReady,
  resolveHostPathsFn = resolveHostPaths,
  hostRestartFn = hostRestart,
  hostHealthFn = hostHealth,
  readExternalFactoryControlStateFn = readCanonicalFactoryControlStateSync,
} = {}) {
  const blocked = normalizeBlockedItems(blockedItems);
  const resolvedIssueNumber = asIssueNumber(sourceIssueNumber)
    || asIssueNumber(issueNumber)
    || pickBlockedIssueNumber(blocked);
  const resolvedMilestoneTitle = trim(milestoneTitle) || pickBlockedMilestone(blocked);
  const normalizedSourceRepo = trim(sourceRepo);
  const normalizedIntentsRepo = trim(controlPlaneRepo);
  const restartRequired = asBool(requireRestart, false);
  const operatorControl = readOperatorControlAction({
    factoryId,
    rootDir: controlStateRootDir,
    readExternalFactoryControlStateFn,
  });
  const operatorReason = reasonFromControlAction(operatorControl.action);

  if (operatorReason) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: operatorReason,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: restartRequired,
      gate: {},
      blockedItems: blocked,
      extra: {
        lifecycle_note: "operator_control_state_active",
        control_state: operatorControl,
      },
    });
  }

  if (!resolvedIssueNumber && blocked.length === 0) {
    return buildBaseResult({
      resumeAllowed: true,
      reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: 0,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: restartRequired,
      gate: {},
      blockedItems: blocked,
      extra: {
        lifecycle_note: "no_blocked_external_issue",
      },
    });
  }

  if (!normalizedIntentsRepo || !normalizedSourceRepo || !resolvedIssueNumber) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: restartRequired,
      gate: {},
      blockedItems: blocked,
      extra: {
        lifecycle_note: "missing_lifecycle_locator",
      },
    });
  }

  const gate = await Promise.resolve(ensureResumeReadyFn({
    controlPlaneRepo: normalizedIntentsRepo,
    sourceRepo: normalizedSourceRepo,
    sourceIssueNumber: resolvedIssueNumber,
    milestoneTitle: resolvedMilestoneTitle,
    rolloutChannel,
    policyPath,
    policyJson,
    manifestPath,
    manifestRef,
    manifestFetchCommand,
    localFactoryRelease,
    localFactoryReleaseCommand,
    selfUpdateCommand,
  }));

  if (!gate || gate.can_resume !== true) {
    const gateStatus = trim(gate?.status || gate?.manifest_entry_status || "").toLowerCase();
    if (gateStatus === "rejected" || gateStatus === "superseded" || trim(gate?.reason) === EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM) {
      const blockerRef = trim(gate?.blockerRef || gate?.blocker_ref || "");
      const status = gateStatus || trim(gate?.status || "rejected").toLowerCase();
      return buildBaseResult({
        resumeAllowed: false,
        reason: EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM,
        factoryId,
        sourceRepo: normalizedSourceRepo,
        sourceIssueNumber: resolvedIssueNumber,
        milestoneTitle: resolvedMilestoneTitle,
        requireRestart: restartRequired,
        gate: gate || {},
        blockedItems: blocked,
        extra: {
          issueNumber: resolvedIssueNumber,
          blockerRef,
          status,
        },
      });
    }

    const reason = reasonFromResumeGate(gate || {});
    return buildBaseResult({
      resumeAllowed: false,
      reason,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: restartRequired,
      gate: gate || {},
      blockedItems: blocked,
    });
  }

  if (!restartRequired) {
    return buildBaseResult({
      resumeAllowed: true,
      reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: false,
      gate,
      blockedItems: blocked,
    });
  }

  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.HOST_RESTART_FAILED,
      factoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: true,
      gate,
      blockedItems: blocked,
      extra: {
        restart: {
          ok: false,
          status: "factory_id_required",
          message: "factory_id_required",
        },
      },
    });
  }

  let paths;
  try {
    paths = resolveHostPathsFn({
      factoryId: normalizedFactoryId,
      baseDir: hostBaseDir,
      logsRoot,
      runsDir,
      tmpDir,
      socketDir,
      pidDir,
    });
  } catch (error) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.HOST_RESTART_FAILED,
      factoryId: normalizedFactoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: true,
      gate,
      blockedItems: blocked,
      extra: {
        restart: {
          ok: false,
          status: "host_path_resolution_failed",
          message: String(error?.message || error || "host_path_resolution_failed"),
        },
      },
    });
  }

  const restart = await Promise.resolve(hostRestartFn({
    factoryId: normalizedFactoryId,
    daemonScript: resolveDaemonScriptPath(factoryRoot, daemonScript),
    env: buildHostDaemonEnv(normalizedFactoryId, paths),
    detach: asBool(detach, true),
    pidFile: paths.pidFile,
    signal,
    timeoutMs: Number(timeoutMs) || 5000,
    paths,
  }));

  if (!restart?.ok) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.HOST_RESTART_FAILED,
      factoryId: normalizedFactoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: true,
      gate,
      blockedItems: blocked,
      extra: {
        restart,
      },
    });
  }

  const health = await Promise.resolve(hostHealthFn({
    factoryId: normalizedFactoryId,
    pidFile: paths.pidFile,
    runsDir: paths.runsDir,
    logsDir: paths.logsDir,
    paths,
  }));

  if (!health?.ok || health?.running !== true) {
    return buildBaseResult({
      resumeAllowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.HOST_HEALTH_FAILED,
      factoryId: normalizedFactoryId,
      sourceRepo: normalizedSourceRepo,
      sourceIssueNumber: resolvedIssueNumber,
      milestoneTitle: resolvedMilestoneTitle,
      requireRestart: true,
      gate,
      blockedItems: blocked,
      extra: {
        restart,
        health,
      },
    });
  }

  return buildBaseResult({
    resumeAllowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
    factoryId: normalizedFactoryId,
    sourceRepo: normalizedSourceRepo,
    sourceIssueNumber: resolvedIssueNumber,
    milestoneTitle: resolvedMilestoneTitle,
    requireRestart: true,
    gate,
    blockedItems: blocked,
    extra: {
      restart,
      health,
    },
  });
}
