import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { trim, ghJson, ghOrThrow } from "../lib/cli-helpers.ts";

export const CONTROL_PLANE_RELEASE_ASSET_PREFIX = "control-plane-manifests";



function normalizeAssetId(value = "") {
  return trim(value);
}

function normalizeAssetUrl(asset = {}) {
  return trim(asset?.asset_url || asset?.browser_download_url || asset?.url || asset?.downloadUrl || "");
}

function findAssetByPath(assets = [], assetPath = "", fallbackName = "") {
  const normalizedPath = trim(assetPath);
  const normalizedFallbackName = trim(fallbackName);
  if (!normalizedPath) return null;

  const rows = Array.isArray(assets) ? assets : [];
  return rows.find((asset) => {
    const name = trim(asset?.name);
    const label = trim(asset?.label);
    if (label && label === normalizedPath) return true;
    if (name && name === normalizedPath) return true;
    if (normalizedFallbackName && name === normalizedFallbackName) return true;
    return false;
  }) || null;
}

function ghExec(args = []) {
  return ghOrThrow(args);
}

export function createGhReleaseAssetClient({ repo = "", ghJsonFn = ghJson, ghExecFn = ghExec } = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) throw new Error("missing_repo");

  return {
    listReleaseAssets({ releaseId = "", releaseTag = "", releaseSha = "" } = {}) {
      const releaseRef = trim(releaseTag || releaseId || releaseSha);
      if (!releaseRef) throw new Error("missing_release_identity");
      const payload = ghJsonFn([
        "release",
        "view",
        releaseRef,
        "--repo",
        normalizedRepo,
        "--json",
        "assets",
      ], { assets: [] });
      return Array.isArray(payload?.assets) ? payload.assets : [];
    },

    deleteReleaseAsset({ assetId = "" } = {}) {
      const normalizedAssetId = trim(assetId);
      if (!normalizedAssetId) return { ok: true, skipped: true, reason: "missing_asset_id" };
      ghExecFn([
        "api",
        "-X",
        "DELETE",
        `repos/${normalizedRepo}/releases/assets/${normalizedAssetId}`,
      ]);
      return { ok: true, deleted: true, asset_id: normalizedAssetId };
    },

    uploadReleaseAsset({ releaseId = "", releaseTag = "", releaseSha = "", manifestPath = "", assetPath = "" } = {}) {
      const releaseRef = trim(releaseTag || releaseId || releaseSha);
      if (!releaseRef) throw new Error("missing_release_identity");

      const normalizedManifestPath = trim(manifestPath);
      if (!normalizedManifestPath) throw new Error("missing_manifest_path");

      const normalizedAssetPath = trim(assetPath);
      if (!normalizedAssetPath) throw new Error("missing_asset_path");

      const uploadName = normalizedAssetPath.replace(/[\\/]+/g, "__");
      const tempDir = mkdtempSync(join(tmpdir(), "control-plane-release-asset-"));
      const stagedPath = join(tempDir, uploadName);

      try {
        copyFileSync(normalizedManifestPath, stagedPath);
        ghExecFn([
          "release",
          "upload",
          releaseRef,
          `${stagedPath}#${normalizedAssetPath}`,
          "--repo",
          normalizedRepo,
          "--clobber",
        ]);

        const assets = this.listReleaseAssets({ releaseId, releaseTag, releaseSha });
        const uploaded = findAssetByPath(assets, normalizedAssetPath, uploadName);
        if (!uploaded) {
          throw new Error("release_asset_not_found_after_upload");
        }

        return {
          asset_id: normalizeAssetId(uploaded?.id),
          asset_url: normalizeAssetUrl(uploaded),
          asset_name: trim(uploaded?.name || uploadName),
          asset_label: trim(uploaded?.label || normalizedAssetPath),
        };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

export async function publishControlPlaneReleaseAsset({
  manifestPath = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  githubClient = null,
  createGithubClientFn = createGhReleaseAssetClient,
  repo = "",
} = {}) {
  const normalizedManifestPath = trim(manifestPath);
  if (!normalizedManifestPath) throw new Error("missing_manifest_path");

  const manifestName = trim(basename(normalizedManifestPath));
  if (!manifestName) throw new Error("invalid_manifest_path");

  const normalizedReleaseId = trim(releaseId || releaseTag || releaseSha);
  if (!normalizedReleaseId) throw new Error("missing_release_identity");

  const resolvedClient = githubClient || createGithubClientFn({ repo });
  if (!resolvedClient || typeof resolvedClient !== "object") throw new Error("invalid_github_client");
  if (typeof resolvedClient.listReleaseAssets !== "function") throw new Error("missing_github_client_list_release_assets");
  if (typeof resolvedClient.uploadReleaseAsset !== "function") throw new Error("missing_github_client_upload_release_asset");

  const assetPath = `${CONTROL_PLANE_RELEASE_ASSET_PREFIX}/${manifestName}`;

  const existingAssets = await Promise.resolve(resolvedClient.listReleaseAssets({
    releaseId: normalizedReleaseId,
    releaseTag: trim(releaseTag),
    releaseSha: trim(releaseSha),
  }));
  const existing = findAssetByPath(existingAssets, assetPath, "");

  if (existing && typeof resolvedClient.deleteReleaseAsset === "function") {
    await Promise.resolve(resolvedClient.deleteReleaseAsset({
      releaseId: normalizedReleaseId,
      releaseTag: trim(releaseTag),
      releaseSha: trim(releaseSha),
      assetId: normalizeAssetId(existing?.id),
    }));
  }

  const uploaded = await Promise.resolve(resolvedClient.uploadReleaseAsset({
    releaseId: normalizedReleaseId,
    releaseTag: trim(releaseTag),
    releaseSha: trim(releaseSha),
    manifestPath: normalizedManifestPath,
    assetPath,
  }));

  const assetId = normalizeAssetId(uploaded?.asset_id || uploaded?.id || "");
  if (!assetId) throw new Error("missing_uploaded_asset_id");

  const assetUrl = normalizeAssetUrl(uploaded);

  return {
    release_id: normalizedReleaseId,
    release_tag: trim(releaseTag),
    release_sha: trim(releaseSha),
    asset_id: assetId,
    asset_url: assetUrl,
    manifest_path: assetPath,
  };
}
