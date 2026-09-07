import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { assertBackendAdapterContract } from "./backend-adapter.ts";
import { resolveBackendSelection } from "./backend-selection-schema.ts";
import { createGhCliAdapter } from "./github-adapter.ts";
import { createLocalFsAdapter } from "./local-fs-adapter.ts";

function trim(value: unknown = ""): string {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveFactoryConfigPath({
  factoryConfigPath = "",
  factoryRoot = "",
  cwd = process.cwd(),
  env = process.env,
  existsSyncFn = existsSync,
}: {
  factoryConfigPath?: string;
  factoryRoot?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  existsSyncFn?: typeof existsSync;
} = {}): string {
  const explicitConfigPath = trim(factoryConfigPath);
  if (explicitConfigPath) {
    const resolvedPath = resolvePath(cwd, explicitConfigPath);
    if (!existsSyncFn(resolvedPath)) {
      throw new Error(`factory config not found at ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const explicitFactoryRoot = trim(factoryRoot);
  if (explicitFactoryRoot) {
    const resolvedPath = resolvePath(cwd, explicitFactoryRoot, "factory.config.json");
    if (!existsSyncFn(resolvedPath)) {
      throw new Error(`factory config not found at ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const envConfigPath = trim(env?.HATCH_FACTORY_CONFIG_PATH || "");
  if (envConfigPath) {
    const resolvedPath = resolvePath(cwd, envConfigPath);
    if (!existsSyncFn(resolvedPath)) {
      throw new Error(`factory config not found at ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const envFactoryRoot = trim(env?.HATCH_FACTORY_ROOT || env?.FACTORY_ROOT || "");
  if (envFactoryRoot) {
    const resolvedPath = resolvePath(cwd, envFactoryRoot, "factory.config.json");
    if (!existsSyncFn(resolvedPath)) {
      throw new Error(`factory config not found at ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const implicitConfigPath = resolvePath(cwd, "factory.config.json");
  return existsSyncFn(implicitConfigPath) ? implicitConfigPath : "";
}

function loadBackendFromFactoryConfig({
  factoryConfigPath = "",
  readFileSyncFn = readFileSync,
}: {
  factoryConfigPath?: string;
  readFileSyncFn?: typeof readFileSync;
} = {}): { backend: Record<string, unknown>; backendConfigPresent: boolean } {
  if (!factoryConfigPath) {
    return {
      backend: {},
      backendConfigPresent: false,
    };
  }

  let parsedConfig: unknown = {};
  try {
    parsedConfig = JSON.parse(readFileSyncFn(factoryConfigPath, "utf8") as string);
  } catch (error: unknown) {
    throw new Error(`failed to read factory config at ${factoryConfigPath}: ${String((error as Record<string, unknown>)?.message || error)}`);
  }

  if (!isPlainObject(parsedConfig)) {
    throw new Error(`factory config at ${factoryConfigPath} must be a JSON object`);
  }

  const backend = parsedConfig?.backend;
  if (backend === undefined || backend === null) {
    return {
      backend: {},
      backendConfigPresent: false,
    };
  }

  if (!isPlainObject(backend)) {
    throw new Error(`factory config backend at ${factoryConfigPath} must be an object`);
  }

  return {
    backend,
    backendConfigPresent: true,
  };
}

function mergeBackendConfig(factoryBackend: Record<string, unknown> = {}, explicitBackend: unknown = undefined): unknown {
  if (explicitBackend === undefined) {
    return factoryBackend;
  }

  if (!isPlainObject(explicitBackend)) {
    return explicitBackend;
  }

  return {
    ...(isPlainObject(factoryBackend) ? factoryBackend : {}),
    ...explicitBackend,
  };
}

function getExplicitBackendOverrides(backend: unknown = undefined): { type: string; storeRoot: string } {
  if (!isPlainObject(backend)) {
    return {
      type: "",
      storeRoot: "",
    };
  }

  return {
    type: trim(backend.type || ""),
    storeRoot: trim(backend.storeRoot || backend.store_root || ""),
  };
}

export function resolveBackendConfig({
  type = "",
  storeRoot = "",
  backend,
  factoryConfigPath = "",
  factoryRoot = "",
  cwd = process.cwd(),
  env = process.env,
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
}: {
  type?: string;
  storeRoot?: string;
  backend?: Record<string, unknown>;
  factoryConfigPath?: string;
  factoryRoot?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  existsSyncFn?: typeof existsSync;
  readFileSyncFn?: typeof readFileSync;
} = {}): {
  type: string;
  storeRoot: string;
  backend: Record<string, unknown>;
  factoryConfigPath: string;
  backendConfigPresent: boolean;
} {
  const resolvedFactoryConfigPath = resolveFactoryConfigPath({
    factoryConfigPath,
    factoryRoot,
    cwd,
    env,
    existsSyncFn,
  });

  const { backend: factoryBackend, backendConfigPresent } = loadBackendFromFactoryConfig({
    factoryConfigPath: resolvedFactoryConfigPath,
    readFileSyncFn,
  });

  const mergedBackend = mergeBackendConfig(factoryBackend, backend);
  const explicitBackend = getExplicitBackendOverrides(backend);

  const selection = resolveBackendSelection({
    backend: mergedBackend as Record<string, unknown>,
    type: trim(type) || explicitBackend.type || trim(env?.HATCH_BACKEND_TYPE || ""),
    storeRoot: trim(storeRoot) || explicitBackend.storeRoot || trim(env?.HATCH_BACKEND_STORE_ROOT || ""),
    env: {},
  });

  return {
    type: selection.type,
    storeRoot: selection.storeRoot,
    backend: isPlainObject(mergedBackend) ? mergedBackend : {},
    factoryConfigPath: resolvedFactoryConfigPath,
    backendConfigPresent,
  };
}

export function createBackend(options: Record<string, unknown> = {}): Record<string, unknown> {
  const {
    type,
    repo,
    storeRoot,
    factoryConfigPath = "",
    factoryRoot = "",
    cwd = process.cwd(),
    backend,
    env = process.env,
    existsSyncFn = existsSync,
    readFileSyncFn = readFileSync,
    ...passThrough
  } = options;

  if (!repo) {
    throw new Error("repo is required");
  }

  const selection = resolveBackendConfig({
    type: type as string,
    storeRoot: storeRoot as string,
    backend: backend as Record<string, unknown>,
    factoryConfigPath: factoryConfigPath as string,
    factoryRoot: factoryRoot as string,
    cwd: cwd as string,
    env: env as Record<string, string | undefined>,
    existsSyncFn: existsSyncFn as typeof existsSync,
    readFileSyncFn: readFileSyncFn as typeof readFileSync,
  });

  if (selection.type === "github") {
    return assertBackendAdapterContract(
      createGhCliAdapter({ repo: repo as string, env: env as Record<string, string | undefined>, ...passThrough }),
      { context: "github backend" },
    );
  }

  return assertBackendAdapterContract(
    createLocalFsAdapter({ repo: repo as string, storeRoot: selection.storeRoot, ...passThrough }),
    { context: "local_fs backend" },
  );
}

export {
  assertBackendAdapterContract,
  BACKEND_ADAPTER_METHODS,
  isBackendAdapter,
} from "./backend-adapter.ts";

export {
  BACKEND_SELECTION_SCHEMA,
  BACKEND_TYPES,
  resolveBackendSelection,
  validateBackendSelectionConfig,
} from "./backend-selection-schema.ts";
