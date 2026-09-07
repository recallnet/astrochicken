import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { trim } from "./cli-helpers.ts";
import { validateReleaseManifestContract, buildReleaseManifest } from "../commands/release-manifest.ts";
import { readReleaseManifestFile, writeReleaseManifestFile } from "../commands/release-rollout-controller.ts";

export const CONTROL_PLANE_MANIFEST_CHANNELS = Object.freeze(["canary", "stable"]);

const RELEASE_MANIFEST_FILENAME = "release-manifest.json";
const DEFAULT_CHANNELS = [...CONTROL_PLANE_MANIFEST_CHANNELS];
const MISSING_MANIFEST_RECOVERY = "factory publish-control-plane-manifest";

function normalizeChannels(channels = DEFAULT_CHANNELS) {
  const values = Array.isArray(channels)
    ? channels
    : String(channels || "")
      .split(",")
      .map((value) => value);

  const normalized = [...new Set(values
    .map((value) => trim(value).toLowerCase())
    .filter(Boolean))];

  return normalized.length > 0 ? normalized : [...DEFAULT_CHANNELS];
}

function resolveRepoRoot(repoRoot = ".") {
  const normalized = trim(repoRoot) || ".";
  return resolve(normalized);
}

export function syncControlPlaneManifest({
  manifestPath = "",
  repoRoot = ".",
  channels = DEFAULT_CHANNELS,
} = {}) {
  const inputManifestPath = trim(manifestPath);
  const manifest_path = inputManifestPath ? resolve(inputManifestPath) : "";
  const normalizedChannels = normalizeChannels(channels);
  const repo_root = resolveRepoRoot(repoRoot);
  const releases_dir = join(repo_root, ".hatch", "releases");

  if (!manifest_path || !existsSync(manifest_path)) {
    return {
      ok: false,
      reason: "manifest_missing",
      recovery: MISSING_MANIFEST_RECOVERY,
      manifest_path,
      channels: normalizedChannels,
      releases_dir,
    };
  }

  const sourceManifest = readReleaseManifestFile(manifest_path);
  const validation = validateReleaseManifestContract(sourceManifest);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "manifest_invalid_contract",
      validation_errors: Array.isArray(validation.reasons) ? validation.reasons : [],
      manifest_path,
    };
  }

  const manifest_paths = {};
  for (const channel of normalizedChannels) {
    const manifestPathForChannel = join(releases_dir, channel, RELEASE_MANIFEST_FILENAME);
    try {
      mkdirSync(join(releases_dir, channel), { recursive: true });
      writeReleaseManifestFile(manifestPathForChannel, sourceManifest);
      manifest_paths[channel] = manifestPathForChannel;
    } catch (error) {
      return {
        ok: false,
        reason: "manifest_write_failed",
        channel,
        manifest_path: manifestPathForChannel,
        source_manifest_path: manifest_path,
        error: String(error?.message || error),
      };
    }
  }

  return {
    ok: true,
    reason: "manifest_synced",
    manifest_paths,
  };
}

export { buildReleaseManifest };
