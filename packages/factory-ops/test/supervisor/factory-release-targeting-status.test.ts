import assert from "node:assert/strict";
import test from "node:test";

import {
  factoryReleaseTargetingStatus,
  formatReleaseTargetingStatusHuman,
} from "../../src/commands/factory-release-targeting-status.ts";
import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";

function makeEntry({ sourceRepo, sourceIssue, factoryId, requiredFactoryRelease }) {
  return {
    source_repo: sourceRepo,
    source_issue: sourceIssue,
    source_issue_url: `https://example/${sourceIssue}`,
    summary: `${sourceRepo}#${sourceIssue}`,
    status: "blocked_upstream",
    required_factory_release: requiredFactoryRelease,
    factory_id: factoryId,
    signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    linkage: {
      schema_version: "factory_link.v1",
      control_plane_repo: "recallnet/astrochicken",
      control_plane_goal: 9000 + Number(sourceIssue || 0),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      status: "blocked_upstream",
      factory_id: factoryId,
      required_factory_release: requiredFactoryRelease,
      signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    },
  };
}

function makeManifest({ releaseTag, releaseSha, entries, rolloutStatus, canaryFactoryIds = [], resumeBlocked = false, floor = "" }) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag,
    releaseSha,
    entries,
  });

  manifest.rollout.controller.status = rolloutStatus;
  manifest.rollout.controller.stage = rolloutStatus === "promoted" ? "general" : "canary";
  manifest.rollout.controller.resume_blocked = resumeBlocked;
  manifest.rollout.controller.canary_factory_ids = canaryFactoryIds;
  manifest.compatibility_matrix.required_factory_release_floor = floor;
  return manifest;
}

test("factoryReleaseTargetingStatus reports mixed fleet state with deterministic totals", async () => {
  const generalManifest = makeManifest({
    releaseTag: "v2.2.0",
    releaseSha: "sha-220",
    rolloutStatus: "promoted",
    floor: "1.0.0",
    entries: [
      makeEntry({ sourceRepo: "example/alpha", sourceIssue: 11, factoryId: "alpha", requiredFactoryRelease: "2.0.0" }),
      makeEntry({ sourceRepo: "example/gamma", sourceIssue: 22, factoryId: "gamma", requiredFactoryRelease: "1.5.0" }),
    ],
  });

  const canaryManifest = makeManifest({
    releaseTag: "v2.2.0-canary",
    releaseSha: "sha-220c",
    rolloutStatus: "canary_in_progress",
    canaryFactoryIds: ["beta"],
    floor: "1.0.0",
    entries: [
      makeEntry({ sourceRepo: "example/beta", sourceIssue: 33, factoryId: "beta", requiredFactoryRelease: "1.4.0" }),
    ],
  });

  const report = await factoryReleaseTargetingStatus({
    registryPath: "factory-registry.json",
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: {
        default_channel: "stable",
        repo_channels: {
          "example/beta": "canary",
        },
      },
      pins: {
        repos: {
          "example/gamma": "1.7.0",
        },
      },
      factory_releases: {
        repos: {
          "example/alpha": "2.2.0",
          "example/beta": "1.0.0",
          "example/gamma": "1.6.0",
        },
      },
    }),
    now: Date.parse("2026-03-09T12:00:00.000Z"),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "example/alpha" },
        { factory_id: "beta", target_repo: "example/beta" },
        { factory_id: "gamma", target_repo: "example/gamma" },
        { factory_id: "delta", target_repo: "" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: ({ rolloutChannel }) => {
      if (rolloutChannel === "canary") {
        return {
          ok: true,
          manifest: canaryManifest,
          source: "test",
          manifest_ref: "main",
          manifest_path: ".hatch/releases/canary/release-manifest.json",
        };
      }
      return {
        ok: true,
        manifest: generalManifest,
        source: "test",
        manifest_ref: "main",
        manifest_path: ".hatch/releases/stable/release-manifest.json",
      };
    },
  });

  assert.equal(report.generated_at, "2026-03-09T12:00:00.000Z");
  assert.equal(report.fleet_totals.total_factories, 4);
  assert.equal(report.fleet_totals.ready, 1);
  assert.equal(report.fleet_totals.lagging, 2);
  assert.equal(report.fleet_totals.unknown, 1);
  assert.equal(report.fleet_totals.canary_selected, 1);

  const alpha = report.factories.find((row) => row.factory_id === "alpha");
  const beta = report.factories.find((row) => row.factory_id === "beta");
  const gamma = report.factories.find((row) => row.factory_id === "gamma");
  const delta = report.factories.find((row) => row.factory_id === "delta");

  assert.equal(alpha.target_repo, "example/alpha");
  assert.equal(alpha.rollout_channel, "stable");
  assert.ok(Object.hasOwn(alpha, "release_identity"));
  assert.equal(alpha.gate_allowed, true);
  assert.equal(alpha.rollout_status, "ready");
  assert.equal(alpha.gate_reason, "ready_to_resume");
  assert.equal(alpha.status_detail, "resume gate ready");
  assert.equal(alpha.upgrade_verification_outcome, "passed");

  assert.equal(beta.target_repo, "example/beta");
  assert.equal(beta.rollout_channel, "canary");
  assert.equal(typeof beta.required_factory_release, "string");
  assert.equal(beta.selected_for_canary, true);
  assert.equal(beta.gate_allowed, false);
  assert.equal(beta.gate_reason, "factory_release_below_required");
  assert.equal(beta.rollout_status, "lagging");
  assert.equal(beta.upgrade_verification_outcome, "unknown");

  assert.equal(gamma.target_repo, "example/gamma");
  assert.equal(gamma.pin_source, "repo_pin");
  assert.equal(gamma.required_factory_release, "1.7.0");
  assert.equal(gamma.rollout_status, "lagging");
  assert.equal(gamma.upgrade_verification_outcome, "unknown");

  assert.equal(delta.target_repo, null);
  assert.equal(delta.rollout_channel, "unknown");
  assert.equal(delta.rollout_status, "unknown");
  assert.equal(delta.gate_reason, "missing_policy_entry");
  assert.equal(delta.upgrade_verification_outcome, "unknown");
  assert.ok(delta.errors.includes("missing_target_repo"));
});

test("factoryReleaseTargetingStatus fails closed on manifest schema mismatch", async () => {
  const report = await factoryReleaseTargetingStatus({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
    }),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "example/alpha" },
        { factory_id: "beta", target_repo: "example/beta" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: () => ({
      ok: false,
      reason: "manifest_schema_mismatch",
      validation_reasons: ["invalid_schema_version:factory_release_manifest/v2"],
    }),
  });

  assert.equal(report.fleet_totals.total_factories, 2);
  assert.equal(report.fleet_totals.manifest_failures, 2);

  for (const row of report.factories) {
    assert.equal(row.gate_reason, "manifest_schema_mismatch");
    assert.ok(["blocked", "unknown"].includes(row.rollout_status));
    assert.ok(Array.isArray(row.errors));
    assert.ok(row.errors.length > 0);
  }
});

test("factoryReleaseTargetingStatus captures canary selection and rollout resume blocks", async () => {
  const canaryManifest = makeManifest({
    releaseTag: "v3.0.0-canary",
    releaseSha: "sha-300c",
    rolloutStatus: "canary_in_progress",
    canaryFactoryIds: ["canary-a"],
    floor: "1.0.0",
    entries: [
      makeEntry({ sourceRepo: "example/canary-a", sourceIssue: 10, factoryId: "canary-a", requiredFactoryRelease: "1.0.0" }),
    ],
  });

  const blockedGeneralManifest = makeManifest({
    releaseTag: "v3.0.0",
    releaseSha: "sha-300",
    rolloutStatus: "rolled_back",
    canaryFactoryIds: ["canary-a"],
    resumeBlocked: true,
    floor: "1.0.0",
    entries: [
      makeEntry({ sourceRepo: "example/blocked-b", sourceIssue: 20, factoryId: "blocked-b", requiredFactoryRelease: "1.0.0" }),
    ],
  });

  const report = await factoryReleaseTargetingStatus({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: {
        default_channel: "stable",
        repo_channels: {
          "example/canary-a": "canary",
        },
      },
      factory_releases: {
        repos: {
          "example/canary-a": "2.0.0",
          "example/blocked-b": "2.0.0",
        },
      },
    }),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "canary-a", target_repo: "example/canary-a" },
        { factory_id: "blocked-b", target_repo: "example/blocked-b" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: ({ rolloutChannel }) => (rolloutChannel === "canary"
      ? { ok: true, manifest: canaryManifest, source: "test", manifest_ref: "main", manifest_path: "canary.json" }
      : { ok: true, manifest: blockedGeneralManifest, source: "test", manifest_ref: "main", manifest_path: "stable.json" }),
  });

  const canary = report.factories.find((row) => row.factory_id === "canary-a");
  const blocked = report.factories.find((row) => row.factory_id === "blocked-b");

  assert.equal(canary.selected_for_canary, true);
  assert.equal(canary.resume_blocked, false);
  assert.equal(canary.rollout_status, "ready");

  assert.equal(blocked.selected_for_canary, false);
  assert.equal(blocked.resume_blocked, true);
  assert.equal(blocked.gate_reason, "release_rollout_blocked");
  assert.equal(blocked.rollout_status, "blocked");
});

test("factoryReleaseTargetingStatus uses local release probe command and computes upgrade verification outcome", async () => {
  const report = factoryReleaseTargetingStatus({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      localReleaseCmdByFactory: {
        alpha: "printf '2.5.0\\n'",
      },
      factory_releases: {
        by_factory: {
          alpha: "0.1.0",
        },
      },
    }),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "example/alpha" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: () => ({
      ok: true,
      manifest: makeManifest({
        releaseTag: "v2.5.0",
        releaseSha: "sha-250",
        rolloutStatus: "promoted",
        floor: "1.0.0",
        entries: [
          makeEntry({ sourceRepo: "example/alpha", sourceIssue: 50, factoryId: "alpha", requiredFactoryRelease: "2.1.0" }),
        ],
      }),
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
  });

  const alpha = report.factories.find((row) => row.factory_id === "alpha");
  assert.equal(alpha.local_factory_release, "2.5.0");
  assert.equal(alpha.upgrade_verification_outcome, "passed");
  assert.equal(alpha.rollout_status, "ready");
});

test("factoryReleaseTargetingStatus falls back when local release probe command fails", async () => {
  const report = factoryReleaseTargetingStatus({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      localReleaseCmdByFactory: {
        alpha: "exit 7",
      },
      factory_releases: {
        by_factory: {
          alpha: "2.2.0",
        },
      },
    }),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "example/alpha" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: () => ({
      ok: true,
      manifest: makeManifest({
        releaseTag: "v2.5.0",
        releaseSha: "sha-250",
        rolloutStatus: "promoted",
        floor: "1.0.0",
        entries: [
          makeEntry({ sourceRepo: "example/alpha", sourceIssue: 51, factoryId: "alpha", requiredFactoryRelease: "2.3.0" }),
        ],
      }),
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
  });

  const alpha = report.factories.find((row) => row.factory_id === "alpha");
  assert.equal(alpha.local_factory_release, "2.2.0");
  assert.equal(alpha.upgrade_verification_outcome, "unknown");
  assert.ok(report.warnings.some((entry) => String(entry).includes("local_release_probe_failed")));
});

test("factoryReleaseTargetingStatus reports passed/failed/unknown upgrade verification outcomes", async () => {
  const report = factoryReleaseTargetingStatus({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      localReleaseCmdByFactory: {
        passed: "printf '3.0.0\\n'",
        failed: "printf '1.0.0\\n'",
      },
      factory_releases: {
        by_factory: {
          unknown: "1.0.0",
        },
      },
    }),
    readFactoryRegistryFn: () => ({
      ok: true,
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "passed", target_repo: "example/passed" },
        { factory_id: "failed", target_repo: "example/failed" },
        { factory_id: "unknown", target_repo: "example/unknown" },
      ],
    }),
    fetchControlPlaneReleaseManifestFn: () => ({
      ok: true,
      manifest: makeManifest({
        releaseTag: "v3.0.0",
        releaseSha: "sha-300",
        rolloutStatus: "promoted",
        floor: "1.0.0",
        entries: [
          makeEntry({ sourceRepo: "example/passed", sourceIssue: 60, factoryId: "passed", requiredFactoryRelease: "2.0.0" }),
          makeEntry({ sourceRepo: "example/failed", sourceIssue: 61, factoryId: "failed", requiredFactoryRelease: "2.0.0" }),
          makeEntry({ sourceRepo: "example/unknown", sourceIssue: 62, factoryId: "unknown", requiredFactoryRelease: "2.0.0" }),
        ],
      }),
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
  });

  const passed = report.factories.find((row) => row.factory_id === "passed");
  const failed = report.factories.find((row) => row.factory_id === "failed");
  const unknown = report.factories.find((row) => row.factory_id === "unknown");

  assert.equal(passed.upgrade_verification_outcome, "passed");
  assert.equal(failed.upgrade_verification_outcome, "failed");
  assert.equal(unknown.upgrade_verification_outcome, "unknown");
});

test("formatReleaseTargetingStatusHuman renders compact fleet summary", () => {
  const output = formatReleaseTargetingStatusHuman({
    fleet_totals: {
      total_factories: 2,
      ready: 1,
      blocked: 1,
      lagging: 0,
      unknown: 0,
      canary_selected: 0,
      resume_blocked: 1,
    },
    factories: [
      {
        factory_id: "alpha",
        rollout_channel: "stable",
        release_identity: { release_tag: "v1.0.0" },
        rollout_status: "ready",
        status_detail: "resume gate ready",
        pin_source: "none",
      },
      {
        factory_id: "beta",
        rollout_channel: "stable",
        release_identity: { release_tag: "v1.0.0" },
        rollout_status: "blocked",
        status_detail: "release rollout currently blocked",
        pin_source: "repo_pin",
      },
    ],
  });

  assert.match(output, /Fleet release targeting total=2 ready=1 blocked=1/);
  assert.match(output, /alpha channel=stable release=v1.0.0 status=ready/);
  assert.match(output, /beta channel=stable release=v1.0.0 status=blocked/);
});
