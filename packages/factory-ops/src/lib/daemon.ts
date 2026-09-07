import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getCanonicalControlActiveAction,
  readCanonicalFactoryControlStateSync,
  writeCanonicalFactoryControlStateSync,
} from "./canonical-control-state.ts";
import { resolveCanonicalCheckoutPath } from "./canonical-worktree.ts";
import { parseJson } from "./cli-helpers.ts";
import {
  evaluateCircuitBreakerCooldown,
  evaluateCircuitBreakerTransition,
  normalizeBreakerThreshold,
  readTickFailureEvidence,
  tripCircuitBreaker,
} from "./daemon-circuit-breaker.ts";
import { evaluateDaemonControlStateAction } from "./daemon-control-decision.ts";
import { buildClearedActionState, resumeDaemonControlState } from "./daemon-control-state.ts";
import {
  runInstallAndBuild as runInstallAndBuildImpl,
  shouldRunInstall as shouldRunInstallImpl,
} from "./daemon-install-bootstrap.ts";
import { runWithLeaseHeartbeat } from "./daemon-lease-heartbeat.ts";
import {
  DEFAULT_DAEMON_LEASE_TTL_SEC,
  acquireLease,
  ensureStartupLease,
  reacquireLeaseIfNeeded,
  releaseLease,
  renewLease,
  renewLeaseOrPause,
  resolveDaemonLeaseTtl,
} from "./daemon-lease.ts";
import { resolveLlmIsolationFromConfig } from "./daemon-llm-isolation.ts";
import { shouldSkipRecoverySweepWorktreeScan } from "./daemon-recovery-policy.ts";
import { runScheduledJobs } from "./daemon-scheduled-jobs.ts";
import { terminateActiveChildAndExit } from "./daemon-shutdown.ts";
import { runTick } from "./daemon-tick-runner.ts";
import {
  DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
  DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
  normalizeDispatchLatencySloSeconds,
  normalizeMaintenanceIntervalSeconds,
} from "./dispatch-slo-policy.ts";
import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "./error-catalog.ts";
import { readExternalFactoryControlState } from "./external-factory-control-state.ts";
import { resolveFactoryContext as resolveFactoryContextFromResolver } from "./factory-context-resolver.ts";
import { resolvePrimaryOpsRepo } from "./factory-repo-identity.ts";
import { buildFactoryRepoRoleContextFromFactory } from "./factory-repo-roles.ts";
import { guardGitMutation } from "./git-mutation-guard.ts";
import { readHostFactoryIntent } from "./host-factory-intent.ts";
import { emitManagedLifecycleEventImpl } from "./managed-factory-lifecycle-telemetry.ts";
import { resolveRunsDir } from "./runs-dir-resolver.ts";
import {
  ROOT_LOCKFILE,
  resolveRootLockfilePath,
} from "./workspace-package-manager.ts";
import { loadFactoryConfig } from "../commands/factory-config-loader.ts";
import { reconcileRuntimeRecoverySweep } from "../commands/factory-recovery-sweep.ts";
import { emitBugIssue } from "../commands/supervisor-artifact.ts";

export { resumeDaemonControlState } from "./daemon-control-state.ts";

export const ACTIVE_SLEEP_MS = 45_000;
export const IDLE_SLEEP_BASE_MS = 600_000;
export const IDLE_SLEEP_MAX_MS = 600_000;
export const MANAGED_FACTORY_TELEMETRY_EVENTS = Object.freeze([
  Object.freeze({
    event: "factory.lifecycle.tick",
    required_fields: Object.freeze([
      "factory_id",
      "instance_id",
      "installation_id",
      "host_id",
      "kind_id",
      "run_id",
      "tick_id",
      "event_type",
      "status",
      "started_at",
      "ended_at",
      "duration_ms",
      "incident_fingerprint",
      "runtime_version",
      "kind_version",
      "policy_profile",
      "tick_idle",
    ]),
  }),
  Object.freeze({
    event: "factory.lifecycle.sleep",
    required_fields: Object.freeze([
      "factory_id",
      "instance_id",
      "installation_id",
      "host_id",
      "kind_id",
      "run_id",
      "tick_id",
      "event_type",
      "status",
      "started_at",
      "ended_at",
      "duration_ms",
      "incident_fingerprint",
      "runtime_version",
      "kind_version",
      "policy_profile",
      "reason",
      "sleep_ms",
    ]),
  }),
]);
export const MANAGED_FACTORY_DAEMON_STATE_SNAPSHOT_SCHEMA = Object.freeze({
  required_fields: Object.freeze([
    "factory_id",
    "branch",
    "canonical_checkout_path",
    "running_from_canonical",
  ]),
});
const FACTORY_DAEMON_LOCK_DIRNAME = "factory-daemon.lock";
const FACTORY_DAEMON_PID_FILENAME = "factory-daemon.pid";
const INSTALL_MTIME_CACHE_FILENAME = "last-install-lockfile-mtime";
const CIRCUIT_BREAKER_DEFAULT_THRESHOLD = 6;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 60_000; // 30 minutes
function trim(value = "") {
  return String(value || "").trim();
}
function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function normalizeTickIdle(tickIdle) {
  if (typeof tickIdle === "string") {
    const normalized = trim(tickIdle).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false" || normalized === "") return false;
  }
  return Boolean(tickIdle);
}
function normalizePid(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}
function isProcessAlive(pid) {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return false;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}
function readPidFile(pidFilePath = "") {
  try {
    return normalizePid(readFileSync(pidFilePath, "utf8"));
  } catch {
    return 0;
  }
}
function appendLogLine(logPath, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  appendFileSync(logPath, `${line}\n`, "utf8");
}
function appendCommandOutputToLog(logPath, output = "") {
  const text = String(output || "");
  if (!text.trim()) return;
  appendFileSync(logPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function isControlStateLockTimeout(error) {
  const message = trim(error?.message || error || "");
  const code = trim(error?.code || "");
  return code === "55P03" || /lock timeout/i.test(message);
}

function readDaemonControlState({
  factoryId = "",
  repoRoot = process.cwd(),
  readControlStateFn = readCanonicalFactoryControlStateSync,
  appendLogLineFn = appendLogLine,
  daemonLogPath = "",
} = {}) {
  try {
    return readControlStateFn({
      factoryId,
      rootDir: repoRoot,
    });
  } catch (error) {
    if (!isControlStateLockTimeout(error)) throw error;
    // @context:regression !critical A busy canonical control-state projection
    // must not crash the managed daemon before tick_start. Fall back to the
    // mirrored control-state snapshot so the daemon can preserve pause/retry
    // semantics while Postgres lock contention clears.
    const fallback = readExternalFactoryControlState({
      factoryId,
      rootDir: repoRoot,
    });
    appendLogLineFn(
      daemonLogPath,
      `control_state_fallback source=mirror reason=lock_timeout state_path=${trim(fallback.state_path || "") || "unknown"}`,
    );
    return fallback;
  }
}
function normalizeEnvValue(raw = "") {
  const value = String(raw ?? "");
  const hasDoubleQuotes = value.startsWith('"') && value.endsWith('"');
  const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
  const unwrapped = (hasDoubleQuotes || hasSingleQuotes) ? value.slice(1, -1) : value;
  if (!hasDoubleQuotes) return unwrapped;
  return unwrapped
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}
function parseEnvLine(line = "", { requireExport = false } = {}) {
  const value = String(line || "").trim();
  if (!value || value.startsWith("#")) return null;

  const pattern = requireExport
    ? /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
    : /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

  const match = value.match(pattern);
  if (!match) return null;

  return {
    key: match[1],
    value: normalizeEnvValue(match[2]),
  };
}
function applyEnvFile(filePath = "", { requireExport = false } = {}) {
  if (!filePath || !existsSync(filePath)) return { loaded: false, assignments: 0 };

  const raw = readFileSync(filePath, "utf8");
  let assignments = 0;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line, { requireExport });
    if (!parsed) continue;
    process.env[parsed.key] = parsed.value;
    assignments += 1;
  }

  return { loaded: true, assignments };
}
function parseRemoteRepoSlug(remote = "") {
  const normalized = trim(remote)
    .replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");

  const [owner, repo] = normalized.split("/");
  if (!owner || !repo) return { owner: "", repo: "" };
  return { owner, repo };
}
function resolveRepoRootFromModule() {
  const moduleFile = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(moduleFile);
  return path.resolve(moduleDir, "../../../../");
}
function loadDaemonEnvironment({ repoRoot = process.cwd(), daemonLogPath = "" } = {}) {
  const loaded = [];

  const secretsPath = "/run/secrets/rendered/env.sh";
  const secretsResult = applyEnvFile(secretsPath, { requireExport: true });
  if (secretsResult.loaded) loaded.push(secretsPath);

  const dotEnvPath = path.resolve(repoRoot, ".env");
  const dotEnvResult = applyEnvFile(dotEnvPath);
  if (dotEnvResult.loaded) loaded.push(dotEnvPath);

  const remote = spawnSync("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" });
  const { owner, repo } = parseRemoteRepoSlug(remote.stdout || "");
  if (owner && repo) {
    const sharedEnvPath = path.join(homedir(), ".hatch-hosts", ".env.d", owner, `${repo}.env`);
    const sharedResult = applyEnvFile(sharedEnvPath);
    if (sharedResult.loaded) loaded.push(sharedEnvPath);
  }
  if (daemonLogPath) {
    for (const filePath of loaded) {
      appendLogLine(daemonLogPath, `env_loaded path=${filePath}`);
    }
  }
  return loaded;
}
export function resolveDaemonPaths({ factoryId = "", hostBaseDir = "" } = {}) {
  const normalizedFactoryId = trim(factoryId);
  const baseDir = path.resolve(trim(hostBaseDir) || path.join(homedir(), ".hatch-hosts"));
  const hostRoot = path.resolve(baseDir, normalizedFactoryId);
  const pidDir = path.resolve(hostRoot, "pid");
  const logsDir = path.resolve(hostRoot, "logs");
  const tmpDir = path.resolve(hostRoot, "tmp");
  const socketDir = path.resolve(hostRoot, "sockets");

  return {
    factoryId: normalizedFactoryId,
    baseDir,
    hostRoot,
    pidDir,
    logsDir,
    tmpDir,
    socketDir,
    pidFile: path.resolve(pidDir, FACTORY_DAEMON_PID_FILENAME),
    lockDir: path.resolve(pidDir, FACTORY_DAEMON_LOCK_DIRNAME),
    daemonLogPath: path.resolve(logsDir, "daemon.log"),
    lockfilePath: resolveRootLockfilePath(resolveRepoRootFromModule()),
    installMtimeCachePath: path.resolve(tmpDir, INSTALL_MTIME_CACHE_FILENAME),
    scheduledJobsStatePath: path.resolve(tmpDir, "scheduled-jobs-state.json"),
    intentFilePath: path.resolve(hostRoot, "intent.json"),
  };
}
function ensureDaemonDirs(paths = {}) {
  mkdirSync(paths.pidDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.tmpDir, { recursive: true });
  mkdirSync(paths.socketDir, { recursive: true });
}
function releaseDaemonLock(paths = {}) {
  try {
    rmSync(paths.lockDir, { recursive: true, force: true });
  } catch {}
  try {
    rmSync(paths.pidFile, { force: true });
  } catch {}
}
function acquireDaemonLock(paths = {}, { pid = process.pid } = {}) {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) throw new Error("invalid_process_pid");
  try {
    mkdirSync(paths.lockDir, { recursive: false });
    writeFileSync(paths.pidFile, String(normalizedPid));
    return { acquired: true, reused: false };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existingPid = readPidFile(paths.pidFile);
    if (existingPid === normalizedPid) {
      return { acquired: false, reused: true };
    }
    if (existingPid > 0 && isProcessAlive(existingPid)) {
      throw new Error("Daemon already running");
    }
    releaseDaemonLock(paths);
    mkdirSync(paths.lockDir, { recursive: false });
    writeFileSync(paths.pidFile, String(normalizedPid));
    return { acquired: true, reused: false, recovered: true };
  }
}
export function resolveTickSleep(tickIdle) {
  return normalizeTickIdle(tickIdle) ? IDLE_SLEEP_BASE_MS : ACTIVE_SLEEP_MS;
}
export function resolveLeaseSafeSleepMs({
  tickIdle = false,
  leaseTtlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
  leaseRenewLeadMs = Math.floor((DEFAULT_DAEMON_LEASE_TTL_SEC * 1000) / 2),
} = {}) {
  const desiredSleepMs = resolveTickSleep(tickIdle);
  const ttlMs = Math.max(1_000, Number(leaseTtlSec) * 1000 || DEFAULT_DAEMON_LEASE_TTL_SEC * 1000);
  const renewLeadMs = Math.max(1_000, Number(leaseRenewLeadMs) || Math.floor(ttlMs / 2));
  const hardCapMs = Math.max(1_000, ttlMs - renewLeadMs - 1_000);
  return Math.min(desiredSleepMs, hardCapMs);
}
export function shouldRunInstall(lockfilePath = "", mtimeCachePath = "") {
  return shouldRunInstallImpl(lockfilePath, mtimeCachePath);
}

export function runInstallAndBuild(args = {}) {
  return runInstallAndBuildImpl({
    appendCommandOutputToLogFn: appendCommandOutputToLog,
    appendLogLineFn: appendLogLine,
    ...args,
  });
}
export function detectOrphanPids(pidDir = "", { currentPid = process.pid, killFn = process.kill } = {}) {
  let files = [];
  try {
    files = readdirSync(pidDir)
      .filter((name) => name.endsWith(".pid"))
      .sort();
  } catch {
    return [];
  }
  const normalizedCurrentPid = normalizePid(currentPid);
  const orphans = [];

  for (const file of files) {
    const filePath = path.resolve(pidDir, file);
    const pid = readPidFile(filePath);
    if (!pid) continue;
    if (normalizedCurrentPid > 0 && pid === normalizedCurrentPid) continue;

    try {
      killFn(pid, 0);
      orphans.push({ pid, file: filePath, access: "ok" });
    } catch (error) {
      const code = trim(error?.code || "");
      if (code === "EPERM") {
        orphans.push({ pid, file: filePath, access: "eperm" });
      }
    }
  }
  return orphans;
}
export function resolveFactoryContext(factoryId = "", { resolveContext = resolveFactoryContextFromResolver } = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    throw new Error("factory_id_required");
  }
  const factoryRoot = `factories/${normalizedFactoryId}`;
  return resolveContext({ factoryId: normalizedFactoryId, factoryRoot, requireTargetRepo: true });
}
function resolveDispatchGraph(config = {}, repoRoot = "") {
  const pipeline = config && typeof config.pipeline === "object" ? config.pipeline : {};
  const dispatch = config && typeof config.dispatch === "object" ? config.dispatch : {};
  const graphPath = trim(dispatch.graph || pipeline.supervisor_tick || "");
  if (!graphPath) {
    throw new Error("factory_dispatch_graph_missing");
  }
  if (path.isAbsolute(graphPath)) return graphPath;
  return path.resolve(repoRoot, graphPath);
}
function resolveSupervisorGraph(config = {}, repoRoot = "") {
  const pipeline = config && typeof config.pipeline === "object" ? config.pipeline : {};
  const dispatch = config && typeof config.dispatch === "object" ? config.dispatch : {};
  const graphPath = trim(pipeline.supervisor_tick || dispatch.graph || "");
  if (!graphPath) {
    throw new Error("factory_supervisor_graph_missing");
  }
  if (path.isAbsolute(graphPath)) return graphPath;
  return path.resolve(repoRoot, graphPath);
}
function resolveContextRepoPath({ repoRoot = "", config = {} } = {}) {
  const explicit = trim(process.env.FACTORY_CONTEXT_REPO_PATH || "");
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  }
  const workDir = trim(config?.work_dir || "");
  if (workDir) {
    return path.isAbsolute(workDir) ? workDir : path.resolve(repoRoot, workDir);
  }
  return repoRoot;
}
function resolveCurrentBranch(repoRoot = "") {
  const current = spawnSync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  if (current.status !== 0) return "";
  return trim(current.stdout || "");
}
function resolveMutationContextFromFactory({ context = {}, identity = {} } = {}) {
  const destinations = parseJson(trim(context?.destinations_json || ""), {});
  return {
    target_repo: trim(identity?.target_repo || context?.target_repo || ""),
    destinations: destinations && typeof destinations === "object" ? destinations : {},
    control_plane_repo: trim(context?.control_plane_repo || ""),
    instance_id: trim(context?.instance_id || context?.factory_id || ""),
    kind_id: trim(context?.kind_id || ""),
  };
}
export function resolveTickRuntime({ factoryId = "", repoRoot = "" } = {}) {
  const context = resolveFactoryContext(factoryId);
  const loaded = loadFactoryConfig({
    factoryRoot: context.factory_root,
    configPath: context.factory_config_path,
  });
  const config = loaded.config || {};
  const canonicalCheckoutPath = resolveCanonicalCheckoutPath({ config, baseDir: repoRoot });
  const contextRepoPath = resolveContextRepoPath({ repoRoot, config });
  const repoRoleContext = buildFactoryRepoRoleContextFromFactory({ context, config });
  const identity = resolvePrimaryOpsRepo({ context, factoryId: context.factory_id });

  return {
    factoryId: context.factory_id,
    factoryRoot: context.factory_root,
    factoryConfigPath: context.factory_config_path,
    config,
    canonicalCheckoutPath,
    targetRepo: identity.target_repo,
    controlPlaneRepo: repoRoleContext.controlPlaneRepo || identity.target_repo,
    runsDir: resolveRunsDir({ runsDir: trim(config.runs_dir || context.runs_dir || ""), factoryId: context.factory_id, baseDir: contextRepoPath || repoRoot }),
    contextRepoPath,
    dispatchGraph: resolveDispatchGraph(config, repoRoot),
    supervisorGraph: resolveSupervisorGraph(config, repoRoot),
    dispatchLatencySloSeconds: normalizeDispatchLatencySloSeconds(
      config?.dispatch?.latency_slo_seconds,
      DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
    ),
    maintenanceIntervalSeconds: normalizeMaintenanceIntervalSeconds(
      config?.pipeline?.maintenance_interval_seconds,
      DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
    ),
    repoRoleContext,
    mutationContext: resolveMutationContextFromFactory({ context, identity }),
    llmIsolation: resolveLlmIsolationFromConfig(config),
  };
}
export function evaluateDaemonStartupInvariants({
  factoryId = "",
  repoRoot = "",
  config = {},
  canonicalCheckoutPath = "",
  currentBranch = "",
  repoRoleContext = {},
} = {}) {
  const branch = trim(currentBranch) || resolveCurrentBranch(repoRoot);
  const canonical = resolveCanonicalCheckoutPath({
    configuredPath: canonicalCheckoutPath,
    config,
    baseDir: repoRoot,
  });
  const repoGuard = guardGitMutation({
    operation: "status",
    repoPath: repoRoot,
    canonicalCheckoutPath: canonical,
    currentBranch: branch,
    mutationContext: repoRoleContext?.mutationContext || null,
    ...repoRoleContext,
  });
  const runningFromCanonical = Boolean(canonical) && !repoGuard.blocked && trim(repoRoot) === trim(canonical);
  if (!runningFromCanonical) {
    return { ok: true, branch, canonical_checkout_path: canonical, running_from_canonical: false };
  }
  if (config?.managed === true && !trim(config?.work_dir)) {
    return {
      ok: false,
      code: "managed_factory_cannot_run_from_canonical_checkout",
      branch,
      canonical_checkout_path: canonical,
      running_from_canonical: true,
    };
  }
  if ((trim(factoryId) || trim(config?.factory_id)) === "mothership" && branch !== "main") {
    return {
      ok: false,
      code: "canonical_checkout_requires_main",
      branch,
      canonical_checkout_path: canonical,
      running_from_canonical: true,
    };
  }
  return { ok: true, branch, canonical_checkout_path: canonical, running_from_canonical: true };
}
function runRecoverySweep({ factoryId = "", runsDir = "", repoRoot = "", daemonLogPath = "", skipWorktreeScan = false } = {}) {
  const canonicalPath = trim(process.env.HATCH_CANONICAL_CHECKOUT_PATH || "");
  const protectedPaths = [];
  if (canonicalPath) protectedPaths.push(canonicalPath);
  if (repoRoot && repoRoot !== canonicalPath) protectedPaths.push(repoRoot);

  const result = reconcileRuntimeRecoverySweep({
    factoryId,
    runsDir,
    repoPath: repoRoot,
    staleMinutes: 20,
    apply: true,
    skipWorktreeScan,
    protectedPaths,
  });
  appendCommandOutputToLog(daemonLogPath, JSON.stringify(result));

  if (result.ok !== true) {
    appendLogLine(daemonLogPath, `recovery_sweep_failed error=${trim(result.error || "runtime_recovery_sweep_failed")}`);
  }
}
export function evaluateGitPullGuard({ repoRoot = "", branch = "", canonicalCheckoutPath = "", repoRoleContext = {} } = {}) {
  const resolvedBranch = trim(branch) || resolveCurrentBranch(repoRoot);
  const guard = guardGitMutation({
    operation: "pull_ff_only_main",
    repoPath: repoRoot,
    canonicalCheckoutPath: canonicalCheckoutPath || resolveCanonicalCheckoutPath({ baseDir: repoRoot }),
    currentBranch: resolvedBranch,
    targetBranch: "main",
    mutationContext: repoRoleContext?.mutationContext || null,
    ...repoRoleContext,
  });
  return {
    guard,
    branch: resolvedBranch,
  };
}
export function runGitPull({
  repoRoot = "",
  daemonLogPath = "",
  canonicalCheckoutPath = "",
  repoRoleContext = {},
  spawnSyncImpl = spawnSync,
} = {}) {
  const evaluated = evaluateGitPullGuard({
    repoRoot,
    canonicalCheckoutPath,
    repoRoleContext,
  });
  const guard = evaluated.guard;
  if (!guard.ok) {
    appendLogLine(daemonLogPath, `git_pull_blocked reason=${guard.reason}`);
    throw new Error(guard.reason);
  }
  // @context:regression !critical The daemon must not depend on branch.<name>.merge/upstream
  // config here because malformed multi-upstream state makes `git pull` die with
  // "Cannot rebase onto multiple branches." during pre-tick bootstrap.
  const fetch = spawnSyncImpl("git", ["-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "origin", "main"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  appendCommandOutputToLog(daemonLogPath, fetch.stdout);
  appendCommandOutputToLog(daemonLogPath, fetch.stderr);
  if (fetch.status !== 0) {
    throw new Error(trim(fetch.stderr || fetch.stdout || "git_fetch_failed"));
  }

  const merge = spawnSyncImpl("git", ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", "FETCH_HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  appendCommandOutputToLog(daemonLogPath, merge.stdout);
  appendCommandOutputToLog(daemonLogPath, merge.stderr);
  if (merge.status !== 0) {
    throw new Error(trim(merge.stderr || merge.stdout || "git_merge_ff_only_failed"));
  }
}
export function resolveCircuitBreakerThreshold({
  configuredThreshold = undefined,
  env = process.env,
} = {}) {
  if (configuredThreshold !== undefined && configuredThreshold !== null && String(configuredThreshold).trim() !== "") {
    return normalizeBreakerThreshold(configuredThreshold, CIRCUIT_BREAKER_DEFAULT_THRESHOLD);
  }
  return normalizeBreakerThreshold(env?.HATCH_DAEMON_CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_DEFAULT_THRESHOLD);
}
export function emitManagedLifecycleEvent(args = {}) {
  return emitManagedLifecycleEventImpl({
    ...args,
    requiredEventDefinitions: MANAGED_FACTORY_TELEMETRY_EVENTS,
    appendLogLineFn: appendLogLine,
  });
}
export { evaluateDaemonControlStateAction } from "./daemon-control-decision.ts";
export async function runDaemon(factoryId, options = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.factory_id_required);
  const {
    readControlStateFn = readCanonicalFactoryControlStateSync,
    getControlStateActionFn = getCanonicalControlActiveAction,
    writeControlStateFn = writeCanonicalFactoryControlStateSync,
    runGitPullFn = runGitPull,
    runRecoverySweepFn = runRecoverySweep,
    runInstallAndBuildFn = runInstallAndBuild,
    runTickFn = runTick,
    resolveTickRuntimeFn = resolveTickRuntime,
    evaluateStartupInvariantFn = evaluateDaemonStartupInvariants,
    emitBugIssueFn = emitBugIssue,
    emitManagedLifecycleEventFn = emitManagedLifecycleEvent,
    tripCircuitBreakerFn = tripCircuitBreaker,
    runScheduledJobsFn = runScheduledJobs,
    acquireLeaseFn = acquireLease,
    renewLeaseFn = renewLease,
    releaseLeaseFn = releaseLease,
    terminateActiveChildAndExitFn = terminateActiveChildAndExit,
    resolveLeaseTtlFn = resolveDaemonLeaseTtl,
    readHostFactoryIntentFn = readHostFactoryIntent,
    sleepFn = sleep,
  } = options;

  const repoRoot = path.resolve(trim(options.repoRoot) || resolveRepoRootFromModule());
  const hostBaseDir = path.resolve(trim(options.hostBaseDir) || process.env.HATCH_HOST_BASE_DIR || path.join(homedir(), ".hatch-hosts"));
  const daemonPaths = resolveDaemonPaths({ factoryId: normalizedFactoryId, hostBaseDir });
  daemonPaths.lockfilePath = path.resolve(repoRoot, ROOT_LOCKFILE);

  ensureDaemonDirs(daemonPaths);
  acquireDaemonLock(daemonPaths);
  const activeChildRef = { current: null };
  let shuttingDown = false;

  process.on("exit", () => {
    releaseDaemonLock(daemonPaths);
  });
  process.on("SIGTERM", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void terminateActiveChildAndExitFn({
      signal: "SIGTERM",
      activeChildRef,
      daemonPaths,
      daemonLogPath: daemonPaths.daemonLogPath,
      leaseReleaseFn: releaseLeaseFn,
      appendLogLineFn: appendLogLine,
      releaseDaemonLockFn: releaseDaemonLock,
    });
  });
  process.on("SIGINT", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void terminateActiveChildAndExitFn({
      signal: "SIGINT",
      activeChildRef,
      daemonPaths,
      daemonLogPath: daemonPaths.daemonLogPath,
      leaseReleaseFn: releaseLeaseFn,
      appendLogLineFn: appendLogLine,
      releaseDaemonLockFn: releaseDaemonLock,
    });
  });
  loadDaemonEnvironment({ repoRoot, daemonLogPath: daemonPaths.daemonLogPath });
  const runtime = resolveTickRuntimeFn({ factoryId: normalizedFactoryId, repoRoot });
  const startupInvariant = evaluateStartupInvariantFn({
    factoryId: normalizedFactoryId,
    repoRoot,
    config: runtime.config,
    canonicalCheckoutPath: runtime.canonicalCheckoutPath,
    repoRoleContext: {
      ...runtime.repoRoleContext,
      repoSlug: runtime.repoRoleContext?.controlPlaneRepo || runtime.targetRepo,
      enforceRepoRoles: true,
      allowControlPlaneMainSafeFlow: true,
      mutationContext: runtime.mutationContext,
    },
  });
  if (!startupInvariant.ok) {
    appendLogLine(daemonPaths.daemonLogPath, `daemon_start_blocked code=${startupInvariant.code} branch=${startupInvariant.branch || "unknown"}`);
    throw new Error(startupInvariant.code);
  }
  mkdirSync(runtime.runsDir, { recursive: true });

  const leaseTtl = resolveLeaseTtlFn({
    config: runtime.config,
    env: process.env,
    defaultTtlSec: DEFAULT_DAEMON_LEASE_TTL_SEC,
  });
  const leaseRenewLeadMs = Math.max(1_000, Math.floor((leaseTtl.ttlSec * 1000) / 2));

  appendLogLine(
    daemonPaths.daemonLogPath,
    `daemon_start factory_id=${normalizedFactoryId} pid=${process.pid} lease_ttl_sec=${leaseTtl.ttlSec} lease_ttl_source=${leaseTtl.source} lease_renew_lead_ms=${leaseRenewLeadMs}`,
  );

  const startupLease = ensureStartupLease({
    runtime,
    paths: daemonPaths,
    ttlSec: leaseTtl.ttlSec,
    acquireLeaseFn,
    emitBugIssueFn,
    appendLogLineFn: appendLogLine,
    daemonLogPath: daemonPaths.daemonLogPath,
  });
  if (!startupLease.ok) {
    releaseDaemonLock(daemonPaths);
    throw new Error(startupLease.error || "daemon_lease_acquire_failed:unknown");
  }
  let leaseHeld = true;
  let nextLeaseRenewAtMs = Date.now() + leaseRenewLeadMs;

  const orphanRecords = detectOrphanPids(daemonPaths.pidDir, { currentPid: process.pid });
  for (const orphan of orphanRecords) {
    if (orphan.access === "eperm") {
      appendLogLine(daemonPaths.daemonLogPath, `orphan_skip pid=${orphan.pid} reason=eperm`);
      continue;
    }
    try {
      process.kill(orphan.pid, "SIGTERM");
      appendLogLine(daemonPaths.daemonLogPath, `orphan_sigterm pid=${orphan.pid}`);
    } catch {}
  }
  let tickCount = 0;
  let loopCount = 0;
  const maxTicks = Number(options.maxTicks) || 0;
  const breakerThreshold = resolveCircuitBreakerThreshold({
    configuredThreshold: options.circuitBreakerThreshold,
    env: process.env,
  });
  let consecutiveTickFailures = 0;

  try {
    while (!shuttingDown) {
    loopCount += 1;

    const hostIntent = readHostFactoryIntentFn({ intentFilePath: daemonPaths.intentFilePath });
    if (!hostIntent.enabled) {
      appendLogLine(
        daemonPaths.daemonLogPath,
        `host_intent_disabled reason=${hostIntent.disabled_reason || "none"} disabled_at=${hostIntent.disabled_at || "unknown"}`,
      );
      const sleepMs = IDLE_SLEEP_BASE_MS;
      appendLogLine(daemonPaths.daemonLogPath, `tick_sleep ms=${sleepMs} reason=host_intent_disabled`);
      if (maxTicks > 0 && loopCount >= maxTicks) {
        break;
      }
      await sleepFn(sleepMs);
      continue;
    }

    const controlState = readDaemonControlState({
      factoryId: runtime.factoryId,
      repoRoot,
      readControlStateFn,
      appendLogLineFn: appendLogLine,
      daemonLogPath: daemonPaths.daemonLogPath,
    });
    const controlStateAction = getControlStateActionFn(controlState);
    const controlDecision = evaluateDaemonControlStateAction({
      stateAction: controlStateAction,
      reason: controlState.reason,
    });
    appendLogLine(
      daemonPaths.daemonLogPath,
      `control_state_check action=${controlDecision.action} mode=${controlDecision.mode} reason=${controlDecision.reason || "none"}`,
    );
    if (controlDecision.shouldStop) {
      appendLogLine(
        daemonPaths.daemonLogPath,
        `daemon_draining_stop reason=${controlDecision.reason || "draining"}`,
      );
      break;
    }
    if (!controlDecision.shouldRunTick) {
      const cooldown = evaluateCircuitBreakerCooldown({
        reason: controlState.reason,
        notes: controlState.notes,
        now: new Date(),
      });
      if (cooldown.shouldRetry) {
        appendLogLine(
          daemonPaths.daemonLogPath,
          `circuit_breaker_cooldown_retry elapsed_ms=${cooldown.elapsedMs} cooldown_ms=${cooldown.cooldownMs}`,
        );
        resumeDaemonControlState({
          factoryId: runtime.factoryId,
          repoRoot,
          reason: "circuit_breaker_cooldown_auto_retry",
          actor: "daemon",
          readControlStateFn: () => controlState,
          writeControlStateFn,
        });
        consecutiveTickFailures = 0;
      } else {
        appendLogLine(
          daemonPaths.daemonLogPath,
          `daemon_skip_tick control_state=${controlDecision.logReason} reason=${controlDecision.reason || "none"}`,
        );
        const sleepMs = IDLE_SLEEP_BASE_MS;
        appendLogLine(daemonPaths.daemonLogPath, `tick_sleep ms=${sleepMs} reason=control_state_${controlDecision.logReason}`);
        if (maxTicks > 0 && loopCount >= maxTicks) {
          break;
        }
        await sleepFn(sleepMs);
        continue;
      }
    }
    if (controlDecision.shouldClearState) {
      resumeDaemonControlState({
        factoryId: runtime.factoryId,
        repoRoot,
        reason: `daemon_${controlDecision.action}_acknowledged`,
        actor: "daemon",
        readControlStateFn: () => controlState,
        writeControlStateFn,
      });
      if (consecutiveTickFailures > 0) { appendLogLine(daemonPaths.daemonLogPath, `circuit_breaker_reset_on_resume previous_failure_streak=${consecutiveTickFailures}`); consecutiveTickFailures = 0; }
      appendLogLine(daemonPaths.daemonLogPath, `control_state_cleared action=${controlDecision.action} next=active`);

      const reacquireState = reacquireLeaseIfNeeded({
        leaseHeld,
        runtime,
        paths: daemonPaths,
        ttlSec: leaseTtl.ttlSec,
        acquireLeaseFn,
        appendLogLineFn: appendLogLine,
        daemonLogPath: daemonPaths.daemonLogPath,
      });
      if (reacquireState.leaseHeld) {
        leaseHeld = true;
        nextLeaseRenewAtMs = Date.now() + leaseRenewLeadMs;
      }
    }
    const leaseRenewalState = renewLeaseOrPause({
      leaseHeld,
      nextLeaseRenewAtMs,
      runtime,
      paths: daemonPaths,
      ttlSec: leaseTtl.ttlSec,
      leaseRenewLeadMs,
      nowMs: Date.now(),
      controlState,
      repoRoot,
      renewLeaseFn,
      acquireLeaseFn,
      writeControlStateFn,
      buildClearedActionStateFn: buildClearedActionState,
      appendLogLineFn: appendLogLine,
      daemonLogPath: daemonPaths.daemonLogPath,
    });
    leaseHeld = leaseRenewalState.leaseHeld;
    nextLeaseRenewAtMs = leaseRenewalState.nextLeaseRenewAtMs;
    if (!leaseHeld) {
      appendLogLine(daemonPaths.daemonLogPath, "tick_skip lease_missing");
      const sleepMs = IDLE_SLEEP_BASE_MS;
      appendLogLine(daemonPaths.daemonLogPath, `tick_sleep ms=${sleepMs} reason=lease_missing`);
      if (maxTicks > 0 && loopCount >= maxTicks) {
        break;
      }
      await sleepFn(sleepMs);
      continue;
    }
    tickCount += 1;
    appendLogLine(daemonPaths.daemonLogPath, `tick_start seq=${tickCount}`);
    // Renew lease between synchronous pre-tick ops that can block longer than the 60s lease TTL.
    const renewNow = () => {
      const r = renewLeaseOrPause({
        leaseHeld, nextLeaseRenewAtMs: 0, runtime, paths: daemonPaths,
        ttlSec: leaseTtl.ttlSec, leaseRenewLeadMs, nowMs: Date.now(),
        controlState, repoRoot, renewLeaseFn, acquireLeaseFn, writeControlStateFn,
        buildClearedActionStateFn: buildClearedActionState,
        appendLogLineFn: appendLogLine, daemonLogPath: daemonPaths.daemonLogPath,
      });
      leaseHeld = r.leaseHeld;
      nextLeaseRenewAtMs = r.nextLeaseRenewAtMs;
    };
    if (trim(runtime.config?.workspace_mode) === "api_only") {
      appendLogLine(daemonPaths.daemonLogPath, "git_pull_skipped reason=api_only_workspace_mode");
    } else {
      runGitPullFn({
        repoRoot,
        daemonLogPath: daemonPaths.daemonLogPath,
        canonicalCheckoutPath: runtime.canonicalCheckoutPath,
        repoRoleContext: {
          ...runtime.repoRoleContext,
          repoSlug: runtime.repoRoleContext?.controlPlaneRepo || runtime.targetRepo,
          enforceRepoRoles: true,
          allowControlPlaneMainSafeFlow: true,
          mutationContext: runtime.mutationContext,
        },
      });
    }
    renewNow();
    runRecoverySweepFn({
      factoryId: runtime.factoryId,
      runsDir: runtime.runsDir,
      repoRoot: runtime.contextRepoPath || repoRoot,
      daemonLogPath: daemonPaths.daemonLogPath,
      skipWorktreeScan: shouldSkipRecoverySweepWorktreeScan(runtime),
    });
    renewNow();
    runInstallAndBuildFn({
      repoRoot,
      lockfilePath: daemonPaths.lockfilePath,
      mtimeCachePath: daemonPaths.installMtimeCachePath,
      daemonLogPath: daemonPaths.daemonLogPath,
      appendLogLineFn: appendLogLine,
      appendCommandOutputToLogFn: appendCommandOutputToLog,
    });
    const heartbeatIntervalMs = Math.max(1_000, Math.floor(leaseRenewLeadMs / 2));
    const tickExecution = await runWithLeaseHeartbeat({
      heartbeatIntervalMs,
      sleepFn,
      taskFn: async () => runTickFn({
        runtime,
        paths: daemonPaths,
        repoRoot,
        hostBaseDir,
        activeChildRef,
        daemonLogPath: daemonPaths.daemonLogPath,
      }),
      onHeartbeatFn: async () => {
        const heartbeatLeaseState = renewLeaseOrPause({
          leaseHeld,
          nextLeaseRenewAtMs,
          runtime,
          paths: daemonPaths,
          ttlSec: leaseTtl.ttlSec,
          leaseRenewLeadMs,
          nowMs: Date.now(),
          controlState: readDaemonControlState({
            factoryId: runtime.factoryId,
            repoRoot,
            readControlStateFn,
            appendLogLineFn: appendLogLine,
            daemonLogPath: daemonPaths.daemonLogPath,
          }),
          repoRoot,
          renewLeaseFn,
          acquireLeaseFn,
          writeControlStateFn,
          buildClearedActionStateFn: buildClearedActionState,
          appendLogLineFn: appendLogLine,
          daemonLogPath: daemonPaths.daemonLogPath,
        });

        leaseHeld = heartbeatLeaseState.leaseHeld;
        nextLeaseRenewAtMs = heartbeatLeaseState.nextLeaseRenewAtMs;

        if (!heartbeatLeaseState.leaseHeld && activeChildRef.current && !activeChildRef.current.killed) {
          appendLogLine(daemonPaths.daemonLogPath, "lease_heartbeat_child_terminate reason=lease_lost");
          activeChildRef.current.kill("SIGTERM");
        }
        return heartbeatLeaseState;
      },
    });

    const tickResult = tickExecution.taskResult;

    const tickEventStatus = tickResult.exitCode === 0 ? "completed" : "failed";
    emitManagedLifecycleEventFn({
      runtime,
      paths: daemonPaths,
      repoRoot,
      daemonLogPath: daemonPaths.daemonLogPath,
      eventType: "factory.lifecycle.tick",
      status: tickEventStatus,
      runId: tickResult.runId,
      tickId: tickResult.tickId,
      startedAt: tickResult.startedAt,
      endedAt: tickResult.endedAt,
      durationMs: tickResult.durationMs,
      incidentSeed: {
        exit_code: Number(tickResult.exitCode) || 0,
      },
      extraFields: {
        tick_idle: tickResult.tickIdle ? "true" : "false",
      },
    });
    const breakerTransition = evaluateCircuitBreakerTransition({
      consecutiveFailures: consecutiveTickFailures,
      tickExitCode: tickResult.exitCode,
      threshold: breakerThreshold,
      tombstone: tickResult.failureTombstone,
    });
    if (breakerTransition.reset) {
      appendLogLine(
        daemonPaths.daemonLogPath,
        `circuit_breaker_reset previous_failure_streak=${consecutiveTickFailures}`,
      );
    }

    consecutiveTickFailures = breakerTransition.nextConsecutiveFailures;

    if (!breakerTransition.reset && tickResult.exitCode !== 0 && breakerTransition.countFailure) {
      appendLogLine(
        daemonPaths.daemonLogPath,
        `tick_failure_streak count=${consecutiveTickFailures} threshold=${breakerTransition.threshold} exit=${tickResult.exitCode} severity=${breakerTransition.severity || "degrading"} crash_type=${breakerTransition.crashType || "unknown"}`,
      );
    }
    if (!breakerTransition.reset && tickResult.exitCode !== 0 && !breakerTransition.countFailure) {
      appendLogLine(
        daemonPaths.daemonLogPath,
        `circuit_breaker_ignored severity=${breakerTransition.severity || "informational"} crash_type=${breakerTransition.crashType || "unknown"} tombstone_id=${breakerTransition.tombstoneId || "none"}`,
      );
    }
    if (breakerTransition.shouldTrip) {
      const tripped = tripCircuitBreakerFn({
        runtime,
        repoRoot,
        controlState,
        tickResult,
        failureCount: consecutiveTickFailures,
        threshold: breakerTransition.threshold,
        writeControlStateFn,
        emitBugIssueFn,
      });

      appendLogLine(
        daemonPaths.daemonLogPath,
        `circuit_breaker_tripped threshold=${tripped.threshold} failures=${tripped.failureCount} exit=${tickResult.exitCode} severity=${tripped.severity || "degrading"} resolution_type=${tripped.resolutionType || "cooldown_auto_retry"} tombstone_id=${tripped.tombstoneId || "none"}`,
      );

      if (tripped.emitted?.ok) {
        appendLogLine(daemonPaths.daemonLogPath, `circuit_breaker_bug_emitted issue=${trim(tripped.emitted.issue_url || "") || "none"}`);
      } else {
        appendLogLine(daemonPaths.daemonLogPath, `circuit_breaker_bug_emit_failed error=${trim(tripped.emitted?.error || "unknown")}`);
      }
    }
    const sleepMs = resolveLeaseSafeSleepMs({
      tickIdle: tickResult.tickIdle,
      leaseTtlSec: leaseTtl.ttlSec,
      leaseRenewLeadMs,
    });
    await runScheduledJobsFn({ runtime, paths: daemonPaths, repoRoot, hostBaseDir, activeChildRef, daemonLogPath: daemonPaths.daemonLogPath, appendLogLineFn: appendLogLine });
    // Renew lease before sleeping so ACTIVE_SLEEP_MS (45s) doesn't outlast TTL (60s).
    renewNow();

    appendLogLine(daemonPaths.daemonLogPath, `tick_sleep ms=${sleepMs} reason=${tickResult.tickIdle ? "tick_idle" : "tick_active"}`);

    emitManagedLifecycleEventFn({
      runtime,
      paths: daemonPaths,
      repoRoot,
      daemonLogPath: daemonPaths.daemonLogPath,
      eventType: "factory.lifecycle.sleep",
      status: "scheduled",
      runId: tickResult.runId,
      tickId: tickResult.tickId,
      startedAt: tickResult.endedAt,
      durationMs: sleepMs,
      incidentSeed: {
        sleep_reason: tickResult.tickIdle ? "tick_idle" : "tick_active",
      },
      extraFields: {
        reason: tickResult.tickIdle ? "tick_idle" : "tick_active",
        sleep_ms: sleepMs,
      },
    });
    if (maxTicks > 0 && loopCount >= maxTicks) {
      break;
    }
      await sleepFn(sleepMs);
    }
    appendLogLine(daemonPaths.daemonLogPath, `daemon_stop factory_id=${normalizedFactoryId} ticks=${tickCount} loops=${loopCount}`);
    return {
      ok: true,
      factory_id: normalizedFactoryId,
      ticks: tickCount,
      loops: loopCount,
    };
  } finally {
    const finalLeaseRelease = releaseLeaseFn({ runtime, paths: daemonPaths });
    appendLogLine(
      daemonPaths.daemonLogPath,
      `lease_release reason=daemon_stop ok=${finalLeaseRelease.ok ? "true" : "false"} detail=${trim(finalLeaseRelease.reason || "unknown") || "unknown"}`,
    );
    releaseDaemonLock(daemonPaths);
  }
}
const isEntrypoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const factoryId = process.argv[2] || "";
  runDaemon(factoryId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
