import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "./error-catalog.ts";
import { writeAtomicJson } from "./file-ops.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export const SERVICE_PROFILE_KEYS = Object.freeze([
  "service_tier",
  "scheduler_weight",
  "reserved_capacity",
  "upgrade_channel",
  "allowed_runtime_version",
  "support_owner",
  "feature_flags",
]);

function normalizeServiceProfile(partial = {}) {
  const featureFlagsSource = isPlainObject(partial.feature_flags) ? partial.feature_flags : {};
  const feature_flags = {};
  for (const key of Object.keys(featureFlagsSource).sort((left, right) => left.localeCompare(right))) {
    const value = featureFlagsSource[key];
    if (typeof value === "string") {
      feature_flags[key] = value;
    }
  }

  return {
    service_tier: partial.service_tier ?? "standard",
    scheduler_weight: partial.scheduler_weight ?? 1,
    reserved_capacity: partial.reserved_capacity ?? 0,
    upgrade_channel: partial.upgrade_channel ?? "stable",
    allowed_runtime_version: partial.allowed_runtime_version ?? "*",
    support_owner: partial.support_owner ?? "ops",
    feature_flags,
  };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function resolveRegistryAbsolutePath({ registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  const candidate = trim(registryPath) || "factory-registry.json";
  if (isAbsolute(candidate)) return candidate;
  return resolve(cwd, candidate);
}

function parseRegistryDocument(text = "") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `registry_malformed_json:${String(error?.message || error || "invalid_json")}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      "registry_malformed:expected_object",
    );
  }

  if (trim(parsed.schema) !== "hatch.factory.registry.v1") {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `registry_invalid_schema:${trim(parsed.schema) || "(missing)"}`,
    );
  }

  if (!Array.isArray(parsed.instances)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      "registry_missing_instances_array",
    );
  }

  return normalizeRegistryDocument(parsed);
}


function normalizeRegistryDocument(registry = {}) {
  const instances = Array.isArray(registry.instances) ? registry.instances : [];
  return {
    ...registry,
    instances: instances.map((entry) => normalizeInstanceRow(entry)),
  };
}

function normalizeInstanceRow(row = {}) {
  const serviceProfile = normalizeServiceProfile({
    service_tier: row?.service_tier,
    scheduler_weight: row?.scheduler_weight,
    reserved_capacity: row?.reserved_capacity,
    upgrade_channel: row?.upgrade_channel,
    allowed_runtime_version: row?.allowed_runtime_version,
    support_owner: row?.support_owner,
    feature_flags: row?.feature_flags,
  });

  return {
    ...row,
    ...serviceProfile,
  };
}

function reorderServiceProfile(profile = {}) {
  const normalized = normalizeServiceProfile(profile);
  return {
    service_tier: normalized.service_tier,
    scheduler_weight: normalized.scheduler_weight,
    reserved_capacity: normalized.reserved_capacity,
    upgrade_channel: normalized.upgrade_channel,
    allowed_runtime_version: normalized.allowed_runtime_version,
    support_owner: normalized.support_owner,
    feature_flags: normalized.feature_flags,
  };
}

function reorderInstanceRow(row = {}) {
  const preferred = [
    "instance_id",
    "kind_id",
    "target_repo",
    "status",
    "assigned_host_id",
    "installation_manifest_path",
    "graphs",
    "daemonStatus",
    "daemon_status",
  ];

  const normalized = normalizeInstanceRow(row);
  const ordered = {};
  for (const key of preferred) {
    if (Object.hasOwn(normalized, key)) ordered[key] = normalized[key];
  }

  Object.assign(ordered, reorderServiceProfile(normalized));

  const remaining = Object.keys(normalized)
    .filter((key) => !Object.hasOwn(ordered, key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of remaining) {
    ordered[key] = normalized[key];
  }
  return ordered;
}

function reorderRegistryDocument(registry = {}) {
  const ordered = {
    schema: registry.schema,
    instances: Array.isArray(registry.instances)
      ? [...registry.instances]
        .sort((left, right) => trim(left?.instance_id).localeCompare(trim(right?.instance_id)))
        .map((entry) => reorderInstanceRow(entry))
      : [],
  };

  if (Array.isArray(registry.factories)) {
    ordered.factories = [...registry.factories].sort((left, right) => trim(left?.id).localeCompare(trim(right?.id)));
  }

  const remaining = Object.keys(registry)
    .filter((key) => !Object.hasOwn(ordered, key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of remaining) ordered[key] = registry[key];

  return ordered;
}

export function loadFactoryRegistry({ registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  const absolutePath = resolveRegistryAbsolutePath({ registryPath, cwd });
  if (!existsSync(absolutePath)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `registry_not_found:${absolutePath}`,
    );
  }

  const raw = readFileSync(absolutePath, "utf8");
  const registry = parseRegistryDocument(raw);
  return {
    registryPath: absolutePath,
    registry,
  };
}

export function findRegistryInstanceRow(registry = {}, instanceId = "") {
  const normalizedInstanceId = trim(instanceId);
  const instances = Array.isArray(registry.instances) ? registry.instances : [];
  return instances.find((entry) => trim(entry?.instance_id) === normalizedInstanceId) || null;
}

export function loadInstanceRuntimePolicy({ instanceId = "", registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  const normalizedInstanceId = trim(instanceId);
  if (!normalizedInstanceId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.missing_args, "instance_id_required");
  }

  const loaded = loadFactoryRegistry({ registryPath, cwd });
  const row = findRegistryInstanceRow(loaded.registry, normalizedInstanceId);
  if (!row) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing,
      `instance_not_registered:${normalizedInstanceId}`,
    );
  }

  return {
    instance_id: normalizedInstanceId,
    allowed_runtime_version: trim(row.allowed_runtime_version),
    status: trim(row.status),
    assigned_host_id: trim(row.assigned_host_id),
    installation_manifest_path: trim(row.installation_manifest_path),
    registry_path: loaded.registryPath,
    row,
  };
}

export function saveFactoryRegistry({ registryPath = "", registry = {} } = {}) {
  const normalizedRegistryPath = resolve(trim(registryPath));
  const normalizedRegistry = reorderRegistryDocument(normalizeRegistryDocument(registry));
  try {
    writeAtomicJson(normalizedRegistryPath, normalizedRegistry);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `registry_write_failed:${String(error?.message || error || "unknown_error")}`,
    );
  }
  return {
    registryPath: normalizedRegistryPath,
    registry: normalizedRegistry,
  };
}
