import { acquireReleaseLeaseFixture } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CONTROL_PLANE_RELEASE_ASSET_PREFIX, createGhReleaseAssetClient, publishControlPlaneReleaseAsset } from "../../src/commands/control-plane-release-asset.ts";
import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";
import { buildReconciledControllerState, latestTelemetryRecord, normalizePublishedManifest, readRolloutEventLog, reconcilePromotedChannelPins, reconcileRolledBackChannelPins } from "../../src/commands/release-rollout-controller-state.ts";
import { RELEASE_ROLLOUT_EVENT_PREFIX, RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION, RELEASE_ROLLOUT_STATE_SCHEMA_VERSION, buildReleaseRolloutEvent, evaluateManifestRolloutGate, readReleaseManifestFile, renderReleaseRolloutEvent, resolveReleaseIdentity, runReleaseRolloutController, selectCanaryFactoryIds, writeReleaseManifestFile } from "../../src/commands/release-rollout-controller.ts";
import { evaluateReleaseCanaryHealth, pollReleaseCanaryHealth } from "../../src/commands/release-rollout-controller-health.ts";
import { buildReleaseRolloutCloudEvent } from "../../src/lib/release-rollout-asyncapi-contract.ts";

function eventData(event) {
  return event?.data && typeof event.data === "object" ? event.data : event;
}

function makeManifest({ releaseTag = "v2.1.0", releaseSha = "sha-210", artifacts = null } = {}) {
  return buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag,
    releaseSha,
    entries: artifacts || [
      {
        source_repo: "example/external-factory",
        source_issue: 101,
        source_issue_url: "https://example/101",
        summary: "first",
        factory_id: "external/issue_worker",
        required_factory_release: "2.1.0",
        status: "blocked_upstream",
        signature_hash: "sha256:101",
        linkage: {
          schema_version: "factory_link.v1",
          linkage_key: "sha256:l101",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 6001,
          source_repo: "example/external-factory",
          source_issue: 101,
          status: "blocked_upstream",
          factory_id: "external/issue_worker",
          required_factory_release: "2.1.0",
          signature_hash: "sha256:101",
        },
      },
      {
        source_repo: "other-org/other-factory",
        source_issue: 202,
        source_issue_url: "https://example/202",
        summary: "second",
        factory_id: "other/worker",
        required_factory_release: "2.1.0",
        status: "blocked_upstream",
        signature_hash: "sha256:202",
        linkage: {
          schema_version: "factory_link.v1",
          linkage_key: "sha256:l202",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 6002,
          source_repo: "other-org/other-factory",
          source_issue: 202,
          status: "blocked_upstream",
          factory_id: "other/worker",
          required_factory_release: "2.1.0",
          signature_hash: "sha256:202",
        },
      },
    ],
  });
}

function setupPaths(name = "release-rollout-") {
  const temp = mkdtempSync(join(tmpdir(), name));
  const releasesDir = join(temp, ".hatch", "releases");
  const runsDir = join(temp, ".hatch", "runs");
  mkdirSync(releasesDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  return {
    temp,
    releasesDir,
    runsDir,
    candidateManifestPath: join(releasesDir, "v2.1.0", "release-manifest.json"),
    canaryManifestPath: join(releasesDir, "canary", "release-manifest.json"),
    generalManifestPath: join(releasesDir, "stable", "release-manifest.json"),
  };
}

function mockPublishManifestAsset(payload = {}) {
  return {
    release_id: payload.releaseId || "v2.1.0",
    release_tag: payload.releaseTag || "v2.1.0",
    release_sha: payload.releaseSha || "sha-210",
    asset_id: "asset-100",
    asset_url: "https://example/assets/100",
    manifest_path: "control-plane-manifests/release-manifest.json",
  };
}

test("release rollout controller exports schema versions", () => {
  assert.equal(RELEASE_ROLLOUT_STATE_SCHEMA_VERSION, "release_rollout_state/v1");
  assert.equal(RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION, "release_rollout_event/v1");
});

test("createGhReleaseAssetClient fails closed when repo is missing", () => {
  assert.throws(() => createGhReleaseAssetClient({ repo: "" }), /missing_repo/);
});

test("release rollout state helpers normalize publish metadata and reconcile channel pins", async () => {
  const normalized = normalizePublishedManifest({ asset_id: "asset-1" });
  assert.equal(normalized.asset_id, "asset-1");
  assert.equal(normalized.asset_url, "");

  const telemetry = latestTelemetryRecord({
    controller: { events: [buildReleaseRolloutCloudEvent({
      id: "promote:stable:v2.1.0",
      subject: "release-rollout/v2.1.0",
      time: "2026-03-07T00:00:00.000Z",
      data: {
        schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
        action: "promote",
        channel: "stable",
        status: "promoted",
        reason: "health_checks_passed",
        release_id: "v2.1.0",
        at: "2026-03-07T00:00:00.000Z",
      },
    })] },
    renderEventFn: (event) => `event:${eventData(event).action}`,
  });
  assert.equal(telemetry, "event:promote");

  const writeCalls = [];
  const promotedPins = reconcilePromotedChannelPins({
    candidateManifest: { release: { tag: "v2.1.0" } },
    canaryManifestPath: ".hatch/releases/canary/release-manifest.json",
    generalManifestPath: ".hatch/releases/stable/release-manifest.json",
    writeReleaseManifestFileFn: (path, manifest) => {
      writeCalls.push({ path, manifest });
    },
  });
  assert.equal(writeCalls.length, 2);
  assert.equal(promotedPins.canary_manifest_path, ".hatch/releases/canary/release-manifest.json");

  const restoreCalls = [];
  const rolledBackPins = reconcileRolledBackChannelPins({
    releasesDir: ".hatch/releases",
    canaryManifestPath: ".hatch/releases/canary/release-manifest.json",
    generalManifestPath: ".hatch/releases/stable/release-manifest.json",
    previousCanaryReleaseId: "v2.0.0",
    previousGeneralReleaseId: "v2.0.1",
    restoreChannelPinFn: (payload) => {
      restoreCalls.push(payload);
      return { ok: true };
    },
  });
  assert.equal(restoreCalls.length, 2);
  assert.equal(rolledBackPins.general_manifest_path, ".hatch/releases/stable/release-manifest.json");

  const reconciled = buildReconciledControllerState({
    manifest: { rollout: { controller: {} } },
    controller: {
      channel: "stable",
      pinned_release_id: "v2.0.1",
      previous_canary_release_id: "v2.0.0",
      previous_general_release_id: "v2.0.1",
      canary_factory_ids: ["other/worker"],
      canary_max_factories: 1,
      candidate_manifest_path: "candidate.json",
      canary_manifest_path: "canary.json",
      general_manifest_path: "stable.json",
      health: {},
      publish: {},
      events: [],
    },
    status: "rolled_back",
    stage: "rollback",
    resumeBlocked: true,
    rollbackReason: "health_check_failed",
    lease: { acquired: true },
    updatedAt: "2026-03-07T00:00:00.000Z",
    writeControllerStateFn: (manifest, patch) => ({ ...manifest, rollout: { controller: patch } }),
  });
  assert.equal(reconciled.rollout.controller.status, "rolled_back");
  assert.equal(reconciled.rollout.controller.channel, "stable");
  assert.equal(reconciled.rollout.controller.pinned_release_id, "v2.0.1");
  assert.equal(reconciled.rollout.controller.resume_blocked, true);

  const manifestWithEvents = {
    rollout: {
      controller: {
        events: [
          buildReleaseRolloutCloudEvent({
            id: "promote:v2.1.0",
            subject: "release-rollout/v2.1.0",
            time: "2026-03-07T00:00:00.000Z",
            data: {
              schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
              action: "promote",
              channel: "stable",
              status: "promoted",
              reason: "health_checks_passed",
              release_id: "v2.1.0",
              at: "2026-03-07T00:00:00.000Z",
            },
          }),
        ],
      },
    },
  };

  const eventsPath = join(setupPaths("release-rollout-events-").temp, "events.json");
  writeFileSync(eventsPath, JSON.stringify(manifestWithEvents, null, 2));
  const fromFile = await readRolloutEventLog({ manifestPath: eventsPath });
  assert.equal(fromFile.length, 1);
  assert.equal(fromFile[0].schema_version, RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION);

  const fromFetch = await readRolloutEventLog({
    controlPlaneRepo: "recallnet/astrochicken",
    rolloutChannel: "stable",
    fetchControlPlaneReleaseManifestFn: () => ({
      ok: true,
      manifest: manifestWithEvents,
    }),
  });
  assert.equal(fromFetch.length, 1);
  assert.equal(fromFetch[0].action, "promote");
  const rolloutEvent = normalizePublishedManifest({
    ...mockPublishManifestAsset(),
    release_id: "v2.1.0",
  });
  assert.equal(rolloutEvent.release_id, "v2.1.0");
});

test("buildReleaseRolloutCloudEvent emits canonical lineage projection for downstream consumers", () => {
  const event = buildReleaseRolloutCloudEvent({
    id: "promote:stable:v2.1.0",
    subject: "release-rollout/v2.1.0",
    time: "2026-03-07T00:00:00.000Z",
    data: {
      schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
      action: "promote",
      channel: "stable",
      status: "promoted",
      reason: "health_checks_passed",
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "sha-210",
      previous_release_id: "",
      run_id: "release-run-7",
      holder_id: "lease-1",
      tracking_issue_number: "123",
      asset_id: "asset-1",
      asset_url: "https://example.test/assets/release-manifest.json",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
      at: "2026-03-07T00:00:00.000Z",
    },
  });

  assert.deepEqual(event.openlineage, {
    eventType: "COMPLETE",
    job: { namespace: "factory.release.rollout", name: "stable" },
    outputs: [{ namespace: "release.asset", name: "https://example.test/assets/release-manifest.json" }],
    run: { runId: "release-run-7" },
  });
});

test("selectCanaryFactoryIds caps deterministic canary set", () => {
  const manifest = makeManifest();
  const out = selectCanaryFactoryIds({ manifest, maxFactories: 1 });
  assert.deepEqual(out, ["external/issue_worker"]);
});

test("renderReleaseRolloutEvent emits wave-lease style telemetry prefix", () => {
  const rendered = renderReleaseRolloutEvent(buildReleaseRolloutEvent({
    action: "rollback",
    channel: "canary",
    status: "rolled_back",
    reason: "health_check_timeout",
    releaseId: "v2.1.0",
  }));
  assert.match(rendered, new RegExp(`^${RELEASE_ROLLOUT_EVENT_PREFIX}`));
  assert.match(rendered, /rolled_back/);
});

test("publishControlPlaneReleaseAsset uploads deterministic manifest path and returns audit ids", async () => {
  const paths = setupPaths("release-rollout-asset-helper-");
  writeReleaseManifestFile(paths.candidateManifestPath, makeManifest());

  const calls = [];
  const githubClient = {
    listReleaseAssets: () => [{ id: "asset-old", label: `${CONTROL_PLANE_RELEASE_ASSET_PREFIX}/release-manifest.json` }],
    deleteReleaseAsset: (payload) => {
      calls.push({ type: "delete", payload });
      return { ok: true };
    },
    uploadReleaseAsset: (payload) => {
      calls.push({ type: "upload", payload });
      return { asset_id: "asset-900", asset_url: "https://example/assets/900" };
    },
  };

  const out = await publishControlPlaneReleaseAsset({
    manifestPath: paths.candidateManifestPath,
    releaseId: "v2.1.0",
    releaseTag: "v2.1.0",
    releaseSha: "sha-210",
    githubClient,
  });

  const upload = calls.find((entry) => entry.type === "upload");
  assert.ok(upload);
  assert.equal(upload.payload.assetPath, "control-plane-manifests/release-manifest.json");
  assert.equal(out.asset_id, "asset-900");
  assert.equal(out.asset_url, "https://example/assets/900");
  assert.equal(out.manifest_path, "control-plane-manifests/release-manifest.json");
});

test("evaluateReleaseCanaryHealth passes when existing ops telemetry satisfies policy", () => {
  const out = evaluateReleaseCanaryHealth({
    factoryStatusSnapshot: { active: [], completed: 4, failed: 0 },
    tickStatusSnapshot: { ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing wave" }] },
    outcomesSnapshot: { merged_prs: 1, merge_commits_main: 1, closed_features: 1, closed_bugs: 0, closed_feature_bug_total: 1 },
    healthPolicy: { min_merged_prs: 1, min_closed_feature_bug_total: 1, max_failed_runs: 0, max_failed_ticks: 0 },
    checkedAt: "2026-03-07T00:00:00.000Z",
  });

  assert.equal(out.passed, true);
  assert.equal(out.reason, "health_check_passed");
});

test("pollReleaseCanaryHealth rechecks pending health until pass", async () => {
  let attempt = 0;
  const out = await pollReleaseCanaryHealth({
    repo: "recallnet/astrochicken",
    repoPath: ".",
    runsDir: ".hatch/runs",
    lookbackHours: 1,
    healthPolicy: { max_polls: 3, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 },
    factoryStatusFn: () => ({ active: [], completed: 2, failed: 0 }),
    tickStatusFn: () => ({ ticks: [{ status: "running", stage: "supervisor_health" }] }),
    outcomesFn: () => {
      attempt += 1;
      return { merged_prs: attempt >= 2 ? 1 : 0, merge_commits_main: 0, closed_features: 0, closed_bugs: 0, closed_feature_bug_total: 0 };
    },
    sleepFn: async () => {},
    nowIsoFn: () => `2026-03-07T00:00:0${attempt}.000Z`,
  });

  assert.equal(out.ok, true);
  assert.equal(out.passed, true);
  assert.equal(out.poll_count, 2);
});

test("runReleaseRolloutController promotes healthy canary, posts fixed-in feedback once per artifact, and rewrites manifest metadata", async () => {
  const paths = setupPaths("release-rollout-pass-");
  const manifest = makeManifest();
  writeReleaseManifestFile(paths.candidateManifestPath, manifest);

  const feedbackCalls = [];

  const out = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    canaryMaxFactories: 1,
    healthPolicyJson: JSON.stringify({ max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 }),
    resolveTrackingIssueFn: () => ({ ok: true, tracking_issue_number: "407", reason: "resolved" }),
    acquireLeaseFn: acquireReleaseLeaseFixture,
    releaseLeaseFn: () => ({ ok: true, released: true, reason: "lease_released" }),
    factoryStatusFn: () => ({ active: [], completed: 3, failed: 0 }),
    tickStatusFn: () => ({ ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing wave" }] }),
    outcomesFn: () => ({ merged_prs: 1, merge_commits_main: 1, closed_features: 1, closed_bugs: 0, closed_feature_bug_total: 1 }),
    sleepFn: async () => {},
    nowIsoFn: () => "2026-03-07T00:00:00.000Z",
    postArtifactFeedbackFn: (payload) => {
      feedbackCalls.push(payload);
      return {
        ok: true,
        skipped: false,
        reason: "comment_posted",
        source_repo: payload.source_repo,
        source_issue: payload.source_issue,
      };
    },
    publishManifestAssetFn: ({ releaseId, releaseTag, releaseSha }) => mockPublishManifestAsset({ releaseId, releaseTag, releaseSha })
  }));

  assert.equal(out.ok, true);
  assert.equal(out.decision, "promoted");
  assert.equal(existsSync(paths.canaryManifestPath), true);
  assert.equal(existsSync(paths.generalManifestPath), true);
  assert.equal(feedbackCalls.length, 2);
  assert.equal(feedbackCalls[0].manifestPath, paths.candidateManifestPath);
  assert.equal(out.published_manifest.asset_id, "asset-100");
  assert.equal(out.published_manifest.manifest_path, "control-plane-manifests/release-manifest.json");
  assert.match(out.publish_telemetry_record, /publish_manifest_asset/);

  const written = readReleaseManifestFile(paths.candidateManifestPath);
  assert.equal(written.rollout.controller.status, "promoted");
  assert.equal(written.rollout.controller.health.status, "passed");
  assert.deepEqual(written.rollout.controller.canary_factory_ids, ["external/issue_worker"]);
  assert.equal(eventData(written.rollout.controller.events.at(-1)).action, "publish_manifest_asset");
  assert.equal(written.rollout.controller.publish.asset_id, "asset-100");
  assert.equal(written.rollout.controller.publish.manifest_path, "control-plane-manifests/release-manifest.json");
  assert.equal(written.artifacts[0].linkage.fixed_in_version, "v2.1.0");
  assert.equal(written.artifacts[0].linkage.fixed_in_manifest, paths.candidateManifestPath);
  assert.equal(written.artifacts[1].linkage.fixed_in_version, "v2.1.0");
  assert.equal(written.artifacts[1].linkage.fixed_in_manifest, paths.candidateManifestPath);
  assert.match(out.telemetry_record, /^CLOUDEVENT /);
  assert.match(out.telemetry_record, /"type":"dev\.recallnet\.factory\.release\.rollout"/);
});

test("runReleaseRolloutController forwards factory identity into canary health reads", async () => {
  const paths = setupPaths("release-rollout-factory-id-");
  const manifest = makeManifest();
  writeReleaseManifestFile(paths.candidateManifestPath, manifest);

  const healthReadArgs = [];

  const out = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    canaryMaxFactories: 1,
    healthPolicyJson: JSON.stringify({ max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 }),
    factoryId: "example-trading",
    resolveTrackingIssueFn: () => ({ ok: true, tracking_issue_number: "407", reason: "resolved" }),
    acquireLeaseFn: acquireReleaseLeaseFixture,
    releaseLeaseFn: () => ({ ok: true, released: true, reason: "lease_released" }),
    factoryStatusFn: (args) => {
      healthReadArgs.push({ kind: "factory", args });
      assert.equal(args?.context?.factory_id, "example-trading");
      return { active: [], completed: 3, failed: 0 };
    },
    tickStatusFn: (args) => {
      healthReadArgs.push({ kind: "tick", args });
      assert.equal(args?.context?.factory_id, "example-trading");
      return { ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing wave" }] };
    },
    outcomesFn: () => ({ merged_prs: 1, merge_commits_main: 1, closed_features: 1, closed_bugs: 0, closed_feature_bug_total: 1 }),
    sleepFn: async () => {},
    nowIsoFn: () => "2026-03-07T00:00:00.000Z",
    postArtifactFeedbackFn: () => ({ ok: true, skipped: true, reason: "no_artifacts" }),
    publishManifestAssetFn: ({ releaseId, releaseTag, releaseSha }) => mockPublishManifestAsset({ releaseId, releaseTag, releaseSha })
  }));

  assert.equal(out.ok, true);
  assert.equal(out.decision, "promoted");
  assert.deepEqual(healthReadArgs.map((entry) => entry.kind), ["factory", "tick"]);
});

test("runReleaseRolloutController blocks promotion deterministically when artifact feedback comment fails", async () => {
  const paths = setupPaths("release-rollout-feedback-fail-");
  const manifest = makeManifest();
  writeReleaseManifestFile(paths.candidateManifestPath, manifest);

  const out = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    canaryMaxFactories: 1,
    healthPolicyJson: JSON.stringify({ max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 }),
    resolveTrackingIssueFn: () => ({ ok: true, tracking_issue_number: "407", reason: "resolved" }),
    acquireLeaseFn: acquireReleaseLeaseFixture,
    releaseLeaseFn: () => ({ ok: true, released: true, reason: "lease_released" }),
    factoryStatusFn: () => ({ active: [], completed: 3, failed: 0 }),
    tickStatusFn: () => ({ ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing wave" }] }),
    outcomesFn: () => ({ merged_prs: 1, merge_commits_main: 1, closed_features: 1, closed_bugs: 0, closed_feature_bug_total: 1 }),
    sleepFn: async () => {},
    nowIsoFn: () => "2026-03-07T00:00:00.000Z",
    postArtifactFeedbackFn: () => ({ ok: false, reason: "issue_comment_failed", error: "rate limit" })
  }));

  assert.equal(out.ok, false);
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "artifact_feedback_failed");
  assert.equal(out.failed_feedback.reason, "issue_comment_failed");

  const written = readReleaseManifestFile(paths.candidateManifestPath);
  assert.equal(written.rollout.controller.status, "canary_in_progress");
  assert.equal(written.artifacts[0].linkage.fixed_in_version, "");
  assert.equal(written.artifacts[0].linkage.fixed_in_manifest, "");
});

test("runReleaseRolloutController checkpoints partial artifact feedback progress and rerun comments only remaining artifacts", async () => {
  const paths = setupPaths("release-rollout-feedback-rerun-");
  const manifest = makeManifest();
  writeReleaseManifestFile(paths.candidateManifestPath, manifest);

  const feedbackCalls = [];
  let attempt = 1;
  const postArtifactFeedbackFn = (payload) => {
    feedbackCalls.push({ attempt, source_issue: payload.source_issue });
    if (attempt === 1 && payload.source_issue === 101) {
      return { ok: false, reason: "issue_comment_failed", error: "rate limit" };
    }
    return {
      ok: true,
      skipped: false,
      reason: "comment_posted",
      source_repo: payload.source_repo,
      source_issue: payload.source_issue,
    };
  };

  const runArgs = rolloutFixtureOptions(paths, {
    canaryMaxFactories: 1,
    healthPolicyJson: JSON.stringify({ max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 }),
    resolveTrackingIssueFn: () => ({ ok: true, tracking_issue_number: "407", reason: "resolved" }),
    acquireLeaseFn: acquireReleaseLeaseFixture,
    releaseLeaseFn: () => ({ ok: true, released: true, reason: "lease_released" }),
    factoryStatusFn: () => ({ active: [], completed: 3, failed: 0 }),
    tickStatusFn: () => ({ ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing wave" }] }),
    outcomesFn: () => ({ merged_prs: 1, merge_commits_main: 1, closed_features: 1, closed_bugs: 0, closed_feature_bug_total: 1 }),
    sleepFn: async () => {},
    nowIsoFn: () => "2026-03-07T00:00:00.000Z",
    postArtifactFeedbackFn,
    publishManifestAssetFn: ({ releaseId, releaseTag, releaseSha }) => mockPublishManifestAsset({ releaseId, releaseTag, releaseSha })
  });

  const first = await runReleaseRolloutController(runArgs);
  assert.equal(first.ok, false);
  assert.equal(first.decision, "blocked");

  const manifestAfterFirst = readReleaseManifestFile(paths.candidateManifestPath);
  assert.equal(manifestAfterFirst.artifacts[0].linkage.fixed_in_version, "");
  assert.equal(manifestAfterFirst.artifacts[0].linkage.fixed_in_manifest, "");
  assert.equal(manifestAfterFirst.artifacts[1].linkage.fixed_in_version, "");
  assert.equal(manifestAfterFirst.artifacts[1].linkage.fixed_in_manifest, "");

  attempt = 2;
  const second = await runReleaseRolloutController(runArgs);
  assert.equal(second.ok, true);
  assert.equal(second.decision, "promoted");
  assert.equal(second.published_manifest.asset_id, "asset-100");

  const secondAttemptCalls = feedbackCalls.filter((entry) => entry.attempt === 2);
  assert.equal(secondAttemptCalls.length, 2);
  assert.deepEqual(secondAttemptCalls.map((entry) => entry.source_issue), [101, 202]);

  const finalManifest = readReleaseManifestFile(paths.candidateManifestPath);
  assert.equal(finalManifest.artifacts[0].linkage.fixed_in_version, "v2.1.0");
  assert.equal(finalManifest.artifacts[1].linkage.fixed_in_version, "v2.1.0");
  assert.equal(finalManifest.artifacts[1].linkage.fixed_in_manifest, paths.candidateManifestPath);
});

test("runReleaseRolloutController rolls back unhealthy canary idempotently and blocks resume", async () => {
  const paths = setupPaths("release-rollout-fail-");
  const previousCanary = makeManifest({ releaseTag: "v1.9.0", releaseSha: "sha-190" });
  const previousGeneral = makeManifest({ releaseTag: "v2.0.0", releaseSha: "sha-200" });
  writeReleaseManifestFile(join(paths.releasesDir, "v1.9.0", "release-manifest.json"), previousCanary);
  writeReleaseManifestFile(join(paths.releasesDir, "v2.0.0", "release-manifest.json"), previousGeneral);
  writeReleaseManifestFile(paths.canaryManifestPath, previousCanary);
  writeReleaseManifestFile(paths.generalManifestPath, previousGeneral);

  const manifest = makeManifest();
  manifest.rollout.controller.previous_canary_release_id = "v1.9.0";
  manifest.rollout.controller.previous_general_release_id = "v2.0.0";
  manifest.artifacts[0].linkage.fixed_in_version = "v2.0.0";
  manifest.artifacts[0].linkage.fixed_in_manifest = ".hatch/releases/v2.0.0/release-manifest.json";
  writeReleaseManifestFile(paths.candidateManifestPath, manifest);

  let releaseCount = 0;
  const first = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    canaryMaxFactories: 1,
    healthPolicyJson: JSON.stringify({ max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 }),
    resolveTrackingIssueFn: () => ({ ok: true, tracking_issue_number: "407", reason: "resolved" }),
    acquireLeaseFn: acquireReleaseLeaseFixture,
    releaseLeaseFn: () => {
      releaseCount += 1;
      return { ok: true, released: true, reason: "lease_released" };
    },
    factoryStatusFn: () => ({ active: [], completed: 0, failed: 2 }),
    tickStatusFn: () => ({ ticks: [{ status: "failed", stage: "supervisor_health", stageLabel: "Health check" }] }),
    outcomesFn: () => ({ merged_prs: 0, merge_commits_main: 0, closed_features: 0, closed_bugs: 0, closed_feature_bug_total: 0 }),
    sleepFn: async () => {},
    nowIsoFn: () => "2026-03-07T00:10:00.000Z",
    postArtifactFeedbackFn: () => {
      throw new Error("artifact_feedback_should_not_run_on_rollback");
    },
    publishManifestAssetFn: ({ releaseId, releaseTag, releaseSha }) => mockPublishManifestAsset({ releaseId, releaseTag, releaseSha })
  }));

  assert.equal(first.ok, true);
  assert.equal(first.decision, "rolled_back");
  assert.equal(first.published_manifest.asset_id, "asset-100");
  assert.match(first.publish_telemetry_record, /publish_manifest_asset/);
  assert.equal(releaseCount, 1);

  const rolledBackManifest = readReleaseManifestFile(paths.candidateManifestPath);
  assert.equal(rolledBackManifest.rollout.controller.status, "rolled_back");
  assert.equal(rolledBackManifest.rollout.controller.resume_blocked, true);
  assert.equal(rolledBackManifest.rollout.controller.rollback_reason, "factory_status_failed_runs");
  assert.equal(rolledBackManifest.rollout.controller.events.filter((event) => eventData(event).action === "rollback").length, 1);
  assert.equal(rolledBackManifest.rollout.controller.events.filter((event) => eventData(event).action === "publish_manifest_asset").length, 1);
  assert.equal(rolledBackManifest.rollout.controller.publish.asset_id, "asset-100");
  assert.equal(rolledBackManifest.artifacts[0].linkage.fixed_in_version, "v2.0.0");
  assert.equal(rolledBackManifest.artifacts[0].linkage.fixed_in_manifest, ".hatch/releases/v2.0.0/release-manifest.json");

  const restoredGeneral = readReleaseManifestFile(paths.generalManifestPath);
  assert.equal(resolveReleaseIdentity(restoredGeneral).release_id, "v2.0.0");
  const restoredCanary = readReleaseManifestFile(paths.canaryManifestPath);
  assert.equal(resolveReleaseIdentity(restoredCanary).release_id, "v1.9.0");

  const second = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    resolveTrackingIssueFn: () => {
      throw new Error("should_not_reacquire_lease");
    }
  }));

  assert.equal(second.ok, true);
  assert.equal(second.noop, true);
  assert.equal(second.decision, "rolled_back");
  assert.equal(second.published_manifest.asset_id, "asset-100");
});

test("rerun after crash in rolled_back state reconciles pins only and never restarts canary", async () => {
  const paths = setupPaths("release-rollout-crash-");
  const previousCanary = makeManifest({ releaseTag: "v1.9.0", releaseSha: "sha-190" });
  const previousGeneral = makeManifest({ releaseTag: "v2.0.0", releaseSha: "sha-200" });
  writeReleaseManifestFile(join(paths.releasesDir, "v1.9.0", "release-manifest.json"), previousCanary);
  writeReleaseManifestFile(join(paths.releasesDir, "v2.0.0", "release-manifest.json"), previousGeneral);
  const candidate = makeManifest();
  candidate.rollout.controller = {
    ...candidate.rollout.controller,
    status: "rolled_back",
    stage: "rollback",
    resume_blocked: true,
    rollback_reason: "factory_status_failed_runs",
    previous_canary_release_id: "v1.9.0",
    previous_general_release_id: "v2.0.0",
    canary_factory_ids: ["other/worker"],
  };
  writeReleaseManifestFile(paths.candidateManifestPath, candidate);
  writeReleaseManifestFile(paths.canaryManifestPath, candidate);
  writeReleaseManifestFile(paths.generalManifestPath, candidate);

  const out = await runReleaseRolloutController(rolloutFixtureOptions(paths, {
    resolveTrackingIssueFn: () => {
      throw new Error("should_not_reenter_rollout");
    },
    acquireLeaseFn: () => {
      throw new Error("should_not_reacquire_lease");
    }
  }));

  assert.equal(out.ok, true);
  assert.equal(out.decision, "rolled_back");
  assert.equal(out.noop, true);
  assert.equal(readReleaseManifestFile(paths.candidateManifestPath).rollout.controller.status, "rolled_back");
  assert.equal(resolveReleaseIdentity(readReleaseManifestFile(paths.canaryManifestPath)).release_id, "v1.9.0");
  assert.equal(resolveReleaseIdentity(readReleaseManifestFile(paths.generalManifestPath)).release_id, "v2.0.0");
});

test("evaluateManifestRolloutGate blocks resume after rollback and limits canary consumers", () => {
  const manifest = makeManifest();
  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status: "rolled_back",
    stage: "rollback",
    channel: "stable",
    pinned_release_id: "v2.1.0",
    resume_blocked: true,
    rollback_reason: "factory_status_failed_runs",
    canary_factory_ids: ["other/worker"],
  };

  const blocked = evaluateManifestRolloutGate({
    manifest,
    manifestEntry: { factory_id: "external/issue_worker" },
    rolloutChannel: "stable",
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "release_rollout_blocked");

  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status: "canary_in_progress",
    stage: "canary",
    channel: "canary",
    pinned_release_id: "v0.0.1",
    resume_blocked: false,
  };

  const skipped = evaluateManifestRolloutGate({
    manifest,
    manifestEntry: { factory_id: "external/issue_worker" },
    rolloutChannel: "canary",
  });
  assert.equal(skipped.allowed, false);
  assert.equal(skipped.reason, "release_not_selected_for_canary");

  const selected = evaluateManifestRolloutGate({
    manifest,
    manifestEntry: { factory_id: "other/worker" },
    rolloutChannel: "canary",
  });
  assert.equal(selected.allowed, true);

  const pinnedBlocked = evaluateManifestRolloutGate({
    manifest,
    manifestEntry: { factory_id: "other/worker" },
    rolloutChannel: "pinned",
  });
  assert.equal(pinnedBlocked.allowed, false);
  assert.equal(pinnedBlocked.reason, "release_not_pinned_match");

  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status: "promoted",
    stage: "general",
    channel: "stable",
    pinned_release_id: "v2.1.0",
    resume_blocked: false,
  };

  const pinnedAllowed = evaluateManifestRolloutGate({
    manifest,
    manifestEntry: { factory_id: "other/worker" },
    rolloutChannel: "pinned",
  });
  assert.equal(pinnedAllowed.allowed, true);
  assert.equal(pinnedAllowed.reason, "release_pinned");
});

function rolloutFixtureOptions(paths, overrides) {
  return {
    repo: "recallnet/astrochicken",
    repoPath: paths.temp,
    candidateManifestPath: paths.candidateManifestPath,
    releasesDir: paths.releasesDir,
    runsDir: paths.runsDir,
    canaryManifestPath: paths.canaryManifestPath,
    generalManifestPath: paths.generalManifestPath,
    ...overrides,
  };
}
