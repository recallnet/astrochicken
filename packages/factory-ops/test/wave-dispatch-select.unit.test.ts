import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeSelectedWaves, fetchTerminallyReleasedMarkers, selectDispatchWavesFromRun, findPriorWave, isPriorWaveComplete } from "../src/commands/wave-dispatch-select.ts";
import { WAVE_READY_LEASE_EVENT_PREFIX, WAVE_READY_LEASE_EVENT_SCHEMA_VERSION } from "../src/commands/wave-claim.ts";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const runFixture = (name) => {
  const fixture = loadJson(`./fixtures/wave-dispatch-select/${name}.input.json`);
  const expected = loadJson(`./snapshots/wave-dispatch-select/${name}.expected.json`);
  const getMilestoneOpenIssues = (title) => fixture.milestoneIssues?.[title] ?? [];
  const getBlockedBy = (num) => fixture.blockedBy?.[String(num)] ?? [];
  const out = computeSelectedWaves({
    ...fixture.input,
    getMilestoneOpenIssues,
    getBlockedBy,
  });
  assert.deepEqual(out, expected);
};

// Common neutral fixture inputs; each case supplies its milestone/issue evidence
// and overrides capacity, priorities or blockers when those are under test.
function selectFixtureWaves(overrides) {
  return computeSelectedWaves({
    readyIssues: [],
    prioritiesText: "",
    maxConcurrent: 1,
    getBlockedBy: () => [],
    ...overrides,
  });
}

test("computeSelectedWaves skips milestones already ready", () => {
  runFixture("unit-ready-only");
});

test("computeSelectedWaves enforces slot limits with priority ordering", () => {
  runFixture("unit-slot-limits");
});

test("computeSelectedWaves blocks all-blocked and cross-milestone dependencies", () => {
  runFixture("unit-blocking");
});

test("computeSelectedWaves skips quarantined issues when selecting", () => {
  const milestones = [{ title: "goal-1-wave-1" }, { title: "goal-2-wave-1" }];
  const readyIssues = [];
  const out = selectFixtureWaves({
    milestones,
    readyIssues,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-1-wave-1") return [{ number: 11, title: "A", labels: [{ name: "quarantined" }] }];
      return [{ number: 21, title: "B", labels: [] }];
    },
  });
  assert.deepEqual(out.selected_waves, ["goal-2-wave-1"]);
});

test("computeSelectedWaves skips milestone with no open issues", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => [],
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "no_open_issues");
});

test("computeSelectedWaves skips milestone where all issues are quarantined", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => [
      { number: 1, title: "A", labels: [{ name: "quarantined" }] },
      { number: 2, title: "B", labels: [{ name: "quarantined" }] },
    ],
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "all_blocked");
});

test("computeSelectedWaves selects milestone with mix of quarantined and unblocked issues", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => [
      { number: 1, title: "A", labels: [{ name: "quarantined" }] },
      { number: 2, title: "B", labels: [] },
    ],
  });
  assert.deepEqual(out.selected_waves, ["goal-1-wave-1"]);
});

test("computeSelectedWaves ignores closed blockers", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
    getBlockedBy: (num) => num === 1
      ? [{ number: 999, state: "CLOSED", milestone: { title: "goal-0-wave-1" } }]
      : [],
  });
  assert.deepEqual(out.selected_waves, ["goal-1-wave-1"]);
});

test("computeSelectedWaves respects in-flight slot math", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }, { title: "goal-2-wave-1" }],
    readyIssues: [
      { number: 50, title: "Wave Ready: goal-0-wave-1", labels: [{ name: "wave-in-progress" }], milestone: { title: "goal-0-wave-1" } },
    ],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => [{ number: title === "goal-1-wave-1" ? 10 : 20, title: "Task", labels: [] }],
  });
  // 2 max - 1 in-flight = 1 slot available
  assert.equal(out.selected_waves.length, 1);
  const slotsFull = out.evaluations.find((e) => e.skip_reason === "slots_full");
  assert.ok(slotsFull, "second candidate should be skipped with slots_full");
});

// --- Error path tests ---

test("computeSelectedWaves returns empty on completely empty input", () => {
  const out = selectFixtureWaves({
    milestones: [],
    getMilestoneOpenIssues: () => [],
  });
  assert.deepEqual(out.selected_waves, []);
  assert.deepEqual(out.candidate_waves, []);
  assert.equal(out.in_flight_count, 0);
});

test("computeSelectedWaves filters milestones with missing title", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "" }, { title: null }, { title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  // Only goal-1-wave-1 should be evaluated
  assert.deepEqual(out.selected_waves, ["goal-1-wave-1"]);
});

test("computeSelectedWaves handles priority ordering with non-candidate waves", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }, { title: "goal-2-wave-1" }],
    prioritiesText: "priority: goal-999-wave-1, goal-2-wave-1, goal-1-wave-1",
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  // goal-2-wave-1 should be selected first (priority order), goal-999 filtered out (not a candidate)
  assert.equal(out.selected_waves[0], "goal-2-wave-1");
});

test("computeSelectedWaves handles cross-milestone blocking", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-2-wave-1" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
    getBlockedBy: (num) => num === 1
      ? [{ number: 50, state: "OPEN", milestone: { title: "goal-1-wave-1" } }]
      : [],
  });
  // Cross-milestone blocker is OPEN → skipped with cross_milestone_blocked
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "cross_milestone_blocked");
});

test("computeSelectedWaves skips milestones blocked on control-plane metadata", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-10-wave-1" }],
    getMilestoneOpenIssues: () => [
      { number: 1001, title: "A", labels: [{ name: "blocked-control-plane" }] },
    ],
    getControlPlaneBlocker: () => ({
      kind: "upstream_bug",
      blockerRef: "#1234",
      unblockCondition: "release v3.2.1 ships",
      status: "blocked",
    }),
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");
  assert.equal(out.control_plane_blocked_items.length, 1);
  assert.equal(out.control_plane_blocked_items[0].blockerKind, "upstream_bug");
  assert.equal(out.control_plane_blocked_items[0].blockerRef, "#1234");
  assert.equal(out.control_plane_blocked_items[0].unblockCondition, "release v3.2.1 ships");
});

test("computeSelectedWaves sentinel blocks milestones when blocked-control-plane label is present", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-11-wave-1" }],
    getMilestoneOpenIssues: () => [
      { number: 1101, title: "A", labels: [{ name: "blocked-control-plane" }] },
    ],
    getControlPlaneBlocker: () => ({
      kind: "release_floor",
      blockerRef: "v9.9.9",
      unblockCondition: "superseded by v10.0.0",
      status: "superseded",
    }),
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");
  assert.equal(out.control_plane_blocked_items.length, 1);
  assert.equal(out.control_plane_blocked_items[0].blockerKind, "label_sentinel");
});

test("computeSelectedWaves ignores same-wave blockers when deciding wave eligibility", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-3-wave-1" }],
    getMilestoneOpenIssues: () => [
      { number: 301, title: "A", labels: [] },
      { number: 302, title: "B", labels: [] },
    ],
    getBlockedBy: (num) => num === 302
      ? [{ number: 301, state: "OPEN", milestone: { title: "goal-3-wave-1" } }]
      : [],
  });
  assert.deepEqual(out.selected_waves, ["goal-3-wave-1"]);
  assert.equal(out.evaluations[0].status, "selected");
});

test("computeSelectedWaves handles getMilestoneOpenIssues returning null", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    getMilestoneOpenIssues: () => null,
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "no_open_issues");
});

test("computeSelectedWaves counts in-flight from wave-in-progress ready issues", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    readyIssues: [
      { number: 10, title: "Wave Ready: goal-0-wave-1", labels: [{ name: "wave-in-progress" }], milestone: { title: "goal-0-wave-1" } },
      { number: 11, title: "Wave Ready: goal-0-wave-2", labels: [{ name: "wave-in-progress" }], milestone: { title: "goal-0-wave-2" } },
    ],
    maxConcurrent: 2,
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  assert.equal(out.in_flight_count, 2);
  // 2 in-flight, max 2 → 0 slots
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "slots_full");
});

test("computeSelectedWaves ready_count includes only wave-ready markers", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    readyIssues: [
      { number: 10, title: "Wave Ready: goal-0-wave-1", labels: [], milestone: { title: "goal-0-wave-1" } },
      { number: 11, title: "Goal: unrelated", labels: [{ name: "goal" }, { name: "ready" }], milestone: null },
      { number: 12, title: "[bug] unrelated", labels: [{ name: "bug" }, { name: "ready" }], milestone: null },
    ],
    maxConcurrent: 2,
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  assert.equal(out.ready_count, 1);
});

test("computeSelectedWaves does NOT false-skip milestone when regular feature issue has ready label and milestone", () => {
  // Regression: a regular feature issue with the ready label + milestone was
  // being counted in readyByMilestone, causing the milestone to be skipped
  // with already_ready. Only Wave Ready: marker issues should trigger that skip.
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    readyIssues: [
      // Regular feature issue with ready label AND a milestone — NOT a Wave Ready: marker
      { number: 42, title: "Bootstrap feature", labels: [{ name: "feature" }, { name: "ready" }, { name: "triaged" }], milestone: { title: "goal-1-wave-1" } },
    ],
    getMilestoneOpenIssues: () => [{ number: 42, title: "Bootstrap feature", labels: [{ name: "feature" }] }],
  });
  // Must select, not skip with already_ready
  assert.deepEqual(out.selected_waves, ["goal-1-wave-1"]);
  assert.equal(out.evaluations[0].status, "selected");
});

test("computeSelectedWaves skips milestone with recently-closed no_merge_candidates marker", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    closedMarkers: [{ milestone: "goal-1-wave-1", releaseReason: "no_merge_candidates" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "recently_released_no_candidates");
});

test("computeSelectedWaves skips milestone with recently-closed judge_failed marker", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    closedMarkers: [{ milestone: "goal-1-wave-1", releaseReason: "judge_failed" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  assert.deepEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "recently_released_no_candidates");
});

test("computeSelectedWaves does NOT skip milestone when closedMarker has non-terminal reason", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-1-wave-1" }],
    closedMarkers: [{ milestone: "goal-1-wave-1", releaseReason: "completed" }],
    getMilestoneOpenIssues: () => [{ number: 1, title: "A", labels: [] }],
  });
  assert.deepEqual(out.selected_waves, ["goal-1-wave-1"]);
});

test("selectDispatchWavesFromRun writes throughput_invariants with idle signal and refill latency", () => {
  const runId = "run-throughput";
  const runsDir = mkdtempSync(join(tmpdir(), "wave-dispatch-throughput-"));
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const leaseEvents = [
    {
      schema_version: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
      action: "release",
      milestone_title: "goal-1-wave-1",
      ready_issue_number: "301",
      run_id: "run-1",
      pipeline: "wave_execute",
      reason: "",
      at: "2026-01-01T00:00:00.000Z",
    },
    {
      schema_version: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
      action: "claim",
      milestone_title: "goal-1-wave-2",
      ready_issue_number: "302",
      run_id: "run-2",
      pipeline: "wave_execute",
      reason: "",
      at: "2026-01-01T00:00:05.000Z",
    },
  ];

  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    context: {
      milestones: JSON.stringify([{ title: "goal-1-wave-1", number: 1 }]),
      ready_issues: JSON.stringify([{ number: 301, title: "Wave Ready: goal-1-wave-0", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-0" } }]),
      priorities_issue: "[]",
      wave_ready_lease_events: JSON.stringify(leaseEvents),
    },
  }), "utf8");

  const previousPath = process.env.PATH || "";
  const fixtureDir = new URL("./fixtures/wave-dispatch-select/bin", import.meta.url).pathname;
  const fixtureData = new URL("./fixtures/wave-dispatch-select/gh-responses.json", import.meta.url).pathname;
  process.env.PATH = `${fixtureDir}:${previousPath}`;
  process.env.WAVE_DISPATCH_FIXTURE = fixtureData;

  try {
    selectDispatchWavesFromRun({
      runId,
      runsDir,
      repo: "recallnet/astrochicken",
      maxConcurrent: 2,
    });

    const tick = JSON.parse(readFileSync(join(runDir, "ticks", "tick-000001.json"), "utf8"));
    assert.equal(tick.throughput_invariants.ready_backlog_count, 1);
    assert.equal(tick.throughput_invariants.active_wave_count, 0);
    assert.equal(tick.throughput_invariants.max_concurrent_waves, 2);
    assert.equal(tick.throughput_invariants.idle_with_runnable_backlog, true);
    assert.equal(tick.throughput_invariants.refill_latency.sample_count, 1);
    assert.equal(tick.throughput_invariants.refill_latency.latest_ms, 5000);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.WAVE_DISPATCH_FIXTURE;
  }
});

// --- fetchTerminallyReleasedMarkers tests ---

function makeLeaseComment(action, reason, at) {
  const event = {
    schema_version: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
    action,
    milestone_title: "goal-1-wave-1",
    ready_issue_number: "100",
    run_id: "test-run",
    pipeline: "wave_execute",
    reason,
    at: at || new Date().toISOString(),
  };
  return { body: `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify(event)}`, created_at: event.at };
}

test("fetchTerminallyReleasedMarkers returns terminal markers within cooldown", () => {
  const milestones = [{ title: "goal-1-wave-1" }];
  const recentRelease = makeLeaseComment("release", "no_merge_candidates");

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [recentRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 1);
  assert.equal(result[0].milestone, "goal-1-wave-1");
  assert.equal(result[0].releaseReason, "no_merge_candidates");
});

test("fetchTerminallyReleasedMarkers skips markers outside cooldown window", () => {
  const milestones = [{ title: "goal-1-wave-1" }];
  const oldRelease = makeLeaseComment("release", "no_merge_candidates", "2020-01-01T00:00:00Z");

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [oldRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 0);
});

test("fetchTerminallyReleasedMarkers skips non-terminal release reasons", () => {
  const milestones = [{ title: "goal-1-wave-1" }];
  const completedRelease = makeLeaseComment("release", "completed");

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [completedRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 0);
});

test("fetchTerminallyReleasedMarkers ignores milestones not in input set", () => {
  const milestones = [{ title: "goal-2-wave-1" }];
  const recentRelease = makeLeaseComment("release", "no_merge_candidates");

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [recentRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 0);
});

test("fetchTerminallyReleasedMarkers returns empty for empty milestones", () => {
  const result = fetchTerminallyReleasedMarkers("owner/repo", [], { ghJsonFn: () => [] });
  assert.deepEqual(result, []);
});

test("fetchTerminallyReleasedMarkers handles judge_failed terminal reason", () => {
  const milestones = [{ title: "goal-1-wave-1" }];
  const recentRelease = makeLeaseComment("release", "judge_failed");

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [recentRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 1);
  assert.equal(result[0].releaseReason, "judge_failed");
});

test("fetchTerminallyReleasedMarkers returns wave_completed markers permanently (no cooldown)", () => {
  const milestones = [{ title: "goal-1-wave-1" }];
  // Event from 7 days ago — well past any cooldown
  const oldRelease = makeLeaseComment("release", "wave_completed", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const ghJsonFn = (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("--state") && cmd.includes("closed")) {
      return [{ number: 100, title: "Wave Ready: goal-1-wave-1", milestone: { title: "goal-1-wave-1" } }];
    }
    if (cmd.includes("comments")) {
      return [oldRelease];
    }
    return [];
  };

  const result = fetchTerminallyReleasedMarkers("owner/repo", milestones, { ghJsonFn });
  assert.equal(result.length, 1, "wave_completed should be returned even after cooldown expires");
  assert.equal(result[0].releaseReason, "wave_completed");
});

// --- Wave sequencing gate tests ---

test("findPriorWave returns null for wave-1", () => {
  assert.equal(findPriorWave("goal-100-wave-1"), null);
});

test("findPriorWave returns prior wave title for wave-2+", () => {
  assert.equal(findPriorWave("goal-100-wave-2"), "goal-100-wave-1");
  assert.equal(findPriorWave("goal-100-wave-3"), "goal-100-wave-2");
  assert.equal(findPriorWave("goal-5-wave-10"), "goal-5-wave-9");
});

test("findPriorWave returns null for non-matching titles", () => {
  assert.equal(findPriorWave("some-milestone"), null);
  assert.equal(findPriorWave(""), null);
  assert.equal(findPriorWave(null), null);
});

test("isPriorWaveComplete — wave-2 is skipped when wave-1 has open feature issues", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }, { title: "goal-50-wave-2" }],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-50-wave-1") return [{ number: 10, title: "Feature A", labels: [] }];
      if (title === "goal-50-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
  });
  assert.deepEqual(out.selected_waves, ["goal-50-wave-1"]);
  const w2eval = out.evaluations.find((e) => e.milestone === "goal-50-wave-2");
  assert.equal(w2eval.skip_reason, "prior_wave_open");
  assert.equal(w2eval.prior_wave, "goal-50-wave-1");
});

test("isPriorWaveComplete — wave-2 is selected when wave-1 has no open issues", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }, { title: "goal-50-wave-2" }],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-50-wave-1") return [];
      if (title === "goal-50-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
  });
  // wave-1 has no open issues → no_open_issues; wave-2 proceeds
  assert.ok(out.selected_waves.includes("goal-50-wave-2"));
});

test("isPriorWaveComplete — wave-2 is selected when wave-1 milestone does not exist", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-2" }],
    getMilestoneOpenIssues: () => [{ number: 20, title: "Feature B", labels: [] }],
  });
  assert.deepEqual(out.selected_waves, ["goal-50-wave-2"]);
});

test("isPriorWaveComplete — wave-2 is selected when wave-1 was terminally completed", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }, { title: "goal-50-wave-2" }],
    closedMarkers: [{ milestone: "goal-50-wave-1", releaseReason: "wave_completed" }],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-50-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
  });
  assert.ok(out.selected_waves.includes("goal-50-wave-2"));
});

test("isPriorWaveComplete — wave-2 is skipped when wave-1 is in-progress", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }, { title: "goal-50-wave-2" }],
    readyIssues: [
      { number: 99, title: "Wave Ready: goal-50-wave-1", labels: [{ name: "wave-in-progress" }], milestone: { title: "goal-50-wave-1" } },
    ],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-50-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
  });
  const w2eval = out.evaluations.find((e) => e.milestone === "goal-50-wave-2");
  assert.equal(w2eval.skip_reason, "prior_wave_open");
});

test("wave-1 is never blocked by wave sequencing", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }],
    getMilestoneOpenIssues: () => [{ number: 10, title: "Feature A", labels: [] }],
  });
  assert.deepEqual(out.selected_waves, ["goal-50-wave-1"]);
});

test("unrelated goals do not block each other's waves", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-A-wave-1" }, { title: "goal-B-wave-2" }],
    maxConcurrent: 2,
    getMilestoneOpenIssues: () => [{ number: 10, title: "Feature", labels: [] }],
  });
  // goal-A-wave-1 and goal-B-wave-2 are different goals — no sequencing
  // goal-B-wave-2 doesn't match the goal-(\d+)-wave-(\d+) pattern (B is not a digit)
  // so findPriorWave returns null → no blocking
  assert.equal(out.selected_waves.length, 2);
});

test("isPriorWaveComplete — wave-3 is skipped when wave-2 is still open even if wave-1 is complete", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-50-wave-1" }, { title: "goal-50-wave-2" }, { title: "goal-50-wave-3" }],
    closedMarkers: [{ milestone: "goal-50-wave-1", releaseReason: "wave_completed" }],
    maxConcurrent: 3,
    getMilestoneOpenIssues: (title) => {
      if (title === "goal-50-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      if (title === "goal-50-wave-3") return [{ number: 30, title: "Feature C", labels: [] }];
      return [];
    },
  });
  assert.ok(out.selected_waves.includes("goal-50-wave-2"), "wave-2 should be selected");
  assert.ok(!out.selected_waves.includes("goal-50-wave-3"), "wave-3 should be blocked by wave-2");
  const w3eval = out.evaluations.find((e) => e.milestone === "goal-50-wave-3");
  assert.equal(w3eval.skip_reason, "prior_wave_open");
});

// --- isPriorWaveComplete fail-closed tests ---

test("isPriorWaveComplete returns false when getMilestoneOpenIssues returns undefined (API error)", () => {
  const result = isPriorWaveComplete("goal-50-wave-1", {
    milestones: [{ title: "goal-50-wave-1" }],
    readyByMilestone: new Map(),
    closedMarkers: [],
    getMilestoneOpenIssues: () => undefined,
  });
  assert.equal(result, false, "API error must fail-closed (not complete)");
});

test("isPriorWaveComplete returns false when getMilestoneOpenIssues returns null (API error)", () => {
  const result = isPriorWaveComplete("goal-50-wave-1", {
    milestones: [{ title: "goal-50-wave-1" }],
    readyByMilestone: new Map(),
    closedMarkers: [],
    getMilestoneOpenIssues: () => null,
  });
  assert.equal(result, false, "API error must fail-closed (not complete)");
});

test("isPriorWaveComplete returns false when getMilestoneOpenIssues is not provided", () => {
  const result = isPriorWaveComplete("goal-50-wave-1", {
    milestones: [{ title: "goal-50-wave-1" }],
    readyByMilestone: new Map(),
    closedMarkers: [],
  });
  assert.equal(result, false, "missing function must fail-closed (not complete)");
});

test("computeSelectedWaves skips wave-2 when getMilestoneOpenIssues errors on wave-1 query", () => {
  const out = selectFixtureWaves({
    milestones: [{ title: "goal-60-wave-1" }, { title: "goal-60-wave-2" }],
    maxConcurrent: 2,
    getMilestoneOpenIssues: (title) => {
      // wave-1 query fails (API error returns undefined), wave-2 succeeds
      if (title === "goal-60-wave-1") return undefined;
      if (title === "goal-60-wave-2") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
  });
  assert.ok(!out.selected_waves.includes("goal-60-wave-2"), "wave-2 must not dispatch when wave-1 state is unknown");
  const w2eval = out.evaluations.find((e) => e.milestone === "goal-60-wave-2");
  assert.equal(w2eval.skip_reason, "prior_wave_open");
});
