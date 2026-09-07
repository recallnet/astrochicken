import { existsSync } from "node:fs";
import { resolve } from "node:path";

function trim(value = "") {
  return String(value ?? "").trim();
}

export function parseFleetRegistryDocument({
  parsed = null,
  registryPath = "",
  normalizeRegistryEntry,
} = {}) {
  if (typeof normalizeRegistryEntry !== "function") {
    throw new TypeError("normalizeRegistryEntry is required");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "registry_malformed_json",
      registry_path: registryPath,
      factories: [],
      error: "registry must be a JSON object",
    };
  }

  if (trim(parsed.schema) !== "hatch.factory.registry.v1") {
    return {
      ok: false,
      reason: "registry_invalid_schema",
      registry_path: registryPath,
      factories: [],
      error: `expected schema hatch.factory.registry.v1 but found ${trim(parsed.schema) || "(missing)"}`,
    };
  }

  const rows = Array.isArray(parsed.instances)
    ? parsed.instances
    : (Array.isArray(parsed.factories) ? parsed.factories : null);

  if (!Array.isArray(rows)) {
    return {
      ok: false,
      reason: "registry_invalid_factories",
      registry_path: registryPath,
      factories: [],
      error: "registry must define instances[] or factories[]",
    };
  }

  return {
    ok: true,
    reason: "ok",
    registry_path: registryPath,
    factories: rows.map((entry, index) => normalizeRegistryEntry(entry, index)),
    error: "",
  };
}

export function resolveRepoRegistryAbsolutePath({
  context = {},
  cwd = process.cwd(),
  resolveRegistryAbsolutePath,
} = {}) {
  if (typeof resolveRegistryAbsolutePath !== "function") {
    throw new TypeError("resolveRegistryAbsolutePath is required");
  }
  return resolveRegistryAbsolutePath({ context, registryPath: "factory-registry.json", cwd });
}

export function isHostRuntimeRegistryPath(pathname = "", env = process.env) {
  const normalized = trim(pathname);
  if (!normalized) return false;
  const baseDir = trim(env?.HATCH_HOST_BASE_DIR || `${env?.HOME || ""}/.hatch-hosts`);
  if (baseDir) {
    const expected = resolve(baseDir, "runtime", "factory-registry.json");
    if (normalized === expected) return true;
  }
  return normalized.endsWith("/.hatch-hosts/runtime/factory-registry.json");
}

export function mergeFleetRegistryRows({ canonical = [], runtime = [] } = {}) {
  const merged = new Map();
  for (const row of canonical) {
    merged.set(trim(row.factory_id), { ...row });
  }
  for (const row of runtime) {
    const key = trim(row.factory_id);
    if (!key) continue;
    const existing = merged.get(key) || {};
    merged.set(key, {
      ...existing,
      ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "" && value !== null && value !== undefined)),
      daemon_status: row.daemon_status && typeof row.daemon_status === "object"
        ? { ...(existing.daemon_status || {}), ...row.daemon_status }
        : existing.daemon_status,
      graphs: Array.isArray(row.graphs) && row.graphs.length > 0 ? row.graphs : existing.graphs,
    });
  }
  return [...merged.values()].sort((left, right) => trim(left.factory_id).localeCompare(trim(right.factory_id), "en"));
}

export function overlayRuntimeRegistry({
  absoluteRegistryPath = "",
  context = {},
  cwd = process.cwd(),
  readJsonFile,
  normalizeRegistryEntry,
  resolveRegistryAbsolutePath,
} = {}) {
  if (typeof readJsonFile !== "function") {
    throw new TypeError("readJsonFile is required");
  }
  if (typeof normalizeRegistryEntry !== "function") {
    throw new TypeError("normalizeRegistryEntry is required");
  }
  if (typeof resolveRegistryAbsolutePath !== "function") {
    throw new TypeError("resolveRegistryAbsolutePath is required");
  }

  const runtimeParsed = parseFleetRegistryDocument({
    parsed: readJsonFile(absoluteRegistryPath, null),
    registryPath: absoluteRegistryPath,
    normalizeRegistryEntry,
  });
  if (!runtimeParsed.ok) return runtimeParsed;

  if (!isHostRuntimeRegistryPath(absoluteRegistryPath)) return runtimeParsed;

  const repoRegistryPath = resolveRepoRegistryAbsolutePath({
    context,
    cwd,
    resolveRegistryAbsolutePath,
  });
  if (!repoRegistryPath || repoRegistryPath === absoluteRegistryPath || !existsSync(repoRegistryPath)) {
    return runtimeParsed;
  }

  const repoParsed = parseFleetRegistryDocument({
    parsed: readJsonFile(repoRegistryPath, null),
    registryPath: repoRegistryPath,
    normalizeRegistryEntry,
  });
  if (!repoParsed.ok) return runtimeParsed;

  return {
    ok: true,
    reason: "ok",
    registry_path: absoluteRegistryPath,
    factories: mergeFleetRegistryRows({
      canonical: repoParsed.factories,
      runtime: runtimeParsed.factories,
    }),
    error: "",
  };
}
