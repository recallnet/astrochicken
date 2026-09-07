import assert from "node:assert/strict";
import { chdir } from "node:process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadResumePolicy,
  resolveRolloutChannel,
  resolvePinnedRequiredRelease,
  resolveLocalRelease,
  fetchControlPlaneReleaseManifest,
  deriveRequiredReleaseFromManifest,
  evaluateManifestResumeGate,
  ensureResumeReady,
} from "../../src/commands/factory-resume-gate.ts";

test("loadResumePolicy accepts inline JSON string", () => {
  const out = loadResumePolicy({ policyJson: "{\"control_plane_repo\":\"recallnet/astrochicken\",\"rollout\":{\"default_channel\":\"stable\"}}" });
  assert.equal(out.rollout.default_channel, "stable");
  assert.deepEqual(out.policy_validation_errors, []);
});

test("loadResumePolicy surfaces schema validation errors without throwing", () => {
  const out = loadResumePolicy({ policyJson: "{\"bad_key\":true}" });
  assert.ok(Array.isArray(out.policy_validation_errors));
  assert.ok(out.policy_validation_errors.some((entry) => String(entry).includes("Unknown top-level key `bad_key`")));
  assert.ok(out.policy_validation_errors.some((entry) => String(entry).includes("control_plane_repo is required")));
});

test("ensureResumeReady blocks stable resume while release remains in canary", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1068,
    localFactoryRelease: "1.3.0",
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    manifestRef: "main",
    fetchManifestFn: () => ({
      ok: true,
      manifest: {
        release: { tag: "v1.3.0" },
        rollout: { controller: { status: "canary_in_progress", stage: "canary", resume_blocked: false, canary_factory_ids: ["external/issue_worker"] } },
        compatibility_matrix: { required_factory_release_floor: "1.2.0" },
        artifacts: [{
          source_repo: "example/external-factory",
          source_issue: 1068,
          factory_id: "external/issue_worker",
          required_factory_release: "1.2.0",
          linkage: {
            schema_version: "factory_link.v1",
            source_repo: "example/external-factory",
            source_issue: 1068,
            control_plane_repo: "recallnet/astrochicken",
            control_plane_goal: 3002,
            signature_hash: "sha256:ready",
            factory_id: "external/issue_worker",
            required_factory_release: "1.2.0",
            status: "blocked_on_goal",
          },
        }],
      },
      selected_channel: "stable",
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 3002, state: "CLOSED", url: "https://example/3002", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "release_not_promoted_to_general");
  assert.ok(Array.isArray(out.policy_validation_errors));
});


test("ensureResumeReady blocks rolled-back release without self-update", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1068,
    localFactoryRelease: "9.9.9",
    selfUpdateCommand: "echo should-not-run",
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    manifestRef: "main",
    fetchManifestFn: () => ({
      ok: true,
      manifest: {
        release: { tag: "v1.3.0" },
        rollout: { controller: { status: "rolled_back", stage: "rollback", resume_blocked: true, rollback_reason: "factory_status_failed_runs", canary_factory_ids: ["external/issue_worker"] } },
        compatibility_matrix: { required_factory_release_floor: "1.2.0" },
        artifacts: [{
          source_repo: "example/external-factory",
          source_issue: 1068,
          factory_id: "external/issue_worker",
          required_factory_release: "1.2.0",
          linkage: {
            schema_version: "factory_link.v1",
            source_repo: "example/external-factory",
            source_issue: 1068,
            control_plane_repo: "recallnet/astrochicken",
            control_plane_goal: 3002,
            signature_hash: "sha256:ready",
            factory_id: "external/issue_worker",
            required_factory_release: "1.2.0",
            status: "blocked_on_goal",
          },
        }],
      },
      selected_channel: "stable",
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 3002, state: "CLOSED", url: "https://example/3002", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "release_rollout_blocked");
  assert.equal(out.attempted_self_update, false);
  assert.ok(Array.isArray(out.policy_validation_errors));
});

test("resolveLocalRelease resolves from explicit value and command", () => {
  const explicit = resolveLocalRelease({ localFactoryRelease: "1.2.3", releaseCommand: "echo 9.9.9" });
  assert.equal(explicit.value, "1.2.3");
  assert.equal(explicit.from, "arg");

  const command = resolveLocalRelease({ releaseCommand: "printf '2.0.0\\n'" });
  assert.equal(command.value, "2.0.0");
  assert.equal(command.from, "command");
});

test("deriveRequiredReleaseFromManifest picks entry over repo/global floor", () => {
  const manifest = {
    compatibility_matrix: { required_factory_release_floor: "1.4.0" },
    artifacts: [
      { source_repo: "example/external-factory", source_issue: 99, required_factory_release: "1.2.0" },
      { source_repo: "example/external-factory", source_issue: 100, required_factory_release: "1.3.0" },
    ],
  };
  const out = deriveRequiredReleaseFromManifest({ manifest, sourceRepo: "example/external-factory", sourceIssueNumber: 99 });
  assert.equal(out.required_factory_release, "1.4.0");
  assert.equal(out.requirement_source, "manifest_entry");
});

test("resolveRolloutChannel honors explicit + policy precedence", () => {
  const policy = {
    rollout: {
      default_channel: "stable",
      repo_channels: { "example/external-factory": "canary" },
      milestone_channels: { "goal-204-wave-2": "stable" },
      repo_milestone_channels: { "example/external-factory#goal-204-wave-2": "canary" },
    },
  };

  assert.equal(resolveRolloutChannel({ policy, sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-2" }), "canary");
  assert.equal(resolveRolloutChannel({ policy, sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-9" }), "canary");
  assert.equal(resolveRolloutChannel({ policy, sourceRepo: "example-org/other", milestoneTitle: "goal-204-wave-2" }), "stable");
  assert.equal(resolveRolloutChannel({ policy, rolloutChannel: "general", sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-2" }), "stable");
  assert.equal(resolveRolloutChannel({ policy, rolloutChannel: "pinned", sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-2" }), "pinned");
});

test("resolvePinnedRequiredRelease supports repo/milestone/repo_milestone pins", () => {
  const policy = {
    pins: {
      repos: { "example/external-factory": "1.7.0" },
      milestones: { "goal-204-wave-2": "1.8.0" },
      repo_milestones: { "example/external-factory#goal-204-wave-2": "1.9.0" },
    },
  };

  const exact = resolvePinnedRequiredRelease({ policy, sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-2" });
  assert.equal(exact.value, "1.9.0");
  assert.equal(exact.source, "repo_milestone_pin");

  const milestoneOnly = resolvePinnedRequiredRelease({ policy, sourceRepo: "example-org/other", milestoneTitle: "goal-204-wave-2" });
  assert.equal(milestoneOnly.value, "1.8.0");
  assert.equal(milestoneOnly.source, "milestone_pin");

  const repoOnly = resolvePinnedRequiredRelease({ policy, sourceRepo: "example/external-factory", milestoneTitle: "goal-204-wave-9" });
  assert.equal(repoOnly.value, "1.7.0");
  assert.equal(repoOnly.source, "repo_pin");
});

test("fetchControlPlaneReleaseManifest selects rollout channel manifest locator", () => {
  const temp = mkdtempSync(join(tmpdir(), "resume-gate-remote-fetch-"));
  const previousCwd = process.cwd();
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.0.0" },
    rollout: { controller: { status: "pending", stage: "candidate", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.0.0" },
    artifacts: [],
  };

  const encoded = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");
  const calls = [];
  const ghJsonFn = (args, fallback = null) => {
    calls.push(args);
    return { content: encoded, encoding: "base64" };
  };

  chdir(temp);
  try {
    const out = fetchControlPlaneReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      rolloutChannel: "canary",
      policy: {
        rollout: {
          channels: {
            canary: {
              manifest_path: ".hatch/releases/canary/release-manifest.json",
              manifest_ref: "develop",
            },
          },
        },
      },
      ghJsonFn,
    });

    assert.equal(out.ok, true);
    assert.equal(out.selected_channel, "canary");
    assert.equal(out.manifest_path, ".hatch/releases/canary/release-manifest.json");
    assert.equal(out.manifest_ref, "develop");
    assert.equal(out.manifest.compatibility_matrix.required_factory_release_floor, "1.0.0");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "-X");
    assert.equal(calls[0][2], "GET");
    assert.match(calls[0][3], /repos\/recallnet\/astrochicken\/contents\/\.hatch\/releases\/canary\/release-manifest\.json/);
  } finally {
    chdir(previousCwd);
  }
});

test("fetchControlPlaneReleaseManifest defaults to canonical local manifest path", () => {
  const temp = mkdtempSync(join(tmpdir(), "resume-gate-local-manifest-"));
  const previousCwd = process.cwd();
  const manifestPath = join(temp, ".hatch", "releases", "stable", "release-manifest.json");
  mkdirSync(join(temp, ".hatch", "releases", "stable"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.0.0" },
    rollout: { controller: { status: "promoted", stage: "general", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.0.0" },
    artifacts: [],
  }));

  chdir(temp);
  try {
    const out = fetchControlPlaneReleaseManifest({
      rolloutChannel: "stable",
      ghJsonFn: () => {
        throw new Error("gh should not be called when canonical manifest exists locally");
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.source, "local_fs");
    assert.equal(out.manifest_path, ".hatch/releases/stable/release-manifest.json");
    assert.equal(out.manifest.release.tag, "v1.0.0");
  } finally {
    chdir(previousCwd);
  }
});

test("ensureResumeReady defaults to canonical manifest mode when stable manifest exists locally", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1068,
    localFactoryRelease: "1.2.0",
    fetchManifestFn: ({ manifestPath, rolloutChannel }) => ({
      ok: true,
      manifest: {
        schema_version: "factory_release_manifest/v1",
        release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.2.0" },
        rollout: { controller: { status: "promoted", stage: "general", resume_blocked: false, canary_factory_ids: [] } },
        compatibility_matrix: { required_factory_release_floor: "1.0.0" },
        artifacts: [{
          source_repo: "example/external-factory",
          source_issue: 1068,
          factory_id: "external/issue_worker",
          required_factory_release: "1.0.0",
          linkage: {
            schema_version: "factory_link.v1",
            source_repo: "example/external-factory",
            source_issue: 1068,
            control_plane_repo: "recallnet/astrochicken",
            control_plane_goal: 3002,
            signature_hash: "sha256:ready",
            factory_id: "external/issue_worker",
            required_factory_release: "1.0.0",
            status: "blocked_on_goal",
          },
        }],
      },
      selected_channel: rolloutChannel,
      source: "test",
      manifest_ref: "",
      manifest_path: manifestPath,
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 3002, state: "CLOSED", url: "https://example/3002", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
    checkResumeGateFromArtifactLinkFn: () => {
      throw new Error("artifact linkage fallback should not run when canonical manifest mode is defaulted");
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.mode, "manifest");
  assert.equal(out.manifest_fetch?.manifest_path, ".hatch/releases/stable/release-manifest.json");
});

test("fetchControlPlaneReleaseManifest fails closed when manifest schema drifts", () => {
  const temp = mkdtempSync(join(tmpdir(), "resume-gate-invalid-remote-"));
  const previousCwd = process.cwd();
  const invalidManifest = {
    schema_version: "factory_release_manifest/v2",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.0.0" },
    compatibility_matrix: { required_factory_release_floor: "1.0.0" },
    artifacts: [],
  };

  const encoded = Buffer.from(JSON.stringify(invalidManifest), "utf8").toString("base64");
  chdir(temp);
  try {
    const out = fetchControlPlaneReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      rolloutChannel: "stable",
      policy: { manifest_path: ".hatch/releases/stable/release-manifest.json" },
      ghJsonFn: () => ({ content: encoded, encoding: "base64" }),
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "manifest_schema_mismatch");
    assert.match((out.validation_reasons || []).join(","), /invalid_schema_version/);
  } finally {
    chdir(previousCwd);
  }
});

test("ensureResumeReady fails closed when fetched manifest schema mismatches", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1068,
    localFactoryRelease: "9.9.9",
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    manifestRef: "main",
    fetchManifestFn: () => ({
      ok: false,
      reason: "manifest_schema_mismatch",
      selected_channel: "stable",
      validation_reasons: ["invalid_schema_version:factory_release_manifest/v2"],
    }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "manifest_schema_mismatch");
  assert.equal(out.attempted_self_update, false);
});

test("evaluateManifestResumeGate reuses manifest linkage + shared release helpers", () => {
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.1.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.1.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.1.0" },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 123,
        required_factory_release: "1.1.0",
        linkage: {
          schema_version: "factory_link.v1",
          source_repo: "example/external-factory",
          source_issue: 123,
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 2042,
          signature_hash: "sha256:x",
          factory_id: "external/issue_worker",
          required_factory_release: "1.1.0",
          status: "blocked_on_goal",
        },
      },
    ],
  };

  const out = evaluateManifestResumeGate({
    manifest,
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 123,
    milestoneTitle: "goal-204-wave-2",
    localFactoryRelease: "1.2.0",
    policy: {
      pins: {
        milestones: {
          "goal-204-wave-2": "1.3.0",
        },
      },
    },
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 2042, state: "CLOSED", url: "https://example/2042", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.manifest_entry_found, true);
  assert.equal(out.required_factory_release, "1.3.0");
  assert.equal(out.pin_source, "milestone_pin");
  assert.equal(out.pin_override_applied, true);
  assert.equal(out.requirement_source, "policy_pin_override");
  assert.equal(out.reason, "factory_release_below_required");
  assert.equal(out.can_resume, false);
});

test("evaluateManifestResumeGate pin override can lower manifest requirement deterministically", () => {
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.5.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.5.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.5.0" },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 124,
        required_factory_release: "1.5.0",
        linkage: {
          schema_version: "factory_link.v1",
          source_repo: "example/external-factory",
          source_issue: 124,
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 2043,
          signature_hash: "sha256:y",
          factory_id: "external/issue_worker",
          required_factory_release: "1.5.0",
          status: "blocked_on_goal",
        },
      },
    ],
  };

  const out = evaluateManifestResumeGate({
    manifest,
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 124,
    milestoneTitle: "goal-204-wave-3",
    localFactoryRelease: "1.2.0",
    policy: {
      pins: {
        milestones: {
          "goal-204-wave-3": "1.1.0",
        },
      },
    },
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 2043, state: "CLOSED", url: "https://example/2043", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.manifest_required_factory_release, "1.5.0");
  assert.equal(out.pinned_required_factory_release, "1.1.0");
  assert.equal(out.required_factory_release, "1.1.0");
  assert.equal(out.pin_source, "milestone_pin");
  assert.equal(out.pin_override_applied, true);
  assert.equal(out.requirement_source, "policy_pin_override");
  assert.equal(out.release_satisfied, true);
  assert.equal(out.can_resume, true);
  assert.equal(out.reason, "ready_to_resume");
});

test("evaluateManifestResumeGate treats consumed linkage feedback as satisfied in manifest mode", () => {
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.5.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.5.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.5.0" },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 200,
        required_factory_release: "1.5.0",
        linkage: {
          schema_version: "factory_link.v1",
          source_repo: "example/external-factory",
          source_issue: 200,
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 900,
          signature_hash: "sha256:feedback",
          factory_id: "external/issue_worker",
          required_factory_release: "1.5.0",
          status: "release_consumed",
          fixed_in_version: "1.5.0",
          consumed_factory_release: "1.5.0",
          consumed_manifest_version: "v1.5.0",
        },
      },
    ],
  };

  const out = evaluateManifestResumeGate({
    manifest,
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 200,
    localFactoryRelease: "",
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 900, state: "CLOSED", url: "https://example/900", title: "Goal" },
      local_factory_release: localFactoryRelease || "1.5.0",
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, true);
  assert.equal(out.reason, "ready_to_resume");
  assert.equal(out.local_factory_release, "1.5.0");
  assert.equal(out.release_satisfied, true);
  assert.equal(out.release_satisfied, true);
});

test("evaluateManifestResumeGate falls back to artifact linkage when manifest entry is missing", () => {
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v1.5.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.5.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.5.0" },
    artifacts: [],
  };

  const out = evaluateManifestResumeGate({
    manifest,
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1062,
    localFactoryRelease: "2.0.0",
    checkResumeGateFromArtifactLinkFn: () => ({
      ok: true,
      can_resume: false,
      reason: "linked_goal_open",
      goal: { number: 99, state: "OPEN", url: "https://example/99", title: "Goal" },
      local_factory_release: "2.0.0",
      required_factory_release: "1.5.0",
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "linked_goal_open");
  assert.equal(out.manifest_entry_found, false);
  assert.equal(out.fallback_to_artifact_linkage, true);
});

test("evaluateManifestResumeGate recomputes fallback release satisfaction against manifest floor", () => {
  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v2.0.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v2.0.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "2.0.0" },
    artifacts: [],
  };

  const out = evaluateManifestResumeGate({
    manifest,
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1062,
    localFactoryRelease: "1.5.0",
    checkResumeGateFromArtifactLinkFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 199, state: "CLOSED", url: "https://example/199", title: "Goal" },
      local_factory_release: "1.5.0",
      required_factory_release: "1.5.0",
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.required_factory_release, "2.0.0");
  assert.equal(out.release_satisfied, false);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "factory_release_below_required");
});

test("ensureResumeReady reports initial stable resume-ready path without self-update", () => {
  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1068,
    localFactoryRelease: "1.3.0",
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    manifestRef: "main",
    fetchManifestFn: () => ({
      ok: true,
      manifest: {
        release: { tag: "v1.3.0" },
        rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.3.0", resume_blocked: false, canary_factory_ids: [] } },
        compatibility_matrix: { required_factory_release_floor: "1.2.0" },
        artifacts: [{
          source_repo: "example/external-factory",
          source_issue: 1068,
          required_factory_release: "1.2.0",
          linkage: {
            schema_version: "factory_link.v1",
            source_repo: "example/external-factory",
            source_issue: 1068,
            control_plane_repo: "recallnet/astrochicken",
            control_plane_goal: 3002,
            signature_hash: "sha256:ready",
            factory_id: "external/issue_worker",
            required_factory_release: "1.2.0",
            status: "blocked_on_goal",
          },
        }],
      },
      selected_channel: "stable",
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 3002, state: "CLOSED", url: "https://example/3002", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, true);
  assert.equal(out.reason, "ready_to_resume");
  assert.equal(out.attempted_self_update, false);
  assert.ok(Array.isArray(out.policy_validation_errors));
});

test("ensureResumeReady runs self-update, posts consume feedback, and rechecks stable manifest gate before resume", () => {
  const temp = mkdtempSync(join(tmpdir(), "resume-gate-"));
  const releaseFile = join(temp, ".factory-release");
  writeFileSync(releaseFile, "1.0.0\n", "utf8");

  const selfUpdatePath = join(temp, "self-update.sh");
  writeFileSync(
    selfUpdatePath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '1.3.0\\n' > "${releaseFile}"
`,
    "utf8",
  );
  chmodSync(selfUpdatePath, 0o755);

  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: { control_plane_repo: "recallnet/astrochicken", sha: "sha", tag: "v1.3.0" },
    rollout: { controller: { status: "promoted", stage: "general", channel: "stable", pinned_release_id: "v1.3.0", resume_blocked: false, canary_factory_ids: [] } },
    compatibility_matrix: { required_factory_release_floor: "1.2.0" },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 1062,
        required_factory_release: "1.2.0",
        linkage: {
          schema_version: "factory_link.v1",
          source_repo: "example/external-factory",
          source_issue: 1062,
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 3001,
          signature_hash: "sha256:goal",
          factory_id: "external/issue_worker",
          required_factory_release: "1.2.0",
          status: "blocked_on_goal",
        },
      },
    ],
  };

  const out = ensureResumeReady({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 1062,
    localFactoryReleaseCommand: `cat "${releaseFile}"`,
    selfUpdateCommand: selfUpdatePath,
    manifestPath: ".hatch/releases/stable/release-manifest.json",
    manifestRef: "main",
    fetchManifestFn: () => ({
      ok: true,
      manifest,
      selected_channel: "stable",
      source: "test",
      manifest_ref: "main",
      manifest_path: ".hatch/releases/stable/release-manifest.json",
    }),
    checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 3001, state: "CLOSED", url: "https://example/3001", title: "Goal" },
      local_factory_release: localFactoryRelease,
      required_factory_release: requiredFactoryRelease,
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.attempted_self_update, true);
  assert.equal(out.self_update_ok, true);
  assert.equal(out.local_factory_release_before, "1.0.0");
  assert.equal(out.local_factory_release_after, "1.3.0");
  assert.equal(out.can_resume, true);
  assert.equal(out.reason, "ready_to_resume");
  assert.ok(Array.isArray(out.policy_validation_errors));
});
