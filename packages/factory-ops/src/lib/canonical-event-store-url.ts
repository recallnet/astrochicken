import { dirname } from "node:path";

import {
  ensureCanonicalEventStoreBootstrap,
  readCanonicalEventStoreBootstrapContract,
  resolveCanonicalEventStoreBootstrapPaths,
} from "./command-owners/host-canonical-event-store-postgres.ts";
import { resolveControlPlaneHatchRoot } from "./control-plane-status.ts";

function resolveBootstrapConnectionString({ runsDir = ".hatch/runs", context = {}, repoRoot = "" } = {}) {
  const candidates = [];
  const explicitRepoRoot = String(repoRoot || context?.repo || "").trim();
  if (explicitRepoRoot) candidates.push(explicitRepoRoot);
  try {
    const hatchRoot = resolveControlPlaneHatchRoot({ runsDir, context });
    candidates.push(dirname(hatchRoot));
  } catch {
    // continue
  }
  candidates.push(process.cwd());

  for (const repoRoot of candidates) {
    try {
      const paths = ensureCanonicalEventStoreBootstrap({ repoRoot });
      return String(readCanonicalEventStoreBootstrapContract({ paths })?.connection_string || "").trim();
    } catch {
      // continue
    }
  }
  return "";
}

export function resolveCanonicalEventStoreUrl({
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  surface = "canonical factory status",
} = {}) {
  const candidates = [
    context?.canonical_event_store_url,
    process.env.HATCH_CANONICAL_EVENT_STORE_URL,
    resolveBootstrapConnectionString({ runsDir, context, repoRoot }),
  ];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  throw new Error(`HATCH_CANONICAL_EVENT_STORE_URL is required for ${surface}`);
}
