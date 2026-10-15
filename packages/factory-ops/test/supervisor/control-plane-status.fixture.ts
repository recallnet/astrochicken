import { buildReleaseManifest } from "../../src/lib/control-plane-manifest.ts";

export function buildControlPlaneManifestFixture({ status = "promoted", reason = "" } = {}) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v9.9.9",
    entries: [{
      source_repo: "example/external-factory",
      source_issue: 42,
      source_issue_url: "https://example/42",
      summary: "control-plane",
      factory_id: "external/issue_worker",
      required_factory_release: "9.9.9",
      status: "blocked_upstream",
      signature_hash: "sha256:42",
      linkage: {
        schema_version: "factory_link.v1",
        linkage_key: "sha256:42",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 9001,
        source_repo: "example/external-factory",
        source_issue: 42,
        status: "blocked_upstream",
        factory_id: "external/issue_worker",
        required_factory_release: "9.9.9",
        signature_hash: "sha256:42",
      },
    }],
  });

  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status,
    stage: status === "canary_in_progress" ? "canary" : "general",
    resume_blocked: status === "rolled_back",
    rollback_reason: reason,
    publish: {
      release_id: "v9.9.9",
      release_tag: "v9.9.9",
      release_sha: "abc123",
      asset_id: "asset-555",
      asset_url: "https://example/assets/555",
      manifest_path: "control-plane-manifests/release-manifest.json",
      published_at: "2026-03-08T00:00:00.000Z",
    },
  };

  return manifest;
}
