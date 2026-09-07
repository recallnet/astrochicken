import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { createGhApiClient } from "@hatch/github-adapter";

import {
  checkResumeGate,
  checkResumeGateFromArtifactLink,
  compareReleases,
  evaluateResumeGateFromManifestEntry,
  isReleaseSatisfied,
} from "./artifact-linkage.ts";
import { validateReleaseManifestContract } from "./release-manifest.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";
import { evaluateManifestRolloutGate } from "../lib/release-rollout-gate.ts";
import { validateResumePolicy } from "../lib/resume-policy-schema.ts";

const ROLLOUT_CHANNEL_ALIASES = {
  general: "stable",
};

const ROLLOUT_CHANNELS = new Set(["stable", "canary", "pinned"]);

function defaultManifestPathForChannel(rolloutChannel = "") {
  // @context:regression!critical The daemon and fleet CLIs rely on the checked-in
  // canonical manifests under .hatch/releases; if callers have to pass these
  // paths manually, managed factories wedge in control_plane_manifest_unavailable
  // even though the manifest already exists locally.
  const channel = normalizeRolloutChannelName(rolloutChannel, "stable");
  if (channel === "canary") return ".hatch/releases/canary/release-manifest.json";
  return ".hatch/releases/stable/release-manifest.json";
}

function listGitWorktreePaths(path = process.cwd()) {
  const cwd = String(path || "").trim();
  if (!cwd) return [];
  try {
    const out = spawnSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    if (out.status !== 0) return [];
    const paths = [];
    for (const line of String(out.stdout || "").split(/\r?\n/)) {
      if (!line.startsWith("worktree ")) continue;
      const worktreePath = String(line.slice("worktree ".length) || "").trim();
      if (worktreePath) paths.push(worktreePath);
    }
    return paths;
  } catch {
    return [];
  }
}

function resolveLocalManifestReadPath(manifestPath = "", controlPlaneRepo = "", cwd = process.cwd()) {
  const relativeManifestPath = String(manifestPath || "").trim();
  if (!relativeManifestPath) return "";
  if (existsSync(relativeManifestPath)) return relativeManifestPath;

  const repoName = String(controlPlaneRepo || "").trim().split("/").pop() || "";
  const worktreePaths = listGitWorktreePaths(cwd).sort((left, right) => {
    const leftScore = basename(left) === repoName ? 0 : 1;
    const rightScore = basename(right) === repoName ? 0 : 1;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.localeCompare(right);
  });

  for (const worktreePath of worktreePaths) {
    const candidate = join(worktreePath, relativeManifestPath);
    if (existsSync(candidate)) return candidate;
  }

  return relativeManifestPath;
}

function normalizeRolloutChannelName(value = "", fallback = "stable") {
  const raw = String(value || "").trim().toLowerCase();
  const aliased = ROLLOUT_CHANNEL_ALIASES[raw] || raw;
  if (ROLLOUT_CHANNELS.has(aliased)) return aliased;
  const normalizedFallback = String(fallback || "stable").trim().toLowerCase();
  const fallbackAliased = ROLLOUT_CHANNEL_ALIASES[normalizedFallback] || normalizedFallback;
  return ROLLOUT_CHANNELS.has(fallbackAliased) ? fallbackAliased : "stable";
}


function runCommand(command = "") {
  if (!String(command || "").trim()) return { ok: false, stdout: "", stderr: "missing_command" };
  const p = spawnSync("bash", ["-lc", command], { encoding: "utf8" });
  return {
    ok: p.status === 0,
    stdout: String(p.stdout || "").trim(),
    stderr: String(p.stderr || "").trim(),
  };
}


function normalizeStringMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(rawValue || "").trim();
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function chooseHigherRelease(a = "", b = "") {
  const ra = String(a || "").trim();
  const rb = String(b || "").trim();
  if (!ra) return rb;
  if (!rb) return ra;
  return compareReleases(ra, rb) >= 0 ? ra : rb;
}

export function loadResumePolicy({ policyPath = "", policyJson = "" } = {}) {
  let parsedPolicy = {};

  if (String(policyJson || "").trim()) {
    const parsed = parseJson(policyJson, null);
    parsedPolicy = parsed && typeof parsed === "object" ? parsed : {};
  } else if (String(policyPath || "").trim()) {
    const parsed = parseJson(readFileSync(String(policyPath).trim(), "utf8"), null);
    parsedPolicy = parsed && typeof parsed === "object" ? parsed : {};
  }

  const validation = validateResumePolicy(parsedPolicy);
  return {
    ...parsedPolicy,
    policy_validation_errors: Array.isArray(validation.errors) ? validation.errors : [],
  };
}

export function resolveRolloutChannel({ policy = {}, sourceRepo = "", milestoneTitle = "", rolloutChannel = "" } = {}) {
  const explicit = normalizeRolloutChannelName(rolloutChannel, "stable");
  if (String(rolloutChannel || "").trim()) return explicit;

  const rollout = policy?.rollout && typeof policy.rollout === "object" ? policy.rollout : {};
  const repo = String(sourceRepo || "").trim();
  const milestone = String(milestoneTitle || "").trim();
  const repoMilestoneKey = `${repo}#${milestone}`;

  const repoMilestoneChannels = normalizeStringMap(rollout.repo_milestone_channels);
  if (repoMilestoneChannels[repoMilestoneKey]) return normalizeRolloutChannelName(repoMilestoneChannels[repoMilestoneKey], "stable");

  const milestoneChannels = normalizeStringMap(rollout.milestone_channels);
  if (milestoneChannels[milestone]) return normalizeRolloutChannelName(milestoneChannels[milestone], "stable");

  const repoChannels = normalizeStringMap(rollout.repo_channels);
  if (repoChannels[repo]) return normalizeRolloutChannelName(repoChannels[repo], "stable");

  return normalizeRolloutChannelName(rollout.default_channel, "stable");
}

export function resolvePinnedRequiredRelease({ policy = {}, sourceRepo = "", milestoneTitle = "" } = {}) {
  const pins = policy?.pins && typeof policy.pins === "object" ? policy.pins : {};
  const repo = String(sourceRepo || "").trim();
  const milestone = String(milestoneTitle || "").trim();
  const repoMilestoneKey = `${repo}#${milestone}`;

  const repoMilestonePins = normalizeStringMap(pins.repo_milestones);
  if (repoMilestonePins[repoMilestoneKey]) return { value: repoMilestonePins[repoMilestoneKey], source: "repo_milestone_pin" };

  const milestonePins = normalizeStringMap(pins.milestones);
  if (milestonePins[milestone]) return { value: milestonePins[milestone], source: "milestone_pin" };

  const repoPins = normalizeStringMap(pins.repos);
  if (repoPins[repo]) return { value: repoPins[repo], source: "repo_pin" };

  return { value: "", source: "none" };
}

export function resolveLocalRelease({ localFactoryRelease = "", releaseCommand = "" } = {}) {
  const explicit = String(localFactoryRelease || "").trim();
  if (explicit) return { value: explicit, from: "arg" };
  if (!String(releaseCommand || "").trim()) return { value: "", from: "none" };
  const out = runCommand(releaseCommand);
  const value = String(out.stdout || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  return { value, from: "command", command_ok: out.ok, command_error: out.stderr };
}

function decodeManifestContent(content = "", encoding = "") {
  if (String(encoding || "").trim().toLowerCase() !== "base64") return String(content || "");
  return Buffer.from(String(content || "").replace(/\s+/g, ""), "base64").toString("utf8");
}

function defaultManifestReadJson({ controlPlaneRepo = "", manifestPath = "", manifestRef = "" } = {}) {
  if (!String(controlPlaneRepo || "").trim() || !String(manifestPath || "").trim()) return null;
  const client = createGhApiClient();
  const refQuery = String(manifestRef || "").trim() ? `?ref=${encodeURIComponent(String(manifestRef).trim())}` : "";
  const response = client.apiReadJson({
    apiPath: `repos/${controlPlaneRepo}/contents/${manifestPath}${refQuery}`,
    fallback: null,
    errorFallback: "manifest_fetch_failed",
  });
  return response?.ok ? response.json : null;
}

export function fetchControlPlaneReleaseManifest({
  controlPlaneRepo = "",
  rolloutChannel = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCommand = "",
  policy = {},
  ghJsonFn = defaultManifestReadJson,
  runCommandFn = runCommand,
} = {}) {
  const selectedChannel = normalizeRolloutChannelName(rolloutChannel, "stable");
  const rollout = policy?.rollout && typeof policy.rollout === "object" ? policy.rollout : {};
  const channels = rollout?.channels && typeof rollout.channels === "object" ? rollout.channels : {};
  const channelConfig = channels[selectedChannel] && typeof channels[selectedChannel] === "object"
    ? channels[selectedChannel]
    : {};

  const fetchCommand = String(
    manifestFetchCommand
      || channelConfig.manifest_fetch_command
      || policy.manifest_fetch_command
      || "",
  ).trim();

  if (fetchCommand) {
    const out = runCommandFn(fetchCommand);
    if (!out.ok) {
      return { ok: false, reason: "manifest_fetch_command_failed", error: String(out.stderr || ""), selected_channel: selectedChannel };
    }
    const manifest = parseJson(out.stdout || "", null);
    if (!manifest || typeof manifest !== "object") {
      return { ok: false, reason: "manifest_fetch_command_invalid_json", selected_channel: selectedChannel };
    }
    const validation = validateReleaseManifestContract(manifest);
    if (!validation.ok) {
      return {
        ok: false,
        reason: "manifest_schema_mismatch",
        selected_channel: selectedChannel,
        source: "command",
        expected_schema_version: validation.schema_version,
        validation_reasons: validation.reasons,
      };
    }
    return { ok: true, manifest, selected_channel: selectedChannel, source: "command", manifest_ref: "", manifest_path: "" };
  }

  const resolvedManifestPath = String(
    manifestPath
      || channelConfig.manifest_path
      || policy.manifest_path
      || defaultManifestPathForChannel(selectedChannel),
  ).trim();
  const resolvedManifestRef = String(
    manifestRef
      || channelConfig.manifest_ref
      || policy.manifest_ref
      || "main",
  ).trim() || "main";

  const localManifestReadPath = resolveLocalManifestReadPath(resolvedManifestPath, controlPlaneRepo);

  if (resolvedManifestPath && existsSync(localManifestReadPath)) {
    const manifest = parseJson(readFileSync(localManifestReadPath, "utf8"), null);
    if (!manifest || typeof manifest !== "object") {
      return {
        ok: false,
        reason: "manifest_invalid_json",
        selected_channel: selectedChannel,
        manifest_ref: "",
        manifest_path: resolvedManifestPath,
      };
    }

    const validation = validateReleaseManifestContract(manifest);
    if (!validation.ok) {
      return {
        ok: false,
        reason: "manifest_schema_mismatch",
        selected_channel: selectedChannel,
        source: "local_fs",
        manifest_ref: "",
        manifest_path: resolvedManifestPath,
        expected_schema_version: validation.schema_version,
        validation_reasons: validation.reasons,
      };
    }

    return {
      ok: true,
      manifest,
      selected_channel: selectedChannel,
      source: "local_fs",
      manifest_ref: "",
      manifest_path: resolvedManifestPath,
    };
  }

  if (!controlPlaneRepo || !resolvedManifestPath) {
    return {
      ok: false,
      reason: "missing_manifest_locator",
      selected_channel: selectedChannel,
      manifest_ref: resolvedManifestRef,
      manifest_path: resolvedManifestPath,
    };
  }

  const payload = ghJsonFn([
    "api",
    "-X",
    "GET",
    `repos/${controlPlaneRepo}/contents/${resolvedManifestPath}`,
    "-F",
    `ref=${resolvedManifestRef}`,
  ], null);

  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      reason: "manifest_fetch_failed",
      selected_channel: selectedChannel,
      manifest_ref: resolvedManifestRef,
      manifest_path: resolvedManifestPath,
    };
  }

  const manifest = parseJson(decodeManifestContent(payload.content || "", payload.encoding || ""), null);
  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      reason: "manifest_invalid_json",
      selected_channel: selectedChannel,
      manifest_ref: resolvedManifestRef,
      manifest_path: resolvedManifestPath,
    };
  }

  const validation = validateReleaseManifestContract(manifest);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "manifest_schema_mismatch",
      selected_channel: selectedChannel,
      source: "gh_contents",
      manifest_ref: resolvedManifestRef,
      manifest_path: resolvedManifestPath,
      expected_schema_version: validation.schema_version,
      validation_reasons: validation.reasons,
    };
  }

  return {
    ok: true,
    manifest,
    selected_channel: selectedChannel,
    source: "gh_contents",
    manifest_ref: resolvedManifestRef,
    manifest_path: resolvedManifestPath,
  };
}

export function deriveRequiredReleaseFromManifest({ manifest = {}, sourceRepo = "", sourceIssueNumber = 0 } = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const repo = String(sourceRepo || "").trim();
  const issue = Number(sourceIssueNumber || 0);

  const entry = artifacts.find((item) => (
    String(item?.source_repo || "").trim() === repo
    && Number(item?.source_issue || 0) === issue
  )) || null;

  const repoEntries = artifacts.filter((item) => String(item?.source_repo || "").trim() === repo);
  let repoFloor = "";
  for (const item of repoEntries) repoFloor = chooseHigherRelease(repoFloor, String(item?.required_factory_release || ""));

  const entryRequired = String(entry?.required_factory_release || "").trim();
  const globalFloor = String(manifest?.compatibility_matrix?.required_factory_release_floor || "").trim();
  const requiredFactoryRelease = chooseHigherRelease(chooseHigherRelease(entryRequired, repoFloor), globalFloor);
  const requirementSource = entryRequired
    ? "manifest_entry"
    : (repoFloor ? "manifest_repo_floor" : (globalFloor ? "manifest_global_floor" : "none"));

  return {
    entry,
    required_factory_release: requiredFactoryRelease,
    requirement_source: requirementSource,
  };
}

function normalizeManifestEntryStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized || "";
}

function deriveManifestEntryBlockerRef(entry = {}) {
  const blockerRef = String(
    entry?.blockerRef
      || entry?.blocker_ref
      || entry?.linkage?.blockerRef
      || entry?.linkage?.blocker_ref
      || "",
  ).trim();
  return blockerRef;
}

export function evaluateManifestResumeGate({
  manifest = {},
  controlPlaneRepo = "",
  sourceRepo = "",
  sourceIssueNumber = 0,
  milestoneTitle = "",
  localFactoryRelease = "",
  policy = {},
  checkResumeGateFn = checkResumeGate,
  checkResumeGateFromArtifactLinkFn = checkResumeGateFromArtifactLink,
} = {}) {
  const derived = deriveRequiredReleaseFromManifest({ manifest, sourceRepo, sourceIssueNumber });
  const pin = resolvePinnedRequiredRelease({ policy, sourceRepo, milestoneTitle });
  const hasPinOverride = Boolean(String(pin.value || "").trim());
  const effectiveRequiredRelease = hasPinOverride ? String(pin.value || "").trim() : String(derived.required_factory_release || "").trim();
  const localRelease = String(localFactoryRelease || "").trim();

  const manifestEntryStatus = normalizeManifestEntryStatus(derived?.entry?.status);
  const blockerRef = deriveManifestEntryBlockerRef(derived?.entry || {});
  if (manifestEntryStatus === "rejected" || manifestEntryStatus === "superseded") {
    return {
      ok: true,
      can_resume: false,
      reason: "rejected_upstream",
      resume_reason: "rejected_upstream",
      local_factory_release: localRelease,
      required_factory_release: effectiveRequiredRelease,
      requirement_source: hasPinOverride ? "policy_pin_override" : derived.requirement_source,
      manifest_entry_found: true,
      pinned_required_factory_release: pin.value,
      pin_source: pin.source,
      pin_override_applied: hasPinOverride,
      effective_required_factory_release: effectiveRequiredRelease,
      manifest_required_factory_release: String(derived.required_factory_release || ""),
      release_satisfied: false,
      status: manifestEntryStatus,
      blocker_ref: blockerRef,
      blockerRef,
      manifest_entry_status: manifestEntryStatus,
    };
  }

  if (!derived.entry) {
    const fallback = checkResumeGateFromArtifactLinkFn({
      controlPlaneRepo,
      sourceRepo,
      sourceIssueNumber,
      localFactoryRelease: localRelease,
    });
    const fallbackLocalRelease = String(fallback?.local_factory_release || localRelease || "");
    const fallbackGoalClosed = String(fallback?.goal?.state || "").toUpperCase() === "CLOSED";
    const fallbackReleaseSatisfied = isReleaseSatisfied({
      localFactoryRelease: fallbackLocalRelease,
      requiredFactoryRelease: effectiveRequiredRelease,
    });
    const fallbackReason = !fallbackGoalClosed
      ? "linked_goal_open"
      : (!fallbackReleaseSatisfied ? "factory_release_below_required" : "ready_to_resume");

    return {
      ...fallback,
      can_resume: Boolean(fallback.ok) && fallbackGoalClosed && fallbackReleaseSatisfied,
      local_factory_release: fallbackLocalRelease,
      required_factory_release: effectiveRequiredRelease,
      requirement_source: hasPinOverride ? "policy_pin_override" : derived.requirement_source,
      manifest_entry_found: false,
      pinned_required_factory_release: pin.value,
      pin_source: pin.source,
      pin_override_applied: hasPinOverride,
      effective_required_factory_release: effectiveRequiredRelease,
      manifest_required_factory_release: String(derived.required_factory_release || ""),
      fallback_to_artifact_linkage: true,
      release_satisfied: fallbackReleaseSatisfied,
      reason: fallback.ok ? fallbackReason : "missing_manifest_entry",
    };
  }

  const base = evaluateResumeGateFromManifestEntry({
    manifestEntry: derived.entry,
    controlPlaneRepo,
    localFactoryRelease: localRelease,
    checkResumeGateFn,
  });

  if (!base.ok) {
    return {
      ...base,
      requirement_source: hasPinOverride ? "policy_pin_override" : derived.requirement_source,
      manifest_entry_found: true,
      pinned_required_factory_release: pin.value,
      pin_source: pin.source,
      pin_override_applied: hasPinOverride,
      effective_required_factory_release: effectiveRequiredRelease,
      manifest_required_factory_release: String(derived.required_factory_release || ""),
      release_satisfied: false,
    };
  }

  const goalClosed = String(base?.goal?.state || "").toUpperCase() === "CLOSED";
  const localForDecision = chooseHigherRelease(localRelease, String(base?.local_factory_release || ""));
  const releaseSatisfied = isReleaseSatisfied({
    localFactoryRelease: localForDecision,
    requiredFactoryRelease: effectiveRequiredRelease,
  });
  const reason = !goalClosed ? "linked_goal_open" : (!releaseSatisfied ? "factory_release_below_required" : "ready_to_resume");

  return {
    ...base,
    can_resume: goalClosed && releaseSatisfied,
    reason,
    local_factory_release: localForDecision,
    required_factory_release: effectiveRequiredRelease,
    requirement_source: hasPinOverride ? "policy_pin_override" : derived.requirement_source,
    manifest_entry_found: true,
    pinned_required_factory_release: pin.value,
    pin_source: pin.source,
    pin_override_applied: hasPinOverride,
    effective_required_factory_release: effectiveRequiredRelease,
    manifest_required_factory_release: String(derived.required_factory_release || ""),
    release_satisfied: releaseSatisfied,
  };
}

function runGateCheck({
  mode = "artifact_linkage",
  controlPlaneRepo = "",
  sourceRepo = "",
  sourceIssueNumber = 0,
  localFactoryRelease = "",
  milestoneTitle = "",
  rolloutChannel = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCommand = "",
  policy = {},
  checkResumeGateFn = checkResumeGate,
  checkResumeGateFromArtifactLinkFn = checkResumeGateFromArtifactLink,
  fetchManifestFn = fetchControlPlaneReleaseManifest,
  ghJsonFn = ghJson,
  runCommandFn = runCommand,
} = {}) {
  if (mode === "manifest") {
    const fetched = fetchManifestFn({
      controlPlaneRepo,
      rolloutChannel,
      manifestPath,
      manifestRef,
      manifestFetchCommand,
      policy,
      ghJsonFn,
      runCommandFn,
    });
    if (!fetched.ok) {
      return {
        ok: false,
        can_resume: false,
        reason: String(fetched.reason || "manifest_fetch_failed"),
        selected_channel: normalizeRolloutChannelName(fetched.selected_channel || rolloutChannel, "stable"),
        manifest_fetch: fetched,
      };
    }

    const gate = evaluateManifestResumeGate({
      manifest: fetched.manifest,
      controlPlaneRepo,
      sourceRepo,
      sourceIssueNumber,
      milestoneTitle,
      localFactoryRelease,
      policy,
      checkResumeGateFn,
      checkResumeGateFromArtifactLinkFn,
    });

    const rolloutGate = evaluateManifestRolloutGate({
      manifest: fetched.manifest,
      manifestEntry: gate?.manifest_entry_found ? gate?.linkage ? {
        source_repo: sourceRepo,
        source_issue: sourceIssueNumber,
        linkage: gate.linkage,
        factory_id: String(gate?.linkage?.factory_id || ""),
        required_factory_release: String(gate?.pinned_required_factory_release || ""),
      } : null : null,
      rolloutChannel: normalizeRolloutChannelName(fetched.selected_channel || rolloutChannel, "stable"),
    });

    const rolloutReason = rolloutGate.allowed ? String(gate.reason || "") : String(rolloutGate.reason || "release_rollout_blocked");
    const canResume = Boolean(gate.can_resume) && Boolean(rolloutGate.allowed);

    return {
      ...gate,
      can_resume: canResume,
      reason: canResume ? String(gate.reason || rolloutReason) : rolloutReason,
      rollout_gate: rolloutGate,
      selected_channel: normalizeRolloutChannelName(fetched.selected_channel || rolloutChannel, "stable"),
      manifest_fetch: {
        ok: true,
        source: fetched.source,
        manifest_ref: fetched.manifest_ref,
        manifest_path: fetched.manifest_path,
      },
      manifest_release: {
        control_plane_repo: String(fetched.manifest?.release?.control_plane_repo || ""),
        sha: String(fetched.manifest?.release?.sha || ""),
        tag: String(fetched.manifest?.release?.tag || ""),
      },
    };
  }

  return checkResumeGateFromArtifactLinkFn({
    controlPlaneRepo,
    sourceRepo,
    sourceIssueNumber,
    localFactoryRelease,
  });
}

export function ensureResumeReady({
  controlPlaneRepo,
  sourceRepo,
  sourceIssueNumber,
  localFactoryRelease = "",
  localFactoryReleaseCommand = "",
  selfUpdateCommand = "",
  rolloutChannel = "",
  milestoneTitle = "",
  policyPath = "",
  policyJson = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCommand = "",
  checkResumeGateFn = checkResumeGate,
  checkResumeGateFromArtifactLinkFn = checkResumeGateFromArtifactLink,
  fetchManifestFn = fetchControlPlaneReleaseManifest,
  ghJsonFn = ghJson,
  runCommandFn = runCommand,
} = {}) {
  const policy = loadResumePolicy({ policyPath, policyJson });
  const policyValidationErrors = Array.isArray(policy?.policy_validation_errors)
    ? [...policy.policy_validation_errors]
    : [];
  const selectedChannel = resolveRolloutChannel({ policy, sourceRepo, milestoneTitle, rolloutChannel });
  const releaseCommand = String(localFactoryReleaseCommand || policy.local_factory_release_command || "").trim();
  const resolvedSelfUpdateCommand = String(selfUpdateCommand || policy.self_update_command || "").trim();
  const initial = resolveLocalRelease({ localFactoryRelease, releaseCommand });
  const defaultManifestPath = defaultManifestPathForChannel(selectedChannel);
  const effectiveManifestPath = String(manifestPath || "").trim() || defaultManifestPath;

  const manifestMode = Boolean(
    effectiveManifestPath
    || String(manifestFetchCommand || "").trim()
    || (policy?.rollout && typeof policy.rollout === "object")
    || String(policy?.manifest_path || "").trim()
    || String(policy?.manifest_fetch_command || "").trim()
  );
  const mode = manifestMode ? "manifest" : "artifact_linkage";

  const firstGate = runGateCheck({
    mode,
    controlPlaneRepo,
    sourceRepo,
      sourceIssueNumber,
      localFactoryRelease: initial.value,
      milestoneTitle,
      rolloutChannel: selectedChannel,
      manifestPath: effectiveManifestPath,
      manifestRef,
      manifestFetchCommand,
      policy,
    checkResumeGateFn,
    checkResumeGateFromArtifactLinkFn,
    fetchManifestFn,
    ghJsonFn,
    runCommandFn,
  });

  if (!firstGate.ok || firstGate.can_resume) {
    return {
      ...firstGate,
      mode,
      attempted_self_update: false,
      local_factory_release: String(firstGate?.local_factory_release || initial.value || ""),
      policy_validation_errors: policyValidationErrors,
    };
  }

  if (String(firstGate?.rollout_gate?.reason || "") === "release_rollout_blocked"
    || String(firstGate?.rollout_gate?.reason || "") === "release_not_promoted_to_general"
    || String(firstGate?.rollout_gate?.reason || "") === "release_not_selected_for_canary"
    || String(firstGate?.rollout_gate?.reason || "") === "release_not_pinned_match") {
    return {
      ...firstGate,
      mode,
      attempted_self_update: false,
      local_factory_release: String(firstGate?.local_factory_release || initial.value || ""),
      policy_validation_errors: policyValidationErrors,
    };
  }

  if (firstGate.reason !== "factory_release_below_required" || !resolvedSelfUpdateCommand) {
    return {
      ...firstGate,
      mode,
      attempted_self_update: false,
      local_factory_release: String(firstGate?.local_factory_release || initial.value || ""),
      policy_validation_errors: policyValidationErrors,
    };
  }

  const update = runCommandFn(resolvedSelfUpdateCommand);
  const after = resolveLocalRelease({ releaseCommand });
  const secondGate = runGateCheck({
    mode,
    controlPlaneRepo,
    sourceRepo,
    sourceIssueNumber,
    localFactoryRelease: after.value,
    milestoneTitle,
    rolloutChannel: selectedChannel,
    manifestPath: effectiveManifestPath,
    manifestRef,
    manifestFetchCommand,
    policy,
    checkResumeGateFn,
    checkResumeGateFromArtifactLinkFn,
    fetchManifestFn,
    ghJsonFn,
    runCommandFn,
  });

  return {
    ...secondGate,
    mode,
    attempted_self_update: true,
    self_update_ok: update.ok,
    self_update_error: update.stderr,
    local_factory_release_before: initial.value,
    local_factory_release_after: after.value,
    policy_validation_errors: policyValidationErrors,
  };
}
