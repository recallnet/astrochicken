import test from "node:test";
import assert from "node:assert/strict";
import { createTestAdapter } from "../../github-adapter/src/test-adapter.ts";
import { createReadyMarkers, createWaveReadyMarker } from "../src/commands/wave-create-ready.ts";
import { WAVE_READY_LEASE_EVENT_PREFIX } from "../src/commands/wave-claim.ts";

function readyMarkerStubs() {
  return {
    ghJsonFn: () => [],
    ghFn: () => ({ ok: true, stdout: "", stderr: "" }),
    syncBlockedByFn: () => ({ ok: true }),
  };
}

function releaseEventFixture({ issueNumber, runId, reason, at }) {
  return JSON.stringify({
    schema_version: "wave_ready_lease_event/v1",
    action: "release",
    milestone_title: "goal-1-wave-1",
    ready_issue_number: issueNumber,
    run_id: runId,
    pipeline: "wave_execute",
    reason,
    at,
  });
}

function closedMarkerQuery(number, comments) {
  return (args) => {
    if (args.includes("--state") && args.includes("open")) return [];
    if (args.includes("--search")) return [marker(number, "goal-1-wave-1", "goal-1-wave-1", "CLOSED", [])];
    if (String(args[1] || "").includes(`/issues/${number}/comments`)) return comments;
    return [];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function marker(number, title, milestone, state = "OPEN", labels = []) {
  return {
    title: `Wave Ready: ${title}`,
    url: `https://gh/${number}`,
    milestone: { title: milestone },
    number,
    state,
    labels: labels.map((name) => ({ name })),
  };
}

// ---------------------------------------------------------------------------
// Input validation / edge cases
// ---------------------------------------------------------------------------

test("createReadyMarkers returns empty array when no waves provided", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: [],

  });
  assert.deepEqual(out, []);
});

test("createReadyMarkers returns empty array with default waves", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),

  });
  assert.deepEqual(out, []);
});

test("createWaveReadyMarker returns invalid_input when repo or wave is missing", () => {
  const out = createWaveReadyMarker({ repo: "", wave: "" });
  assert.equal(out.ok, false);
  assert.equal(out.decision, "invalid_input");
  assert.equal(out.markerIssueNumber, "");
});

test("createWaveReadyMarker returns already_ready for existing open marker", () => {
  const out = createWaveReadyMarker({
    ...readyMarkerStubs(),
    repo: "r/r",
    wave: "goal-1-wave-1",
    ghJsonFn: (args) => {
      if (args.includes("--label") && args.includes("ready")) {
        return [marker(11, "goal-1-wave-1", "goal-1-wave-1", "OPEN", ["ready"])];
      }
      return [];
    },

  });

  assert.equal(out.ok, true);
  assert.equal(out.decision, "already_ready");
  assert.equal(out.markerIssueNumber, "11");
  assert.equal(out.url, "https://gh/11");
});

// ---------------------------------------------------------------------------
// Branch: existing open+ready marker found
// ---------------------------------------------------------------------------

test("createReadyMarkers returns existing URL for open+ready marker", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: (args) => {
      if (args.includes("--label") && args.includes("ready")) {
        return [marker(1, "goal-1-wave-1", "goal-1-wave-1", "OPEN", ["ready"])];
      }
      return [];
    },

  });
  assert.deepEqual(out, ["https://gh/1"]);
});

test("createWaveReadyMarker reads open ready markers through adapter when provided", () => {
  const adapter = createTestAdapter({
    repo: "r/r",
    stubs: {
      issueList: ({ labels }) => (Array.isArray(labels) && labels.includes("ready")
        ? [marker(11, "goal-1-wave-1", "goal-1-wave-1", "OPEN", ["ready"])]
        : []),
    },
  });

  const out = createWaveReadyMarker({
    ...readyMarkerStubs(),
    repo: "r/r",
    wave: "goal-1-wave-1",
    adapter,
    ghJsonFn: () => {
      throw new Error("ghJson must not be called when adapter is provided");
    },

  });

  assert.equal(out.ok, true);
  assert.equal(out.markerIssueNumber, "11");
  assert.equal(adapter.callsTo("issueList").length, 1);
});

// ---------------------------------------------------------------------------
// Branch: existing open issue without ready label
// ---------------------------------------------------------------------------

test("createReadyMarkers adds ready label to existing open issue without it", () => {
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: (args) => {
      if (args.includes("--label") && args.includes("ready")) return [];
      if (args.includes("--state") && args.includes("open")) {
        return [marker(2, "goal-1-wave-1", "goal-1-wave-1", "OPEN", [])];
      }
      return [];
    },
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/2"]);
  const addLabelCall = calls.find((c) => c.includes("--add-label") && c.includes("ready"));
  assert.ok(addLabelCall, "should add ready label");
});

test("createReadyMarkers does not add ready label if already present on open issue", () => {
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: (args) => {
      if (args.includes("--label") && args.includes("ready")) return [];
      if (args.includes("--state") && args.includes("open")) {
        return [marker(2, "goal-1-wave-1", "goal-1-wave-1", "OPEN", ["ready"])];
      }
      return [];
    },
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/2"]);
  const addLabelCall = calls.find((c) => c.includes("--add-label"));
  assert.equal(addLabelCall, undefined, "should not add ready label when already present");
});

// ---------------------------------------------------------------------------
// Branch: closed marker — normal reopen
// ---------------------------------------------------------------------------

test("createReadyMarkers reopens closed marker", () => {
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(3, []),
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/3"]);
  const reopenCall = calls.find((c) => c.includes("reopen"));
  assert.ok(reopenCall, "should reopen closed marker");
});

// ---------------------------------------------------------------------------
// Branch: closed marker with terminal release — DO NOT reopen (#452 fix)
// ---------------------------------------------------------------------------

test("createReadyMarkers does NOT reopen closed marker with no_merge_candidates release within cooldown", () => {
  const recentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago (within 30-min cooldown)
  const event = releaseEventFixture({ issueNumber: "4", runId: "run-4", reason: "no_merge_candidates", at: recentAt });
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(4, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: recentAt }]),

  });
  // Should NOT reopen — still within cooldown window
  assert.deepEqual(out, [""]);
});

test("createReadyMarkers does NOT reopen closed marker with judge_failed release within cooldown", () => {
  const recentAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
  const event = releaseEventFixture({ issueNumber: "5", runId: "run-5", reason: "judge_failed", at: recentAt });
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(5, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: recentAt }]),

  });
  assert.deepEqual(out, [""]);
});

// ---------------------------------------------------------------------------
// Branch: closed marker with terminal release AFTER cooldown — reopen allowed
// ---------------------------------------------------------------------------

test("createReadyMarkers reopens closed marker with no_merge_candidates release after cooldown expires", () => {
  const oldAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago (past 30-min cooldown)
  const event = releaseEventFixture({ issueNumber: "4", runId: "run-4", reason: "no_merge_candidates", at: oldAt });
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(4, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: oldAt }]),
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/4"]);
  const reopenCall = calls.find((c) => c.includes("reopen"));
  assert.ok(reopenCall, "should reopen — cooldown has expired");
});

test("createReadyMarkers reopens closed marker with judge_failed release after cooldown expires", () => {
  const oldAt = new Date(Date.now() - 45 * 60 * 1000).toISOString(); // 45 min ago
  const event = releaseEventFixture({ issueNumber: "5", runId: "run-5", reason: "judge_failed", at: oldAt });
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(5, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: oldAt }]),
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/5"]);
  const reopenCall = calls.find((c) => c.includes("reopen"));
  assert.ok(reopenCall, "should reopen — judge_failed cooldown has expired");
});

test("createReadyMarkers respects custom cooldownMs", () => {
  const at = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const event = releaseEventFixture({ issueNumber: "7", runId: "run-7", reason: "judge_failed", at: at });
  // With 5-min cooldown, 10-min-old event should allow reopen
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    cooldownMs: 5 * 60 * 1000,
    ghJsonFn: closedMarkerQuery(7, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: at }]),
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },

  });
  assert.deepEqual(out, ["https://gh/7"]);
  const reopenCall = calls.find((c) => c.includes("reopen"));
  assert.ok(reopenCall, "should reopen with custom cooldown");

  // With 60-min cooldown, same 10-min-old event should still block
  const out2 = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    cooldownMs: 60 * 60 * 1000,
    ghJsonFn: closedMarkerQuery(7, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: at }]),

  });
  assert.deepEqual(out2, [""]);
});

// ---------------------------------------------------------------------------
// Branch: closed marker with non-terminal release — always reopen
// ---------------------------------------------------------------------------

test("createReadyMarkers does NOT reopen closed marker with wave_completed release (permanent block with default cooldown)", () => {
  // wave_completed means the wave successfully merged — permanent block at default cooldown (no explicit override)
  const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
  const event = releaseEventFixture({ issueNumber: "6", runId: "run-6", reason: "wave_completed", at: longAgo });
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    ghJsonFn: closedMarkerQuery(6, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: longAgo }]),

  });
  // Should NOT reopen — wave_completed is a permanent block at default cooldown
  assert.deepEqual(out, [""]);
});

test("createReadyMarkers allows new marker when wave_completed but cooldownMs=0 (explicit force-override)", () => {
  // cooldownMs=0 is an explicit supervisor override that bypasses even wave_completed terminal state
  // so that re-dispatch is possible when open features still exist.
  const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
  const event = releaseEventFixture({ issueNumber: "6", runId: "run-6", reason: "wave_completed", at: longAgo });
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],
    cooldownMs: 0, // explicit force-override
    ghJsonFn: closedMarkerQuery(6, [{ body: `${WAVE_READY_LEASE_EVENT_PREFIX}${event}`, created_at: longAgo }]),
    ghFn: (args) => {
      calls.push(args);
      if (args.includes("reopen")) return { ok: true, stdout: "https://gh/6\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    },

  });
  // Should reopen — cooldownMs=0 is an explicit override that bypasses wave_completed permanent block
  assert.deepEqual(out, ["https://gh/6"]);
  const reopenCall = calls.find((c) => c.includes("reopen"));
  assert.ok(reopenCall, "should reopen with cooldownMs=0 override");
});

// ---------------------------------------------------------------------------
// Branch: no existing marker — create new issue
// ---------------------------------------------------------------------------

test("createReadyMarkers creates new issue when no marker exists", () => {
  const calls = [];
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],

    ghFn: (args) => {
      calls.push(args);
      if (args.includes("create")) return { ok: true, stdout: "https://gh/5\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    },

  });
  assert.deepEqual(out, ["https://gh/5"]);
  const createCall = calls.find((c) => c.includes("create"));
  assert.ok(createCall, "should create new issue");
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

test("createReadyMarkers returns empty string when issue creation fails", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],

    ghFn: (args) => {
      if (args.includes("create")) return { ok: false, stdout: "", stderr: "create_failed" };
      return { ok: true, stdout: "", stderr: "" };
    },

  });
  assert.deepEqual(out, [""]);
});

test("createReadyMarkers handles ghJsonFn failure gracefully", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1"],

    ghFn: (args) => {
      if (args.includes("create")) return { ok: true, stdout: "https://gh/new\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    },

  });
  // When all queries return empty, falls through to create new
  assert.deepEqual(out, ["https://gh/new"]);
});

test("createReadyMarkers handles multiple waves", () => {
  const out = createReadyMarkers({
    ...readyMarkerStubs(),
    repo: "r/r",
    waves: ["goal-1-wave-1", "goal-2-wave-1"],
    ghJsonFn: (args) => {
      if (args.includes("--label") && args.includes("ready")) {
        return [marker(1, "goal-1-wave-1", "goal-1-wave-1", "OPEN", ["ready"])];
      }
      return [];
    },
    ghFn: (args) => {
      if (args.includes("create")) return { ok: true, stdout: "https://gh/new\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    },

  });
  assert.equal(out.length, 2);
  assert.equal(out[0], "https://gh/1"); // existing
  assert.equal(out[1], "https://gh/new"); // created
});
