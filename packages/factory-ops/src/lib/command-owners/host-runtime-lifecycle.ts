import { accessSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "../error-catalog.ts";
import { loadInstanceRuntimePolicy } from "../factory-registry.ts";
import { readLeaseRecord, resolveLeasePath } from "../host-instance-lease.ts";
import { executeHostRuntimeDecisions } from "../host-runtime-executor.ts";
import { repairHostInstallationAssignments, syncHostRegistryFromCanonical } from "../host-runtime-repair.ts";
import {
  loadHostRuntimeSchedulerState,
  writeHostRuntimeSchedulerState,
} from "../host-runtime-scheduler-state.ts";
import {
  runHostRuntimeSchedulerCycle,
  summarizeHostRuntimeSchedulerState,
} from "../host-runtime-scheduler.ts";
import {
  loadHostWakeupState,
  pollHostWakeups,
  summarizeHostWakeupState,
  writeHostWakeupState,
} from "../host-wakeup.ts";
import { evaluateRuntimeCompatibility } from "../runtime-compatibility.ts";
import {
  buildRuntimeSignatureEvidence,
  extractRuntimeSignatureInputs,
  readRuntimeSignatureFromReleaseManifest,
  verifyRuntimeSignature,
} from "../runtime-signature.ts";

const HOST_RUNTIME_SCHEMA = "hatch.host.runtime.v2";

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

function ensureObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHostId(value = "") {
  const hostId = trim(value || process.env.HATCH_HOST_ID || process.env.HOST_ID || os.hostname() || "unknown-host");
  return hostId || "unknown-host";
}

function resolvePackageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function resolveRuntimeEntrypoint() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "host-runtime.mjs");
}

export function resolveHostRuntimeVersion({ packageRoot = resolvePackageRoot() } = {}) {
  const packageJsonPath = path.resolve(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) return "unknown";
  const parsed = parseJson(readFileSync(packageJsonPath, "utf8"), null);
  const version = trim(parsed?.version);
  return version || "unknown";
}

export function resolveHostRuntimePaths({ hostBaseDir = "", repoRoot = process.cwd() } = {}) {
  const resolvedBaseDir = path.resolve(trim(hostBaseDir) || path.join(os.homedir(), ".hatch-hosts"));
  const runtimeDir = path.resolve(resolvedBaseDir, "runtime");
  return {
    baseDir: resolvedBaseDir,
    runtimeDir,
    runtimeLogDir: path.resolve(runtimeDir, "logs"),
    hostManifestPath: path.resolve(runtimeDir, "host-runtime.json"),
    repoRoot: path.resolve(trim(repoRoot) || process.cwd()),
  };
}

function computeSchedulerHealth({ scheduler = {}, installationCount = 0 } = {}) {
  const activeCount = Array.isArray(scheduler.active_instances) ? scheduler.active_instances.length : 0;
  const queuedCount = Array.isArray(scheduler.queued_instances) ? scheduler.queued_instances.length : 0;
  const maxActive = Number(scheduler?.last_cycle?.max_active) || 1;
  const boundedMaxActive = maxActive > 0 ? maxActive : 1;
  const pressure = activeCount / boundedMaxActive;

  return {
    host_queue_depth: queuedCount,
    host_active_slots: activeCount,
    host_max_active_slots: boundedMaxActive,
    host_capacity_pressure: Number.isFinite(pressure) ? Number(pressure.toFixed(4)) : 0,
    host_pending_installations: Math.max(0, Number(installationCount) - activeCount),
  };
}

function buildHostRuntimeManifest({
  hostId = "",
  paths = {},
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  runtimeSignatureEvidence = {},
} = {}) {
  const evidence = buildRuntimeSignatureEvidence({
    runtimeSignature,
    runtimeSignatureKeyId,
    verification: runtimeSignatureEvidence,
  });

  return {
    schema: HOST_RUNTIME_SCHEMA,
    host_id: normalizeHostId(hostId),
    runtime_version: resolveHostRuntimeVersion(),
    runtime_entrypoint: resolveRuntimeEntrypoint(),
    repo_root: trim(paths.repoRoot),
    host_base_dir: trim(paths.baseDir),
    runtime_log_dir: trim(paths.runtimeLogDir),
    installed_at: new Date().toISOString(),
    runtime_signature: evidence.runtime_signature,
    runtime_signature_key_id: evidence.runtime_signature_key_id,
    runtime_signature_hash: evidence.runtime_signature_hash,
    runtime_signature_status: evidence.runtime_signature_status,
    runtime_signature_verified_at: evidence.runtime_signature_verified_at,
    runtime_signature_error: evidence.runtime_signature_error,
    runtime_signature_digest: evidence.runtime_signature_digest,
    runtime_signature_digest_algorithm: evidence.runtime_signature_digest_algorithm,
    runtime_signature_payload_path: evidence.runtime_signature_payload_path,
    runtime_signature_payload_type: evidence.runtime_signature_payload_type,
  };
}

function validateInstallationManifest(manifest = {}) {
  const required = ["installation_id", "instance_id", "host_id", "workspace_mode"];
  const missing = required.filter((key) => !trim(manifest?.[key]));
  return {
    ok: missing.length === 0,
    missing,
  };
}

function collectInstallationManifestPaths(rootDir = "") {
  const manifests = [];
  const queue = [path.resolve(rootDir)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || !existsSync(current)) continue;
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const fullPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "runtime") continue;
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "installation.json") {
        manifests.push(fullPath);
      }
    }
  }
  return manifests.sort((left, right) => left.localeCompare(right, "en"));
}

function buildLeaseSummary(installations = []) {
  const firstLeased = installations.find((entry) => ensureObject(entry?.lease)) || null;
  if (!firstLeased) {
    return {
      assigned_host_id: "",
      lease_owner: "",
      lease_expires_at: "",
      lease_ttl_sec: "",
      runtime_version: "",
    };
  }

  return {
    assigned_host_id: trim(firstLeased.lease.host_id || firstLeased.host_id),
    lease_owner: trim(firstLeased.lease.lease_owner),
    lease_expires_at: trim(firstLeased.lease.lease_expires_at),
    lease_ttl_sec: Number(firstLeased.lease.lease_ttl_sec) || "",
    runtime_version: trim(firstLeased.lease.runtime_version || firstLeased.runtime_version),
  };
}

function enrichInstallationsWithScheduler(installations = [], scheduler = {}) {
  const schedulerInstances = Array.isArray(scheduler?.instances) ? scheduler.instances : [];
  const schedulerByInstallationId = new Map(
    schedulerInstances.map((entry) => [trim(entry?.installation_id), entry]),
  );

  return (Array.isArray(installations) ? installations : []).map((installation) => {
    const schedulerEntry = schedulerByInstallationId.get(trim(installation?.installation_id)) || {};
    return {
      ...installation,
      selection_reason: trim(schedulerEntry.selection_reason),
      selection_score: Number(schedulerEntry.selection_score) || 0,
      base_priority: Number(schedulerEntry.base_priority) || 1000,
      effective_priority: Number(schedulerEntry.effective_priority) || 1000,
      age_bonus: Number(schedulerEntry.age_bonus_counter) || 0,
      age_bonus_counter: Number(schedulerEntry.age_bonus_counter) || 0,
      wait_cycles: Number(schedulerEntry.wait_cycles) || 0,
      capacity_reject_reason: trim(schedulerEntry.capacity_reject_reason),
      defer_reason: trim(schedulerEntry.defer_reason),
      active_state: trim(schedulerEntry.active_state),
    };
  });
}

export function listHostInstallations({ paths = {} } = {}) {
  const manifestPaths = collectInstallationManifestPaths(paths.baseDir);
  const installations = [];
  const diagnostics = [];
  for (const manifestPath of manifestPaths) {
    const parsed = parseJson(readFileSync(manifestPath, "utf8"), null);
    if (!ensureObject(parsed)) {
      diagnostics.push(`invalid_installation_manifest:${manifestPath}`);
      continue;
    }
    const validation = validateInstallationManifest(parsed);
    if (!validation.ok) {
      diagnostics.push(`invalid_installation_manifest:${manifestPath}:missing=${validation.missing.join(",")}`);
      continue;
    }

    const installation = {
      installation_id: trim(parsed.installation_id),
      instance_id: trim(parsed.instance_id),
      host_id: trim(parsed.host_id),
      workspace_mode: trim(parsed.workspace_mode),
      work_dir: parsed.work_dir === null ? null : trim(parsed.work_dir),
      log_dir: trim(parsed.log_dir),
      artifact_dir: trim(parsed.artifact_dir),
      runtime_version: trim(parsed.runtime_version),
      runtime_signature_hash: trim(parsed.runtime_signature_hash),
      manifest_path: manifestPath,
    };

    const lease = readLeaseRecord({
      paths: {
        ...paths,
        installationManifestPath: manifestPath,
      },
      installationId: installation.installation_id,
      instanceId: installation.instance_id,
    });

    if (lease) {
      installation.lease = lease;
    } else {
      const leasePath = resolveLeasePath({
        paths: {
          ...paths,
          installationManifestPath: manifestPath,
        },
        installationId: installation.installation_id,
        instanceId: installation.instance_id,
      });
      diagnostics.push(`${existsSync(leasePath) ? "invalid_lease_record" : "missing_lease_record"}:${manifestPath}`);
    }

    installations.push(installation);
  }

  return {
    installations,
    diagnostics,
    leaseSummary: buildLeaseSummary(installations),
  };
}

function loadHostRuntimeManifest(paths = {}) {
  if (!existsSync(paths.hostManifestPath)) {
    return {
      ok: false,
      errorCode: "host_runtime_not_installed",
      message: "host_runtime_not_installed",
      manifest: null,
    };
  }
  const parsed = parseJson(readFileSync(paths.hostManifestPath, "utf8"), null);
  if (!ensureObject(parsed)) {
    return {
      ok: false,
      errorCode: "host_runtime_manifest_invalid",
      message: "host_runtime_manifest_invalid",
      manifest: null,
    };
  }
  return {
    ok: true,
    errorCode: "",
    message: "host_runtime_manifest_loaded",
    manifest: parsed,
  };
}

function evaluateStoredRuntimeSignatureEvidence(manifest = {}) {
  const runtimeSignature = trim(manifest.runtime_signature);
  const runtimeSignatureKeyId = trim(manifest.runtime_signature_key_id);
  const runtimeSignatureStatus = trim(manifest.runtime_signature_status).toLowerCase();
  const runtimeSignatureError = trim(manifest.runtime_signature_error);

  if (!runtimeSignature || !runtimeSignatureKeyId) {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      message: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      runtimeSignatureStatus,
      runtimeSignatureError,
    };
  }

  if (runtimeSignatureStatus !== "verified") {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      message: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      runtimeSignatureStatus,
      runtimeSignatureError,
    };
  }

  if (runtimeSignatureError) {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      message: runtimeSignatureError,
      runtimeSignatureStatus,
      runtimeSignatureError,
    };
  }

  return {
    ok: true,
    errorCode: "",
    message: "host_runtime_signature_verified",
    runtimeSignatureStatus,
    runtimeSignatureError,
  };
}

function checkWritable(pathValue = "") {
  try {
    mkdirSync(pathValue, { recursive: true });
    accessSync(pathValue, 2);
    return true;
  } catch {
    return false;
  }
}

function appendRuntimeLog(logFile = "", line = "") {
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${line}\n`, { flag: "a" });
}

function evaluateInstallationRuntimeCompatibility({ installation = {}, runtimeVersion = "", registryPath = "", registryCwd = process.cwd() } = {}) {
  const instanceId = trim(installation.instance_id);
  if (!instanceId) {
    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode: FACTORY_OPS_ERROR_CODES.runtime_incompatible,
      message: "runtime_policy_instance_id_missing",
      instanceId: "",
      runtimeVersion,
      allowedRange: "",
      registryPath,
    };
  }

  let policy;
  try {
    policy = loadInstanceRuntimePolicy({
      instanceId,
      registryPath: registryPath || "factory-registry.json",
      cwd: registryCwd,
    });
  } catch (error) {
    const errorCode = String(error?.code || FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing);
    if (
      errorCode === FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing
      || errorCode === FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing
    ) {
      return {
        ok: true,
        status: "runtime_policy_unresolved",
        errorCode: "",
        message: "runtime_policy_unresolved",
        instanceId,
        runtimeVersion,
        allowedRange: "*",
        registryPath,
      };
    }

    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode,
      message: String(error?.message || "runtime_policy_lookup_failed"),
      instanceId,
      runtimeVersion,
      allowedRange: "",
      registryPath,
    };
  }

  let compatibility;
  try {
    compatibility = evaluateRuntimeCompatibility({
      runtimeVersion,
      allowedRange: policy.allowed_runtime_version,
    });
  } catch (error) {
    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode: String(error?.code || FACTORY_OPS_ERROR_CODES.runtime_version_range_invalid),
      message: String(error?.message || "runtime_version_range_invalid"),
      instanceId,
      runtimeVersion,
      allowedRange: trim(policy.allowed_runtime_version),
      registryPath: policy.registry_path,
    };
  }

  if (compatibility.ok) {
    return {
      ok: true,
      status: "runtime_compatible",
      errorCode: "",
      message: compatibility.reason || "runtime_version_compatible",
      instanceId,
      runtimeVersion: compatibility.runtimeVersion || runtimeVersion,
      allowedRange: compatibility.allowedRange || trim(policy.allowed_runtime_version),
      registryPath: policy.registry_path,
    };
  }

  return {
    ok: false,
    status: "runtime_incompatible",
    errorCode: FACTORY_OPS_ERROR_CODES.runtime_incompatible,
    message: compatibility.reason || `runtime_version_out_of_range:${runtimeVersion}:${trim(policy.allowed_runtime_version) || "*"}`,
    instanceId,
    runtimeVersion: compatibility.runtimeVersion || runtimeVersion,
    allowedRange: compatibility.allowedRange || trim(policy.allowed_runtime_version),
    registryPath: policy.registry_path,
  };
}

export function installHostRuntime({
  paths = {},
  hostId = "",
  repoRoot = "",
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  trustPublicKeyPath = "",
  trustPublicKeyPem = "",
  releaseManifestPath = "",
  signedPayloadPath = "",
} = {}) {
  mkdirSync(paths.runtimeLogDir, { recursive: true });

  const releaseSignature = readRuntimeSignatureFromReleaseManifest({ releaseManifestPath });
  const signatureInputs = extractRuntimeSignatureInputs({
    runtimeSignature: runtimeSignature || (releaseSignature.ok ? releaseSignature.runtimeSignature : ""),
    runtimeSignatureKeyId: runtimeSignatureKeyId || (releaseSignature.ok ? releaseSignature.runtimeSignatureKeyId : ""),
    trustPublicKeyPath,
    trustPublicKeyPem,
  });

  if (!signatureInputs.ok) {
    return {
      ok: false,
      status: "signature_missing",
      message: signatureInputs.message,
      errorCode: signatureInputs.errorCode,
      hostId: normalizeHostId(hostId),
      runtimeVersion: resolveHostRuntimeVersion(),
      manifest: null,
      paths,
    };
  }

  const runtimeEntrypointPath = resolveRuntimeEntrypoint();
  const verification = verifyRuntimeSignature({
    runtimeSignature: signatureInputs.inputs.runtimeSignature,
    runtimeSignatureKeyId: signatureInputs.inputs.runtimeSignatureKeyId,
    trustPublicKeyPath: signatureInputs.inputs.trustPublicKeyPath,
    trustPublicKeyPem: signatureInputs.inputs.trustPublicKeyPem,
    releaseManifestPath,
    runtimeEntrypointPath,
    signedPayloadPath,
    signatureAlgorithm: releaseSignature.ok ? releaseSignature.signatureAlgorithm : "sha256",
  });

  if (!verification.ok) {
    return {
      ok: false,
      status: "signature_invalid",
      message: trim(verification.error || "host_runtime_signature_invalid"),
      errorCode: trim(verification.errorCode || FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid),
      hostId: normalizeHostId(hostId),
      runtimeVersion: resolveHostRuntimeVersion(),
      manifest: null,
      paths,
    };
  }

  const manifest = buildHostRuntimeManifest({
    hostId,
    paths: {
      ...paths,
      repoRoot: trim(repoRoot) || paths.repoRoot,
    },
    runtimeSignature: signatureInputs.inputs.runtimeSignature,
    runtimeSignatureKeyId: signatureInputs.inputs.runtimeSignatureKeyId,
    runtimeSignatureEvidence: verification,
  });
  writeFileSync(paths.hostManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    ok: true,
    status: "installed",
    message: "host_runtime_installed",
    errorCode: "",
    hostId: manifest.host_id,
    runtimeVersion: manifest.runtime_version,
    manifest,
    paths,
  };
}

export function getHostRuntimeStatus({
  paths = {},
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  trustPublicKeyPath = "",
  trustPublicKeyPem = "",
  signedPayloadPath = "",
} = {}) {
  const loaded = loadHostRuntimeManifest(paths);
  if (!loaded.ok) {
    const schedulerLoaded = loadHostRuntimeSchedulerState({ paths, hostId: "" });
    const wakeupLoaded = loadHostWakeupState({ paths, hostId: "" });
    const scheduler = summarizeHostRuntimeSchedulerState({ state: schedulerLoaded.state });
    const wakeup = summarizeHostWakeupState({ state: wakeupLoaded.state });
    const health = computeSchedulerHealth({
      scheduler,
      installationCount: 0,
    });

    return {
      ok: false,
      status: "not_installed",
      message: loaded.message,
      errorCode: loaded.errorCode,
      hostId: "",
      runtimeVersion: "",
      manifest: null,
      installationCount: 0,
      installations: [],
      diagnostics: [],
      leaseSummary: {
        assigned_host_id: "",
        lease_owner: "",
        lease_expires_at: "",
        lease_ttl_sec: "",
        runtime_version: "",
      },
      scheduler,
      schedulerStatePath: schedulerLoaded.schedulerStatePath,
      wakeup,
      wakeupStatePath: wakeupLoaded.wakeupStatePath,
      ...health,
      wake_sources: wakeup.last_wake_sources || [],
      runtime_signature_status: "",
      runtime_signature_error: "",
      runtime_signature_hash: "",
      runtime_signature_key_id: "",
      paths,
    };
  }

  const hostId = trim(loaded.manifest.host_id);
  let runtimeSignatureStatus = trim(loaded.manifest.runtime_signature_status);
  let runtimeSignatureError = trim(loaded.manifest.runtime_signature_error);
  let runtimeSignatureHash = trim(loaded.manifest.runtime_signature_hash);
  let runtimeSignatureKeyIdOut = trim(loaded.manifest.runtime_signature_key_id);

  if (trim(runtimeSignature) && trim(runtimeSignatureKeyId) && (trim(trustPublicKeyPath) || trim(trustPublicKeyPem))) {
    const liveVerification = verifyRuntimeSignature({
      runtimeSignature,
      runtimeSignatureKeyId,
      trustPublicKeyPath,
      trustPublicKeyPem,
      signedPayloadPath: trim(signedPayloadPath) || trim(loaded.manifest.runtime_signature_payload_path) || trim(loaded.manifest.runtime_entrypoint),
    });
    if (liveVerification.ok) {
      const liveEvidence = buildRuntimeSignatureEvidence({
        runtimeSignature,
        runtimeSignatureKeyId,
        verification: liveVerification,
      });
      runtimeSignatureStatus = trim(liveEvidence.runtime_signature_status) || runtimeSignatureStatus;
      runtimeSignatureError = trim(liveEvidence.runtime_signature_error);
      runtimeSignatureHash = trim(liveEvidence.runtime_signature_hash) || runtimeSignatureHash;
      runtimeSignatureKeyIdOut = trim(liveEvidence.runtime_signature_key_id) || runtimeSignatureKeyIdOut;
    } else {
      runtimeSignatureStatus = "invalid";
      runtimeSignatureError = trim(liveVerification.errorCode || liveVerification.error || FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid);
    }
  }

  const listed = listHostInstallations({ paths });
  const schedulerLoaded = loadHostRuntimeSchedulerState({ paths, hostId });
  const wakeupLoaded = loadHostWakeupState({ paths, hostId });
  const scheduler = summarizeHostRuntimeSchedulerState({ state: schedulerLoaded.state });
  const wakeup = summarizeHostWakeupState({ state: wakeupLoaded.state });
  const installations = enrichInstallationsWithScheduler(listed.installations, scheduler);
  const health = computeSchedulerHealth({
    scheduler,
    installationCount: installations.length,
  });

  return {
    ok: true,
    status: "installed",
    message: "host_runtime_status_ok",
    errorCode: "",
    hostId,
    runtimeVersion: trim(loaded.manifest.runtime_version),
    manifest: loaded.manifest,
    installationCount: installations.length,
    installations,
    diagnostics: listed.diagnostics,
    leaseSummary: listed.leaseSummary,
    scheduler,
    schedulerStatePath: schedulerLoaded.schedulerStatePath,
    wakeup,
    wakeupStatePath: wakeupLoaded.wakeupStatePath,
    ...health,
    wake_sources: wakeup.last_wake_sources || [],
    runtime_signature_status: runtimeSignatureStatus,
    runtime_signature_error: runtimeSignatureError,
    runtime_signature_hash: runtimeSignatureHash,
    runtime_signature_key_id: runtimeSignatureKeyIdOut,
    paths,
  };
}

export function doctorHostRuntime({
  paths = {},
  requiredEnv = [],
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  trustPublicKeyPath = "",
  trustPublicKeyPem = "",
  signedPayloadPath = "",
} = {}) {
  const checks = [];
  const loaded = loadHostRuntimeManifest(paths);
  checks.push({ id: "host_manifest", ok: loaded.ok, detail: loaded.message });
  if (!loaded.ok) {
    return {
      ok: false,
      status: "unhealthy",
      message: loaded.message,
      errorCode: loaded.errorCode,
      checks,
      hostId: "",
      runtimeVersion: "",
      installationCount: 0,
      paths,
    };
  }

  const manifest = loaded.manifest;
  const runtimeEntrypoint = trim(manifest.runtime_entrypoint);
  const runtimeVersion = trim(manifest.runtime_version);
  const hostId = trim(manifest.host_id);
  const writable = checkWritable(paths.runtimeLogDir);
  const requiredEnvNames = requiredEnv.map((entry) => trim(entry)).filter(Boolean);
  const missingEnv = requiredEnvNames.filter((entry) => !trim(process.env[entry]));
  const listed = listHostInstallations({ paths });

  const blockingInstallationDiagnostics = listed.diagnostics.filter((entry) => !entry.startsWith("missing_lease_record:"));
  const signatureEvidence = evaluateStoredRuntimeSignatureEvidence(manifest);
  let runtimeSignatureStatus = trim(manifest.runtime_signature_status);
  let runtimeSignatureError = trim(manifest.runtime_signature_error);

  if (trim(runtimeSignature) && trim(runtimeSignatureKeyId) && (trim(trustPublicKeyPath) || trim(trustPublicKeyPem))) {
    const liveVerification = verifyRuntimeSignature({
      runtimeSignature,
      runtimeSignatureKeyId,
      trustPublicKeyPath,
      trustPublicKeyPem,
      signedPayloadPath: trim(signedPayloadPath) || trim(manifest.runtime_signature_payload_path) || runtimeEntrypoint,
    });
    runtimeSignatureStatus = liveVerification.ok ? "verified" : "invalid";
    runtimeSignatureError = trim(liveVerification.errorCode || liveVerification.error);
  }

  checks.push({ id: "host_id", ok: Boolean(hostId), detail: hostId || "missing_host_id" });
  checks.push({ id: "runtime_version", ok: Boolean(runtimeVersion), detail: runtimeVersion || "missing_runtime_version" });
  checks.push({ id: "runtime_entrypoint", ok: Boolean(runtimeEntrypoint) && existsSync(runtimeEntrypoint), detail: runtimeEntrypoint || "missing_runtime_entrypoint" });
  checks.push({ id: "runtime_signature", ok: signatureEvidence.ok, detail: signatureEvidence.ok ? "verified" : trim(signatureEvidence.message || signatureEvidence.errorCode) || "host_runtime_signature_invalid" });
  checks.push({ id: "runtime_log_dir_writable", ok: writable, detail: paths.runtimeLogDir });
  checks.push({ id: "required_env", ok: missingEnv.length === 0, detail: missingEnv.length === 0 ? requiredEnvNames.join(",") || "none" : `missing:${missingEnv.join(",")}` });
  checks.push({ id: "installation_manifests", ok: blockingInstallationDiagnostics.length === 0, detail: listed.diagnostics.length === 0 ? `${listed.installations.length}` : listed.diagnostics.join(";") });

  const ok = checks.every((entry) => entry.ok);
  return {
    ok,
    status: ok ? "healthy" : "unhealthy",
    message: ok ? "host_runtime_doctor_ok" : (trim(signatureEvidence.message) || "host_runtime_doctor_failed"),
    errorCode: ok ? "" : (trim(signatureEvidence.errorCode) || "host_runtime_doctor_failed"),
    checks,
    hostId,
    runtimeVersion,
    installationCount: listed.installations.length,
    installations: listed.installations,
    runtimeSignatureStatus,
    runtimeSignatureError,
    paths,
  };
}

export function removeHostRuntime({ paths = {}, force = false } = {}) {
  const listed = listHostInstallations({ paths });
  if (listed.installations.length > 0 && !force) {
    return {
      ok: false,
      status: "installations_present",
      message: "host_runtime_remove_blocked_by_installations",
      errorCode: "host_runtime_remove_blocked_by_installations",
      installationCount: listed.installations.length,
      paths,
    };
  }
  if (existsSync(paths.hostManifestPath)) {
    try {
      unlinkSync(paths.hostManifestPath);
    } catch (error) {
      throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.path_collision, String(error?.message || error));
    }
  }
  try {
    rmSync(paths.runtimeDir, { recursive: true, force: true });
  } catch {}
  return {
    ok: true,
    status: "removed",
    message: "host_runtime_removed",
    errorCode: "",
    installationCount: listed.installations.length,
    paths,
  };
}

function enrichInstallationsWithExecution(installations = [], executionResults = []) {
  const executionByInstallationId = new Map(
    (Array.isArray(executionResults) ? executionResults : [])
      .map((entry) => [trim(entry?.installation_id), entry])
      .filter(([installationId]) => Boolean(installationId)),
  );

  return (Array.isArray(installations) ? installations : []).map((installation) => {
    const execution = executionByInstallationId.get(trim(installation?.installation_id));
    if (!execution) {
      return {
        ...installation,
        last_run_id: "",
        last_tick_id: "",
        last_exit_code: "",
        last_tick_idle: "",
      };
    }

    return {
      ...installation,
      last_run_id: trim(execution.run_id),
      last_tick_id: trim(execution.tick_id),
      last_exit_code: Number(execution.exit_code),
      last_tick_idle: Boolean(execution.tick_idle),
    };
  });
}

function evaluateOnceExecutionFailure({ once = false, scheduledDecisions = [], executionResults = [] } = {}) {
  if (!once) {
    return {
      failed: false,
      reason: "",
      failures: [],
    };
  }

  const scheduledInstallationIds = new Set(
    (Array.isArray(scheduledDecisions) ? scheduledDecisions : [])
      .map((entry) => trim(entry?.installation_id))
      .filter(Boolean),
  );

  const failures = [];
  const seen = new Set();

  for (const result of Array.isArray(executionResults) ? executionResults : []) {
    const installationId = trim(result?.installation_id);
    if (!installationId || !scheduledInstallationIds.has(installationId)) continue;
    seen.add(installationId);

    const exitCode = Number(result?.exit_code);
    const tickIdle = Boolean(result?.tick_idle);
    const error = trim(result?.error);

    if (exitCode !== 0 || tickIdle || error) {
      failures.push({
        installation_id: installationId,
        exit_code: Number.isFinite(exitCode) ? exitCode : 1,
        tick_idle: tickIdle,
        error,
      });
    }
  }

  for (const installationId of scheduledInstallationIds) {
    if (seen.has(installationId)) continue;
    failures.push({
      installation_id: installationId,
      exit_code: 1,
      tick_idle: false,
      error: "missing_execution_result",
    });
  }

  if (failures.length === 0) {
    return {
      failed: false,
      reason: "",
      failures: [],
    };
  }

  const hasExitCodeFailure = failures.some((entry) => Number(entry.exit_code) !== 0);
  const hasIdleFailure = failures.some((entry) => Boolean(entry.tick_idle));
  const reason = hasExitCodeFailure ? "non_zero_exit_code" : (hasIdleFailure ? "tick_idle" : "execution_error");

  return {
    failed: true,
    reason,
    failures,
  };
}

export async function runHostRuntime({
  paths = {},
  once = false,
  executeHostRuntimeDecisionsFn = executeHostRuntimeDecisions,
  runTickFn,
} = {}) {
  const loadedManifest = loadHostRuntimeManifest(paths);
  if (loadedManifest.ok) {
    const signatureEvidence = evaluateStoredRuntimeSignatureEvidence(loadedManifest.manifest);
    if (!signatureEvidence.ok) {
      return {
        ok: false,
        status: "signature_invalid",
        message: trim(signatureEvidence.message || FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid),
        errorCode: trim(signatureEvidence.errorCode || FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid),
        hostId: trim(loadedManifest.manifest.host_id),
        runtimeVersion: trim(loadedManifest.manifest.runtime_version),
        installationCount: 0,
        logFile: path.resolve(paths.runtimeLogDir, "hatch-host.log"),
        executionResults: [],
        paths,
      };
    }
  }

  const doctor = doctorHostRuntime({ paths });
  if (!doctor.ok) {
    return {
      ok: false,
      status: "doctor_failed",
      message: doctor.message,
      errorCode: doctor.errorCode,
      hostId: doctor.hostId,
      runtimeVersion: doctor.runtimeVersion,
      installationCount: doctor.installationCount,
      logFile: path.resolve(paths.runtimeLogDir, "hatch-host.log"),
      executionResults: [],
      paths,
    };
  }

  const runtimeVersion = trim(doctor.runtimeVersion);
  const registryPath = trim(process.env.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json");
  const registryCwd = trim(process.env.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd());

  syncHostRegistryFromCanonical({
    paths,
    env: process.env,
    installations: doctor.installations,
  });

  const repairedInstallations = repairHostInstallationAssignments({
    paths,
    env: process.env,
    installations: doctor.installations,
  });

  for (const installation of repairedInstallations || []) {
    const compatibility = evaluateInstallationRuntimeCompatibility({
      installation,
      runtimeVersion,
      registryPath,
      registryCwd,
    });
    if (!compatibility.ok) {
      return {
        ok: false,
        status: "runtime_incompatible",
        message: compatibility.message || "runtime_version_out_of_range",
        errorCode: compatibility.errorCode || FACTORY_OPS_ERROR_CODES.runtime_incompatible,
        hostId: doctor.hostId,
        runtimeVersion,
        installationCount: doctor.installationCount,
        installations: doctor.installations,
        logFile: path.resolve(paths.runtimeLogDir, "hatch-host.log"),
        executionResults: [],
        paths,
      };
    }
  }

  const wakeupLoaded = loadHostWakeupState({
    paths,
    hostId: trim(doctor.hostId),
  });
  const wakeupPoll = pollHostWakeups({
    hostId: trim(doctor.hostId),
    installations: doctor.installations,
    previousState: wakeupLoaded.state,
    paths,
    env: process.env,
  });
  const wakeupWritten = writeHostWakeupState({
    paths,
    state: wakeupPoll.state,
  });

  const schedulerLoaded = loadHostRuntimeSchedulerState({
    paths,
    hostId: trim(doctor.hostId),
  });

  const schedulerCycle = runHostRuntimeSchedulerCycle({
    hostId: trim(doctor.hostId),
    installations: repairedInstallations,
    previousState: schedulerLoaded.state,
    paths,
    env: process.env,
  });

  const schedulerWritten = writeHostRuntimeSchedulerState({
    paths,
    state: schedulerCycle.state,
  });

  const loadedHostManifest = loadHostRuntimeManifest(paths);
  const execution = await executeHostRuntimeDecisionsFn({
    hostManifest: loadedHostManifest.manifest || {},
    decisions: schedulerCycle.decisions,
    installations: repairedInstallations,
    paths,
    env: process.env,
    runTickFn,
    appendLogLineFn: appendRuntimeLog,
    daemonLogPath: path.resolve(paths.runtimeLogDir, "hatch-host.log"),
  });
  const executionResults = Array.isArray(execution?.results) ? execution.results : [];

  const health = computeSchedulerHealth({
    scheduler: schedulerCycle.summary,
    installationCount: doctor.installationCount,
  });

  const logFile = path.resolve(paths.runtimeLogDir, "hatch-host.log");
  appendRuntimeLog(
    logFile,
    `[hatch-host] tick host_id=${doctor.hostId} runtime_version=${doctor.runtimeVersion} installations=${doctor.installationCount} mode=${once ? "once" : "loop"} scheduled=${schedulerCycle.decisions.filter((entry) => entry.decision === "scheduled").length} deferred=${schedulerCycle.decisions.filter((entry) => entry.decision !== "scheduled").length} wake_sources=${(wakeupPoll.wake_sources || []).join(",") || "none"}`,
  );
  for (const decision of schedulerCycle.decisions || []) {
    if (trim(decision.selection_reason) !== "low_priority_nudge") continue;
    appendRuntimeLog(
      logFile,
      `[hatch-host] warning=low_priority_nudge installation_id=${trim(decision.installation_id)} effective_priority=${Number(decision.effective_priority) || 0} age_bonus=${Number(decision.age_bonus_counter) || 0}`,
    );
  }
  appendRuntimeLog(
    logFile,
    `[hatch-host] health host_queue_depth=${health.host_queue_depth} host_active_slots=${health.host_active_slots} host_max_active_slots=${health.host_max_active_slots} host_capacity_pressure=${health.host_capacity_pressure} host_pending_installations=${health.host_pending_installations}`,
  );
  for (const diagnostic of schedulerCycle.diagnostics || []) {
    appendRuntimeLog(logFile, `[hatch-host] scheduler ${diagnostic}`);
  }
  for (const pollError of wakeupPoll.poll_errors || []) {
    appendRuntimeLog(logFile, `[hatch-host] wakeup warning=${pollError}`);
  }
  for (const executionResult of executionResults) {
    appendRuntimeLog(
      logFile,
      `[hatch-host] execution installation_id=${trim(executionResult.installation_id)} run_id=${trim(executionResult.run_id) || "unknown"} tick_id=${trim(executionResult.tick_id) || "unknown"} exit=${Number(executionResult.exit_code) || 0} tick_idle=${Boolean(executionResult.tick_idle) ? "true" : "false"} error=${trim(executionResult.error) || "none"}`,
    );
  }

  const scheduledDecisions = schedulerCycle.decisions.filter((entry) => trim(entry.decision) === "scheduled");
  const onceFailure = evaluateOnceExecutionFailure({
    once,
    scheduledDecisions,
    executionResults,
  });

  const enrichedInstallations = enrichInstallationsWithExecution(
    enrichInstallationsWithScheduler(repairedInstallations, schedulerCycle.summary),
    executionResults,
  );

  if (onceFailure.failed) {
    return {
      ok: false,
      status: "host_runtime_once_failed",
      message: `host_runtime_once_failed:${onceFailure.reason}`,
      errorCode: "host_runtime_once_failed",
      hostId: doctor.hostId,
      runtimeVersion: doctor.runtimeVersion,
      installationCount: doctor.installationCount,
      installations: enrichedInstallations,
      executionResults,
      executionFailure: onceFailure,
      logFile,
      mode: once ? "once" : "loop",
      scheduler: schedulerCycle.summary,
      schedulerDecisions: schedulerCycle.decisions,
      schedulerStatePath: schedulerWritten.schedulerStatePath,
      wakeup: wakeupPoll.summary,
      wakeupStatePath: wakeupWritten.wakeupStatePath,
      wakeSources: wakeupPoll.wake_sources,
      ...health,
      paths,
    };
  }

  return {
    ok: true,
    status: "ok",
    message: once ? "host_runtime_once_completed" : "host_runtime_started",
    errorCode: "",
    hostId: doctor.hostId,
    runtimeVersion: doctor.runtimeVersion,
    installationCount: doctor.installationCount,
    installations: enrichedInstallations,
    executionResults,
    logFile,
    mode: once ? "once" : "loop",
    scheduler: schedulerCycle.summary,
    schedulerDecisions: schedulerCycle.decisions,
    schedulerStatePath: schedulerWritten.schedulerStatePath,
    wakeup: wakeupPoll.summary,
    wakeupStatePath: wakeupWritten.wakeupStatePath,
    wakeSources: wakeupPoll.wake_sources,
    ...health,
    paths,
  };
}
