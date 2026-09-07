import semver from "semver";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "./error-catalog.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeRange(allowedRange = "") {
  return trim(allowedRange) || "*";
}

function normalizeRuntimeVersion(runtimeVersion = "") {
  const normalized = trim(runtimeVersion);
  if (!normalized) return "";
  return semver.valid(normalized) || "";
}

/**
 * Evaluate host runtime compatibility against an instance policy range.
 *
 * Semantics:
 * - Empty allowedRange is normalized to "*".
 * - Malformed ranges fail closed by throwing runtime_version_range_invalid.
 * - Invalid runtimeVersion values return { ok:false } so callers can block startup.
 */
export function evaluateRuntimeCompatibility({ runtimeVersion = "", allowedRange = "" } = {}) {
  const normalizedRange = normalizeRange(allowedRange);
  const validRange = semver.validRange(normalizedRange);
  if (!validRange) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.runtime_version_range_invalid,
      `runtime_version_range_invalid:${normalizedRange}`,
    );
  }

  const normalizedRuntimeVersion = normalizeRuntimeVersion(runtimeVersion);
  if (!normalizedRuntimeVersion) {
    return {
      ok: false,
      reason: `runtime_version_invalid:${trim(runtimeVersion) || "(missing)"}`,
      runtimeVersion: trim(runtimeVersion),
      allowedRange: normalizedRange,
    };
  }

  const compatible = semver.satisfies(normalizedRuntimeVersion, validRange);
  if (compatible) {
    return {
      ok: true,
      reason: "runtime_version_compatible",
      runtimeVersion: normalizedRuntimeVersion,
      allowedRange: normalizedRange,
    };
  }

  return {
    ok: false,
    reason: `runtime_version_out_of_range:${normalizedRuntimeVersion}:${normalizedRange}`,
    runtimeVersion: normalizedRuntimeVersion,
    allowedRange: normalizedRange,
  };
}
