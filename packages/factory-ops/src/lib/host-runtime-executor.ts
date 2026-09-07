import { mkdirSync } from "node:fs";
import path from "node:path";

import { runTick } from "./daemon-tick-runner.ts";
import { findRegistryInstanceRow, loadFactoryRegistry } from "./factory-registry.ts";
import { buildFactoryRepoRoleContext } from "./factory-repo-roles.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeExitCode(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function normalizeDurationMs(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function parseJson(text = "", fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function resolveRegistryContext({ paths = {}, env = process.env } = {}) {
  return {
    registryPath: trim(env?.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json"),
    registryCwd: trim(env?.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd()),
  };
}

function loadRegistryRowsByInstanceId({ paths = {}, env = process.env } = {}) {
  const context = resolveRegistryContext({ paths, env });
  try {
    const loaded = loadFactoryRegistry({
      registryPath: context.registryPath,
      cwd: context.registryCwd,
    });

    return {
      registryPath: loaded.registryPath,
      registry: loaded.registry,
    };
  } catch {
    return {
      registryPath: context.registryPath,
      registry: {
        schema: "hatch.factory.registry.v1",
        instances: [],
      },
    };
  }
}

function resolveSupervisorGraph({ registryRow = {}, repoRoot = "" } = {}) {
  const graphs = Array.isArray(registryRow?.graphs) ? registryRow.graphs : [];
  const preferred = graphs.find((entry) => trim(entry?.id) === "factory_supervisor_tick" && trim(entry?.path));
  const fallback = graphs.find((entry) => trim(entry?.path));
  const graphPath = trim(preferred?.path || fallback?.path);
  if (!graphPath) return "";
  if (path.isAbsolute(graphPath)) return graphPath;
  return path.resolve(repoRoot, graphPath);
}

function resolveContextRepoPath({ installation = {}, repoRoot = "" } = {}) {
  if (trim(installation.workspace_mode) === "api_only") return repoRoot;
  const configured = installation.work_dir === null ? "" : trim(installation.work_dir);
  if (!configured) return repoRoot;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

function buildExecutionRuntime({
  decision = {},
  installation = {},
  registryRow = {},
  repoRoot = "",
  runsDir = "",
  supervisorGraph = "",
} = {}) {
  const targetRepo = trim(registryRow?.target_repo);
  const controlPlaneRepo = trim(registryRow?.control_plane_repo);
  const instanceId = trim(installation.instance_id || decision.instance_id);
  const destinations = parseJson(trim(registryRow?.destinations_json), {});
  const factoryRoot = path.resolve(repoRoot, "factories", instanceId);
  const factoryConfigPath = path.resolve(factoryRoot, "factory.config.json");

  return {
    factoryId: instanceId,
    factoryRoot,
    factoryConfigPath,
    supervisorGraph,
    contextRepoPath: resolveContextRepoPath({ installation, repoRoot }),
    runsDir,
    targetRepo,
    controlPlaneRepo,
    mutationContext: {
      instance_id: instanceId,
      target_repo: targetRepo,
      control_plane_repo: controlPlaneRepo,
      destinations: destinations && typeof destinations === "object" ? destinations : {},
    },
    repoRoleContext: buildFactoryRepoRoleContext({
      targetRepo,
      controlPlaneRepo,
      destinations,
    }),
    llmIsolation: {},
  };
}

function buildExecutionPaths({ installationRoot = "", runtimeLogDir = "" } = {}) {
  const hostRoot = path.resolve(installationRoot);
  const pidDir = path.resolve(hostRoot, "pid");
  return {
    hostRoot,
    logsDir: path.resolve(runtimeLogDir || path.resolve(hostRoot, "logs")),
    pidDir,
    pidFile: path.resolve(pidDir, "factory-daemon.pid"),
    lockDir: path.resolve(pidDir, "factory-daemon.lock"),
    tmpDir: path.resolve(hostRoot, "tmp"),
    socketDir: path.resolve(hostRoot, "sockets"),
  };
}

function buildExecutionFailureResult({
  decision = {},
  installation = {},
  exitCode = 1,
  error = "",
} = {}) {
  return {
    installation_id: trim(decision.installation_id || installation.installation_id),
    instance_id: trim(decision.instance_id || installation.instance_id),
    run_id: "",
    tick_id: "",
    exit_code: normalizeExitCode(exitCode, 1),
    tick_idle: false,
    duration_ms: 0,
    tick_log_path: "",
    error: trim(error || "execution_failed"),
  };
}

export async function executeHostRuntimeDecisions({
  hostManifest = {},
  decisions = [],
  installations = [],
  paths = {},
  env = process.env,
  runTickFn = runTick,
  appendLogLineFn = () => {},
  daemonLogPath = "",
} = {}) {
  const repoRoot = path.resolve(trim(paths.repoRoot || hostManifest.repo_root || process.cwd()));
  const runtimeLogDir = path.resolve(trim(paths.runtimeLogDir || hostManifest.runtime_log_dir || path.resolve(repoRoot, ".hatch", "host-runtime", "logs")));
  mkdirSync(runtimeLogDir, { recursive: true });

  const installationById = new Map(
    (Array.isArray(installations) ? installations : [])
      .map((entry) => [trim(entry?.installation_id), entry])
      .filter(([installationId]) => Boolean(installationId)),
  );

  const registryLoaded = loadRegistryRowsByInstanceId({ paths, env });
  const scheduled = (Array.isArray(decisions) ? decisions : [])
    .filter((entry) => trim(entry?.decision) === "scheduled");

  const activeChildRef = { current: null };
  const results = [];

  for (const decision of scheduled) {
    const installationId = trim(decision.installation_id);
    const installation = installationById.get(installationId) || null;

    if (!installation) {
      results.push(buildExecutionFailureResult({
        decision,
        exitCode: 1,
        error: "installation_not_found",
      }));
      continue;
    }

    const installationRoot = path.dirname(trim(installation.manifest_path));
    const runsDir = path.resolve(installationRoot, "runs");
    mkdirSync(runsDir, { recursive: true });

    const instanceId = trim(installation.instance_id || decision.instance_id);
    const registryRow = findRegistryInstanceRow(registryLoaded.registry, instanceId) || {};
    const supervisorGraph = resolveSupervisorGraph({ registryRow, repoRoot });
    if (!supervisorGraph) {
      results.push(buildExecutionFailureResult({
        decision,
        installation,
        exitCode: 1,
        error: "factory_supervisor_graph_missing",
      }));
      continue;
    }

    const runtime = buildExecutionRuntime({
      decision,
      installation,
      registryRow,
      repoRoot,
      runsDir,
      supervisorGraph,
    });

    if (!trim(runtime.factoryId) || !trim(runtime.targetRepo)) {
      results.push(buildExecutionFailureResult({
        decision,
        installation,
        exitCode: 1,
        error: "execution_runtime_metadata_missing",
      }));
      continue;
    }

    const executionPaths = buildExecutionPaths({
      installationRoot,
      runtimeLogDir,
    });

    try {
      const tick = await runTickFn({
        runtime,
        paths: executionPaths,
        repoRoot,
        hostBaseDir: trim(paths.baseDir || hostManifest.host_base_dir),
        activeChildRef,
        daemonLogPath,
        appendLogLineFn,
      });

      results.push({
        installation_id: installationId,
        instance_id: instanceId,
        run_id: trim(tick.runId),
        tick_id: trim(tick.tickId),
        exit_code: normalizeExitCode(tick.exitCode, 1),
        tick_idle: Boolean(tick.tickIdle),
        duration_ms: normalizeDurationMs(tick.durationMs),
        tick_log_path: trim(tick.tickLogPath),
        error: "",
      });
    } catch (error) {
      results.push(buildExecutionFailureResult({
        decision,
        installation,
        exitCode: 1,
        error: String(error?.message || error || "run_tick_failed"),
      }));
    }
  }

  return {
    results,
    registry_path: trim(registryLoaded.registryPath),
  };
}
