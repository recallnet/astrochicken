import path from "node:path";

function trim(value = "") {
  return String(value || "").trim();
}

function expandHomePath(value = "", homeDir = process.env.HOME || "") {
  const raw = trim(value);
  if (!raw) return "";
  if (raw === "~") return homeDir || raw;
  if (raw.startsWith("~/")) return homeDir ? path.join(homeDir, raw.slice(2)) : raw;
  return raw;
}

export function resolveLlmIsolationFromConfig(config = {}) {
  const isolation = config?.isolation && typeof config.isolation === "object" ? config.isolation : {};
  const provider = isolation?.provider && typeof isolation.provider === "object" ? isolation.provider : {};
  const model = isolation?.model && typeof isolation.model === "object" ? isolation.model : {};
  return {
    providerEnvVar: trim(provider.envVar || ""),
    providerValue: trim(provider.value || ""),
    modelEnvVar: trim(model.envVar || ""),
    modelValue: trim(model.value || ""),
    authStoragePath: expandHomePath(isolation?.authStoragePath || ""),
  };
}

export function buildTickEnv({
  runtime = {},
  paths = {},
  hostBaseDir = "",
  processEnv = process.env,
} = {}) {
  const tickEnv = {
    ...processEnv,
    HATCH_FACTORY_ID: runtime.factoryId,
    HATCH_FACTORY_ROOT: runtime.factoryRoot,
    HATCH_FACTORY_CONFIG_PATH: runtime.factoryConfigPath,
    HATCH_RUNS_DIR: runtime.runsDir,
    HATCH_HOST_BASE_DIR: hostBaseDir,
    FACTORY_HOST_ROOT: paths.hostRoot,
    FACTORY_CONTEXT_REPO_PATH: runtime.contextRepoPath,
    MOTHERSHIP_REPO: runtime.targetRepo,
    HATCH_TARGET_REPO: runtime.targetRepo,
    HATCH_INSTANCE_ID: runtime.factoryId,
    HATCH_FACTORY_INSTANCE_ID: runtime.mutationContext?.instance_id || "",
    HATCH_FACTORY_MUTATION_CONTEXT_JSON: JSON.stringify(runtime.mutationContext || {}),
    HATCH_FACTORY_REPO_ROLES_JSON: JSON.stringify(runtime.repoRoleContext || {}),
    FACTORY_DAEMON_LOG_DIR: paths.logsDir,
    FACTORY_DAEMON_PID_DIR: paths.pidDir,
    FACTORY_DAEMON_PID_FILE: paths.pidFile,
    FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
    FACTORY_DAEMON_TMP_DIR: paths.tmpDir,
    FACTORY_DAEMON_SOCKET_DIR: paths.socketDir,
  };
  const isolation = runtime.llmIsolation || {};
  if (trim(isolation.providerValue)) {
    tickEnv[trim(isolation.providerEnvVar) || "HATCH_MODEL_PROVIDER"] = trim(isolation.providerValue);
    tickEnv.HATCH_PROVIDER = trim(isolation.providerValue);
  }
  if (trim(isolation.modelValue)) {
    tickEnv[trim(isolation.modelEnvVar) || "HATCH_MODEL"] = trim(isolation.modelValue);
    tickEnv.HATCH_MODEL = trim(isolation.modelValue);
  }
  if (trim(isolation.authStoragePath)) {
    tickEnv.HATCH_AUTH_STORAGE_PATH = trim(isolation.authStoragePath);
  }
  return tickEnv;
}
