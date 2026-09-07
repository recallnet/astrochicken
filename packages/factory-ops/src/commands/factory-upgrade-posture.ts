import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  findRegistryInstanceRow,
  loadFactoryRegistry,
  saveFactoryRegistry,
} from "../lib/factory-registry.ts";
import { evaluateRuntimeCompatibility } from "../lib/runtime-compatibility.ts";

const DEFAULT_POLICY_PATH = "factories/mothership/policy-pack/v1/release-policy.json";
const SUPPORTED_CHANNELS = new Set(["stable", "canary", "pinned"]);

function trim(value = "") {
  return String(value || "").trim();
}

function parseJson(text = "", fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function ensureObject(value = null) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeChannel(value = "", fallback = "stable") {
  const normalized = trim(value).toLowerCase();
  if (SUPPORTED_CHANNELS.has(normalized)) return normalized;
  const fallbackChannel = trim(fallback).toLowerCase();
  return SUPPORTED_CHANNELS.has(fallbackChannel) ? fallbackChannel : "stable";
}

function resolvePathFromCwd(candidatePath = "", cwd = process.cwd()) {
  const normalized = trim(candidatePath);
  if (!normalized) return "";
  if (isAbsolute(normalized)) return normalized;
  return resolve(cwd, normalized);
}

function loadReleasePolicy({
  policyPath = DEFAULT_POLICY_PATH,
  cwd = process.cwd(),
  readFileSyncFn = readFileSync,
} = {}) {
  const resolvedPolicyPath = resolvePathFromCwd(policyPath, cwd);
  if (!resolvedPolicyPath) {
    throw new Error("policy_path_required");
  }

  const parsed = parseJson(readFileSyncFn(resolvedPolicyPath, "utf8"), null);
  if (!ensureObject(parsed)) {
    throw new Error(`policy_invalid_json:${resolvedPolicyPath}`);
  }

  return {
    policy: parsed,
    policyPath: resolvedPolicyPath,
  };
}

function resolveChannelTargetPolicy({ policy = {}, channel = "stable" } = {}) {
  const normalizedChannel = normalizeChannel(channel, "stable");
  const shared = ensureObject(policy.shared) ? policy.shared : {};
  const channels = ensureObject(shared.channels) ? shared.channels : {};
  const channelPolicy = ensureObject(channels[normalizedChannel]) ? channels[normalizedChannel] : null;

  if (!channelPolicy) {
    throw new Error(`release_policy_channel_missing:${normalizedChannel}`);
  }

  const runtimeTarget = trim(
    channelPolicy.runtime_version_target
    || channelPolicy.runtime_target
    || channelPolicy.target_runtime_version,
  );
  const kindTarget = trim(
    channelPolicy.kind_version_target
    || channelPolicy.kind_target
    || channelPolicy.target_kind_version,
  );

  if (!runtimeTarget || !kindTarget) {
    throw new Error(`release_policy_channel_targets_missing:${normalizedChannel}`);
  }

  return {
    channel: normalizedChannel,
    runtime_version_target: runtimeTarget,
    kind_version_target: kindTarget,
    required_checks: Array.isArray(channelPolicy.required_checks)
      ? channelPolicy.required_checks.map((entry) => trim(entry)).filter(Boolean)
      : [],
  };
}

function readInstallationFacts({
  instance = {},
  cwd = process.cwd(),
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const installationManifestPath = resolvePathFromCwd(instance.installation_manifest_path, cwd);
  if (!installationManifestPath) {
    return {
      runtime_artifact_version: "",
      runtime_provenance_tag: "",
      runtime_artifact_ref: "",
      runtime_signature_hash: "",
      installation_manifest_path: "",
      warnings: ["installation_manifest_path_missing"],
    };
  }

  if (!existsSyncFn(installationManifestPath)) {
    return {
      runtime_artifact_version: "",
      runtime_provenance_tag: "",
      runtime_artifact_ref: installationManifestPath,
      runtime_signature_hash: "",
      installation_manifest_path: installationManifestPath,
      warnings: ["installation_manifest_missing"],
    };
  }

  const parsed = parseJson(readFileSyncFn(installationManifestPath, "utf8"), null);
  if (!ensureObject(parsed)) {
    return {
      runtime_artifact_version: "",
      runtime_provenance_tag: "",
      runtime_artifact_ref: installationManifestPath,
      runtime_signature_hash: "",
      installation_manifest_path: installationManifestPath,
      warnings: ["installation_manifest_invalid_json"],
    };
  }

  const runtimeArtifactVersion = trim(parsed.runtime_version);
  const runtimeSignatureHash = trim(parsed.runtime_signature_hash);
  const runtimeProvenanceTag = runtimeSignatureHash
    || trim(parsed.runtime_signature_key_id)
    || trim(parsed.installation_id);

  return {
    runtime_artifact_version: runtimeArtifactVersion,
    runtime_provenance_tag: runtimeProvenanceTag,
    runtime_artifact_ref: trim(parsed.runtime_artifact_ref || parsed.runtime_artifact_url || installationManifestPath),
    runtime_signature_hash: runtimeSignatureHash,
    installation_manifest_path: installationManifestPath,
    warnings: [],
  };
}

function readKindVersionFromEvents(events = [], instanceId = "") {
  const normalizedInstanceId = trim(instanceId);
  const candidates = (Array.isArray(events) ? events : [])
    .filter((event) => trim(event?.instance_id) === normalizedInstanceId && trim(event?.kind_version))
    .sort((left, right) => {
      const leftAt = Date.parse(trim(left?.ended_at || left?.started_at || "")) || 0;
      const rightAt = Date.parse(trim(right?.ended_at || right?.started_at || "")) || 0;
      return rightAt - leftAt;
    });

  return candidates[0] || null;
}

function readKindFacts({
  instance = {},
  cwd = process.cwd(),
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const instanceId = trim(instance.instance_id);
  const kindId = trim(instance.kind_id);
  const candidates = [
    resolve(cwd, ".hatch", "fleet", "mirrors", kindId, instanceId, "snapshot.json"),
    resolve(cwd, ".hatch", "managed-mirror", kindId, instanceId, "snapshot.json"),
  ];

  for (const snapshotPath of candidates) {
    if (!existsSyncFn(snapshotPath)) continue;
    const snapshot = parseJson(readFileSyncFn(snapshotPath, "utf8"), null);
    if (!ensureObject(snapshot)) continue;
    const explicit = trim(snapshot.kind_version || snapshot.kindVersion);
    if (!explicit) continue;
    return {
      kind_version: explicit,
      source: snapshotPath,
      warnings: [],
    };
  }

  const eventCandidates = [
    resolve(cwd, ".hatch", "fleet", "mirrors", kindId, "events.json"),
    resolve(cwd, ".hatch", "managed-mirror", kindId, "events.json"),
  ];

  for (const eventPath of eventCandidates) {
    if (!existsSyncFn(eventPath)) continue;
    const parsed = parseJson(readFileSyncFn(eventPath, "utf8"), null);
    if (!Array.isArray(parsed)) continue;
    const latest = readKindVersionFromEvents(parsed, instanceId);
    if (!latest) continue;
    return {
      kind_version: trim(latest.kind_version),
      source: eventPath,
      warnings: [],
    };
  }

  return {
    kind_version: "",
    source: "",
    warnings: ["kind_version_unavailable"],
  };
}

function evaluateTargetMatch(actualVersion = "", targetVersion = "") {
  const actual = trim(actualVersion);
  const target = trim(targetVersion);

  if (!target || target === "*") {
    return {
      matches: true,
      reason: "wildcard_target",
    };
  }

  if (!actual) {
    return {
      matches: false,
      reason: "missing_actual_version",
    };
  }

  try {
    const compatibility = evaluateRuntimeCompatibility({
      runtimeVersion: actual,
      allowedRange: target,
    });
    return {
      matches: compatibility.ok,
      reason: trim(compatibility.reason) || (compatibility.ok ? "target_match" : "target_mismatch"),
    };
  } catch {
    const exact = actual === target;
    return {
      matches: exact,
      reason: exact ? "exact_match" : "exact_mismatch",
    };
  }
}

function computeDrift({ runtimeArtifactVersion = "", kindVersion = "", channelTargets = {} } = {}) {
  const runtimeMatch = evaluateTargetMatch(runtimeArtifactVersion, channelTargets.runtime_version_target);
  const kindMatch = evaluateTargetMatch(kindVersion, channelTargets.kind_version_target);
  const reasons = [];
  if (!runtimeMatch.matches) reasons.push(`runtime:${runtimeMatch.reason}`);
  if (!kindMatch.matches) reasons.push(`kind:${kindMatch.reason}`);

  return {
    runtime_drift: !runtimeMatch.matches,
    kind_drift: !kindMatch.matches,
    drifted: !runtimeMatch.matches || !kindMatch.matches,
    reasons,
    target_runtime_version: trim(channelTargets.runtime_version_target),
    target_kind_version: trim(channelTargets.kind_version_target),
  };
}

function buildInstanceUpgradePosture({
  instance = {},
  policy = {},
  cwd = process.cwd(),
  readFileSyncFn = readFileSync,
  existsSyncFn = existsSync,
} = {}) {
  const channel = normalizeChannel(instance.upgrade_channel, "stable");
  const channelTargets = resolveChannelTargetPolicy({ policy, channel });

  const runtimeFacts = readInstallationFacts({
    instance,
    cwd,
    readFileSyncFn,
    existsSyncFn,
  });

  const kindFacts = readKindFacts({
    instance,
    cwd,
    readFileSyncFn,
    existsSyncFn,
  });

  const pinVersion = channel === "pinned"
    ? (trim(instance.allowed_runtime_version) && trim(instance.allowed_runtime_version) !== "*"
      ? trim(instance.allowed_runtime_version)
      : trim(channelTargets.runtime_version_target))
    : "";

  const drift = computeDrift({
    runtimeArtifactVersion: runtimeFacts.runtime_artifact_version,
    kindVersion: kindFacts.kind_version,
    channelTargets,
  });

  return {
    instance_id: trim(instance.instance_id),
    kind_id: trim(instance.kind_id),
    target_repo: trim(instance.target_repo),
    status: trim(instance.status),
    assigned_host_id: trim(instance.assigned_host_id),
    channel_posture: channel,
    pin_posture: {
      pinned: channel === "pinned",
      version: pinVersion,
    },
    runtime: {
      artifact_version: runtimeFacts.runtime_artifact_version,
      build_provenance_tag: runtimeFacts.runtime_provenance_tag,
      artifact_ref: runtimeFacts.runtime_artifact_ref,
      signature_hash: runtimeFacts.runtime_signature_hash,
      installation_manifest_path: runtimeFacts.installation_manifest_path,
    },
    kind: {
      version: kindFacts.kind_version,
      source: kindFacts.source,
    },
    compatibility_metadata: {
      allowed_runtime_version: trim(instance.allowed_runtime_version),
      channel_required_checks: channelTargets.required_checks,
    },
    policy_target: {
      channel: channelTargets.channel,
      runtime_version_target: channelTargets.runtime_version_target,
      kind_version_target: channelTargets.kind_version_target,
    },
    drift,
    warnings: [...runtimeFacts.warnings, ...kindFacts.warnings],
  };
}

function normalizeSelector(selector = "") {
  const normalized = trim(selector);
  if (!normalized) {
    throw new Error("selector_required");
  }

  if (normalized === "all") {
    return { type: "all", value: "all" };
  }

  if (normalized.startsWith("instance:")) {
    return { type: "instance", value: trim(normalized.slice("instance:".length)) };
  }

  if (normalized.startsWith("kind:")) {
    return { type: "kind", value: trim(normalized.slice("kind:".length)) };
  }

  if (normalized.startsWith("repo:")) {
    return { type: "repo", value: trim(normalized.slice("repo:".length)) };
  }

  return { type: "instance", value: normalized };
}

function selectCohortInstances({ selector = "", instances = [] } = {}) {
  const normalizedSelector = normalizeSelector(selector);
  const rows = Array.isArray(instances) ? instances : [];

  if (normalizedSelector.type === "all") {
    return {
      selector: normalizedSelector,
      selected: rows,
    };
  }

  const selected = rows.filter((row) => {
    if (normalizedSelector.type === "instance") {
      return trim(row.instance_id) === normalizedSelector.value;
    }
    if (normalizedSelector.type === "kind") {
      return trim(row.kind_id) === normalizedSelector.value;
    }
    if (normalizedSelector.type === "repo") {
      return trim(row.target_repo) === normalizedSelector.value;
    }
    return false;
  });

  return {
    selector: normalizedSelector,
    selected,
  };
}

function resolveExactVersionCandidate(value = "") {
  const normalized = trim(value).replace(/^v/i, "");
  if (!normalized) return "";
  const semverPrefixMatch = normalized.match(/^(\d+\.\d+\.\d+)/);
  if (semverPrefixMatch) return semverPrefixMatch[1];
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : "";
}

function validateCohortCompatibility({
  row = {},
  targetChannel = "stable",
  targetRuntimeVersion = "",
  pinVersion = "",
} = {}) {
  const allowedRange = trim(row.allowed_runtime_version) || "*";
  const effectiveVersion = targetChannel === "pinned"
    ? (trim(pinVersion) || trim(targetRuntimeVersion))
    : trim(targetRuntimeVersion);

  if (targetChannel === "pinned" && !effectiveVersion) {
    return {
      ok: false,
      reason: "pin_version_required",
    };
  }

  const exactCandidate = resolveExactVersionCandidate(effectiveVersion);
  if (!exactCandidate) {
    return {
      ok: true,
      reason: "compatibility_unresolved_non_exact_target",
    };
  }

  try {
    const compatibility = evaluateRuntimeCompatibility({
      runtimeVersion: exactCandidate,
      allowedRange,
    });

    if (!compatibility.ok) {
      return {
        ok: false,
        reason: trim(compatibility.reason) || "runtime_compatibility_conflict",
      };
    }

    return {
      ok: true,
      reason: "runtime_compatible",
    };
  } catch {
    return {
      ok: false,
      reason: "runtime_target_invalid_range",
    };
  }
}

function appendAuditLog({
  auditLogPath = ".hatch/upgrade-posture/audit-log.jsonl",
  cwd = process.cwd(),
  payload = {},
  mkdirSyncFn = mkdirSync,
  appendFileSyncFn = appendFileSync,
} = {}) {
  const resolvedAuditLogPath = resolvePathFromCwd(auditLogPath, cwd);
  mkdirSyncFn(dirname(resolvedAuditLogPath), { recursive: true });
  appendFileSyncFn(resolvedAuditLogPath, `${JSON.stringify(payload)}\n`, "utf8");
  return resolvedAuditLogPath;
}

export function inspectFactoryUpgradePosture({
  instanceId = "",
  registryPath = "factory-registry.json",
  policyPath = DEFAULT_POLICY_PATH,
  cwd = process.cwd(),
  now = Date.now(),
  loadFactoryRegistryFn = loadFactoryRegistry,
  findRegistryInstanceRowFn = findRegistryInstanceRow,
  readFileSyncFn = readFileSync,
  existsSyncFn = existsSync,
} = {}) {
  const normalizedInstanceId = trim(instanceId);
  if (!normalizedInstanceId) {
    throw new Error("instance_id_required");
  }

  const loaded = loadFactoryRegistryFn({ registryPath, cwd });
  const instance = findRegistryInstanceRowFn(loaded.registry, normalizedInstanceId);
  if (!instance) {
    throw new Error(`instance_not_registered:${normalizedInstanceId}`);
  }

  const { policy, policyPath: resolvedPolicyPath } = loadReleasePolicy({
    policyPath,
    cwd,
    readFileSyncFn,
  });

  const posture = buildInstanceUpgradePosture({
    instance,
    policy,
    cwd,
    readFileSyncFn,
    existsSyncFn,
  });

  return {
    ok: true,
    generated_at: new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString(),
    registry_path: loaded.registryPath,
    policy_path: resolvedPolicyPath,
    instance: posture,
  };
}

export function updateFactoryUpgradePostureCohort({
  selector = "",
  channel = "",
  pinVersion = "",
  registryPath = "factory-registry.json",
  policyPath = DEFAULT_POLICY_PATH,
  auditLogPath = ".hatch/upgrade-posture/audit-log.jsonl",
  actor = "",
  dryRun = false,
  cwd = process.cwd(),
  now = Date.now(),
  loadFactoryRegistryFn = loadFactoryRegistry,
  saveFactoryRegistryFn = saveFactoryRegistry,
  readFileSyncFn = readFileSync,
  mkdirSyncFn = mkdirSync,
  appendFileSyncFn = appendFileSync,
} = {}) {
  const normalizedChannel = normalizeChannel(channel, "");
  if (!SUPPORTED_CHANNELS.has(normalizedChannel)) {
    throw new Error(`unsupported_channel:${trim(channel) || "(missing)"}`);
  }

  const loaded = loadFactoryRegistryFn({ registryPath, cwd });
  const instances = Array.isArray(loaded.registry.instances) ? loaded.registry.instances : [];
  const selected = selectCohortInstances({ selector, instances });

  if (selected.selected.length === 0) {
    throw new Error(`cohort_empty:${trim(selector) || "(missing)"}`);
  }

  const { policy, policyPath: resolvedPolicyPath } = loadReleasePolicy({
    policyPath,
    cwd,
    readFileSyncFn,
  });
  const channelPolicy = resolveChannelTargetPolicy({ policy, channel: normalizedChannel });

  const normalizedPinVersion = trim(pinVersion);
  const targetRuntimeVersion = normalizedChannel === "pinned"
    ? (normalizedPinVersion || trim(channelPolicy.runtime_version_target))
    : trim(channelPolicy.runtime_version_target);

  for (const row of selected.selected) {
    const compatibility = validateCohortCompatibility({
      row,
      targetChannel: normalizedChannel,
      targetRuntimeVersion,
      pinVersion: normalizedPinVersion,
    });

    if (!compatibility.ok) {
      throw new Error(`compatibility_conflict:${trim(row.instance_id)}:${compatibility.reason}`);
    }
  }

  const updatesById = new Map();
  const mutations = [];
  for (const row of selected.selected) {
    const before = {
      instance_id: trim(row.instance_id),
      upgrade_channel: trim(row.upgrade_channel),
      allowed_runtime_version: trim(row.allowed_runtime_version),
    };

    const after = {
      instance_id: trim(row.instance_id),
      upgrade_channel: normalizedChannel,
      allowed_runtime_version: targetRuntimeVersion,
    };

    updatesById.set(trim(row.instance_id), after);
    mutations.push({ before, after });
  }

  const nextRegistry = {
    ...loaded.registry,
    instances: instances.map((row) => {
      const key = trim(row.instance_id);
      if (!updatesById.has(key)) return row;
      const update = updatesById.get(key);
      return {
        ...row,
        upgrade_channel: update.upgrade_channel,
        allowed_runtime_version: update.allowed_runtime_version,
      };
    }),
  };

  if (!dryRun) {
    saveFactoryRegistryFn({
      registryPath: loaded.registryPath,
      registry: nextRegistry,
    });
  }

  const auditPayload = {
    schema_version: "factory_upgrade_posture_audit/v1",
    action: "cohort_update",
    at: new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString(),
    actor: trim(actor) || "unknown_actor",
    selector: selected.selector,
    dry_run: Boolean(dryRun),
    channel: normalizedChannel,
    target_runtime_version: targetRuntimeVersion,
    target_kind_version: channelPolicy.kind_version_target,
    updated_instances: mutations,
  };

  const resolvedAuditLogPath = appendAuditLog({
    auditLogPath,
    cwd,
    payload: auditPayload,
    mkdirSyncFn,
    appendFileSyncFn,
  });

  return {
    ok: true,
    status: dryRun ? "dry_run" : "updated",
    generated_at: auditPayload.at,
    registry_path: loaded.registryPath,
    policy_path: resolvedPolicyPath,
    selector: selected.selector,
    channel: normalizedChannel,
    target_runtime_version: targetRuntimeVersion,
    target_kind_version: channelPolicy.kind_version_target,
    updated_count: mutations.length,
    updated_instances: mutations.map((entry) => ({ ...entry.after })),
    audit_log_path: resolvedAuditLogPath,
    dry_run: Boolean(dryRun),
  };
}

export function formatFactoryUpgradePostureInspectHuman(report = {}) {
  const instance = ensureObject(report.instance) ? report.instance : {};
  const drift = ensureObject(instance.drift) ? instance.drift : {};
  const runtime = ensureObject(instance.runtime) ? instance.runtime : {};
  const kind = ensureObject(instance.kind) ? instance.kind : {};
  const policyTarget = ensureObject(instance.policy_target) ? instance.policy_target : {};

  const lines = [];
  lines.push(`Upgrade posture instance=${trim(instance.instance_id) || "(unknown)"} channel=${trim(instance.channel_posture) || "stable"}`);
  lines.push(`  runtime=${trim(runtime.artifact_version) || "(unknown)"} target=${trim(policyTarget.runtime_version_target) || "(none)"} provenance=${trim(runtime.build_provenance_tag) || "(none)"}`);
  lines.push(`  kind=${trim(kind.version) || "(unknown)"} target=${trim(policyTarget.kind_version_target) || "(none)"}`);
  lines.push(`  drift=${drift.drifted === true ? "yes" : "no"} reasons=${Array.isArray(drift.reasons) && drift.reasons.length > 0 ? drift.reasons.join(",") : "none"}`);
  return lines.join("\n");
}

export function formatFactoryUpgradePostureCohortHuman(report = {}) {
  const updated = Array.isArray(report.updated_instances) ? report.updated_instances : [];
  const header = `Upgrade posture cohort status=${trim(report.status) || "unknown"} channel=${trim(report.channel) || "(unknown)"} updated=${updated.length}`;
  if (updated.length === 0) return header;
  const lines = [header];
  for (const row of updated) {
    lines.push(`  ${trim(row.instance_id) || "(unknown)"} channel=${trim(row.upgrade_channel) || "(unknown)"} allowed_runtime_version=${trim(row.allowed_runtime_version) || "(none)"}`);
  }
  return lines.join("\n");
}
