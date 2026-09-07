import path from "node:path";

import { trim } from "./cli-helpers.ts";

function normalizeFactoryId(value = "") {
  return trim(value);
}

function normalizeIsolationPath(value = "", { baseDir = process.cwd() } = {}) {
  const raw = trim(value);
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(baseDir, raw);
}

function resolveDefaultRunsDir(factoryId = "") {
  const scopedFactoryId = normalizeFactoryId(factoryId);
  if (scopedFactoryId) return path.resolve(".hatch", scopedFactoryId, "runs");
  return path.resolve(".hatch", "runs");
}

export function resolveRunsDir({ runsDir = "", factoryId = "", isolationPaths = undefined, baseDir = process.cwd() } = {}) {
  const explicitRunsDir = trim(runsDir);
  if (explicitRunsDir) return normalizeIsolationPath(explicitRunsDir, { baseDir });

  const isolationRunsDir = normalizeIsolationPath(isolationPaths?.runs, { baseDir });
  if (isolationRunsDir) return isolationRunsDir;

  return resolveDefaultRunsDir(factoryId);
}

export function resolveLogsDir({ logsDir = "", runsDir = "", factoryId = "", isolationPaths = undefined, baseDir = process.cwd() } = {}) {
  const explicit = trim(logsDir);
  if (explicit) return explicit;

  const isolationLogsDir = normalizeIsolationPath(isolationPaths?.logs, { baseDir });
  if (isolationLogsDir) return isolationLogsDir;

  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId, isolationPaths, baseDir });
  return path.resolve(resolvedRunsDir, "logs");
}

export function resolveTmpDir({ tmpDir = "", runsDir = "", factoryId = "", isolationPaths = undefined, baseDir = process.cwd() } = {}) {
  const explicit = trim(tmpDir);
  if (explicit) return explicit;

  const isolationTmpDir = normalizeIsolationPath(isolationPaths?.tmp, { baseDir });
  if (isolationTmpDir) return isolationTmpDir;

  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId, isolationPaths, baseDir });
  return path.resolve(resolvedRunsDir, "tmp");
}

export function resolveCacheDir({ cacheDir = "", runsDir = "", factoryId = "", isolationPaths = undefined, baseDir = process.cwd() } = {}) {
  const explicit = trim(cacheDir);
  if (explicit) return explicit;

  const isolationCacheDir = normalizeIsolationPath(isolationPaths?.cache, { baseDir });
  if (isolationCacheDir) return isolationCacheDir;

  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId, isolationPaths, baseDir });
  return path.resolve(resolvedRunsDir, "cache");
}

export function resolveFactoryRuntimePaths({
  runsDir = "",
  logsDir = "",
  tmpDir = "",
  cacheDir = "",
  factoryId = "",
  isolationPaths = undefined,
  baseDir = process.cwd(),
} = {}) {
  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId, isolationPaths, baseDir });
  return {
    runsDir: resolvedRunsDir,
    logsDir: resolveLogsDir({ logsDir, runsDir: resolvedRunsDir, factoryId, isolationPaths, baseDir }),
    tmpDir: resolveTmpDir({ tmpDir, runsDir: resolvedRunsDir, factoryId, isolationPaths, baseDir }),
    cacheDir: resolveCacheDir({ cacheDir, runsDir: resolvedRunsDir, factoryId, isolationPaths, baseDir }),
  };
}
