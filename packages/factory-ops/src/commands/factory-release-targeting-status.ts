import { spawnSync } from "node:child_process";

import { compareReleases } from "./artifact-linkage.ts";
import {
  loadResumePolicy,
  resolveRolloutChannel,
  resolvePinnedRequiredRelease,
  fetchControlPlaneReleaseManifest,
  evaluateManifestResumeGate,
} from "./factory-resume-gate.ts";
import { evaluateManifestRolloutGate, resolveReleaseIdentity } from "./release-rollout-controller.ts";
import { trim } from "../lib/cli-helpers.ts";
import { readFactoryRegistry } from "../lib/factory-fleet-projection-support.ts";
import { resolvePrimaryOpsRepo } from "../lib/factory-repo-identity.ts";


function normalizeStringMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = trim(key);
    const normalizedValue = trim(rawValue);
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function chooseHigherRelease(a = "", b = "") {
  const left = trim(a);
  const right = trim(b);
  if (!left) return right;
  if (!right) return left;
  return compareReleases(left, right) >= 0 ? left : right;
}

function derivePolicySource({ policyPath = "", policyJson = "" } = {}) {
  if (trim(policyJson)) return "inline_json";
  if (trim(policyPath)) return `file:${trim(policyPath)}`;
  return "default_empty";
}

function deriveControlPlaneRepo(policy = {}) {
  return trim(
    policy?.control_plane_repo
      || policy?.controlPlaneRepo
      || process.env.MOTHERSHIP_REPO
      || "",
  );
}

function resolvePolicyFactoryRelease({ policy = {}, factoryId = "", sourceRepo = "", milestoneTitle = "" } = {}) {
  const releases = policy?.factory_releases && typeof policy.factory_releases === "object"
    ? policy.factory_releases
    : {};

  const repo = trim(sourceRepo);
  const factory = trim(factoryId);
  const milestone = trim(milestoneTitle);
  const repoMilestoneKey = `${repo}#${milestone}`;

  const byFactory = normalizeStringMap(releases.by_factory);
  if (byFactory[factory]) return { value: byFactory[factory], source: "factory_release_by_factory" };

  const repoMilestone = normalizeStringMap(releases.repo_milestones);
  if (repoMilestone[repoMilestoneKey]) return { value: repoMilestone[repoMilestoneKey], source: "factory_release_repo_milestone" };

  const milestoneMap = normalizeStringMap(releases.milestones);
  if (milestoneMap[milestone]) return { value: milestoneMap[milestone], source: "factory_release_milestone" };

  const repos = normalizeStringMap(releases.repos);
  if (repos[repo]) return { value: repos[repo], source: "factory_release_repo" };

  const defaultRelease = trim(releases.default_release);
  if (defaultRelease) return { value: defaultRelease, source: "factory_release_default" };

  return { value: "", source: "none" };
}

function resolveFactoryRelease({
  policy = {},
  factoryId = "",
  sourceRepo = "",
  milestoneTitle = "",
  localReleaseCmdByFactory = {},
  spawnSyncFn = spawnSync,
} = {}) {
  const policyRelease = resolvePolicyFactoryRelease({
    policy,
    factoryId,
    sourceRepo,
    milestoneTitle,
  });

  const factory = trim(factoryId);
  const cmdMap = normalizeStringMap(localReleaseCmdByFactory);
  const localReleaseCmd = trim(cmdMap[factory]);
  if (!localReleaseCmd) {
    return {
      ...policyRelease,
      local_release_probe_attempted: false,
      local_release_probe_ok: false,
      local_release_probe_command: "",
    };
  }

  // `localReleaseCmdByFactory` is privileged operator-owned configuration.
  // It is not sourced from arbitrary end-user input.
  const probe = spawnSyncFn("bash", ["-lc", localReleaseCmd], { encoding: "utf8" });
  const probeOutput = trim(probe?.stdout || "");
  const probeOk = Number(probe?.status) === 0 && Boolean(probeOutput);
  if (probeOk) {
    return {
      value: probeOutput,
      source: "factory_release_local_cmd",
      local_release_probe_attempted: true,
      local_release_probe_ok: true,
      local_release_probe_command: localReleaseCmd,
      local_release_probe_error: trim(probe?.stderr || ""),
    };
  }

  return {
    ...policyRelease,
    local_release_probe_attempted: true,
    local_release_probe_ok: false,
    local_release_probe_command: localReleaseCmd,
    local_release_probe_error: trim(probe?.stderr || ""),
  };
}

function normalizeManifestFailureReason(reason = "") {
  return trim(reason) === "manifest_schema_mismatch" ? "manifest_schema_mismatch" : "manifest_fetch_failed";
}

function createSyntheticGateResult({ localFactoryRelease = "", requiredFactoryRelease = "" } = {}) {
  return {
    ok: true,
    can_resume: true,
    reason: "ready_to_resume",
    goal: {
      number: 0,
      state: "CLOSED",
      url: "",
      title: "",
    },
    local_factory_release: trim(localFactoryRelease),
    required_factory_release: trim(requiredFactoryRelease),
  };
}

function pickRepresentativeManifestEntry({ manifest = {}, sourceRepo = "", factoryId = "" } = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const repo = trim(sourceRepo);
  const factory = trim(factoryId);

  const candidates = artifacts.filter((entry) => (
    trim(entry?.source_repo) === repo
    || (factory && trim(entry?.factory_id || entry?.linkage?.factory_id) === factory)
  ));

  if (candidates.length === 0) return null;

  const ordered = [...candidates].sort((left, right) => {
    const releaseCmp = compareReleases(trim(right?.required_factory_release), trim(left?.required_factory_release));
    if (releaseCmp !== 0) return releaseCmp;
    const issueCmp = Number(left?.source_issue || 0) - Number(right?.source_issue || 0);
    if (issueCmp !== 0) return issueCmp;
    return trim(left?.source_repo).localeCompare(trim(right?.source_repo));
  });

  return ordered[0] || null;
}

function hasCompatibilityByFactoryEntry({ manifest = {}, factoryId = "" } = {}) {
  const byFactory = Array.isArray(manifest?.compatibility_matrix?.by_factory)
    ? manifest.compatibility_matrix.by_factory
    : [];
  const factory = trim(factoryId);
  return byFactory.some((entry) => trim(entry?.factory_id) === factory);
}

function deriveGateReasonDetail({ gateReason = "", requiredFactoryRelease = "", localFactoryRelease = "" } = {}) {
  const reason = trim(gateReason);
  const local = trim(localFactoryRelease) || "(unknown)";
  const required = trim(requiredFactoryRelease) || "(none)";

  const details = {
    ready_to_resume: "resume gate ready",
    release_promoted: "release promoted to general",
    release_selected_for_canary: "factory selected for canary",
    release_not_promoted_to_general: "waiting for general promotion",
    release_not_selected_for_canary: "factory not selected for canary",
    release_rollout_blocked: "release rollout currently blocked",
    linked_goal_open: "linked control-plane goal still open",
    missing_policy_entry: "missing policy/manifest targeting entry",
    missing_manifest_entry: "missing manifest entry for factory",
    missing_manifest_linkage: "manifest linkage missing for factory entry",
    invalid_manifest_linkage: "manifest linkage invalid for factory entry",
    manifest_fetch_failed: "manifest fetch failed",
    manifest_schema_mismatch: "manifest schema mismatch",
    factory_release_below_required: `factory release ${local} below required ${required}`,
  };

  return details[reason] || reason || "state_unknown";
}

function computeRolloutStatus({ gateAllowed = false, gateReason = "", releaseIdentity = {} } = {}) {
  const reason = trim(gateReason);
  const unknownReasons = new Set([
    "missing_policy_entry",
    "missing_manifest_entry",
    "missing_manifest_linkage",
    "invalid_manifest_linkage",
    "missing_source_reference",
  ]);

  if (reason === "factory_release_below_required") return "lagging";
  if (gateAllowed) return "ready";
  if (unknownReasons.has(reason)) return "unknown";
  if (reason === "manifest_fetch_failed" || reason === "manifest_schema_mismatch") {
    return trim(releaseIdentity?.release_id) ? "blocked" : "unknown";
  }
  if (!reason) return "unknown";
  return "blocked";
}

function computeUpgradeVerificationOutcome({
  localFactoryRelease = "",
  requiredFactoryRelease = "",
  localReleaseProbeOk = false,
} = {}) {
  const local = trim(localFactoryRelease);
  const required = trim(requiredFactoryRelease);
  if (!local) return "unknown";
  if (!required) return "passed";
  if (compareReleases(local, required) >= 0) return "passed";
  if (localReleaseProbeOk) return "failed";
  return "unknown";
}

function truncate(value = "", max = 72) {
  const text = trim(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeReleaseTargetingRow(row = {}) {
  const value = row && typeof row === "object" ? row : {};
  const releaseIdentity = value.release_identity && typeof value.release_identity === "object"
    ? value.release_identity
    : {};

  return {
    ...value,
    factory_id: trim(value.factory_id) || "unknown",
    rollout_channel: trim(value.rollout_channel) || "unknown",
    rollout_status: trim(value.rollout_status) || "unknown",
    gate_reason: trim(value.gate_reason) || "unknown",
    upgrade_verification_outcome: trim(value.upgrade_verification_outcome) || "unknown",
    required_factory_release: trim(value.required_factory_release),
    selected_for_canary: value.selected_for_canary === true,
    gate_allowed: value.gate_allowed === true,
    resume_blocked: value.resume_blocked === true,
    pin_source: trim(value.pin_source || "none") || "none",
    status_detail: trim(value.status_detail || value.gate_reason || "") || "unknown",
    release_identity: {
      release_id: trim(releaseIdentity.release_id),
      release_tag: trim(releaseIdentity.release_tag),
      release_sha: trim(releaseIdentity.release_sha),
    },
    local_factory_release: trim(value.local_factory_release),
    errors: Array.isArray(value.errors) ? value.errors.filter(Boolean) : [],
  };
}

function computeFleetTotals(rows = []) {
  const totals = {
    total_factories: rows.length,
    ready: 0,
    blocked: 0,
    lagging: 0,
    unknown: 0,
    canary_selected: 0,
    resume_blocked: 0,
    manifest_failures: 0,
  };

  for (const row of rows) {
    const status = trim(row?.rollout_status);
    if (Object.hasOwn(totals, status)) totals[status] += 1;
    if (row?.selected_for_canary === true && trim(row?.rollout_channel) === "canary") totals.canary_selected += 1;
    if (row?.resume_blocked === true) totals.resume_blocked += 1;
    if (["manifest_fetch_failed", "manifest_schema_mismatch"].includes(trim(row?.gate_reason))) {
      totals.manifest_failures += 1;
    }
  }

  return totals;
}

function buildRegistryMissingReport({ generatedAt = "", registryPath = "", policySource = "" } = {}) {
  return {
    generated_at: generatedAt,
    registry_path: registryPath,
    policy_source: policySource,
    warnings: ["registry_missing"],
    fleet_totals: computeFleetTotals([]),
    factories: [],
  };
}

function buildFactoryRowFromManifestFailure({
  factory = {},
  rolloutChannel = "",
  pin = {},
  manifestFailure = {},
  release = {},
  identity = {},
} = {}) {
  const rawReason = trim(manifestFailure.reason || "manifest_fetch_failed") || "manifest_fetch_failed";
  const gateReason = normalizeManifestFailureReason(rawReason);
  const releaseIdentity = release?.identity || { release_id: "", release_tag: "", release_sha: "" };
  const errors = [`manifest:${rawReason}`];

  const requiredFactoryRelease = trim(pin?.value || "");
  const targetRepo = trim(identity.target_repo || factory.target_repo || "");

  return normalizeReleaseTargetingRow({
    factory_id: trim(factory.factory_id) || "unknown",
    target_repo: targetRepo || null,
    rollout_channel: trim(rolloutChannel) || "general",
    release_identity: {
      release_id: trim(releaseIdentity.release_id),
      release_tag: trim(releaseIdentity.release_tag),
      release_sha: trim(releaseIdentity.release_sha),
    },
    local_factory_release: "",
    required_factory_release: requiredFactoryRelease,
    pin_source: trim(pin?.source || "none") || "none",
    gate_allowed: false,
    resume_blocked: true,
    selected_for_canary: false,
    rollout_status: computeRolloutStatus({ gateAllowed: false, gateReason, releaseIdentity }),
    upgrade_verification_outcome: computeUpgradeVerificationOutcome({
      localFactoryRelease: "",
      requiredFactoryRelease,
      localReleaseProbeOk: false,
    }),
    status_detail: deriveGateReasonDetail({ gateReason }),
    gate_reason: gateReason,
    errors,
  });
}

function buildFactoryRow({
  factory = {},
  policy = {},
  controlPlaneRepo = "",
  rolloutChannel = "",
  manifest = {},
  manifestIdentity = {},
  pin = {},
  localRelease = {},
  evaluateManifestResumeGateFn = evaluateManifestResumeGate,
  evaluateManifestRolloutGateFn = evaluateManifestRolloutGate,
} = {}) {
  const factoryId = trim(factory.factory_id) || "unknown";
  let identity;
  try {
    identity = resolvePrimaryOpsRepo({
      context: factory,
      factoryId,
      requireResolved: false,
    });
  } catch {
    identity = {
      target_repo: trim(factory.target_repo || ""),
    };
  }

  const targetRepo = trim(identity.target_repo || factory.target_repo || "");

  if (!targetRepo) {
    const missingTargetRepoRow = normalizeReleaseTargetingRow({
      factory_id: factoryId,
      target_repo: null,
      rollout_channel: trim(rolloutChannel) || "general",
      release_identity: {
        release_id: trim(manifestIdentity.release_id),
        release_tag: trim(manifestIdentity.release_tag),
        release_sha: trim(manifestIdentity.release_sha),
      },
      local_factory_release: "",
      required_factory_release: "",
      pin_source: trim(pin?.source || "none") || "none",
      gate_allowed: false,
      resume_blocked: false,
      selected_for_canary: false,
      rollout_status: "unknown",
      upgrade_verification_outcome: "unknown",
      status_detail: deriveGateReasonDetail({ gateReason: "missing_policy_entry" }),
      gate_reason: "missing_policy_entry",
      errors: ["missing_target_repo"],
    });
    missingTargetRepoRow.rollout_channel = "unknown";
    return missingTargetRepoRow;
  }

  const manifestEntry = pickRepresentativeManifestEntry({ manifest, sourceRepo: targetRepo, factoryId });
  const releaseLocal = trim(localRelease?.value);
  const resumeGate = evaluateManifestResumeGateFn({
    manifest,
    controlPlaneRepo,
    sourceRepo: targetRepo,
    sourceIssueNumber: Number(manifestEntry?.source_issue || 0),
    milestoneTitle: "",
    localFactoryRelease: releaseLocal,
    policy,
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => createSyntheticGateResult({
      localFactoryRelease,
      requiredFactoryRelease,
    }),
    checkResumeGateFromArtifactLinkFn: ({ localFactoryRelease, requiredFactoryRelease }) => createSyntheticGateResult({
      localFactoryRelease,
      requiredFactoryRelease,
    }),
  });

  const rolloutGate = evaluateManifestRolloutGateFn({
    manifest,
    manifestEntry: {
      ...(manifestEntry && typeof manifestEntry === "object" ? manifestEntry : {}),
      factory_id: trim(manifestEntry?.factory_id || manifestEntry?.linkage?.factory_id || factoryId),
      linkage: {
        ...(manifestEntry?.linkage && typeof manifestEntry.linkage === "object" ? manifestEntry.linkage : {}),
        factory_id: trim(manifestEntry?.linkage?.factory_id || manifestEntry?.factory_id || factoryId),
      },
    },
    rolloutChannel,
  });

  const hasPolicyCoverage = Boolean(
    manifestEntry
    || hasCompatibilityByFactoryEntry({ manifest, factoryId })
    || trim(pin?.value),
  );

  const requiredFactoryRelease = trim(resumeGate?.required_factory_release || pin?.value || "");
  const resumeReason = trim(resumeGate?.reason || "");
  const rolloutReason = trim(rolloutGate?.reason || "");

  const rolloutAllowed = Boolean(rolloutGate?.allowed);
  const gateAllowed = rolloutAllowed && Boolean(resumeGate?.can_resume);
  let gateReason = gateAllowed
    ? "ready_to_resume"
    : (rolloutAllowed ? (resumeReason || "missing_policy_entry") : (rolloutReason || "missing_policy_entry"));

  if (!hasPolicyCoverage && !gateAllowed) gateReason = "missing_policy_entry";

  const row = normalizeReleaseTargetingRow({
    factory_id: factoryId,
    target_repo: targetRepo,
    rollout_channel: trim(rolloutChannel) || "general",
    release_identity: {
      release_id: trim(manifestIdentity.release_id),
      release_tag: trim(manifestIdentity.release_tag),
      release_sha: trim(manifestIdentity.release_sha),
    },
    local_factory_release: releaseLocal,
    required_factory_release: requiredFactoryRelease,
    pin_source: trim(resumeGate?.pin_source || pin?.source || "none") || "none",
    gate_allowed: gateAllowed,
    resume_blocked: Boolean(rolloutGate?.resume_blocked),
    selected_for_canary: trim(rolloutChannel) === "canary" && Boolean(rolloutGate?.selected_for_canary),
    rollout_status: computeRolloutStatus({
      gateAllowed,
      gateReason,
      releaseIdentity: manifestIdentity,
    }),
    upgrade_verification_outcome: computeUpgradeVerificationOutcome({
      localFactoryRelease: releaseLocal,
      requiredFactoryRelease,
      localReleaseProbeOk: Boolean(localRelease?.local_release_probe_ok),
    }),
    status_detail: deriveGateReasonDetail({
      gateReason,
      requiredFactoryRelease,
      localFactoryRelease: releaseLocal,
    }),
    gate_reason: gateReason,
    errors: [],
  });

  if (!hasPolicyCoverage) row.errors.push("missing_policy_or_manifest_entry");
  if (trim(resumeGate?.reason) === "factory_release_below_required" && !releaseLocal) {
    row.errors.push("missing_factory_release_signal");
  }

  return row;
}

export function factoryReleaseTargetingStatus({
  registryPath = "factory-registry.json",
  policyPath = "",
  policyJson = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCmd = "",
  localReleaseCmdByFactory = {},
  now = Date.now(),
  readFactoryRegistryFn = readFactoryRegistry,
  loadResumePolicyFn = loadResumePolicy,
  resolveRolloutChannelFn = resolveRolloutChannel,
  resolvePinnedRequiredReleaseFn = resolvePinnedRequiredRelease,
  fetchControlPlaneReleaseManifestFn = fetchControlPlaneReleaseManifest,
  evaluateManifestResumeGateFn = evaluateManifestResumeGate,
  evaluateManifestRolloutGateFn = evaluateManifestRolloutGate,
  resolveReleaseIdentityFn = resolveReleaseIdentity,
  spawnSyncFn = spawnSync,
} = {}) {
  const generatedAt = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
  const policySource = derivePolicySource({ policyPath, policyJson });
  const policy = loadResumePolicyFn({ policyPath, policyJson });
  const controlPlaneRepo = deriveControlPlaneRepo(policy);
  const warnings = [];
  const policyLocalReleaseCmdByFactory = normalizeStringMap(policy?.localReleaseCmdByFactory);
  const cliLocalReleaseCmdByFactory = normalizeStringMap(localReleaseCmdByFactory);
  const effectiveLocalReleaseCmdByFactory = {
    ...policyLocalReleaseCmdByFactory,
    ...cliLocalReleaseCmdByFactory,
  };

  const registry = readFactoryRegistryFn({ registryPath, cwd: process.cwd() });
  if (!registry?.ok) {
    return {
      ...buildRegistryMissingReport({
        generatedAt,
        registryPath: registry?.registry_path || trim(registryPath),
        policySource,
      }),
      warnings: [
        trim(registry?.reason || "registry_missing"),
        trim(registry?.error || ""),
      ].filter(Boolean),
    };
  }

  const manifestByChannel = new Map();
  const fetchManifestSnapshot = (rolloutChannel = "general") => {
    const channel = trim(rolloutChannel) || "general";
    if (manifestByChannel.has(channel)) return manifestByChannel.get(channel);

    const fetched = fetchControlPlaneReleaseManifestFn({
      controlPlaneRepo,
      rolloutChannel: channel,
      manifestPath,
      manifestRef,
      manifestFetchCommand: manifestFetchCmd,
      policy,
    });

    if (!fetched?.ok) {
      const failed = {
        ok: false,
        reason: trim(fetched?.reason || "manifest_fetch_failed") || "manifest_fetch_failed",
        error: trim(fetched?.error || ""),
      };
      manifestByChannel.set(channel, failed);
      return failed;
    }

    const manifest = fetched.manifest && typeof fetched.manifest === "object" ? fetched.manifest : {};
    const identity = resolveReleaseIdentityFn(manifest);
    const snapshot = {
      ok: true,
      manifest,
      identity,
      source: trim(fetched.source),
      manifest_ref: trim(fetched.manifest_ref),
      manifest_path: trim(fetched.manifest_path),
    };
    manifestByChannel.set(channel, snapshot);
    return snapshot;
  };

  const rows = [];

  for (const entry of (Array.isArray(registry.factories) ? registry.factories : [])) {
    const factory = entry && typeof entry === "object" ? entry : {};
    const factoryId = trim(factory.factory_id) || "unknown";
    let identity;
    try {
      identity = resolvePrimaryOpsRepo({
        context: factory,
        factoryId,
        requireResolved: false,
      });
    } catch {
      identity = {
        target_repo: trim(factory.target_repo || ""),
      };
    }
    const targetRepo = trim(identity.target_repo || factory.target_repo || "");

    const rolloutChannel = resolveRolloutChannelFn({
      policy,
      sourceRepo: targetRepo,
      milestoneTitle: "",
    });
    const pin = resolvePinnedRequiredReleaseFn({
      policy,
      sourceRepo: targetRepo,
      milestoneTitle: "",
    });
    const localRelease = resolveFactoryRelease({
      policy,
      factoryId,
      sourceRepo: targetRepo,
      milestoneTitle: "",
      localReleaseCmdByFactory: effectiveLocalReleaseCmdByFactory,
      spawnSyncFn,
    });

    const factoryWithIdentity = {
      ...factory,
      target_repo: targetRepo,
    };

    const manifestSnapshot = fetchManifestSnapshot(rolloutChannel);

    if (!manifestSnapshot.ok) {
      const row = normalizeReleaseTargetingRow(buildFactoryRowFromManifestFailure({
        factory: factoryWithIdentity,
        rolloutChannel,
        pin,
        manifestFailure: manifestSnapshot,
        identity,
      }));
      rows.push(row);
      warnings.push(`${factoryId}:${row.gate_reason}`);
      continue;
    }

    const row = normalizeReleaseTargetingRow(buildFactoryRow({
      factory: factoryWithIdentity,
      policy,
      controlPlaneRepo,
      rolloutChannel,
      manifest: manifestSnapshot.manifest,
      manifestIdentity: manifestSnapshot.identity,
      pin,
      localRelease,
      evaluateManifestResumeGateFn,
      evaluateManifestRolloutGateFn,
    }));

    if (row.errors.length > 0) warnings.push(`${factoryId}:${row.errors[0]}`);
    if (localRelease.local_release_probe_attempted && !localRelease.local_release_probe_ok) {
      warnings.push(`${factoryId}:local_release_probe_failed`);
    }
    rows.push(row);
  }

  rows.sort((left, right) => trim(left?.factory_id).localeCompare(trim(right?.factory_id)));
  const fleetTotals = computeFleetTotals(rows);

  return {
    generated_at: generatedAt,
    registry_path: trim(registry.registry_path) || trim(registryPath),
    policy_source: policySource,
    warnings,
    fleet_totals: fleetTotals,
    factories: rows,
  };
}

export function formatReleaseTargetingStatusHuman(report = {}) {
  const rows = Array.isArray(report?.factories) ? [...report.factories] : [];
  rows.sort((left, right) => trim(left?.factory_id).localeCompare(trim(right?.factory_id)));

  const totals = report?.fleet_totals && typeof report.fleet_totals === "object"
    ? report.fleet_totals
    : computeFleetTotals(rows);

  const lines = [];
  lines.push(
    `Fleet release targeting total=${totals.total_factories || 0} ready=${totals.ready || 0} blocked=${totals.blocked || 0} lagging=${totals.lagging || 0} unknown=${totals.unknown || 0} canary_selected=${totals.canary_selected || 0} resume_blocked=${totals.resume_blocked || 0}`,
  );

  for (const row of rows) {
    const release = trim(row?.release_identity?.release_tag)
      || trim(row?.release_identity?.release_id)
      || "(unknown)";
    const status = trim(row?.rollout_status) || "unknown";
    const indicator = status === "ready" ? " " : "!";
    const upgradeVerification = trim(row?.upgrade_verification_outcome) || "unknown";
    lines.push(
      `${indicator} ${trim(row?.factory_id) || "unknown"} channel=${trim(row?.rollout_channel) || "general"} release=${truncate(release, 36) || "(unknown)"} status=${status} upgrade_verification: ${upgradeVerification} reason=${truncate(row?.status_detail || row?.gate_reason || "state_unknown", 80) || "state_unknown"} pin=${truncate(row?.pin_source || "none", 28) || "none"}`,
    );
  }

  const warnings = Array.isArray(report?.warnings) ? report.warnings.filter(Boolean) : [];
  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.length} first=${warnings[0]}`);
  }

  return lines.join("\n");
}
