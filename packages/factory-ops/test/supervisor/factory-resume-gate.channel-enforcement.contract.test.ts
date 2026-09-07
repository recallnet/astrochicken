import assert from "node:assert/strict";
import test from "node:test";

import { ensureResumeReady } from "../../src/commands/factory-resume-gate.ts";
import {
  defaultReleaseRolloutSleep,
  evaluateReleaseCanaryHealth,
  pollReleaseCanaryHealth,
} from "../../src/commands/release-rollout-controller-health.ts";

function buildManifest({ channel = "canary" } = {}) {
  return {
    schema_version: "factory_release_manifest/v1",
    release: {
      control_plane_repo: "recallnet/astrochicken",
      sha: "abc123",
      tag: "v2.4.0",
    },
    rollout: {
      controller: {
        status: "canary_in_progress",
        stage: "canary",
        channel,
        pinned_release_id: "v2.4.0",
        resume_blocked: false,
        canary_factory_ids: ["external/issue_worker"],
      },
    },
    compatibility_matrix: { required_factory_release_floor: "2.4.0" },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 2214,
        factory_id: "external/issue_worker",
        required_factory_release: "2.4.0",
        linkage: {
          schema_version: "factory_link.v1",
          source_repo: "example/external-factory",
          source_issue: 2214,
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 2214,
          signature_hash: "sha256:channel-enforcement",
          factory_id: "external/issue_worker",
          required_factory_release: "2.4.0",
          status: "blocked_on_goal",
        },
      },
    ],
  };
}

test("release-rollout-controller-health helpers keep canonical canary health semantics", async () => {
  const passedHealth = evaluateReleaseCanaryHealth({
    factoryStatusSnapshot: { active: [], completed: 1, failed: 0 },
    tickStatusSnapshot: { ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing" }] },
    outcomesSnapshot: { merged_prs: 1, merge_commits_main: 1, closed_features: 0, closed_bugs: 0, closed_feature_bug_total: 0 },
    healthPolicy: { min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 },
    checkedAt: "2026-03-16T00:00:00.000Z",
  });
  assert.equal(passedHealth.passed, true);
  assert.equal(passedHealth.reason, "health_check_passed");

  const failedHealth = evaluateReleaseCanaryHealth({
    factoryStatusSnapshot: { active: [], completed: 0, failed: 2 },
    tickStatusSnapshot: { ticks: [{ status: "failed", stage: "wave_execute", stageLabel: "Executing" }] },
    outcomesSnapshot: { merged_prs: 0, merge_commits_main: 0, closed_features: 0, closed_bugs: 0, closed_feature_bug_total: 0 },
    healthPolicy: { min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 },
    checkedAt: "2026-03-16T00:00:00.000Z",
  });
  assert.equal(failedHealth.passed, false);
  assert.equal(failedHealth.reason, "factory_status_failed_runs");

  const polled = await pollReleaseCanaryHealth({
    repo: "recallnet/astrochicken",
    repoPath: ".",
    runsDir: ".hatch/runs",
    lookbackHours: 1,
    healthPolicy: { max_polls: 1, poll_interval_ms: 0, min_merged_prs: 1, max_failed_runs: 0, max_failed_ticks: 0 },
    factoryStatusFn: () => ({ active: [], completed: 1, failed: 0 }),
    tickStatusFn: () => ({ ticks: [{ status: "running", stage: "wave_execute", stageLabel: "Executing" }] }),
    outcomesFn: () => ({ merged_prs: 1, merge_commits_main: 1, closed_features: 0, closed_bugs: 0, closed_feature_bug_total: 0 }),
    sleepFn: defaultReleaseRolloutSleep,
    nowIsoFn: () => "2026-03-16T00:00:00.000Z",
  });
  assert.equal(polled.ok, true);
  assert.equal(polled.passed, true);
  assert.equal(polled.reason, "health_check_passed");
});

test("ensureResumeReady rejects canary-only release when policy resolves stable channel", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 2214,
    localFactoryRelease: "2.4.0",
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: {
        default_channel: "stable",
        repo_channels: {
          "example/external-factory": "stable",
        },
      },
    }),
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    fetchManifestFn: () => ({
      ok: true,
      selected_channel: "stable",
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
      manifest: buildManifest({ channel: "canary" }),
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 2214, state: "CLOSED", url: "https://example/2214", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.selected_channel, "stable");
  assert.equal(out.rollout_gate.allowed, false);
  assert.equal(out.rollout_gate.reason, "release_not_promoted_to_general");
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "release_not_promoted_to_general");
});
