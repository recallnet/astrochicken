import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
  describeOperatorSignals,
  expectedNextOutcomeForNode,
  formatFactoryActiveMinimal,
  formatFactoryStatus,
  formatFactoryActiveSummary,
} from "../../src/commands/factory-status.ts";
import { buildReleaseManifest, syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";
import {
  formatControlPlaneGateSection,
  formatManagedStateLine,
  formatActiveRunTreeRows,
  presentFactoryStatus,
  presentFactoryActiveSummary,
} from "../../src/lib/factory-status-presenter.ts";
import {
  legacyFixtureFactoryActiveSummary as factoryActiveSummary,
  legacyFixtureFactoryStatus as factoryStatus,
} from "../../src/lib/factory-status-support.ts";
import { resolveRunsDir } from "../../src/lib/runs-dir-resolver.ts";
function writeRun(runsDir, id, state, metadata = null) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
  if (metadata) {
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));
  }
}

function buildControlPlaneManifest({ status = "promoted", reason = "" } = {}) {
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

function writeControlPlaneManifest(runsDir, { channel = "stable", status = "promoted", reason = "" } = {}) {
  const hatchDir = join(runsDir, "..");
  const manifestPath = join(hatchDir, "releases", channel, "release-manifest.json");
  const manifest = buildControlPlaneManifest({ status, reason });

  mkdirSync(join(hatchDir, "releases", channel), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function syncControlPlaneManifestForStatus(runsDir, { status = "promoted", reason = "" } = {}) {
  const hatchDir = join(runsDir, "..");
  const repoRoot = join(hatchDir, "..");
  const sourceManifestPath = join(hatchDir, "releases", "v9.9.9", "release-manifest.json");
  mkdirSync(join(hatchDir, "releases", "v9.9.9"), { recursive: true });
  writeFileSync(sourceManifestPath, JSON.stringify(buildControlPlaneManifest({ status, reason }), null, 2));
  return syncControlPlaneManifest({
    manifestPath: sourceManifestPath,
    repoRoot,
  });
}

function writeExternalControlState({ rootDir, factoryId, state }) {
  const controlStatePath = join(rootDir, ".hatch", "factories", factoryId, "control-state.json");
  mkdirSync(join(rootDir, ".hatch", "factories", factoryId), { recursive: true });
  writeFileSync(controlStatePath, JSON.stringify(state, null, 2));
  return controlStatePath;
}

test("factoryStatus treats stale running run with dead pid as failed", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-"));
  const staleHeartbeat = new Date(Date.now() - 40 * 60 * 1000).toISOString();

  writeRun(runsDir, "stale-running", {
    runId: "stale-running",
    status: "running",
    currentNode: "review",
    updatedAt: staleHeartbeat,
    pid: 999999,
  }, {
    runId: "stale-running",
    status: "running",
    pid: 999999,
    heartbeatAt: staleHeartbeat,
    updatedAt: staleHeartbeat,
  });

  writeRun(runsDir, "healthy-running", {
    runId: "healthy-running",
    status: "running",
    currentNode: "execute_issue_in_wave",
    updatedAt: new Date().toISOString(),
  });

  const out = factoryStatus({ runsDir, staleMinutes: 20 });
  assert.equal(out.failed, 1);
  assert.equal(out.active.length, 1);
  assert.equal(out.runs.length, 1);
  assert.equal(out.active[0].id, "healthy-running");
  assert.equal(out.active[0].run_id, "healthy-running");
  assert.equal(typeof out.active[0].updated_at, "string");
});

test("factoryStatus includes control_plane gate block with synced manifest evidence and publish ids", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-control-plane-"));
  const runsDir = join(rootDir, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });
  const syncOut = syncControlPlaneManifestForStatus(runsDir, { status: "promoted" });
  assert.equal(syncOut.ok, true);

  const out = factoryStatus({
    runsDir,
    context: { control_plane_repo: "recallnet/astrochicken" },
  });

  assert.equal(out.control_plane.selected_channel, "general");
  assert.notEqual(out.control_plane.resume_reason, "control_plane_manifest_unavailable");
  assert.equal(out.control_plane.resume_reason, "ready_to_resume");
  assert.equal(out.control_plane.required_release_floor, "9.9.9");
  assert.match(out.control_plane.manifest.path, /releases[\\/]stable[\\/]release-manifest\.json$/);
  assert.equal(out.control_plane.publish.asset_id, "asset-555");
  assert.equal(out.control_plane.publish.manifest_path, "control-plane-manifests/release-manifest.json");

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /Control plane gate:/);
  assert.match(rendered, /Manifest:/);
  assert.match(rendered, /Published asset: id=asset-555/);
});

test("factoryStatus renders blocked control-plane reason when canary rollout is still in progress", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-control-plane-canary-"));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "canary", status: "canary_in_progress" });

  const out = factoryStatus({ runsDir });
  assert.equal(out.control_plane.selected_channel, "canary");
  assert.equal(out.control_plane.can_resume, false);
  assert.equal(out.control_plane.resume_reason, "release_not_promoted_to_general");
  assert.match(out.control_plane.resume_when, /promotion to stable\/general channel/);

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /reason=release_not_promoted_to_general/);
  assert.match(rendered, /Resume condition:/);
});

test("factoryStatus prefers canary gate state when stable and canary manifests both exist", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-control-plane-both-"));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "stable", status: "promoted" });
  writeControlPlaneManifest(runsDir, { channel: "canary", status: "canary_in_progress" });

  const out = factoryStatus({ runsDir });
  assert.equal(out.control_plane.selected_channel, "canary");
  assert.equal(out.control_plane.can_resume, false);
  assert.equal(out.control_plane.resume_reason, "release_not_promoted_to_general");
  assert.match(out.control_plane.manifest.path, /releases[\\/]canary[\\/]release-manifest\.json$/);

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /channel=canary/);
  assert.match(rendered, /reason=release_not_promoted_to_general/);
});

test("factoryStatus includes control-plane blocker metadata for blocked waves", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-blocked-cp-"));
  writeRun(runsDir, "run-cp", {
    runId: "run-cp",
    status: "running",
    currentNode: "decide_wave_dispatch",
    updatedAt: new Date().toISOString(),
    context: {
      control_plane_blocked_items: JSON.stringify([
        {
          milestone: "goal-500-wave-1",
          issue_number: 501,
          kind: "upstream_bug",
          blockerRef: "#4321",
          unblockCondition: "release v4.5.6 ships",
          status: "blocked",
        },
      ]),
    },
  });

  const out = factoryStatus({ runsDir });
  assert.equal(out.blocked_control_plane.length, 1);
  assert.equal(out.blocked_control_plane[0].blockerKind, "upstream_bug");
  assert.equal(out.blocked_control_plane[0].blockerRef, "#4321");
  assert.equal(out.blocked_control_plane[0].unblockCondition, "release v4.5.6 ships");
  assert.equal(out.blocked_control_plane[0].linked_goal_number, 4321);

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /Blocked control-plane work:/);
  assert.match(rendered, /goal-500-wave-1/);
  assert.match(rendered, /upstream_bug #4321/);
});

test("factoryStatus ignores active runs whose graph path falls outside the resolved factory root", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-scope-"));
  const factoryRoot = join(rootDir, "factories", "mothership");
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(factoryRoot, { recursive: true });
  mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeRun(runsDir, "factory-wave", {
    runId: "factory-wave",
    status: "running",
    currentNode: "execute_issue_in_wave",
    updatedAt: new Date().toISOString(),
    pipelineFile: join(factoryRoot, "graphs", "wave_execute.dot"),
    pipeline: join(factoryRoot, "graphs", "wave_execute.dot"),
    context: {
      milestone_title: "goal-200-wave-1",
      current_issue_number: 201,
    },
  });

  writeRun(runsDir, "foreign-test-run", {
    runId: "foreign-test-run",
    status: "running",
    currentNode: "slow",
    updatedAt: new Date().toISOString(),
    pipelineFile: "/tmp/hatch-pipeline-timeout-foreign/child-timeout.dot",
    pipeline: "/tmp/hatch-pipeline-timeout-foreign/child-timeout.dot",
  });

  const status = factoryStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      factory_root: factoryRoot,
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
  });

  assert.equal(status.active.length, 1);
  assert.equal(status.active[0].run_id, "factory-wave");

  const summary = factoryActiveSummary({
    runsDir,
    context: {
      factory_id: "mothership",
      factory_root: factoryRoot,
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
  });

  assert.equal(summary.active_run_count, 1);
  assert.equal(summary.active_wave_count, 1);
  assert.equal(summary.non_wave_active.length, 0);
  assert.equal(summary.waves.length, 1);
  assert.equal(summary.waves[0].milestone_title, "goal-200-wave-1");
});

test("factoryStatus surfaces open durable packets for operator takeover", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-open-packets-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  const packetDir = join(runsDir, "run-judge", "packets", "judge_context_contract_recovery");
  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "judge_context_contract_recovery_abc.json"), JSON.stringify({
    schema_version: "remediation_packet/v1",
    packet_type: "judge_context_contract_recovery",
    packet_id: "judge_context_contract_recovery_abc",
    packet_state: "open",
    created_at: new Date().toISOString(),
    factory_id: "mothership",
    run_id: "run-judge",
    pipeline: "wave_execute",
    node_id: "build_judge_context_recovery_packet",
    intent: "Recover failed judge context contract",
    resource_refs: {
      milestone_title: "goal-1-wave-1",
    },
  }, null, 2));

  const out = factoryStatus({
    runsDir,
    context: { factory_id: "mothership" },
  });

  assert.equal(out.open_packets.length, 1);
  assert.equal(out.open_packets[0].packet_type, "judge_context_contract_recovery");
  assert.equal(out.open_packets[0].title, "goal-1-wave-1");

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /Open durable packets:/);
  assert.match(rendered, /judge_context_contract_recovery/);
  assert.match(rendered, /goal-1-wave-1/);
});

test("factoryStatus ignores control-plane blockers from completed runs (stale blocker bug)", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-stale-cp-"));
  // Completed run with stale blocker data — should NOT surface in factory status
  writeRun(runsDir, "run-completed", {
    runId: "run-completed",
    status: "completed",
    currentNode: "done",
    updatedAt: new Date().toISOString(),
    context: {
      control_plane_blocked_items: JSON.stringify([
        {
          milestone: "goal-500-wave-1",
          issue_number: 501,
          kind: "upstream_bug",
          blockerRef: "#4321",
          unblockCondition: "release v4.5.6 ships",
          status: "blocked",
        },
      ]),
    },
  });

  const out = factoryStatus({ runsDir });
  assert.equal(out.blocked_control_plane.length, 0,
    "completed runs must not contribute stale control-plane blockers");
});

test("factoryStatus ignores stale control-plane blocker context when blocker_active=false", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-stale-active-cp-"));
  writeRun(runsDir, "run-active", {
    runId: "run-active",
    status: "running",
    currentNode: "execute_issue_in_wave",
    updatedAt: new Date().toISOString(),
    context: {
      blocker_active: "false",
      control_plane_blocked_items: JSON.stringify([
        {
          milestone: "goal-1811-wave-2",
          issue_number: 1846,
          kind: "upstream_bug",
          blockerRef: "",
          unblockCondition: "Wait for control-plane blocker status to change.",
          status: "blocked",
        },
      ]),
    },
  });

  const out = factoryStatus({ runsDir });
  assert.equal(out.blocked_control_plane.length, 0,
    "active runs with blocker_active=false must not surface stale control-plane blockers");
});

test("factoryStatus derives managed_state from operator pause control-state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-managed-state-pause-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRun(runsDir, "run-1", {
    runId: "run-1",
    status: "running",
    currentNode: "review",
    updatedAt: new Date().toISOString(),
  });

  const controlStatePath = writeExternalControlState({
    rootDir,
    factoryId: "mothership",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "mothership",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: "operator",
      reason: "manual pause",
      action_state: {
        pause: { active: true },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({ runsDir, context: { factory_id: "mothership" } });
  assert.equal(out.managed_state.state_action, "pause");
  assert.equal(out.managed_state.health_classification, "operator_paused");
  assert.equal(out.managed_state.reason, "manual pause");
  assert.equal(out.managed_state.state_path, controlStatePath);

  const rendered = formatFactoryStatus(out);
  assert.match(rendered, /Managed state: action=pause health=operator_paused/);
  assert.match(rendered, /Reason: manual pause/);
});

test("factoryStatus managed_state distinguishes control_plane_blocked vs locally_unhealthy", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-managed-state-classes-"));
  const blockedRunsDir = join(rootDir, "blocked", "runs");
  mkdirSync(blockedRunsDir, { recursive: true });
  writeControlPlaneManifest(blockedRunsDir, { channel: "canary", status: "canary_in_progress" });

  const blocked = factoryStatus({ runsDir: blockedRunsDir });
  assert.equal(blocked.managed_state.health_classification, "control_plane_blocked");

  const unhealthyRunsDir = join(rootDir, "unhealthy", "runs");
  mkdirSync(unhealthyRunsDir, { recursive: true });
  writeControlPlaneManifest(unhealthyRunsDir, { channel: "stable", status: "promoted" });
  writeRun(unhealthyRunsDir, "failed-1", {
    runId: "failed-1",
    status: "failed",
    currentNode: "review",
    updatedAt: new Date().toISOString(),
  });

  const unhealthy = factoryStatus({ runsDir: unhealthyRunsDir });
  assert.equal(unhealthy.failed, 1);
  assert.equal(unhealthy.managed_state.health_classification, "locally_unhealthy");
});

test("factoryStatus prefers active control-plane blocker reason over stale resume reason", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-blocked-reason-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "stable", status: "promoted" });

  writeRun(runsDir, "blocked-wave", {
    runId: "blocked-wave",
    status: "running",
    currentNode: "decide_wave_dispatch",
    updatedAt: new Date().toISOString(),
    context: {
      control_plane_blocked_items: JSON.stringify([
        {
          milestone: "goal-1591-wave-2",
          issue_number: 1834,
          kind: "upstream_bug",
          unblockCondition: "Wait for control-plane blocker status to change.",
          status: "blocked",
        },
      ]),
    },
  });

  writeExternalControlState({
    rootDir,
    factoryId: "mothership",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "mothership",
      version: 2,
      updated_at: new Date().toISOString(),
      updated_by: "operator",
      reason: "Duplicate wave dispatch investigation complete; fix shipped in commit b0a4dc41.",
      action_state: {
        pause: { active: false },
        quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
        retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
        unblock: { active: false, note: "", at: "" },
        resume: { active: true, at: new Date().toISOString() },
      },
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({
    runsDir,
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
  });

  assert.equal(out.managed_state.health_classification, "control_plane_blocked");
  assert.equal(out.managed_state.reason, "Wait for control-plane blocker status to change.");
});

test("factoryStatus does not keep resumed factory locally_unhealthy from historical failed runs alone", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-resumed-healthy-"));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "stable", status: "promoted" });
  writeRun(runsDir, "failed-1", {
    runId: "failed-1",
    status: "failed",
    currentNode: "review",
    updatedAt: new Date().toISOString(),
  });
  writeExternalControlState({
    rootDir,
    factoryId: "mothership",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "mothership",
      version: 2,
      updated_at: new Date().toISOString(),
      updated_by: "operator",
      action_state: {
        pause: { active: false },
        quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
        retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
        unblock: { active: false, note: "", at: "" },
        resume: { active: true, at: new Date().toISOString() },
      },
      reason: "operator resumed after prior incident was fixed",
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({ runsDir, context: { factory_id: "mothership" } });
  assert.equal(out.failed, 1);
  assert.equal(out.managed_state.state_action, "resume");
  assert.equal(out.managed_state.health_classification, "healthy");
});
test("factoryStatus clears historical failure health once a later tick completes", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-recovered-after-failure-"));
  const runsDir = join(rootDir, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "stable", status: "promoted" });
  writeRun(runsDir, "failed-1", {
    runId: "failed-1",
    status: "failed",
    currentNode: "review",
    updatedAt: "2026-03-12T16:02:53.809Z",
  });
  writeRun(runsDir, "completed-1", {
    runId: "completed-1",
    status: "completed",
    currentNode: "done",
    updatedAt: "2026-03-12T16:03:02.097Z",
  });

  const out = factoryStatus({ runsDir, context: { factory_id: "mothership" } });
  assert.equal(out.failed, 1);
  assert.equal(out.completed, 1);
  assert.equal(out.managed_state.state_action, "none");
  assert.equal(out.managed_state.health_classification, "healthy");
});
test("factoryStatus clears stale resume incident reason once factory is healthy", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-resume-reason-"));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeControlPlaneManifest(runsDir, { channel: "stable", status: "promoted" });
  writeExternalControlState({
    rootDir,
    factoryId: "mothership",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "mothership",
      version: 2,
      updated_at: new Date().toISOString(),
      updated_by: "operator",
      action_state: {
        pause: { active: false },
        quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
        retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
        unblock: { active: false, note: "", at: "" },
        resume: { active: true, at: new Date().toISOString() },
      },
      reason: "Duplicate wave dispatch investigation complete; fix shipped in commit b0a4dc41.",
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({ runsDir, context: { factory_id: "mothership" } });
  const rendered = formatFactoryStatus(out);
  assert.equal(out.managed_state.state_action, "resume");
  assert.equal(out.managed_state.health_classification, "healthy");
  assert.equal(out.managed_state.reason, "");
  assert.doesNotMatch(rendered, /Reason:/);
});

test("factoryStatus/active-summary include context object and render context header", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-context-"));
  writeRun(runsDir, "run-1", {
    runId: "run-1",
    status: "running",
    currentNode: "review",
    updatedAt: new Date().toISOString(),
  });

  const context = {
    factory_root: "/tmp/factory-root",
    factory_id: "mothership",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: runsDir,
    scenarios_root: "/tmp/factory-root/scenarios",
  };

  const status = factoryStatus({ runsDir, context });
  assert.equal(status.context.factory_id, "mothership");
  assert.equal(status.context.runs_dir, runsDir);
  const renderedStatus = formatFactoryStatus(status);
  assert.match(renderedStatus, /Factory: \/tmp\/factory-root/);
  assert.match(renderedStatus, /Factory ID: mothership/);
  assert.match(renderedStatus, /Target Repo: recallnet\/astrochicken/);
  assert.match(renderedStatus, /Control Plane: recallnet\/astrochicken/);
  assert.match(renderedStatus, new RegExp(`Runs Dir: ${runsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const summary = factoryActiveSummary({ runsDir, context });
  assert.equal(summary.context.factory_id, "mothership");
  const renderedSummary = formatFactoryActiveSummary(summary);
  assert.match(renderedSummary, /Factory ID: mothership/);
});

test("factoryStatus exposes canonical active child metadata", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-status-children-"));

  writeRun(runsDir, "parent", {
    runId: "parent",
    status: "running",
    currentNode: "execute_issue_in_wave",
    updatedAt: new Date().toISOString(),
    activeChildren: {
      execute_issue_in_wave__abc123: {
        childId: "execute_issue_in_wave__abc123",
        parentNodeId: "execute_issue_in_wave",
        childRunId: "child-abc",
        childRunDir: join(runsDir, "child-abc"),
        role: "coder",
        traceKind: "coder",
        workerIndex: 1,
        status: "running",
        currentNode: "build",
      },
    },
  });

  writeRun(runsDir, "child-abc", {
    runId: "child-abc",
    status: "running",
    currentNode: "build",
    updatedAt: new Date().toISOString(),
  });

  const out = factoryStatus({ runsDir });
  assert.equal(out.active.length, 2);
  const parent = out.active.find((row) => row.id === "parent");
  assert.ok(parent);
  assert.equal(parent.active_children.length, 1);
  assert.equal(parent.active_children[0].child_id, "execute_issue_in_wave__abc123");
  assert.equal(parent.active_children[0].parent_node_id, "execute_issue_in_wave");
  assert.equal(parent.active_children[0].run_id, "child-abc");
  assert.equal(parent.active_children[0].role, "coder");
  assert.equal(parent.active_children[0].trace_kind, "coder");
  assert.equal(parent.active_children[0].worker_index, 1);
  assert.equal(parent.active_children[0].status, "running");
});

test("factoryActiveSummary reports active wave issue and deterministically selected child identity", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-active-summary-"));

  writeRun(runsDir, "wave-parent", {
    runId: "wave-parent",
    pipeline: "/tmp/wave_execute.dot",
    status: "running",
    currentNode: "execute_issue_in_wave",
    updatedAt: new Date().toISOString(),
    context: {
      milestone_title: "goal-999-wave-1",
      ready_issue_number: "9001",
      next_issue_number: "9002",
      processed_issues: "[\"9000\"]",
      milestone_issues: JSON.stringify([
        { number: 9000, title: "Feature A" },
        { number: 9002, title: "Feature B" },
        { number: 9003, title: "Feature C" },
        { number: 9001, title: "Wave Ready: goal-999-wave-1" },
      ]),
      __child_run_id_execute_issue_in_wave: "child-1",
    },
    activeChildren: {
      execute_issue_in_wave__child_1: {
        childId: "execute_issue_in_wave__child_1",
        parentNodeId: "execute_issue_in_wave",
        childRunId: "child-1",
        childRunDir: join(runsDir, "child-1"),
        role: "coder",
        traceKind: "coder",
        status: "running",
        currentNode: "build",
      },
      execute_issue_in_wave__child_2: {
        childId: "execute_issue_in_wave__child_2",
        parentNodeId: "execute_issue_in_wave",
        childRunId: "child-2",
        childRunDir: join(runsDir, "child-2"),
        role: "reviewer",
        traceKind: "reviewer",
        status: "running",
        currentNode: "review",
      },
    },
  });

  writeRun(runsDir, "child-1", {
    runId: "child-1",
    pipeline: "/tmp/wave_issue_execute.dot",
    status: "running",
    currentNode: "build",
    updatedAt: new Date(Date.now() - 1_000).toISOString(),
    context: { issue_number: "9002", goal_issue_number: "999", milestone_title: "goal-999-wave-1" },
  });

  writeRun(runsDir, "child-2", {
    runId: "child-2",
    pipeline: "/tmp/wave_issue_execute.dot",
    status: "running",
    currentNode: "review",
    updatedAt: new Date().toISOString(),
    context: { issue_number: "9003", milestone_title: "goal-999-wave-1" },
  });
  mkdirSync(join(runsDir, "child-2", "sessions", "review"), { recursive: true });
  writeFileSync(join(runsDir, "child-2", "sessions", "review", "session.jsonl"), "{\"type\":\"session\"}\n");

  const summary = factoryActiveSummary({ runsDir });
  assert.equal(summary.active_wave_count, 1);
  assert.equal(summary.waves[0].wave_issue_number, 9001);
  assert.equal(summary.waves[0].current_issue_number, 9003);
  assert.equal(summary.waves[0].completed_issues, 1);
  assert.equal(summary.waves[0].total_issues, 3);
  assert.equal(summary.waves[0].goal_execution_mode, "");
  assert.equal(summary.waves[0].is_direct_goal_execution, false);
  assert.equal(summary.waves[0].trace_run_id, "child-2");
  assert.equal(summary.waves[0].trace_child_id, "execute_issue_in_wave__child_2");
  assert.equal(summary.waves[0].trace_parent_node_id, "execute_issue_in_wave");
  assert.equal(summary.waves[0].trace_child_role, "reviewer");
  assert.equal(summary.waves[0].trace_available, true);
  assert.equal(summary.waves[0].trace_kind, "reviewer");
  assert.match(summary.waves[0].trace_command, /--run-id child-2/);
  assert.match(summary.waves[0].trace_command, new RegExp(`--runs-dir '${runsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(summary.waves[0].live_attachable, true);
  assert.equal(summary.waves[0].live_attach_target.run_id, "child-2");
  assert.equal(summary.waves[0].live_attach_target.wave_run_id, "wave-parent");
  assert.equal(summary.waves[0].live_attach_target.trace_kind, "reviewer");
  assert.equal(summary.waves[0].live_attach_target.node, "review");
  assert.equal(typeof summary.waves[0].last_progress_at, "string");
  assert.equal(typeof summary.waves[0].last_progress_age_ms, "number");
  assert.equal(typeof summary.waves[0].stalled, "boolean");
  assert.equal(summary.waves[0].stalled_threshold_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS);
  assert.equal(summary.waves[0].expected_next_outcome, "review decision");

  const nonWaveRow = summary.non_wave_active.find((row) => row.run_id === "child-1");
  assert.ok(nonWaveRow);
  assert.equal(nonWaveRow.goal_issue_number, 999);
  assert.equal(nonWaveRow.live_attachable, false);
  assert.equal(nonWaveRow.live_attach_target, null);
  assert.equal(typeof nonWaveRow.last_progress_at, "string");
  assert.equal(typeof nonWaveRow.last_progress_age_ms, "number");
  assert.equal(typeof nonWaveRow.stalled, "boolean");
  assert.equal(nonWaveRow.stalled_threshold_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS);
  assert.equal(typeof nonWaveRow.expected_next_outcome, "string");
});

test("describeOperatorSignals computes deterministic stall telemetry and expected outcomes", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const lastProgressAt = new Date(now - ACTIVE_SUMMARY_STALLED_THRESHOLD_MS - 5_000).toISOString();

  const stalled = describeOperatorSignals(
    { updated_at: lastProgressAt },
    { now, node: "execute_issue" },
  );

  assert.equal(stalled.last_progress_at, lastProgressAt);
  assert.equal(stalled.last_progress_age_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS + 5_000);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.stalled_threshold_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS);
  assert.equal(stalled.expected_next_outcome, "issue run completes");

  assert.equal(
    describeOperatorSignals({ updated_at: lastProgressAt }, { now, node: "review" }).expected_next_outcome,
    "review decision",
  );
  assert.equal(
    describeOperatorSignals({ updated_at: lastProgressAt }, { now, node: "dispatch_issue" }).expected_next_outcome,
    "issue claimed",
  );
  assert.equal(
    describeOperatorSignals({ updated_at: lastProgressAt }, { now, node: "claim_wave" }).expected_next_outcome,
    "wave assigned",
  );
  assert.equal(expectedNextOutcomeForNode("dispatch_issue"), "issue claimed");
  assert.equal(expectedNextOutcomeForNode("execute_issue_in_wave"), "issue run completes");
  assert.equal(expectedNextOutcomeForNode(""), "run state update");
});
test("factoryActiveSummary marks stale runs stalled when progress age exceeds threshold", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-active-summary-stalled-"));
  const now = Date.parse("2026-02-02T00:10:00.000Z");
  const oldUpdate = new Date(now - ACTIVE_SUMMARY_STALLED_THRESHOLD_MS - 2_000).toISOString();

  writeRun(runsDir, "non-wave-stalled", {
    runId: "non-wave-stalled",
    pipeline: "/tmp/factory_supervisor_tick.dot",
    status: "running",
    currentNode: "dispatch_issue",
    updatedAt: oldUpdate,
  }, {
    runId: "non-wave-stalled",
    status: "running",
    pid: process.pid,
    heartbeatAt: oldUpdate,
    updatedAt: oldUpdate,
  });

  const summary = factoryActiveSummary({ runsDir, now });
  assert.equal(summary.active_wave_count, 0);
  assert.equal(summary.non_wave_active.length, 1);
  assert.equal(summary.non_wave_active[0].last_progress_at, oldUpdate);
  assert.equal(summary.non_wave_active[0].last_progress_age_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS + 2_000);
  assert.equal(summary.non_wave_active[0].stalled, true);
  assert.equal(summary.non_wave_active[0].stalled_threshold_ms, ACTIVE_SUMMARY_STALLED_THRESHOLD_MS);
  assert.equal(summary.non_wave_active[0].expected_next_outcome, "issue claimed");
});

test("formatFactoryActiveSummary renders compact wave lines", () => {
  const rendered = formatFactoryActiveSummary({
    generated_at: new Date().toISOString(),
    active_run_count: 2,
    active_wave_count: 1,
    waves: [{
      milestone_title: "goal-100-wave-1",
      wave_issue_number: 700,
      current_issue_number: 701,
      completed_issues: 1,
      total_issues: 3,
      current_issue_node: "review",
      goal_execution_path: "easy",
      goal_execution_mode: "direct",
      is_direct_goal_execution: true,
      trace_run_id: "run-701",
      trace_available: true,
      trace_kind: "reviewer",
      trace_command: "node packages/factory-ops/src/cli.ts factory session-tail --run-id run-701 --runs-dir '/tmp/factory-runs' --follow",
    }],
  });
  assert.match(rendered, /goal-100-wave-1/);
  assert.match(rendered, /wave_issue=#700/);
  assert.match(rendered, /current_issue=#701/);
  assert.match(rendered, /progress=1\/3/);
  assert.match(rendered, /goal_execution_path=easy \(direct\)/);
  assert.match(rendered, /trace_kind=reviewer/);
  assert.match(rendered, /trace_run=run-701/);
  assert.match(rendered, /factory session-tail --run-id run-701 --runs-dir '\/tmp\/factory-runs' --follow/);
  assert.doesNotMatch(rendered, /tail=/);
});

test("formatFactoryActiveSummary shows non-wave activity when no active waves", () => {
  const rendered = formatFactoryActiveSummary({
    generated_at: new Date().toISOString(),
    active_run_count: 1,
    active_wave_count: 0,
    waves: [],
    non_wave_active: [{
      run_id: "abc12345",
      graph: "/tmp/factory_supervisor_tick.dot",
      graph_label: "factory_supervisor_tick.dot",
      node: "triage",
      issue_number: null,
      milestone_title: "",
      age: "12s",
      trace_run_id: "abc12345",
      trace_available: true,
      trace_kind: "manager",
      trace_command: "node packages/factory-ops/src/cli.ts factory session-tail --run-id abc12345 --runs-dir '/tmp/factory-runs' --follow",
    }],
  });
  assert.match(rendered, /Active non-wave runs:/);
  assert.match(rendered, /factory_supervisor_tick\.dot/);
  assert.match(rendered, /node=triage/);
  assert.match(rendered, /trace_kind=manager/);
  assert.match(rendered, /trace_run=abc12345/);
});

test("formatFactoryActiveSummary caps non-wave rows to top five plus overflow line", () => {
  const nonWave = Array.from({ length: 7 }, (_, idx) => ({
    run_id: `run-${idx + 1}`,
    graph: `/tmp/non-wave-${idx + 1}.dot`,
    graph_label: `non-wave-${idx + 1}.dot`,
    node: `node-${idx + 1}`,
    issue_number: null,
    milestone_title: "",
    age: `${idx + 1}s`,
    trace_run_id: `run-${idx + 1}`,
    trace_available: false,
    trace_kind: "none",
    trace_command: "",
  }));

  const rendered = formatFactoryActiveSummary({
    generated_at: new Date().toISOString(),
    active_run_count: 7,
    active_wave_count: 0,
    waves: [],
    non_wave_active: nonWave,
  });

  assert.match(rendered, /non-wave-1\.dot/);
  assert.match(rendered, /non-wave-5\.dot/);
  assert.doesNotMatch(rendered, /non-wave-6\.dot/);
  assert.doesNotMatch(rendered, /non-wave-7\.dot/);
  assert.match(rendered, /\.\.\. and 2 more/);
});

test("formatFactoryActiveSummary suppresses shell command when trace is unavailable", () => {
  const rendered = formatFactoryActiveSummary({
    generated_at: new Date().toISOString(),
    active_run_count: 1,
    active_wave_count: 0,
    waves: [],
    non_wave_active: [{
      run_id: "no-trace",
      graph: "/tmp/factory_supervisor_tick.dot",
      graph_label: "factory_supervisor_tick.dot",
      node: "supervisor_review",
      issue_number: null,
      milestone_title: "",
      age: "1s",
      trace_run_id: "no-trace",
      trace_available: false,
      trace_kind: "none",
      trace_command: "",
    }],
  });
  assert.match(rendered, /trace=unavailable/);
  assert.doesNotMatch(rendered, /factory session-tail/);
});

test("formatFactoryActiveMinimal renders supervisor stage and coder substage compactly", () => {
  const rendered = formatFactoryActiveMinimal({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    non_wave_active: [{
      run_id: "tick-1",
      graph: "/tmp/factory_supervisor_tick.dot",
      graph_label: "factory_supervisor_tick.dot",
      node: "fan_out_wave_execute",
    }],
    waves: [{
      milestone_title: "goal-200-wave-1",
      current_issue_number: 201,
      current_issue_node: "build",
      completed_issues: 1,
      total_issues: 3,
    }],
  });
  assert.match(rendered, /^mothership {2}recallnet\/astrochicken/m);
  assert.match(rendered, /^supervisor {2}fan_out_wave_execute/m);
  assert.match(rendered, /^goal-200-wave-1 {2}#201 {2}build {2}1\/3/m);
});

test("formatFactoryActiveMinimal sorts wave rows by milestone title", () => {
  const rendered = formatFactoryActiveMinimal({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    non_wave_active: [{
      run_id: "tick-1",
      graph: "/tmp/factory_supervisor_tick.dot",
      graph_label: "factory_supervisor_tick.dot",
      node: "supervisor_review",
    }],
    waves: [
      {
        milestone_title: "goal-1592-wave-1",
        current_issue_number: 1663,
        current_issue_node: "build",
        completed_issues: 0,
        total_issues: 1,
      },
      {
        milestone_title: "goal-1549-wave-3",
        current_issue_number: 1614,
        current_issue_node: "build",
        completed_issues: 0,
        total_issues: 1,
      },
      {
        milestone_title: "goal-1565-wave-1",
        current_issue_number: 1632,
        current_issue_node: "build",
        completed_issues: 0,
        total_issues: 2,
      },
    ],
  });

  const waveLines = rendered.split("\n").slice(2);
  assert.deepEqual(waveLines, [
    "goal-1549-wave-3  #1614  build  0/1",
    "goal-1565-wave-1  #1632  build  0/2",
    "goal-1592-wave-1  #1663  build  0/1",
  ]);
});

test("formatFactoryActiveMinimal renders idle state when no waves are active", () => {
  const rendered = formatFactoryActiveMinimal({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    non_wave_active: [],
    waves: [],
  });
  assert.match(rendered, /^supervisor {2}idle/m);
  assert.match(rendered, /^waves {2}idle/m);
});

test("formatFactoryActiveMinimal renders blocked state when control plane blocks progress", () => {
  const rendered = formatFactoryActiveMinimal({
    context: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
    },
    managed_state: {
      health_classification: "control_plane_blocked",
      reason: "Publish or sync a control-plane release manifest.",
    },
    blocked_control_plane: [{
      milestone: "goal-1511-wave-2",
      issue_number: 1551,
      unblockCondition: "Wait for control-plane blocker status to change.",
      status: "blocked",
    }],
    non_wave_active: [],
    waves: [],
  });
  assert.match(rendered, /^supervisor {2}blocked/m);
  assert.match(rendered, /^blocked goal-1511-wave-2 #1551/m);
  assert.match(rendered, /^reason {2}Publish or sync a control-plane release manifest\./m);
});

test("factory status resolver scopes runs dir by factory id", () => {
  const scoped = resolveRunsDir({ factoryId: "mothership" });
  assert.match(scoped, /\.hatch[\\/]mothership[\\/]runs$/);

  const explicit = resolveRunsDir({ runsDir: "/tmp/custom-runs", factoryId: "mothership" });
  assert.equal(explicit, "/tmp/custom-runs");
});

test("factory status and active-summary commands support shared factory context resolver + --json output", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(cmd, /class FactoryStatusCommand/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*Option\.String\("--factory-root", ""\)/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*Option\.String\("--factory-config-path", ""\)/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*Option\.String\("--factory-id", ""\)/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*Option\.String\("--repo", ""\)/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*resolveFactoryContextOrExit\(this, \{/);
  assert.match(cmd, /FactoryStatusCommand[\s\S]*Option\.Boolean\("--json", false\)/);
  assert.match(cmd, /class FactoryActiveSummaryCommand/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*resolveFactoryContextOrExit\(this, \{/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*Option\.Boolean\("--json", false\)/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*Option\.Boolean\("--minimal", false\)/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*Option\.Boolean\("--follow", false\)/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*Option\.String\("--interval-ms", "2000"\)/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*if \(this\.json\) {[\s\S]*JSON\.stringify\(summary, null, 2\)[\s\S]*formatFactoryActiveSummary\(summary\)/);
  assert.match(cmd, /FactoryActiveSummaryCommand[\s\S]*formatFactoryActiveMinimal\(summary\)/);
  assert.match(cmd, /enterFullscreenTui\(this\.context\.stdout\)/);
  assert.match(cmd, /writeFollowFrame\(this\.context\.stdout, output\)/);
  assert.match(cmd, /exitFullscreenTui\(this\.context\.stdout\)/);
});

test("shared presenter helpers render status/summary sections", () => {
  const statusPresentation = presentFactoryStatus({
    context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
    control_plane: {
      selected_channel: "general",
      resume_reason: "ready_to_resume",
      can_resume: true,
      resume_when: "Release gate already satisfied.",
    },
    managed_state: {
      state_action: "none",
      health_classification: "healthy",
    },
    blocked_control_plane: [],
    active: [{ id: "run-1", node: "wave_execute", graph: "factory_supervisor_tick.dot", children: [] }],
    completed: 2,
    failed: 1,
  });
  const renderedStatus = formatFactoryStatus(statusPresentation.json);
  assert.match(renderedStatus, /Factory ID: mothership/);
  assert.match(renderedStatus, /Control plane gate:/);
  assert.match(renderedStatus, /Managed state:/);
  assert.match(renderedStatus, /Active runs:/);
  assert.match(renderedStatus, /node=wave_execute/);

  const summaryPresentation = presentFactoryActiveSummary({
    context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
    control_plane: {
      selected_channel: "general",
      resume_reason: "ready_to_resume",
      can_resume: true,
    },
    managed_state: {
      state_action: "none",
      health_classification: "healthy",
    },
    blocked_control_plane: [],
    active_run_count: 1,
    active_wave_count: 1,
    waves: [{
      milestone_title: "goal-1565-wave-2",
      wave_issue_number: 1630,
      current_issue_number: 1631,
      completed_issues: 1,
      total_issues: 2,
      current_issue_node: "review",
      trace_available: true,
      trace_kind: "reviewer",
      trace_run_id: "run-1",
      trace_child_id: "child-1",
      trace_child_role: "reviewer",
      trace_command: "node packages/factory-ops/src/cli.ts factory session-tail --run-id run-1 --follow",
    }],
    non_wave_active: [],
  });
  const renderedSummary = formatFactoryActiveSummary(summaryPresentation.json);
  assert.match(renderedSummary, /Factory ID: mothership/);
  assert.match(renderedSummary, /Control plane gate:/);
  assert.match(renderedSummary, /Managed state:/);
  assert.match(renderedSummary, /Active runs: 1/);
  assert.match(renderedSummary, /goal-1565-wave-2/);
});

test("shared presenter section helpers emit canonical blocks", () => {
  const controlPlaneLines = formatControlPlaneGateSection({
    selected_channel: "canary",
    resume_reason: "release_not_promoted_to_general",
    can_resume: false,
    required_release_floor: "9.9.9",
    manifest: { source: "local_fs", path: ".hatch/releases/canary/release-manifest.json", ref: "v9.9.9" },
    publish: { asset_id: "asset-555", asset_url: "https://example/assets/555" },
    resume_when: "Wait for canary health to pass and promotion to stable/general channel.",
  });
  assert.match(controlPlaneLines.join("\n"), /channel=canary/);
  assert.match(controlPlaneLines.join("\n"), /Required release floor: 9\.9\.9/);
  assert.match(controlPlaneLines.join("\n"), /Published asset: id=asset-555/);

  const managedLines = formatManagedStateLine({ state_action: "pause", health_classification: "operator_paused", reason: "manual pause" });
  assert.match(managedLines.join("\n"), /Managed state: action=pause health=operator_paused/);
  assert.match(managedLines.join("\n"), /Reason: manual pause/);

  const treeLines = formatActiveRunTreeRows([
    { id: "parent-run", node: "wave_execute", graph: "factory_supervisor_tick.dot", children: [{ runId: "child-run" }] },
    { id: "child-run", node: "build", graph: "wave_issue_execute.dot", children: [] },
  ]);
  const tree = treeLines.join("\n");
  assert.match(tree, /parent-r/);
  assert.match(tree, /└─ child-ru/);
});
