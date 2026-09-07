import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";

import { resolveHostRuntimeVersion } from "./host-runtime-lifecycle.ts";
import { parseJson } from "../cli-helpers.ts";
import {
  FACTORY_OPS_ERROR_CODES,
  buildAmbiguousFactorySubstringErrorCode,
  buildFactoryPathNamespaceErrorCode,
  buildHostInstallMissingPathErrorCode,
  createFactoryOpsError,
} from "../error-catalog.ts";
import { loadInstanceRuntimePolicy } from "../factory-registry.ts";
import { readLeaseRecord } from "../host-lease-store.ts";
import { evaluateManagedFactoryMutationPolicy } from "../mutation-policy-contract.ts";
import { evaluateRuntimeCompatibility } from "../runtime-compatibility.ts";

function normalizeFactoryId(value = "") {
  const id = String(value || "").trim();
  if (!id) throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.factory_id_required);
  const normalized = id.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.invalid_factory_id, `invalid_factory_id:${id}`);
  }
  return normalized;
}

function trim(value = "") {
  return String(value || "").trim();
}

function resolveMutationContextFromEnv(env = process.env) {
  const raw = trim(env?.HATCH_FACTORY_MUTATION_CONTEXT_JSON || "");
  if (!raw) return null;
  const parsed = parseJson(raw, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function resolveHostLifecycleMutationContext({ env = process.env } = {}) {
  return resolveMutationContextFromEnv(env);
}

function evaluateHostPathMutationPolicy({
  operation = "",
  targetPath = "",
  mutationContext = null,
} = {}) {
  if (!mutationContext) return { allowed: true, reason: "" };

  const decision = evaluateManagedFactoryMutationPolicy({
    mutationContext: {
      ...mutationContext,
      operation: `fs:${trim(operation) || "host_path_resolve"}`,
      target_path: targetPath,
    },
  });

  if (decision.allowed) return { allowed: true, reason: "" };
  return {
    allowed: false,
    reason: trim(decision.denied_reason || decision.reason || "mutation_policy_denied"),
  };
}

function enforceHostPathPolicy({ paths = {}, mutationContext = null } = {}) {
  const targets = [
    ["logs_dir", paths.logsDir],
    ["runs_dir", paths.runsDir],
    ["tmp_dir", paths.tmpDir],
    ["socket_dir", paths.socketDir],
    ["pid_dir", paths.pidDir],
    ["pid_file", paths.pidFile],
    ["lock_dir", paths.lockDir],
  ];

  for (const [label, candidate] of targets) {
    const resolved = path.resolve(String(candidate || ""));
    const decision = evaluateHostPathMutationPolicy({
      operation: `host_${label}`,
      targetPath: resolved,
      mutationContext,
    });
    if (!decision.allowed) {
      throw createFactoryOpsError(
        FACTORY_OPS_ERROR_CODES.path_collision,
        `${label}_outside_factory_scoped_paths:${decision.reason}`,
      );
    }
  }
}

function resolveAbsolute(value = "", fallback = "") {
  const raw = String(value || "").trim() || String(fallback || "").trim();
  return path.resolve(raw || ".");
}

function toPathSegments(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
}

function containsSegmentSequence(pathSegments = [], namespaceSegments = []) {
  if (!Array.isArray(pathSegments) || !Array.isArray(namespaceSegments) || namespaceSegments.length === 0) {
    return false;
  }
  for (let i = 0; i <= pathSegments.length - namespaceSegments.length; i += 1) {
    let allMatch = true;
    for (let j = 0; j < namespaceSegments.length; j += 1) {
      if (pathSegments[i + j] !== namespaceSegments[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

function ensureNamespacedPath(label, candidatePath, factoryId) {
  const normalizedFactoryId = normalizeFactoryId(factoryId).toLowerCase();
  const pathSegments = toPathSegments(candidatePath);
  const namespaceSegments = toPathSegments(normalizedFactoryId);
  if (!containsSegmentSequence(pathSegments, namespaceSegments)) {
    throw createFactoryOpsError(
      buildFactoryPathNamespaceErrorCode(label),
      `${label}_must_include_factory_id:${factoryId}`,
    );
  }
}

function ensureNoAmbiguousFactorySubstring(label, candidatePath, factoryId) {
  const normalizedPath = String(candidatePath || "").replace(/\\/g, "/").toLowerCase();
  const normalizedFactoryId = normalizeFactoryId(factoryId).toLowerCase();
  if (!normalizedPath || !normalizedFactoryId) return;
  if (!normalizedPath.includes(normalizedFactoryId)) return;

  const pathSegments = toPathSegments(normalizedPath);
  const namespaceSegments = toPathSegments(normalizedFactoryId);
  if (!containsSegmentSequence(pathSegments, namespaceSegments)) {
    throw createFactoryOpsError(
      buildAmbiguousFactorySubstringErrorCode(label),
      `${label}_contains_ambiguous_factory_substring:${factoryId}`,
    );
  }
}

function ensureNoLocalPathCollisions(paths = {}) {
  const entries = [
    ["logsDir", paths.logsDir],
    ["runsDir", paths.runsDir],
    ["tmpDir", paths.tmpDir],
    ["socketDir", paths.socketDir],
    ["pidDir", paths.pidDir],
  ];

  const seen = new Map();
  for (const [label, value] of entries) {
    const key = path.resolve(String(value || ""));
    if (seen.has(key)) {
      throw createFactoryOpsError(
        FACTORY_OPS_ERROR_CODES.path_collision,
        `path_collision:${label}=${key};conflicts_with=${seen.get(key)}`,
      );
    }
    seen.set(key, label);
  }
}

function parsePid(value = "") {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function readPidFile(pidFile = "") {
  try {
    return parsePid(readFileSync(pidFile, "utf8"));
  } catch {
    return 0;
  }
}

function isProcessAlive(pid) {
  const parsed = Number(pid);
  if (!Number.isFinite(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeSignal(value = "TERM") {
  const normalized = String(value || "TERM").trim().toUpperCase();
  if (!normalized) return "SIGTERM";
  return normalized.startsWith("SIG") ? normalized : `SIG${normalized}`;
}

function parseDurationMs(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return 0;
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  if (unit === "d") return amount * 86_400_000;
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStableProcess(pid, stabilityWindowMs = 1500) {
  const parsedPid = Number(pid);
  if (!Number.isFinite(parsedPid) || parsedPid <= 0) return false;
  const deadline = Date.now() + Math.max(100, Number(stabilityWindowMs) || 1500);
  while (Date.now() <= deadline) {
    if (!isProcessAlive(parsedPid)) return false;
    await sleep(50);
  }
  return isProcessAlive(parsedPid);
}

async function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();
  const timeout = Math.max(100, Number(timeoutMs) || 5000);
  while (Date.now() - start < timeout) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

export function resolveHostPaths({
  factoryId,
  instanceId = "",
  baseDir = process.env.HATCH_HOST_BASE_DIR,
  logsRoot = "",
  runsDir = "",
  tmpDir = "",
  socketDir = "",
  pidDir = "",
  mutationContext = null,
  env = null,
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const normalizedInstanceId = String(instanceId || "").trim() || normalizedFactoryId;
  const defaultBaseDir = baseDir || path.join(homedir(), ".hatch-hosts");
  const resolvedBaseDir = resolveAbsolute(defaultBaseDir);
  const namespacedRoot = path.resolve(resolvedBaseDir, normalizedInstanceId);

  if (String(logsRoot || "").trim()) ensureNoAmbiguousFactorySubstring("logs_root", logsRoot, normalizedFactoryId);
  if (String(runsDir || "").trim()) ensureNoAmbiguousFactorySubstring("runs_dir", runsDir, normalizedFactoryId);
  if (String(tmpDir || "").trim()) ensureNoAmbiguousFactorySubstring("tmp_dir", tmpDir, normalizedFactoryId);
  if (String(socketDir || "").trim()) ensureNoAmbiguousFactorySubstring("socket_dir", socketDir, normalizedFactoryId);
  if (String(pidDir || "").trim()) ensureNoAmbiguousFactorySubstring("pid_dir", pidDir, normalizedFactoryId);

  const resolvedPaths = {
    factoryId: normalizedFactoryId,
    instanceId: normalizedInstanceId,
    baseDir: resolvedBaseDir,
    hostDir: namespacedRoot,
    logsDir: logsRoot ? path.resolve(logsRoot, normalizedFactoryId) : path.resolve(namespacedRoot, "logs"),
    runsDir: runsDir ? path.resolve(runsDir, normalizedFactoryId) : path.resolve(namespacedRoot, "runs"),
    tmpDir: tmpDir ? path.resolve(tmpDir, normalizedFactoryId) : path.resolve(namespacedRoot, "tmp"),
    socketDir: socketDir ? path.resolve(socketDir, normalizedFactoryId) : path.resolve(namespacedRoot, "sockets"),
    pidDir: pidDir ? path.resolve(pidDir, normalizedFactoryId) : path.resolve(namespacedRoot, "pid"),
  };

  resolvedPaths.pidFile = path.resolve(resolvedPaths.pidDir, "factory-daemon.pid");
  resolvedPaths.lockDir = path.resolve(resolvedPaths.pidDir, "factory-daemon.lock");
  resolvedPaths.artifactDir = path.resolve(namespacedRoot, "artifacts");
  resolvedPaths.installationManifestPath = path.resolve(namespacedRoot, "installation.json");

  ensureNamespacedPath("logs_dir", resolvedPaths.logsDir, normalizedInstanceId);
  ensureNamespacedPath("runs_dir", resolvedPaths.runsDir, normalizedInstanceId);
  ensureNamespacedPath("tmp_dir", resolvedPaths.tmpDir, normalizedInstanceId);
  ensureNamespacedPath("socket_dir", resolvedPaths.socketDir, normalizedInstanceId);
  ensureNamespacedPath("pid_dir", resolvedPaths.pidDir, normalizedInstanceId);
  ensureNamespacedPath("pid_file", resolvedPaths.pidFile, normalizedInstanceId);
  ensureNamespacedPath("lock_dir", resolvedPaths.lockDir, normalizedInstanceId);
  ensureNamespacedPath("artifact_dir", resolvedPaths.artifactDir, normalizedInstanceId);
  ensureNamespacedPath("installation_manifest_path", resolvedPaths.installationManifestPath, normalizedInstanceId);
  ensureNoLocalPathCollisions(resolvedPaths);

  const effectiveMutationContext = mutationContext ?? resolveHostLifecycleMutationContext(env ? { env } : undefined);
  if (effectiveMutationContext) {
    enforceHostPathPolicy({
      paths: resolvedPaths,
      mutationContext: effectiveMutationContext,
    });
  }

  return resolvedPaths;
}

function resolveWorkspaceMode(context = {}) {
  const explicit = String(context.workspace_mode || "").trim().toLowerCase();
  if (["api_only", "checkout", "worktree"].includes(explicit)) {
    return explicit;
  }

  const workDir = String(context.work_dir || "").trim();
  if (workDir) return "checkout";
  return "api_only";
}

function resolveHostId() {
  return String(process.env.HATCH_HOST_ID || process.env.HOST_ID || hostname() || "unknown-host").trim() || "unknown-host";
}

function buildInstallationManifest({ context = {}, paths = {} } = {}) {
  const instanceId = String(context.instance_id || paths.instanceId || context.factory_id || paths.factoryId || "").trim();
  const hostId = resolveHostId();
  const workspaceMode = resolveWorkspaceMode(context);
  const manifest = {
    installation_id: `inst_${instanceId || "factory"}_${hostId}`.replace(/[^A-Za-z0-9_.-]/g, "_"),
    instance_id: instanceId,
    host_id: hostId,
    workspace_mode: workspaceMode,
    work_dir: workspaceMode === "api_only" ? null : String(context.work_dir || "").trim(),
    log_dir: String(paths.logsDir || ""),
    artifact_dir: String(paths.artifactDir || ""),
    runtime_version: resolveHostRuntimeVersion(),
  };
  if (!manifest.instance_id || !manifest.host_id || !manifest.workspace_mode || !manifest.installation_id) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.invalid_factory_id, "installation_manifest_invalid");
  }
  return manifest;
}

function readInstallationManifest(paths = {}) {
  const installationManifestPath = String(paths.installationManifestPath || "").trim();
  if (!installationManifestPath) return null;
  if (!existsSync(installationManifestPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(installationManifestPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function resolveExpectedLeaseHostId({ paths = {}, env = process.env } = {}) {
  const explicitHostId = String(env?.HATCH_HOST_ID || env?.HOST_ID || "").trim();
  if (explicitHostId) return explicitHostId;

  const installationManifest = readInstallationManifest(paths);
  const manifestHostId = String(installationManifest?.host_id || "").trim();
  if (manifestHostId) return manifestHostId;

  return "";
}

function checkLeaseOwnership({ paths = {}, expectedHostId = "" } = {}) {
  const normalizedExpectedHostId = String(expectedHostId || "").trim();
  if (!String(paths.installationManifestPath || "").trim()) {
    return { ok: true, lease: null, leasePresent: false };
  }

  let leaseRecord;
  try {
    leaseRecord = readLeaseRecord({ installationManifestPath: paths.installationManifestPath });
  } catch (error) {
    return {
      ok: false,
      lease: null,
      leasePresent: false,
      errorCode: String(error?.code || FACTORY_OPS_ERROR_CODES.lease_record_invalid),
      message: String(error?.message || "lease_record_invalid"),
    };
  }

  if (!leaseRecord.exists || !leaseRecord.lease) {
    return { ok: true, lease: null, leasePresent: false };
  }

  const leaseHostId = String(leaseRecord.lease.host_id || "").trim();
  if (!normalizedExpectedHostId || !leaseHostId || leaseHostId === normalizedExpectedHostId) {
    return { ok: true, lease: leaseRecord.lease, leasePresent: true };
  }

  return {
    ok: false,
    lease: leaseRecord.lease,
    leasePresent: true,
    errorCode: FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
    message: `ambiguous_host_assignment:lease_host_id=${leaseHostId}:expected_host_id=${normalizedExpectedHostId}`,
  };
}

function resolveRuntimePolicyCompatibility({ factoryId = "", env = process.env } = {}) {
  const instanceId = trim(env?.HATCH_INSTANCE_ID || factoryId);
  if (!instanceId) {
    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode: FACTORY_OPS_ERROR_CODES.runtime_incompatible,
      message: "runtime_policy_instance_id_missing",
      runtimeVersion: trim(resolveHostRuntimeVersion()),
      allowedRange: "*",
      instanceId: "",
      registryPath: "",
    };
  }

  const registryPath = trim(env?.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json");
  const registryCwd = trim(env?.HATCH_FACTORY_REGISTRY_CWD || process.cwd());
  const runtimeVersion = trim(resolveHostRuntimeVersion());

  let policy;
  try {
    policy = loadInstanceRuntimePolicy({
      instanceId,
      registryPath,
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
        runtimeVersion,
        allowedRange: "*",
        instanceId,
        registryPath,
      };
    }

    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode,
      message: String(error?.message || "runtime_policy_lookup_failed"),
      runtimeVersion,
      allowedRange: "",
      instanceId,
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
      runtimeVersion,
      allowedRange: trim(policy.allowed_runtime_version),
      instanceId,
      registryPath: policy.registry_path,
    };
  }

  if (compatibility.ok) {
    return {
      ok: true,
      status: "runtime_compatible",
      errorCode: "",
      message: compatibility.reason || "runtime_version_compatible",
      runtimeVersion: compatibility.runtimeVersion || runtimeVersion,
      allowedRange: compatibility.allowedRange || trim(policy.allowed_runtime_version),
      instanceId,
      registryPath: policy.registry_path,
    };
  }

  return {
    ok: false,
    status: "runtime_incompatible",
    errorCode: FACTORY_OPS_ERROR_CODES.runtime_incompatible,
    message: compatibility.reason || `runtime_version_out_of_range:${runtimeVersion}:${trim(policy.allowed_runtime_version) || "*"}`,
    runtimeVersion: compatibility.runtimeVersion || runtimeVersion,
    allowedRange: compatibility.allowedRange || trim(policy.allowed_runtime_version),
    instanceId,
    registryPath: policy.registry_path,
  };
}

export function hostInstall(resolvedPaths = {}, context = {}) {
  const paths = { ...resolvedPaths };
  const required = ["factoryId", "instanceId", "logsDir", "runsDir", "tmpDir", "socketDir", "pidDir", "pidFile", "lockDir", "artifactDir", "installationManifestPath"];
  for (const key of required) {
    if (!String(paths[key] || "").trim()) {
      throw createFactoryOpsError(buildHostInstallMissingPathErrorCode(key));
    }
  }

  const installPaths = [paths.logsDir, paths.runsDir, paths.tmpDir, paths.socketDir, paths.pidDir, paths.artifactDir];
  for (const dir of installPaths) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(path.dirname(paths.installationManifestPath), { recursive: true });
  const installationManifest = buildInstallationManifest({ context, paths });
  writeFileSync(paths.installationManifestPath, `${JSON.stringify(installationManifest, null, 2)}\n`);

  return {
    ok: true,
    status: "installed",
    message: "host_paths_installed",
    factoryId: paths.factoryId,
    instanceId: paths.instanceId,
    pid: readPidFile(paths.pidFile),
    paths,
    installedPaths: installPaths,
    installationManifest,
  };
}

export async function hostStart({
  factoryId,
  daemonScript = "",
  env = {},
  detach = true,
  pidFile = "",
  paths = {},
  spawnImpl = spawn,
  cwd = process.cwd(),
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const resolvedPidFile = path.resolve(String(pidFile || "").trim());
  if (!resolvedPidFile) throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.pid_file_required);

  const leaseDecision = checkLeaseOwnership({
    paths,
    expectedHostId: resolveExpectedLeaseHostId({ paths, env }),
  });
  if (!leaseDecision.ok) {
    return {
      ok: false,
      status: "lease_mismatch",
      errorCode: leaseDecision.errorCode || FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      message: leaseDecision.message || "ambiguous_host_assignment",
      factoryId: normalizedFactoryId,
      pid: 0,
      paths,
      lease: leaseDecision.lease || null,
    };
  }

  const runtimePolicyDecision = resolveRuntimePolicyCompatibility({
    factoryId: normalizedFactoryId,
    env: {
      ...process.env,
      ...env,
    },
  });
  if (!runtimePolicyDecision.ok) {
    return {
      ok: false,
      status: "runtime_incompatible",
      errorCode: runtimePolicyDecision.errorCode || FACTORY_OPS_ERROR_CODES.runtime_incompatible,
      message: runtimePolicyDecision.message || `runtime_version_out_of_range:${runtimePolicyDecision.runtimeVersion || "unknown"}:${runtimePolicyDecision.allowedRange || "*"}`,
      factoryId: normalizedFactoryId,
      pid: 0,
      paths,
      runtimeVersion: runtimePolicyDecision.runtimeVersion || "",
      allowedRuntimeVersion: runtimePolicyDecision.allowedRange || "",
      registryPath: runtimePolicyDecision.registryPath || "",
      instanceId: runtimePolicyDecision.instanceId || "",
    };
  }

  const existingPid = readPidFile(resolvedPidFile);
  if (existingPid > 0 && isProcessAlive(existingPid)) {
    return {
      ok: false,
      status: "already_running",
      errorCode: FACTORY_OPS_ERROR_CODES.factory_host_already_running,
      message: `factory_host_already_running pid=${existingPid}`,
      factoryId: normalizedFactoryId,
      pid: existingPid,
      paths,
    };
  }
  if (existingPid > 0) {
    try { unlinkSync(resolvedPidFile); } catch {}
  }

  const resolvedScript = path.resolve(String(daemonScript || "").trim());
  if (!String(daemonScript || "").trim()) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.daemon_script_required);
  }
  if (!existsSync(resolvedScript)) {
    return {
      ok: false,
      status: "daemon_script_missing",
      errorCode: FACTORY_OPS_ERROR_CODES.daemon_script_missing,
      message: `daemon_script_not_found:${resolvedScript}`,
      factoryId: normalizedFactoryId,
      pid: 0,
      paths,
    };
  }

  mkdirSync(path.dirname(resolvedPidFile), { recursive: true });
  const mergedEnv = {
    ...process.env,
    ...env,
    HATCH_FACTORY_ID: normalizedFactoryId,
    FACTORY_DAEMON_PID_FILE: resolvedPidFile,
  };

  let child;
  try {
    child = spawnImpl(resolvedScript, [normalizedFactoryId], {
      cwd,
      env: mergedEnv,
      detached: Boolean(detach),
      stdio: "ignore",
    });
  } catch (error) {
    return {
      ok: false,
      status: "spawn_failed",
      errorCode: FACTORY_OPS_ERROR_CODES.daemon_spawn_failed,
      message: String(error?.message || error || "spawn_failed"),
      factoryId: normalizedFactoryId,
      pid: 0,
      paths,
    };
  }

  if (typeof child?.unref === "function") child.unref();

  const fallbackPid = parsePid(child?.pid);
  if (!readPidFile(resolvedPidFile) && fallbackPid > 0) {
    try { writeFileSync(resolvedPidFile, `${fallbackPid}\n`); } catch {}
  }

  let pid = 0;
  const waitUntil = Date.now() + 1000;
  while (Date.now() <= waitUntil) {
    pid = readPidFile(resolvedPidFile) || fallbackPid;
    if (pid > 0 && isProcessAlive(pid)) break;
    await sleep(50);
  }

  // @context:regression !critical host-start must prove the daemon survived
  // past launcher bootstrap or detached shell handoff; brief child liveness
  // is not enough because it misclassifies a crashing daemon as "started".
  const running = await waitForStableProcess(pid);
  if (!running) {
    try { unlinkSync(resolvedPidFile); } catch {}
    return {
      ok: false,
      status: "start_failed",
      errorCode: FACTORY_OPS_ERROR_CODES.factory_host_start_failed,
      message: "factory_host_process_not_running",
      factoryId: normalizedFactoryId,
      pid,
      paths,
    };
  }

  return {
    ok: true,
    status: "started",
    message: "factory_host_started",
    factoryId: normalizedFactoryId,
    pid,
    paths,
  };
}

export async function hostStop({
  factoryId,
  pidFile = "",
  signal = "TERM",
  timeoutMs = 5000,
  paths = {},
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const resolvedPidFile = path.resolve(String(pidFile || "").trim());
  if (!resolvedPidFile) throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.pid_file_required);

  const pid = readPidFile(resolvedPidFile);
  if (!pid) {
    return {
      ok: true,
      status: "already_stopped",
      message: "factory_host_not_running",
      factoryId: normalizedFactoryId,
      pid: 0,
      paths,
    };
  }

  if (!isProcessAlive(pid)) {
    try { unlinkSync(resolvedPidFile); } catch {}
    return {
      ok: true,
      status: "stale_pid_cleared",
      message: "factory_host_stale_pid_removed",
      factoryId: normalizedFactoryId,
      pid,
      paths,
    };
  }

  try {
    process.kill(pid, normalizeSignal(signal));
  } catch (error) {
    return {
      ok: false,
      status: "stop_signal_failed",
      errorCode: FACTORY_OPS_ERROR_CODES.factory_host_stop_signal_failed,
      message: String(error?.message || error || "stop_signal_failed"),
      factoryId: normalizedFactoryId,
      pid,
      paths,
    };
  }

  let stopped = await waitForProcessExit(pid, timeoutMs);
  let status = "stopped";
  let message = "factory_host_stopped";

  if (!stopped) {
    try { process.kill(pid, "KILL"); } catch {}
    stopped = await waitForProcessExit(pid, 2000);
    status = stopped ? "force_killed" : "stop_timeout";
    message = stopped ? "factory_host_force_stopped" : "factory_host_stop_timeout";
  }

  if (stopped) {
    try { unlinkSync(resolvedPidFile); } catch {}
    const lockDir = String(paths.lockDir || "").trim();
    if (lockDir) {
      try { rmSync(path.resolve(lockDir), { recursive: true, force: true }); } catch {}
    }
  }

  return {
    ok: Boolean(stopped),
    status,
    errorCode: stopped ? "" : FACTORY_OPS_ERROR_CODES.factory_host_stop_timeout,
    message,
    factoryId: normalizedFactoryId,
    pid,
    paths,
  };
}

export async function hostRestart(options = {}) {
  const stopResult = await hostStop(options);
  if (!stopResult.ok && stopResult.status !== "already_stopped") {
    return {
      ok: false,
      status: "restart_failed",
      message: stopResult.message,
      factoryId: stopResult.factoryId,
      pid: stopResult.pid,
      paths: options.paths || stopResult.paths,
      stopStatus: stopResult.status,
      startStatus: "",
    };
  }

  const startResult = await hostStart(options);
  return {
    ok: Boolean(startResult.ok),
    status: startResult.ok ? "restarted" : "restart_failed",
    errorCode: startResult.errorCode || "",
    message: startResult.message,
    factoryId: startResult.factoryId,
    pid: startResult.pid,
    paths: startResult.paths,
    stopStatus: stopResult.status,
    startStatus: startResult.status,
  };
}

export function hostHealth({
  factoryId,
  pidFile = "",
  runsDir = "",
  logsDir = "",
  paths = {},
  env = process.env,
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const resolvedPidFile = path.resolve(String(pidFile || "").trim());
  const resolvedRunsDir = path.resolve(String(runsDir || "").trim());
  const resolvedLogsDir = path.resolve(String(logsDir || "").trim());

  const leaseDecision = checkLeaseOwnership({
    paths,
    expectedHostId: resolveExpectedLeaseHostId({ paths, env }),
  });
  if (!leaseDecision.ok) {
    return {
      ok: false,
      status: "lease_mismatch",
      message: leaseDecision.message || "ambiguous_host_assignment",
      errorCode: leaseDecision.errorCode || FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      factoryId: normalizedFactoryId,
      pid: 0,
      running: false,
      runCount: 0,
      logFile: path.resolve(resolvedLogsDir, "daemon.log"),
      logExists: existsSync(path.resolve(resolvedLogsDir, "daemon.log")),
      paths,
      lease: leaseDecision.lease || null,
    };
  }

  const pid = readPidFile(resolvedPidFile);
  const running = pid > 0 && isProcessAlive(pid);
  const daemonLog = path.resolve(resolvedLogsDir, "daemon.log");
  const logExists = existsSync(daemonLog);

  let runCount = 0;
  try {
    runCount = readdirSync(resolvedRunsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    runCount = 0;
  }

  return {
    ok: true,
    status: running ? "running" : "stopped",
    message: running ? "factory_host_running" : "factory_host_stopped",
    factoryId: normalizedFactoryId,
    pid,
    running,
    runCount,
    logFile: daemonLog,
    logExists,
    paths,
  };
}

export function hostVersion({
  factoryRoot = process.cwd(),
  factoryId = "",
  releaseCommand = "",
  paths = {},
} = {}) {
  const resolvedRoot = path.resolve(String(factoryRoot || process.cwd()));
  const resolvedReleaseCommand = String(releaseCommand || "").trim();

  if (resolvedReleaseCommand) {
    const release = spawnSync("bash", ["-lc", resolvedReleaseCommand], {
      encoding: "utf8",
    });
    const releaseVersion = String(release.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "";
    if (release.status === 0 && releaseVersion) {
      return {
        ok: true,
        status: "ok",
        message: "factory_version_from_release_command",
        factoryId: String(factoryId || ""),
        version: releaseVersion,
        source: "release_command",
        paths,
      };
    }
  }

  const packageJsonPath = path.resolve(resolvedRoot, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const version = String(parsed.version || "").trim();
      if (version) {
        return {
          ok: true,
          status: "ok",
          message: "factory_version_from_package_json",
          factoryId: String(factoryId || ""),
          version,
          source: "package_json",
          paths,
        };
      }
    } catch {
      // fallback to git sha
    }
  }

  const git = spawnSync("git", ["-C", resolvedRoot, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  const sha = String(git.stdout || "").trim();
  if (git.status === 0 && sha) {
    return {
      ok: true,
      status: "ok",
      message: "factory_version_from_git_sha",
      factoryId: String(factoryId || ""),
      version: `git:${sha}`,
      source: "git_sha",
      paths,
    };
  }

  return {
    ok: false,
    status: "unknown",
    errorCode: FACTORY_OPS_ERROR_CODES.factory_version_unresolved,
    message: "factory_version_unresolved",
    factoryId: String(factoryId || ""),
    version: "unknown",
    source: "unknown",
    paths,
  };
}

export function hostLogs({
  factoryId,
  logsDir = "",
  tailLines = 100,
  sinceDuration = "",
  paths = {},
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const resolvedLogsDir = path.resolve(String(logsDir || "").trim());
  const logsPolicyHint = {
    retention_policy: "no_automatic_rotation",
    recommended_max_age: "30d",
    prune_command: "truncate or rotate daemon.log manually",
  };
  if (!existsSync(resolvedLogsDir)) {
    return {
      ok: false,
      status: "logs_dir_missing",
      errorCode: FACTORY_OPS_ERROR_CODES.factory_host_logs_dir_missing,
      message: "factory_host_logs_dir_missing",
      factoryId: normalizedFactoryId,
      files: [],
      lines: [],
      sinceDuration: String(sinceDuration || ""),
      logsPolicyHint,
      paths,
    };
  }

  const cutoffMs = parseDurationMs(sinceDuration);
  const threshold = cutoffMs > 0 ? Date.now() - cutoffMs : 0;

  const files = readdirSync(resolvedLogsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => {
      const fullPath = path.resolve(resolvedLogsDir, entry.name);
      let mtimeMs = 0;
      try { mtimeMs = statSync(fullPath).mtimeMs; } catch {}
      return { file: fullPath, name: entry.name, mtimeMs };
    })
    .filter((entry) => threshold === 0 || entry.mtimeMs >= threshold)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const renderedLines = [];
  for (const file of files) {
    let raw = "";
    try { raw = readFileSync(file.file, "utf8"); } catch { raw = ""; }
    const split = raw.split(/\r?\n/).filter(Boolean);
    for (const line of split) renderedLines.push(`[${file.name}] ${line}`);
  }

  const limit = Math.max(1, Number(tailLines) || 100);
  const lines = renderedLines.slice(Math.max(0, renderedLines.length - limit));

  return {
    ok: true,
    status: "ok",
    message: "factory_host_logs_read",
    factoryId: normalizedFactoryId,
    files: files.map((entry) => entry.file),
    lines,
    sinceDuration: String(sinceDuration || ""),
    logsPolicyHint,
    paths,
  };
}
