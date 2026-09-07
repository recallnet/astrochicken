import { createHash } from "node:crypto";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectDeep(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const out = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right, "en"))) {
    const normalized = sortObjectDeep(value[key]);
    if (typeof normalized === "undefined") continue;
    out[key] = normalized;
  }
  return out;
}

/**
 * Create deterministic incident fingerprints from canonicalized seed data.
 *
 * Seed contract:
 * - Input must be a plain object.
 * - Keys are sorted lexicographically.
 * - Nested objects are sorted recursively.
 * - Arrays preserve order (caller owns array normalization when needed).
 *
 * Typical seed fields include: kind_id, crash_type, affected_node, error_excerpt,
 * runtime_version, kind_version, stack_hash, source_repo, and optionally
 * instance_id/host_id/run_id when stricter identity partitioning is desired.
 */
export function createIncidentFingerprint(seed = {}) {
  const canonicalSeed = sortObjectDeep(isPlainObject(seed) ? seed : {});
  const encoded = JSON.stringify(canonicalSeed);
  const digest = createHash("sha256").update(encoded).digest("hex");
  return `sha256:${digest}`;
}
