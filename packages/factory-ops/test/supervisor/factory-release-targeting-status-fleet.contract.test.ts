import assert from "node:assert/strict";
import test from "node:test";

import { factoryReleaseTargetingStatus } from "../../src/commands/factory-release-targeting-status.ts";
import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";

function makeEntry({
  sourceRepo,
  sourceIssue,
  factoryId,
  requiredFactoryRelease,
  status = "blocked_upstream",
}) {
  return {
    source_repo: sourceRepo,
    source_issue: sourceIssue,
    source_issue_url: `https://example/${sourceIssue}`,
    summary: `${sourceRepo}#${sourceIssue}`,
    status,
    required_factory_release: requiredFactoryRelease,
    factory_id: factoryId,
    signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    linkage: {
      schema_version: "factory_link.v1",
      control_plane_repo: "recallnet/astrochicken",
      control_plane_goal: 10000 + Number(sourceIssue || 0),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      status,
      factory_id: factoryId,
      required_factory_release: requiredFactoryRelease,
      signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    },
  };
}

function makeManifest({
  releaseTag,
  releaseSha,
  rolloutStatus,
  canaryFactoryIds = [],
  entries,
}) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag,
    releaseSha,
    entries,
  });

  manifest.rollout.controller.status = rolloutStatus;
  manifest.rollout.controller.stage = rolloutStatus === "promoted" ? "general" : "canary";
  manifest.rollout.controller.resume_blocked = false;
  manifest.rollout.controller.canary_factory_ids = canaryFactoryIds;
  manifest.compatibility_matrix.required_factory_release_floor = "1.0.0";
  return manifest;
}

function rowById(report, factoryId) {
  return report.factories.find((row) => row.factory_id === factoryId);
}

test("factoryReleaseTargetingStatus proves fleet correctness across six factories and channel transition", async () => {
  const policyJson = JSON.stringify({
    control_plane_repo: "recallnet/astrochicken",
    rollout: {
      default_channel: "general",
      repo_channels: {
        "example/factory-d": "canary",
        "example/factory-e": "canary",
      },
    },
    pins: {
      repos: {
        "example/factory-b": "2.3.0",
      },
    },
  });

  const registry = {
    ok: true,
    registry_path: "/tmp/factory-registry.json",
    factories: [
      { factory_id: "factory-a", target_repo: "example/factory-a" },
      { factory_id: "factory-b", target_repo: "example/factory-b" },
      { factory_id: "factory-c", target_repo: "example/factory-c" },
      { factory_id: "factory-d", target_repo: "example/factory-d" },
      { factory_id: "factory-e", target_repo: "example/factory-e" },
      { factory_id: "factory-f", target_repo: "example/factory-f" },
    ],
  };

  const canaryManifest = makeManifest({
    releaseTag: "v4.0.0-canary",
    releaseSha: "sha-400c",
    rolloutStatus: "canary_in_progress",
    canaryFactoryIds: ["factory-d", "factory-e"],
    entries: [
      makeEntry({
        sourceRepo: "example/factory-d",
        sourceIssue: 401,
        factoryId: "factory-d",
        requiredFactoryRelease: "3.0.0",
      }),
      makeEntry({
        sourceRepo: "example/factory-e",
        sourceIssue: 402,
        factoryId: "factory-e",
        requiredFactoryRelease: "2.0.0",
        status: "rejected",
      }),
    ],
  });

  const generalManifestBlocked = makeManifest({
    releaseTag: "v4.0.0",
    releaseSha: "sha-400",
    rolloutStatus: "promoted",
    entries: [
      makeEntry({
        sourceRepo: "example/factory-a",
        sourceIssue: 301,
        factoryId: "factory-a",
        requiredFactoryRelease: "2.0.0",
      }),
      makeEntry({
        sourceRepo: "example/factory-b",
        sourceIssue: 302,
        factoryId: "factory-b",
        requiredFactoryRelease: "2.2.0",
      }),
      makeEntry({
        sourceRepo: "example/factory-c",
        sourceIssue: 303,
        factoryId: "factory-c",
        requiredFactoryRelease: "2.0.0",
        status: "rejected",
      }),
    ],
  });

  const generalManifestReady = makeManifest({
    releaseTag: "v4.0.1",
    releaseSha: "sha-401",
    rolloutStatus: "promoted",
    entries: [
      makeEntry({
        sourceRepo: "example/factory-a",
        sourceIssue: 301,
        factoryId: "factory-a",
        requiredFactoryRelease: "2.0.0",
      }),
      makeEntry({
        sourceRepo: "example/factory-b",
        sourceIssue: 302,
        factoryId: "factory-b",
        requiredFactoryRelease: "2.2.0",
      }),
      makeEntry({
        sourceRepo: "example/factory-c",
        sourceIssue: 303,
        factoryId: "factory-c",
        requiredFactoryRelease: "2.0.0",
      }),
    ],
  });

  let currentGeneralManifest = generalManifestBlocked;
  let generalFetchCount = 0;
  let canaryFetchCount = 0;

  const localReleaseProbeOutput = {
    "probe factory-a": "2.5.0",
    "probe factory-b": "2.0.0",
    "probe factory-c": "2.1.0",
    "probe factory-d": "3.1.0",
    "probe factory-e": "1.9.0",
  };

  const spawnSyncFn = (_cmd, args) => {
    const command = String(args?.[1] || "").trim();
    const out = localReleaseProbeOutput[command];
    if (!out) return { status: 1, stdout: "", stderr: `unknown_probe:${command}` };
    return { status: 0, stdout: `${out}\n`, stderr: "" };
  };

  const baseArgs = {
    policyJson,
    localReleaseCmdByFactory: {
      "factory-a": "probe factory-a",
      "factory-b": "probe factory-b",
      "factory-c": "probe factory-c",
      "factory-d": "probe factory-d",
      "factory-e": "probe factory-e",
    },
    readFactoryRegistryFn: () => registry,
    fetchControlPlaneReleaseManifestFn: ({ rolloutChannel }) => {
      if (rolloutChannel === "canary") {
        canaryFetchCount += 1;
        return {
          ok: true,
          manifest: canaryManifest,
          source: "test",
          manifest_ref: "main",
          manifest_path: "canary.json",
        };
      }
      generalFetchCount += 1;
      return {
        ok: true,
        manifest: currentGeneralManifest,
        source: "test",
        manifest_ref: "main",
        manifest_path: "stable.json",
      };
    },
    spawnSyncFn,
  };

  const first = await factoryReleaseTargetingStatus(baseArgs);

  assert.equal(first.fleet_totals.ready, 2);
  assert.equal(first.fleet_totals.blocked, 2);
  assert.equal(first.fleet_totals.lagging, 1);
  assert.equal(first.fleet_totals.unknown, 1);
  assert.equal(first.fleet_totals.canary_selected, 2);

  const factoryA = rowById(first, "factory-a");
  const factoryB = rowById(first, "factory-b");
  const factoryC = rowById(first, "factory-c");
  const factoryD = rowById(first, "factory-d");
  const factoryE = rowById(first, "factory-e");
  const factoryF = rowById(first, "factory-f");

  assert.equal(factoryA.rollout_status, "ready");
  assert.equal(factoryA.rollout_channel, "stable");
  assert.equal(factoryA.selected_for_canary, false);
  assert.equal(factoryA.pin_source, "none");
  assert.equal(factoryA.upgrade_verification_outcome, "passed");

  assert.equal(factoryB.rollout_status, "lagging");
  assert.equal(factoryB.selected_for_canary, false);
  assert.equal(factoryB.pin_source, "repo_pin");
  assert.equal(factoryB.upgrade_verification_outcome, "failed");

  assert.equal(factoryC.rollout_status, "blocked");
  assert.equal(factoryC.selected_for_canary, false);
  assert.equal(factoryC.pin_source, "none");

  assert.equal(factoryD.rollout_status, "ready");
  assert.equal(factoryD.selected_for_canary, true);
  assert.equal(factoryD.pin_source, "none");
  assert.equal(factoryD.upgrade_verification_outcome, "passed");

  assert.equal(factoryE.rollout_status, "blocked");
  assert.equal(factoryE.selected_for_canary, true);
  assert.equal(factoryE.pin_source, "none");
  assert.equal(factoryE.upgrade_verification_outcome, "failed");

  assert.equal(factoryF.rollout_status, "unknown");
  assert.equal(factoryF.rollout_channel, "stable");
  assert.equal(factoryF.selected_for_canary, false);
  assert.equal(factoryF.pin_source, "none");
  assert.equal(factoryF.upgrade_verification_outcome, "unknown");

  currentGeneralManifest = generalManifestReady;
  const second = await factoryReleaseTargetingStatus(baseArgs);
  const secondFactoryC = rowById(second, "factory-c");

  assert.equal(secondFactoryC.rollout_status, "ready");
  assert.equal(second.fleet_totals.blocked, first.fleet_totals.blocked - 1);

  assert.equal(generalFetchCount, 2);
  assert.equal(canaryFetchCount, 2);
});
