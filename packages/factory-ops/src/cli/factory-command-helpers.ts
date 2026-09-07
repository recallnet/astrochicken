import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { FACTORY_OPS_ERROR_CODES, normalizeFactoryOpsError } from "../lib/error-catalog.ts";
import { loadFactoryRegistry } from "../lib/factory-registry.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export function resolveRepoScopedFactoryContext({
  repo = "",
  repoRoot = "",
  factoryId = "",
  registryPath = "factory-registry.json",
  cwd = process.cwd(),
} = {}) {
  const resolvedRepoRoot = trim(repoRoot) || resolve(String(cwd || process.cwd()));
  const explicitFactoryId = trim(factoryId);
  if (explicitFactoryId) {
    // @context:regression !critical When factoryId is explicit, resolve target_repo
    // from the registry so callers don't accidentally query the control-plane repo
    // (which is the git remote of the canonical checkout) instead of the target repo.
    let targetRepo = "";
    try {
      const loaded = loadFactoryRegistry({ registryPath, cwd: resolvedRepoRoot });
      const instances = Array.isArray(loaded?.registry?.instances) ? loaded.registry.instances : [];
      const match = instances.find((entry) => trim(entry?.instance_id) === explicitFactoryId);
      targetRepo = trim(match?.target_repo || "");
    } catch {
      // Registry unavailable — caller must provide --repo explicitly.
    }
    return {
      repoRoot: resolvedRepoRoot,
      factoryId: explicitFactoryId,
      targetRepo,
    };
  }

  const normalizedRepo = trim(repo).toLowerCase();
  if (!normalizedRepo) {
    return {
      repoRoot: resolvedRepoRoot,
      factoryId: "",
    };
  }

  try {
    const loaded = loadFactoryRegistry({ registryPath, cwd: resolvedRepoRoot });
    const instances = Array.isArray(loaded?.registry?.instances) ? loaded.registry.instances : [];
    const match = instances.find((entry) => trim(entry?.target_repo).toLowerCase() === normalizedRepo);
    return {
      repoRoot: resolvedRepoRoot,
      factoryId: trim(match?.instance_id || ""),
    };
  } catch {
    return {
      repoRoot: resolvedRepoRoot,
      factoryId: "",
    };
  }
}

export function reconcileManagedFactoryRunsDir(
  context = {},
  {
    hostBaseDir = process.env.HATCH_HOST_BASE_DIR || "",
  } = {},
) {
  const normalizedContext = context && typeof context === "object" ? { ...context } : {};
  const runsDir = trim(normalizedContext.runs_dir);
  const factoryMode = trim(normalizedContext.factory_mode).toLowerCase();
  if (!runsDir || factoryMode !== "managed") return normalizedContext;
  // Managed runtime state is rooted by the shared context resolver under the
  // target checkout work_dir. Generic CLI/status commands must preserve that
  // semantic runs_dir instead of rewriting it to the host mirror path.
  return {
    ...normalizedContext,
    runs_dir: runsDir,
  };
}

function writeCommandError(command, error, { jsonFactoryId = "", status = "invalid", extra = {} } = {}) {
  const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.factory_context_resolve_failed);
  const message = normalized.rawMessage || normalized.message;
  command.context.stderr.write(`${message}\n`);
  command.context.stdout.write(JSON.stringify({
    ok: false,
    factory_id: String(jsonFactoryId || ""),
    status: String(status || "invalid"),
    message,
    error_code: normalized.code,
    pid: 0,
    log_dir: "",
    runs_dir: "",
    pid_file: "",
    version: "",
    ...extra,
  }));
}

export async function resolveRepoOrExit(command, rawRepo = "") {
  try {
    const { resolveGhRepo } = await import("../commands/common-resolve-gh-repo.ts");
    return resolveGhRepo(rawRepo);
  } catch (error) {
    const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.gh_repo_required);
    command.context.stderr.write(`${normalized.rawMessage || normalized.message}\n`);
    return "";
  }
}

export async function resolveFactoryContextOrExit(command, options = {}) {
  try {
    const { resolveFactoryContext } = await import("../lib/factory-context-resolver.ts");
    return reconcileManagedFactoryRunsDir(resolveFactoryContext(options));
  } catch (error) {
    const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.factory_context_resolve_failed);
    command.context.stderr.write(`${normalized.rawMessage || normalized.message}\n`);
    return null;
  }
}

export async function resolveFleetTuiDetailContext(initialFactoryContext = {}) {
  const { resolveFactoryContext } = await import("../lib/factory-context-resolver.ts");
  const candidateFactoryRoot = trim(initialFactoryContext?.factory_root || "");
  const candidateConfigPath = trim(initialFactoryContext?.factory_config_path || "");
  const resolvedFactoryRoot = candidateFactoryRoot && existsSync(resolve(candidateFactoryRoot, "factory.config.json"))
    ? candidateFactoryRoot
    : "";
  const resolvedFactoryConfigPath = candidateConfigPath && existsSync(candidateConfigPath)
    ? candidateConfigPath
    : "";
  const hasStableIdentity = Boolean(
    resolvedFactoryRoot
    || resolvedFactoryConfigPath
    || String(initialFactoryContext?.factory_id || "").trim()
    || String(initialFactoryContext?.target_repo || "").trim(),
  );
  return reconcileManagedFactoryRunsDir(resolveFactoryContext({
    // Fleet rows may carry stale host-scoped runs_dir values. Once we know
    // the factory identity, re-resolve the canonical runs_dir from source.
    runsDir: hasStableIdentity ? "" : (initialFactoryContext?.runs_dir || ""),
    factoryRoot: resolvedFactoryRoot,
    factoryConfigPath: resolvedFactoryConfigPath,
    factoryId: initialFactoryContext?.factory_id || "",
    targetRepo: initialFactoryContext?.target_repo || "",
    controlPlaneRepo: initialFactoryContext?.control_plane_repo || "",
    scenariosRoot: initialFactoryContext?.scenarios_root || "",
  }));
}

export async function resolveFactoryRunsDir(runsDir, factoryId, {
  resolveFactoryContextFn = null,
} = {}) {
  const candidate = String(runsDir || "").trim();
  const scopedFactoryId = String(factoryId || "").trim();
  if (!scopedFactoryId) return candidate || ".hatch/runs";
  const explicitRunsDir = candidate && candidate !== ".hatch/runs" ? candidate : "";
  if (explicitRunsDir) return explicitRunsDir;

  try {
    const resolveContext = typeof resolveFactoryContextFn === "function"
      ? resolveFactoryContextFn
      : (await import("../lib/factory-context-resolver.ts")).resolveFactoryContext;
    const context = resolveContext({ factoryId: scopedFactoryId });
    const resolvedContextRunsDir = trim(context?.runs_dir);
    if (resolvedContextRunsDir) return resolvedContextRunsDir;
  } catch {
    // Fall through to generic runs-dir resolution below.
  }
  const { resolveRunsDir } = await import("../lib/runs-dir-resolver.ts");
  return resolveRunsDir({ runsDir: explicitRunsDir, factoryId: scopedFactoryId });
}

export function resolveFleetRegistryPath(registryPath = "") {
  const candidate = String(registryPath || "").trim();
  if (!candidate || candidate !== "factory-registry.json") return candidate;
  const baseDir = String(process.env.HATCH_HOST_BASE_DIR || `${process.env.HOME || "/tmp"}/.hatch-hosts`).trim();
  const hostRuntimeRegistryPath = resolve(baseDir, "runtime", "factory-registry.json");
  return existsSync(hostRuntimeRegistryPath) ? hostRuntimeRegistryPath : candidate;
}

export async function resolveHostLifecycleInputs(command, flags = {}) {
  const context = await resolveFactoryContextOrExit(command, {
    factoryRoot: flags.factoryRoot,
    factoryConfigPath: flags.factoryConfigPath,
    factoryId: flags.factoryId,
  });
  if (!context) return null;
  try {
    const { resolveHostPaths } = await import("../commands/factory-host-lifecycle.ts");
    const lifecycleInstanceId = String(flags.factoryId || "").trim() && String(flags.factoryId || "").trim() !== String(context.instance_id || "").trim()
      ? String(flags.factoryId || "").trim()
      : context.instance_id;
    const resolvedPaths = resolveHostPaths({
      factoryId: context.factory_id,
      instanceId: lifecycleInstanceId,
      baseDir: flags.hostBaseDir,
      logsRoot: flags.logsRoot,
      runsDir: flags.runsDir,
      tmpDir: flags.tmpDir,
      socketDir: flags.socketDir,
      pidDir: flags.pidDir,
    });
    return { context, resolvedPaths };
  } catch (error) {
    writeCommandError(command, error, {
      jsonFactoryId: context.factory_id || flags.factoryId,
      status: "invalid_host_configuration",
    });
    return null;
  }
}

export function printHostLifecycleJson(command, payload = {}) {
  command.context.stdout.write(JSON.stringify(payload));
}

export function buildHostLifecycleJson({
  ok,
  status,
  message = "",
  errorCode = "",
  context = {},
  paths = {},
  pid = 0,
  version = "",
  extra = {},
} = {}) {
  return {
    ok: Boolean(ok),
    factory_id: String(context.factory_id || paths.factoryId || ""),
    instance_id: String(context.instance_id || paths.instanceId || ""),
    status: String(status || ""),
    message: String(message || ""),
    error_code: String(errorCode || ""),
    pid: Number.isFinite(Number(pid)) ? Number(pid) : 0,
    log_dir: String(paths.logsDir || ""),
    runs_dir: String(paths.runsDir || ""),
    pid_file: String(paths.pidFile || ""),
    installation_manifest_path: String(paths.installationManifestPath || ""),
    artifact_dir: String(paths.artifactDir || ""),
    version: String(version || ""),
    ...extra,
  };
}

export function resolveDaemonScriptPath(factoryRoot, daemonScriptFlag) {
  const explicit = String(daemonScriptFlag || "").trim();
  if (explicit) return explicit;
  return "scripts/factory-daemon.sh";
}

export function buildHostDaemonEnv(context = {}, paths = {}) {
  return {
    HATCH_FACTORY_ID: context.factory_id,
    HATCH_FACTORY_ROOT: context.factory_root,
    HATCH_INSTANCE_ID: context.instance_id,
    HATCH_TARGET_REPO: context.target_repo,
    HATCH_RUNS_DIR: paths.runsDir,
    HATCH_HOST_BASE_DIR: paths.baseDir,
    HATCH_INSTALLATION_MANIFEST_PATH: paths.installationManifestPath,
    FACTORY_DAEMON_LOG_DIR: paths.logsDir,
    FACTORY_DAEMON_PID_DIR: paths.pidDir,
    FACTORY_DAEMON_PID_FILE: paths.pidFile,
    FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
    FACTORY_DAEMON_TMP_DIR: paths.tmpDir,
    FACTORY_DAEMON_SOCKET_DIR: paths.socketDir,
  };
}

export async function executeFactoryControlMutation(command, { action = "", factoryId = "", reason = "", retryTarget = "" } = {}) {
  const { runFactoryControlAction } = await import("../commands/factory-control-state.ts");
  const out = runFactoryControlAction({ action, factoryId, reason, retryTarget });
  command.context.stdout.write(JSON.stringify(out));
  if (!out.ok) {
    command.context.stderr.write(JSON.stringify({
      ok: false,
      action,
      error: String(out.error || "control_state_error"),
      message: String(out.message || ""),
    }) + "\n");
    return 1;
  }
  return 0;
}
