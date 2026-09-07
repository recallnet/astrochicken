import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { attachGuardMetadataToStalledWaves, attachLeaseContextToStalledWaves, attachRunContextToStalledWaves, attachStalledWaveHistory, buildRemediationPlanSummary, buildStalledWaveTelemetry, evaluateStalledWaves, shouldEmitStalledWaveBug } from "../src/commands/supervisor-detect-stalled-wave.ts";
import { evaluateStalledWaves as evaluateStalledWavesNew, diagnoseStalledWaves } from "../src/commands/supervisor-diagnose-stalled-waves.ts";
import { WAVE_MARKER_CLAIM_SCHEMA_VERSION, upsertWaveMarkerClaimInBody } from "../src/commands/wave-claim.ts";
import { collectActiveWaveLeases } from "../src/commands/wave-sanitize-state.ts";

test("detectStalledWaveExecution must use emitBugIssue, not goalIngest artifacts", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-detect-stalled-wave.ts", "utf8");
  assert.ok(
    !src.includes("goalIngest: true"),
    "stalled-wave-execution must not use goalIngest: true — use emitBugIssue() for fast-track bug dispatch"
  );
  assert.ok(
    src.includes("emitBugIssue"),
    "stalled-wave-execution must call emitBugIssue to file actionable bugs"
  );
});

test("stall detector must import collectActiveWaveLeases or readAllRunStates for active-run check", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-detect-stalled-wave.ts", "utf8");
  assert.ok(
    src.includes("collectActiveWaveLeases") || src.includes("readAllRunStates"),
    "stall detector must check active pipeline runs to avoid false positives (#454)"
  );
});

test("stall detector includes remediation plan summary for stalled-wave bugs", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-detect-stalled-wave.ts", "utf8");
  assert.ok(src.includes("sanitizeWaveState"), "stalled-wave detector must call sanitizeWaveState for remediation planning");
  assert.ok(src.includes("remediation_plan_summary"), "stalled-wave detector must expose remediation_plan_summary in output/evidence");
});

test("buildRemediationPlanSummary derives milestone list from plan actions", () => {
  const summary = buildRemediationPlanSummary({
    repair_plan: {
      action_count: 2,
      stats: { close_issue_count: 1, remove_label_count: 1, add_label_count: 0, stale_claim_release_count: 0, stale_in_progress_release_count: 1, duplicate_marker_count: 0 },
      actions: [
        { type: "close_issue", issue_number: "101", milestone_title: "goal-1-wave-2" },
        { type: "remove_label", issue_number: "102", milestone_title: "goal-1-wave-1", label: "wave-in-progress" },
      ],
    },
  }, { apply: false, stalledWaves: [] });

  assert.equal(summary.milestones_summary, "goal-1-wave-1, goal-1-wave-2");
  assert.match(summary.summary_line, /milestones=goal-1-wave-1, goal-1-wave-2/);
});

test("attachRunContextToStalledWaves attaches latest run metadata", () => {
  const runStates = [{
    runId: "run-123",
    status: "running",
    pipelineFile: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
    updatedAt: "2026-03-03T01:00:00.000Z",
    currentNode: "execute_issue",
    guard: {
      circuitState: "open",
      reasonCode: "guard_backoff_active",
      terminalAt: "",
      metadata: {
        reasonCode: "guard_backoff_active",
        nodeId: "review_gate",
        issueNumber: "301",
        branch: "wave/301",
        milestoneTitle: "goal-12-wave-1",
        capturedAt: "2026-03-03T01:00:00.000Z",
      },
    },
    context: {
      milestone_title: "goal-12-wave-1",
      ready_issue_number: 301,
      claim_owner_id: "worker-1",
      claim_run_id: "run-123",
      claim_lease_expires_at: "2026-03-03T01:10:00.000Z",
      claim_reason: "claim_acquired",
      claim_acquired: "true",
      worktree_dir: "/tmp/goal-12-wave-1",
    },
  }];
  const stale = [{
    wave_issue_number: 44,
    milestone: "goal-12-wave-1",
    active_run_ids: ["run-123"],
  }];

  const out = attachRunContextToStalledWaves({ stale, runStates });
  assert.equal(out.length, 1);
  assert.equal(out[0].run_context?.run_id, "run-123");
  assert.equal(out[0].run_context?.graph, "docs/contracts/workflow-ir/mothership/wave_execute.dot");
  assert.equal(out[0].run_context?.node, "execute_issue");
  assert.equal(out[0].run_context?.status, "running");
  assert.equal(out[0].run_context?.last_updated, "2026-03-03T01:00:00.000Z");
  assert.equal(out[0].run_context?.worktree_dir, "/tmp/goal-12-wave-1");
  assert.equal(out[0].run_context?.guard_status, "open");
  assert.equal(out[0].run_context?.guard_reason_code, "guard_backoff_active");
  assert.equal(out[0].run_context?.guard_metadata?.node_id, "review_gate");
  assert.equal(out[0].run_context_present, true);
  assert.equal(out[0].run_context?.claim_context?.claim_owner_id, "worker-1");
});

test("attachLeaseContextToStalledWaves merges lease snapshot from wave marker body", () => {
  const nowMs = Date.parse("2026-03-03T01:05:00.000Z");
  const claim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_44",
    claim_token: "wave_claim_44",
    owner_id: "worker-1",
    run_id: "run-123",
    ready_issue_number: "44",
    milestone_title: "goal-12-wave-1",
    lease_started_at: "2026-03-03T01:00:00.000Z",
    lease_expires_at: "2026-03-03T01:20:00.000Z",
    heartbeat_at: "2026-03-03T01:04:00.000Z",
    updated_at: "2026-03-03T01:04:00.000Z",
    reclaim_count: 0,
  };
  const body = upsertWaveMarkerClaimInBody("Wave Ready: goal-12-wave-1", claim);
  const stale = [{
    wave_issue_number: 44,
    milestone: "goal-12-wave-1",
  }];
  const waveIssues = [{
    number: 44,
    title: "Wave Ready: goal-12-wave-1",
    body,
    labels: [{ name: "wave-in-progress" }],
  }];

  const out = attachLeaseContextToStalledWaves({ stale, waveIssues, nowMs });
  assert.equal(out.length, 1);
  assert.equal(out[0].lease_context?.lease_status, "active");
  assert.equal(out[0].lease_context?.lease_active, true);
  assert.equal(out[0].lease_context?.lease_present, true);
  assert.equal(out[0].lease_context?.claim_owner_id, "worker-1");
  assert.equal(out[0].lease_context?.claim_run_id, "run-123");
  assert.equal(out[0].lease_context?.claim_lease_expires_at, "2026-03-03T01:20:00.000Z");
  assert.equal(out[0].lease_context?.lease_snapshot?.claim?.claim_token, "wave_claim_44");
});

test("buildStalledWaveTelemetry includes run context fields", () => {
  const telemetry = buildStalledWaveTelemetry({
    threshold: 20,
    stalledWaves: [{
      wave_issue_number: 44,
      milestone: "goal-12-wave-1",
      reason: "wave_marker_stale",
      wave_stale_minutes: 30,
      threshold_minutes: 20,
      open_feature_count: 1,
      open_features: [{ number: 301 }],
      run_context: {
        run_id: "run-123",
        graph: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
        node: "execute_issue",
        status: "running",
        last_updated: "2026-03-03T01:00:00.000Z",
        claim_context: { claim_context_present: true, claim_owner_id: "worker-1", claim_run_id: "run-123", claim_reason: "claim_acquired" },
        worktree_dir: "/tmp/goal-12-wave-1",
        guard_status: "open",
        guard_reason_code: "guard_backoff_active",
        guard_terminal_at: "",
        guard_metadata: {
          reason_code: "guard_backoff_active",
          node_id: "review_gate",
          issue_number: "301",
          branch: "wave/301",
          milestone_title: "goal-12-wave-1",
          captured_at: "2026-03-03T01:00:00.000Z",
          run_id: "run-123",
        },
        guard_metadata_present: true,
      },
      run_context_present: true,
      run_worktree_dir: "/tmp/goal-12-wave-1",
      guard_status: "open",
      guard_reason_code: "guard_backoff_active",
      guard_terminal_at: "",
      guard_snapshot: {
        reason_code: "guard_backoff_active",
        node_id: "review_gate",
        issue_number: "301",
        branch: "wave/301",
        milestone_title: "goal-12-wave-1",
        captured_at: "2026-03-03T01:00:00.000Z",
        run_id: "run-123",
      },
      guard_snapshot_present: true,
      lease_context: {
        lease_status: "active",
        lease_active: true,
        lease_present: true,
        lease_snapshot_truncated: false,
        lease_snapshot: {
          present: true,
          status: "active",
          active: true,
          stale: false,
          released: false,
          claim: {
            status: "active",
            claim_id: "wave_claim_44",
            claim_token: "wave_claim_44",
            owner_id: "worker-1",
            run_id: "run-123",
            ready_issue_number: "44",
            milestone_title: "goal-12-wave-1",
            lease_started_at: "2026-03-03T01:00:00.000Z",
            lease_expires_at: "2026-03-03T01:20:00.000Z",
            heartbeat_at: "2026-03-03T01:04:00.000Z",
            updated_at: "2026-03-03T01:04:00.000Z",
            reclaim_count: 0,
            reclaimed_from_owner_id: "",
            reclaimed_from_run_id: "",
            reclaimed_at: "",
            released_at: "",
            release_reason: "",
          },
        },
        claim_owner_id: "worker-1",
        claim_run_id: "run-123",
        claim_token: "wave_claim_44",
        claim_lease_expires_at: "2026-03-03T01:20:00.000Z",
        claim_reason: "",
        claim_updated_at: "2026-03-03T01:04:00.000Z",
      },
      active_milestone: false,
    }],
  });

  assert.equal(telemetry[0].run_context?.run_id, "run-123");
  assert.equal(telemetry[0].run_graph, "docs/contracts/workflow-ir/mothership/wave_execute.dot");
  assert.equal(telemetry[0].run_node, "execute_issue");
  assert.equal(telemetry[0].run_status, "running");
  assert.equal(telemetry[0].run_last_updated, "2026-03-03T01:00:00.000Z");
  assert.equal(telemetry[0].run_worktree_dir, "/tmp/goal-12-wave-1");
  assert.equal(telemetry[0].guard_status, "open");
  assert.equal(telemetry[0].guard_reason_code, "guard_backoff_active");
  assert.equal(telemetry[0].guard_snapshot?.node_id, "review_gate");
  assert.equal(telemetry[0].claim_owner_id, "worker-1");
  assert.equal(telemetry[0].lease_status, "active");
  assert.equal(telemetry[0].lease_present, true);
  assert.equal(telemetry[0].lease_claim_owner_id, "worker-1");
  assert.equal(telemetry[0].lease_claim_run_id, "run-123");
  assert.equal(telemetry[0].lease_claim_token, "wave_claim_44");
  assert.equal(telemetry[0].lease_claim_lease_expires_at, "2026-03-03T01:20:00.000Z");
  assert.equal(telemetry[0].active_milestone, false);
  assert.equal(telemetry[0].repeat_count, 0);
  assert.equal(telemetry[0].signature_hash, "");
  assert.equal(telemetry[0].repeat_first_observed_at, "");
  assert.equal(telemetry[0].repeat_last_observed_at, "");
});

/* ── Pure-logic gate tests for evaluateStalledWaves ── */

function makeWave({ number, milestone, waveAge = 30, featureAges = [] }) {
  const now = Date.now();
  return {
    number,
    title: `Wave Ready: ${milestone}`,
    url: `https://github.com/test/repo/issues/${number}`,
    updatedAt: new Date(now - waveAge * 60000).toISOString(),
    milestone: { title: milestone },
    labels: [{ name: "wave-in-progress" }],
    features: featureAges.map((age, i) => ({
      number: 100 + i,
      title: `Feature ${i}`,
      url: `https://github.com/test/repo/issues/${100 + i}`,
      updatedAt: new Date(now - age * 60000).toISOString(),
    })),
  };
}

function makeRunState({ runId, milestone, status = "running", updatedMinutesAgo = 5, guardMeta = null } = {}) {
  return {
    runId,
    status,
    pipelineFile: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
    updatedAt: new Date(Date.now() - updatedMinutesAgo * 60000).toISOString(),
    context: { milestone_title: milestone, worktree_dir: `/tmp/${milestone}`, ready_issue_number: 200 },
    guard: guardMeta ? { metadata: guardMeta, reasonCode: guardMeta.reasonCode || "" } : undefined,
  };
}

test("wave with active run for its milestone is NOT marked stale (#454)", () => {
  const wave = makeWave({ number: 10, milestone: "goal-1-wave-3", waveAge: 30, featureAges: [30, 25] });
  const runStates = [makeRunState({ runId: "run-abc", milestone: "goal-1-wave-3", updatedMinutesAgo: 2 })];
  const { active_milestones } = collectActiveWaveLeases(runStates, { staleRunMinutes: 20 });

  const result = evaluateStalledWaves({
    inProgressWaves: [wave],
    activeMilestones: new Set(active_milestones),
    staleMinutes: 20,
  });

  assert.equal(result.length, 0, "should not mark wave as stale when active run exists");
});

test("wave with NO active run AND old timestamps IS marked stale", () => {
  const wave = makeWave({ number: 11, milestone: "goal-2-wave-1", waveAge: 30, featureAges: [30, 40] });
  const { active_milestones } = collectActiveWaveLeases([], { staleRunMinutes: 20 });

  const result = evaluateStalledWaves({
    inProgressWaves: [wave],
    activeMilestones: new Set(active_milestones),
    staleMinutes: 20,
  });

  assert.equal(result.length, 1, "should mark wave as stale when no active run exists");
  assert.equal(result[0].milestone, "goal-2-wave-1");
});

test("wave with stale run AND old timestamps IS marked stale", () => {
  const wave = makeWave({ number: 12, milestone: "goal-3-wave-2", waveAge: 45, featureAges: [45] });
  const runStates = [makeRunState({ runId: "run-old", milestone: "goal-3-wave-2", updatedMinutesAgo: 25 })];
  const { active_milestones } = collectActiveWaveLeases(runStates, { staleRunMinutes: 20 });

  const result = evaluateStalledWaves({
    inProgressWaves: [wave],
    activeMilestones: new Set(active_milestones),
    staleMinutes: 20,
  });

  assert.equal(result.length, 1, "should mark wave as stale when run itself is stale");
  assert.equal(result[0].milestone, "goal-3-wave-2");
});

test("wave with recent feature activity is NOT marked stale", () => {
  const wave = makeWave({ number: 13, milestone: "goal-4-wave-2", waveAge: 45, featureAges: [5, 40] });

  const result = evaluateStalledWaves({
    inProgressWaves: [wave],
    activeMilestones: new Set(),
    staleMinutes: 20,
  });

  assert.equal(result.length, 0, "recent feature update should suppress stale detection");
});

test("mixed waves: only those without active runs are marked stale", () => {
  const activeWave = makeWave({ number: 20, milestone: "goal-1-wave-1", waveAge: 30, featureAges: [30] });
  const staleWave = makeWave({ number: 21, milestone: "goal-1-wave-2", waveAge: 30, featureAges: [30] });
  const runStates = [makeRunState({ runId: "run-active", milestone: "goal-1-wave-1", updatedMinutesAgo: 3 })];
  const { active_milestones } = collectActiveWaveLeases(runStates, { staleRunMinutes: 20 });

  const result = evaluateStalledWaves({
    inProgressWaves: [activeWave, staleWave],
    activeMilestones: new Set(active_milestones),
    staleMinutes: 20,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].milestone, "goal-1-wave-2");
});

test("wave below threshold is never marked stale regardless of active runs", () => {
  const wave = makeWave({ number: 30, milestone: "goal-4-wave-1", waveAge: 10, featureAges: [5] });

  const result = evaluateStalledWaves({
    inProgressWaves: [wave],
    activeMilestones: new Set(),
    staleMinutes: 20,
  });

  assert.equal(result.length, 0, "below-threshold wave should not be stale");
});

test("attachGuardMetadataToStalledWaves merges guard metadata into stalled wave evidence", () => {
  const now = Date.now();
  const wave = {
    number: 40,
    title: "Wave Ready: goal-5-wave-1",
    url: "https://github.com/test/repo/issues/40",
    updatedAt: new Date(now - 30 * 60000).toISOString(),
    milestone: { title: "goal-5-wave-1" },
    labels: [{ name: "wave-in-progress" }],
    features: [{ number: 555, title: "Feature", url: "https://github.com/test/repo/issues/555", updatedAt: new Date(now - 30 * 60000).toISOString() }],
    active_run_ids: ["run-guarded"],
  };
  const stale = evaluateStalledWaves({ inProgressWaves: [wave], activeMilestones: new Set(), staleMinutes: 20, nowMs: now });
  const runStates = [makeRunState({
    runId: "run-guarded",
    milestone: "goal-5-wave-1",
    guardMeta: {
      reasonCode: "guard_backoff_active",
      nodeId: "review_gate",
      issueNumber: "555",
      branch: "wave/555",
      milestoneTitle: "goal-5-wave-1",
      capturedAt: new Date(now - 1000).toISOString(),
    },
  })];

  const joined = attachGuardMetadataToStalledWaves({ stale, runStates });
  assert.equal(joined.length, 1);
  assert.equal(joined[0].guard_metadata?.reason_code, "guard_backoff_active");
  assert.match(joined[0].guard_reason_text, /guard_backoff_active/);
  assert.match(joined[0].guard_reason_text, /feature #555/);
  assert.equal(joined[0].guard_metadata_present, true);
});

test("stall detector exports graph-contract aliases for stalled_wave_count/artifact keys", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-detect-stalled-wave.ts", "utf8");
  assert.ok(src.includes("stalled_wave_count"), "must export stalled_wave_count for factory_supervisor_tick.dot gate");
  assert.ok(src.includes("stalled_wave_artifact_url"), "must export stalled_wave_artifact_url alias");
  assert.ok(src.includes("stalled_wave_artifact_error"), "must export stalled_wave_artifact_error alias");
  assert.ok(src.includes("stalled_wave_telemetry"), "must export stalled_wave_telemetry payload for progress metrics");
});

test("attachStalledWaveHistory computes repeat counts within window", () => {
  const nowMs = Date.parse("2026-03-03T01:10:00.000Z");
  const history = [];
  const detections = [
    { wave_issue_number: 55, milestone: "goal-12-wave-1", reason: "wave_marker_stale" },
  ];

  const out = attachStalledWaveHistory({
    repo: "recallnet/astrochicken",
    detections,
    history,
    nowMs,
    windowMs: 60 * 60 * 1000,
  });

  assert.equal(out.detections.length, 1);
  assert.equal(out.detections[0].repeat_count, 1);
  assert.ok(String(out.detections[0].signature_hash || "").startsWith("sha256:"));
  assert.equal(out.history_entries.length, 1);
  assert.equal(out.history_window_count, 0);
});

test("shouldEmitStalledWaveBug gates on repeat threshold", () => {
  const detections = [
    { repeat_count: 1 },
    { repeat_count: 2 },
  ];
  assert.equal(shouldEmitStalledWaveBug({ detections, repeatThreshold: 3 }), false);
  assert.equal(shouldEmitStalledWaveBug({ detections: [{ repeat_count: 3 }], repeatThreshold: 3 }), true);
});

/* ── New diagnose-stalled-waves module tests ── */

test("new evaluateStalledWaves matches old evaluateStalledWaves for basic detection", () => {
  const now = Date.now();
  const wave = {
    number: 99,
    title: "Wave Ready: goal-99-wave-1",
    url: "https://github.com/test/repo/issues/99",
    updatedAt: new Date(now - 30 * 60000).toISOString(),
    milestone: { title: "goal-99-wave-1" },
    labels: [{ name: "wave-in-progress" }],
    features: [{
      number: 200,
      title: "Feature",
      url: "https://github.com/test/repo/issues/200",
      updatedAt: new Date(now - 30 * 60000).toISOString(),
    }],
  };

  const oldResult = evaluateStalledWaves({ inProgressWaves: [wave], activeMilestones: new Set(), staleMinutes: 20, nowMs: now });
  const newResult = evaluateStalledWavesNew({ inProgressWaves: [wave], activeMilestones: new Set(), staleMinutes: 20, nowMs: now });

  assert.equal(oldResult.length, 1);
  assert.equal(newResult.length, 1);
  assert.equal(oldResult[0].wave_issue_number, newResult[0].wave_issue_number);
  assert.equal(oldResult[0].milestone, newResult[0].milestone);
  assert.equal(oldResult[0].reason, newResult[0].reason);
});

test("new evaluateStalledWaves includes wave_labels in output", () => {
  const now = Date.now();
  const wave = {
    number: 98,
    title: "Wave Ready: goal-98-wave-1",
    updatedAt: new Date(now - 30 * 60000).toISOString(),
    milestone: { title: "goal-98-wave-1" },
    labels: [{ name: "wave-in-progress" }, { name: "ready" }],
    features: [],
  };

  const result = evaluateStalledWavesNew({ inProgressWaves: [wave], activeMilestones: new Set(), staleMinutes: 20, nowMs: now });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].wave_labels, ["wave-in-progress", "ready"]);
});

test("diagnoseStalledWaves returns ok:false for missing repo", () => {
  const result = diagnoseStalledWaves({ repo: "" });
  assert.equal(result.ok, false);
  assert.equal(result.stalled_wave_count, 0);
});

test("diagnoseStalledWaves source file exports stalled_wave_count and stalled_wave_telemetry", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-diagnose-stalled-waves.ts", "utf8");
  assert.ok(src.includes("stalled_wave_count"), "must export stalled_wave_count");
  assert.ok(src.includes("stalled_wave_telemetry"), "must export stalled_wave_telemetry");
  assert.ok(src.includes("diagnosis"), "must produce diagnosis strings");
  assert.ok(src.includes("suggested_commands"), "must produce suggested_commands");
  assert.ok(src.includes("action_type"), "must produce action_type classification");
});
