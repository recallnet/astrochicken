import { join } from "node:path";

import { trim } from "../lib/cli-helpers.ts";

export function resolveManagedRecoverySweepScope({ config = {}, cwd = process.cwd(), env = process.env } = {}) {
  const workspaceMode = trim(config?.workspace_mode || "").toLowerCase();
  const isManaged = config?.managed === true;
  if (workspaceMode === "api_only") {
    return {
      repoPath: "",
      skipWorktreeScan: true,
    };
  }

  const contextRepoPath = trim(env?.FACTORY_CONTEXT_REPO_PATH || "");
  if (contextRepoPath) {
    return {
      repoPath: contextRepoPath,
      skipWorktreeScan: isManaged,
    };
  }

  const workDir = trim(config?.work_dir || "");
  if (workDir) {
    return {
      repoPath: workDir.startsWith("/") ? workDir : join(cwd, workDir),
      skipWorktreeScan: isManaged,
    };
  }

  return {
    repoPath: cwd,
    skipWorktreeScan: isManaged,
  };
}

function collectResolutionText(item = {}) {
  const possibleResolutions = Array.isArray(item?.possible_resolutions) ? item.possible_resolutions : [];
  return possibleResolutions
    .map((entry) => {
      if (!entry || typeof entry !== "object") return String(entry || "");
      return `${String(entry.when || "")} ${String(entry.resolution || "")}`;
    })
    .join("\n");
}

export function determineOwnershipDecision(item = {}, { targetRepo = "", controlPlaneRepo = "" } = {}) {
  const problem = String(item?.problem || "");
  const remediationPolicy = String(item?.diagnostics?.remediation_policy || "").toUpperCase();
  const suggestedAction = String(item?.suggested_action || "");
  const resolutionText = collectResolutionText(item);
  const rawRemediationPacket = item?.remediation_packet;
  const remediationPacket = rawRemediationPacket && typeof rawRemediationPacket === "object"
    ? rawRemediationPacket
    : null;
  const executionCommands = Array.isArray(remediationPacket?.execution_commands)
    ? remediationPacket.execution_commands.map((cmd) => String(cmd || "")).join("\n")
    : "";

  const normalizedTargetRepo = trim(targetRepo).toLowerCase();
  const normalizedControlPlaneRepo = trim(controlPlaneRepo).toLowerCase();
  const hasRemoteRepoContext = normalizedTargetRepo
    && normalizedControlPlaneRepo
    && normalizedTargetRepo !== normalizedControlPlaneRepo;

  const isCliRuntimeCrash = /^CLI_RUNTIME_CRASH:/i.test(problem);
  const remoteCliRuntimeCrash = isCliRuntimeCrash && (
    remediationPolicy === "REMOTE_FACTORY_ESCALATE_AND_SUBSCRIBE"
    || /\bremote_factory\b/i.test(resolutionText)
    || /\bcontrol[_ -]?plane\b/i.test(resolutionText)
    || (hasRemoteRepoContext && /supervisor\s+emit-bug/i.test(suggestedAction))
  );

  if (remoteCliRuntimeCrash) {
    return {
      decision: "control_plane",
      reason: "remote CLI runtime crash is owned by control plane escalation path",
    };
  }

  const packetType = String(remediationPacket?.packet_type || "");
  if (packetType === "remote_cli_runtime_crash") {
    return {
      decision: "control_plane",
      reason: "remote_cli_runtime_crash packet is a control-plane takeover contract",
    };
  }
  if (packetType === "local_cli_runtime_crash") {
    return {
      decision: "local_fix",
      reason: "local_cli_runtime_crash packet requires local in-repo repair",
    };
  }
  const waitSignalSource = [suggestedAction, executionCommands]
    .filter(Boolean)
    .join("\n");
  const explicitWaitSignal = /\b(defer(?:red)?|wait(?:ing)?)\b/i.test(waitSignalSource);
  const explicitCooldownSignal = /\bcooldown\b/i.test(waitSignalSource);
  const unscheduledWaveRequeue = packetType === "unscheduled_wave_requeue";
  if (explicitWaitSignal || (explicitCooldownSignal && !unscheduledWaveRequeue)) {
    return {
      decision: "wait",
      reason: "action item explicitly requests defer/wait/cooldown handling",
    };
  }

  const requiresRepoFix = remediationPacket?.requiresRepoFix === true || remediationPacket?.requires_repo_fix === true;
  if (requiresRepoFix) {
    return {
      decision: "local_fix",
      reason: "remediation packet requires an in-repo code fix",
    };
  }

  if (remediationPolicy === "LOCAL_FACTORY_IMMEDIATE_FIX") {
    return {
      decision: "local_fix",
      reason: "remediation policy marks this incident as local factory ownership",
    };
  }

  return {
    decision: "local_fix",
    reason: "default local ownership when no explicit escalation or wait signal is present",
  };
}

export function addActionItem(actionItems = [], item = {}, { targetRepo = "", controlPlaneRepo = "" } = {}) {
  const ownership = determineOwnershipDecision(item, { targetRepo, controlPlaneRepo });
  actionItems.push({
    ...item,
    ownership_decision: String(ownership?.decision || "local_fix"),
    ownership_reason: String(ownership?.reason || "default local ownership"),
  });
}
