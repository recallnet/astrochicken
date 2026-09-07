import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HOST_FACTORY_INTENT_SCHEMA = "hatch.host.factory-intent.v1";

const DEFAULT_ENABLED = Object.freeze({
  enabled: true,
  disabled_at: null,
  disabled_reason: null,
  updated_at: null,
  updated_by: null,
});

function trim(value = "") {
  return String(value || "").trim();
}

/**
 * Read host-level factory intent. Missing or malformed file = enabled (default).
 */
export function readHostFactoryIntent({ intentFilePath = "" } = {}) {
  const resolved = trim(intentFilePath);
  if (!resolved || !existsSync(resolved)) {
    return { ...DEFAULT_ENABLED };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    return { ...DEFAULT_ENABLED };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ENABLED };
  }

  return {
    enabled: raw.enabled !== false,
    disabled_at: raw.enabled === false ? (trim(raw.disabled_at) || null) : null,
    disabled_reason: raw.enabled === false ? (trim(raw.disabled_reason) || null) : null,
    updated_at: trim(raw.updated_at) || null,
    updated_by: trim(raw.updated_by) || null,
  };
}

/**
 * Write host-level factory intent atomically (write-tmp-then-rename).
 */
export function writeHostFactoryIntent({
  intentFilePath = "",
  factoryId = "",
  enabled = true,
  reason = "",
  actor = "",
} = {}) {
  const resolved = trim(intentFilePath);
  if (!resolved) throw new Error("intentFilePath is required");

  mkdirSync(dirname(resolved), { recursive: true });

  const now = new Date().toISOString();
  const payload = {
    schema: HOST_FACTORY_INTENT_SCHEMA,
    factory_id: trim(factoryId),
    enabled: enabled !== false,
    disabled_at: enabled === false ? now : null,
    disabled_reason: enabled === false ? (trim(reason) || null) : null,
    updated_at: now,
    updated_by: trim(actor) || "unknown",
  };

  const tmpPath = `${resolved}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, resolved);
}

/**
 * Resolve the intent file path from factoryId and optional baseDir.
 */
export function resolveIntentFilePath({ factoryId = "", baseDir = "" } = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) throw new Error("factoryId is required");
  const base = trim(baseDir) || join(homedir(), ".hatch-hosts");
  return resolve(base, normalizedFactoryId, "intent.json");
}
