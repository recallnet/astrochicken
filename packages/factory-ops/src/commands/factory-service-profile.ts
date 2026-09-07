import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { parseFactoryRegistryDocument } from "hatch";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "../lib/error-catalog.ts";
import {
  SERVICE_PROFILE_KEYS,
  findRegistryInstanceRow,
  loadFactoryRegistry,
  saveFactoryRegistry,
} from "../lib/factory-registry.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatSchemaError(error) {
  const message = String(error?.message || "").split("\n").find((line) => String(line || "").trim().startsWith("- "))
    || String(error?.message || "service_profile_validation_failed");
  return trim(message.replace(/^-\s*/, ""));
}

function resolveProfilePath(profilePath = "", cwd = process.cwd()) {
  const candidate = trim(profilePath);
  if (!candidate) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.missing_args, "profile_path_required");
  }
  return isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
}

function parseProfilePatch(text = "") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `service_profile_invalid_json:${String(error?.message || error || "invalid_json")}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      "service_profile_invalid_shape:expected_object",
    );
  }

  const unknownKeys = Object.keys(parsed)
    .filter((key) => !SERVICE_PROFILE_KEYS.includes(key))
    .sort((a, b) => a.localeCompare(b));
  if (unknownKeys.length > 0) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `service_profile_unknown_keys:${unknownKeys.join(",")}`,
    );
  }

  return parsed;
}

function pickServiceProfile(row = {}) {
  const out = {};
  for (const key of SERVICE_PROFILE_KEYS) {
    if (Object.hasOwn(row, key)) out[key] = row[key];
  }
  return out;
}

function validateRegistryInstances(instances = []) {
  try {
    parseFactoryRegistryDocument({
      schema: "hatch.factory.registry.v1",
      instances,
    });
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `service_profile_validation_failed:${formatSchemaError(error)}`,
    );
  }
}

function resolveInstanceOrThrow(registry = {}, instanceId = "") {
  const normalizedInstanceId = trim(instanceId);
  if (!normalizedInstanceId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.missing_args, "instance_id_required");
  }

  const row = findRegistryInstanceRow(registry, normalizedInstanceId);
  if (!row) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing,
      `instance_not_registered:${normalizedInstanceId}`,
    );
  }
  return row;
}

export function inspectFactoryServiceProfile({
  instanceId = "",
  registryPath = "factory-registry.json",
  cwd = process.cwd(),
} = {}) {
  const loaded = loadFactoryRegistry({ registryPath, cwd });
  const row = resolveInstanceOrThrow(loaded.registry, instanceId);
  return {
    ok: true,
    instance_id: trim(row.instance_id),
    registry_path: loaded.registryPath,
    service_profile: pickServiceProfile(row),
  };
}

export function updateFactoryServiceProfile({
  instanceId = "",
  profilePath = "",
  registryPath = "factory-registry.json",
  cwd = process.cwd(),
  readFileSyncFn = readFileSync,
} = {}) {
  const normalizedProfilePath = resolveProfilePath(profilePath, cwd);
  const patch = parseProfilePatch(readFileSyncFn(normalizedProfilePath, "utf8"));

  const loaded = loadFactoryRegistry({ registryPath, cwd });
  const row = resolveInstanceOrThrow(loaded.registry, instanceId);
  const updatedRow = {
    ...row,
    ...patch,
  };

  const nextRegistry = {
    ...loaded.registry,
    instances: loaded.registry.instances.map((entry) => (
      trim(entry?.instance_id) === trim(row.instance_id)
        ? updatedRow
        : entry
    )),
  };

  validateRegistryInstances(nextRegistry.instances);
  const saved = saveFactoryRegistry({ registryPath: loaded.registryPath, registry: nextRegistry });
  const persisted = resolveInstanceOrThrow(saved.registry, row.instance_id);

  return {
    ok: true,
    status: "updated",
    instance_id: trim(persisted.instance_id),
    profile_path: normalizedProfilePath,
    registry_path: saved.registryPath,
    service_profile: pickServiceProfile(persisted),
  };
}
