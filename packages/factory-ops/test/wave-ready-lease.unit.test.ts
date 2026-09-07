import assert from "node:assert/strict";
import test from "node:test";

import { planWaveOrphanStateRepair } from "../src/commands/wave-sanitize-state.ts";
import {
  WAVE_READY_LEASE_EVENT_PREFIX,
  claimReadyWaveIssue,
  collectActiveWaveLeasesFromIssues,
  collectActiveWaveLeasesFromRepo,
  parseWaveReadyLeaseEventsFromComment,
  releaseReadyWaveClaim,
  renderWaveReadyLeaseComment,
} from "../src/lib/wave-ready-lease.ts";
import { buildWaveReadyLeaseEvent } from "../src/lib/wave-ready-lease-cloudevents.ts";

function issue(number, title, labels = [], milestone = "") {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    milestone: milestone ? { title: milestone } : null,
    state: "OPEN",
  };
}

test("parseWaveReadyLeaseEventsFromComment parses prefixed lease JSON", () => {
  const event = buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-1-wave-1",
    readyIssueNumber: 101,
    runId: "run-abc",
    pipeline: "wave_execute",
    at: "2026-01-01T00:00:00.000Z",
  });
  const comment = {
    created_at: "2026-01-01T00:00:01.000Z",
    body: `note\n${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify(event)}\ntrailer`,
  };

  const out = parseWaveReadyLeaseEventsFromComment(comment, { fallbackMilestone: "goal-1-wave-1", fallbackIssueNumber: "101" });
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "claim");
  assert.equal(out[0].milestone_title, "goal-1-wave-1");
  assert.equal(out[0].ready_issue_number, "101");
});

test("collectActiveWaveLeasesFromIssues keeps explicit claim active without in-progress label", () => {
  const openIssues = [issue(120, "Wave Ready: goal-2-wave-1", ["ready"], "goal-2-wave-1")];
  const claimEvent = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-2-wave-1",
    readyIssueNumber: 120,
    runId: "run-120",
    at: "2026-01-01T00:05:00.000Z",
  }));

  const leases = collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue: new Map([["120", [{ created_at: "2026-01-01T00:05:01.000Z", body: claimEvent }]]]),
    nowEpochMs: Date.parse("2026-01-01T00:10:00.000Z"),
    staleClaimMinutes: 0,
  });

  assert.deepEqual(leases.active_milestones, ["goal-2-wave-1"]);
  assert.equal(leases.active_lease_count, 1);
  assert.equal(leases.active_leases[0].source, "github_claim");
});

test("collectActiveWaveLeasesFromIssues treats release event as authoritative over label fallback", () => {
  const openIssues = [issue(121, "Wave Ready: goal-2-wave-2", ["ready", "wave-in-progress"], "goal-2-wave-2")];
  const events = [
    renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
      action: "claim",
      milestoneTitle: "goal-2-wave-2",
      readyIssueNumber: 121,
      runId: "run-121",
      at: "2026-01-01T00:05:00.000Z",
    })),
    renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
      action: "release",
      milestoneTitle: "goal-2-wave-2",
      readyIssueNumber: 121,
      runId: "run-121",
      reason: "completed",
      at: "2026-01-01T00:06:00.000Z",
    })),
  ].join("\n");

  const leases = collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue: new Map([["121", [{ created_at: "2026-01-01T00:06:01.000Z", body: events }]]]),
  });

  assert.equal(leases.active_lease_count, 0);
});

test("collectActiveWaveLeasesFromIssues supports implicit GitHub-label fallback", () => {
  const openIssues = [issue(122, "Wave Ready: goal-2-wave-3", ["ready", "wave-in-progress"], "goal-2-wave-3")];
  const leases = collectActiveWaveLeasesFromIssues({ openIssues, commentsByIssue: new Map() });
  assert.equal(leases.active_lease_count, 1);
  assert.equal(leases.active_leases[0].source, "github_label");
});

test("collectActiveWaveLeasesFromIssues expires stale implicit label fallback claims", () => {
  const openIssues = [
    {
      ...issue(1221, "Wave Ready: goal-2-wave-3-legacy", ["ready", "wave-in-progress"], "goal-2-wave-3-legacy"),
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const leases = collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue: new Map(),
    nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z"),
    staleClaimMinutes: 20,
  });

  assert.equal(leases.active_lease_count, 0);
  assert.equal(leases.stale_candidate_count, 1);
  assert.equal(leases.stale_candidates[0].source, "github_label");

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  assert.equal(
    plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "1221" && a.label === "wave-in-progress"),
    true,
  );
});

test("repo-backed stale claim with lingering wave-in-progress label is not treated as active", () => {
  const openIssues = [issue(223, "Wave Ready: goal-2-wave-23", ["wave-in-progress"], "goal-2-wave-23")];
  const staleClaim = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-2-wave-23",
    readyIssueNumber: 223,
    runId: "run-223",
    at: "2026-01-01T00:00:00.000Z",
  }));

  const execGhJson = (args) => {
    const endpoint = String(args?.[1] || "");
    if (endpoint.includes("/issues/223/comments")) {
      return [{ created_at: "2026-01-01T00:00:01.000Z", body: staleClaim }];
    }
    return [];
  };

  const activeLeases = collectActiveWaveLeasesFromRepo({
    repo: "recallnet/astrochicken",
    openIssues,
    nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z"),
    staleClaimMinutes: 20,
    execGhJson,
  });

  assert.equal(activeLeases.active_lease_count, 0);
  assert.equal(activeLeases.stale_candidate_count, 1);

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases });
  assert.equal(
    plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "223" && a.label === "wave-in-progress"),
    true,
  );
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "223" && a.label === "ready"),
    true,
  );
});

test("repo-backed lease sourcing paginates comments and respects latest release beyond first page", () => {
  const openIssues = [issue(224, "Wave Ready: goal-2-wave-24", ["wave-in-progress"], "goal-2-wave-24")];

  const oldClaim = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-2-wave-24",
    readyIssueNumber: 224,
    runId: "run-224-old",
    at: "2026-01-01T00:05:00.000Z",
  }));

  const latestRelease = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "release",
    milestoneTitle: "goal-2-wave-24",
    readyIssueNumber: 224,
    runId: "run-224-old",
    reason: "completed",
    at: "2026-01-01T00:20:00.000Z",
  }));

  const page1 = Array.from({ length: 100 }, (_, i) => ({
    created_at: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
    body: `noise ${i + 1}`,
  }));
  page1[99] = { created_at: "2026-01-01T00:05:01.000Z", body: oldClaim };

  const page2 = [{ created_at: "2026-01-01T00:20:01.000Z", body: latestRelease }];
  const requestedPages = [];

  const execGhJson = (args) => {
    const endpoint = String(args?.[1] || "");
    if (!endpoint.includes("/issues/224/comments")) return [];
    const pageMatch = endpoint.match(/[?&]page=(\d+)/);
    const page = Number(pageMatch?.[1] || "1");
    requestedPages.push(page);
    if (page === 1) return page1;
    if (page === 2) return page2;
    return [];
  };

  const activeLeases = collectActiveWaveLeasesFromRepo({
    repo: "recallnet/astrochicken",
    openIssues,
    nowEpochMs: Date.parse("2026-01-01T00:30:00.000Z"),
    staleClaimMinutes: 20,
    execGhJson,
  });

  assert.equal(requestedPages.includes(2), true);
  assert.equal(activeLeases.active_lease_count, 0);
  assert.equal(activeLeases.stale_candidate_count, 0);

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases });
  assert.equal(
    plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "224" && a.label === "wave-in-progress"),
    true,
  );
});

test("claimReadyWaveIssue rolls back in-progress label when lease comment write fails", () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "edit" && args.includes("--add-label")) {
      return { ok: true, stdout: "", stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "comment") {
      return { ok: false, stdout: "", stderr: "gh_comment_failed" };
    }
    if (args[0] === "issue" && args[1] === "edit" && args.includes("--remove-label")) {
      return { ok: true, stdout: "", stderr: "" };
    }
    return { ok: false, stdout: "", stderr: "unexpected_call" };
  };

  const out = claimReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: 149,
    milestoneTitle: "goal-3-wave-0",
    runId: "run-149",
    pipeline: "wave_execute",
    execGh,
  });

  assert.equal(out.ok, false);
  assert.equal(out.rollback_label_attempted, true);
  assert.equal(out.rollback_label_ok, true);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [
    ["issue", "edit"],
    ["issue", "comment"],
    ["issue", "edit"],
  ]);
  assert.equal(calls[2].includes("--remove-label"), true);
});

// --- Error path tests: claimReadyWaveIssue ---

test("claimReadyWaveIssue returns error on missing repo", () => {
  const out = claimReadyWaveIssue({ readyIssueNumber: 1, milestoneTitle: "m", execGh: () => ({ ok: true }) });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("claimReadyWaveIssue returns error on missing issue number", () => {
  const out = claimReadyWaveIssue({ repo: "r/r", readyIssueNumber: 0, milestoneTitle: "m", execGh: () => ({ ok: true }) });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("claimReadyWaveIssue returns error on missing milestone", () => {
  const out = claimReadyWaveIssue({ repo: "r/r", readyIssueNumber: 1, milestoneTitle: "", execGh: () => ({ ok: true }) });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("claimReadyWaveIssue returns error on non-finite issue number", () => {
  const out = claimReadyWaveIssue({ repo: "r/r", readyIssueNumber: "abc", milestoneTitle: "m", execGh: () => ({ ok: true }) });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("claimReadyWaveIssue returns error when label add fails", () => {
  const out = claimReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 1,
    milestoneTitle: "m",
    execGh: () => ({ ok: false, stdout: "", stderr: "label_404" }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "label_404");
});

test("claimReadyWaveIssue rollback fails gracefully", () => {
  let callCount = 0;
  const execGh = (args) => {
    callCount++;
    if (callCount === 1) return { ok: true, stdout: "", stderr: "" }; // add label
    if (callCount === 2) return { ok: false, stdout: "", stderr: "comment_fail" }; // comment
    return { ok: false, stdout: "", stderr: "rollback_fail" }; // rollback
  };
  const out = claimReadyWaveIssue({ repo: "r/r", readyIssueNumber: 1, milestoneTitle: "m", execGh });
  assert.equal(out.ok, false);
  assert.equal(out.rollback_label_attempted, true);
  assert.equal(out.rollback_label_ok, false);
  assert.match(out.rollback_label_error, /rollback_fail/);
});

// --- Error path tests: releaseReadyWaveClaim ---

test("releaseReadyWaveClaim returns error on missing args", () => {
  const out = releaseReadyWaveClaim({ readyIssueNumber: 1, milestoneTitle: "m" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("releaseReadyWaveClaim returns error on non-finite issue number", () => {
  const out = releaseReadyWaveClaim({ repo: "r/r", readyIssueNumber: -5, milestoneTitle: "m" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo_issue_or_milestone");
});

test("releaseReadyWaveClaim returns error when comment fails", () => {
  const out = releaseReadyWaveClaim({
    repo: "r/r",
    readyIssueNumber: 1,
    milestoneTitle: "m",
    execGh: () => ({ ok: false, stdout: "", stderr: "write_fail" }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "write_fail");
  assert.ok(out.event, "should still have the event object");
});

test("releaseReadyWaveClaim skips label removal when removeLabel is false", () => {
  const calls = [];
  const out = releaseReadyWaveClaim({
    repo: "r/r",
    readyIssueNumber: 1,
    milestoneTitle: "m",
    removeLabel: false,
    execGh: (args) => { calls.push(args[1]); return { ok: true, stdout: "", stderr: "" }; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.remove_label_ok, true);
  assert.equal(calls.length, 1); // only comment, no label edit
  assert.equal(calls[0], "comment");
});

test("releaseReadyWaveClaim returns failure when label removal fails", () => {
  let callCount = 0;
  const out = releaseReadyWaveClaim({
    repo: "r/r",
    readyIssueNumber: 1,
    milestoneTitle: "m",
    removeLabel: true,
    execGh: () => {
      callCount++;
      if (callCount === 1) return { ok: true, stdout: "", stderr: "" }; // comment
      return { ok: false, stdout: "", stderr: "label_err" }; // label remove
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.remove_label_ok, false);
  assert.match(out.remove_label_error, /label_err/);
});

// --- Error path tests: parseWaveReadyLeaseEventsFromComment ---

test("parseWaveReadyLeaseEventsFromComment returns empty for empty body", () => {
  const out = parseWaveReadyLeaseEventsFromComment({ body: "" });
  assert.deepEqual(out, []);
});

test("parseWaveReadyLeaseEventsFromComment ignores invalid JSON", () => {
  const out = parseWaveReadyLeaseEventsFromComment({
    body: `${WAVE_READY_LEASE_EVENT_PREFIX}{broken json`,
  });
  assert.deepEqual(out, []);
});

test("parseWaveReadyLeaseEventsFromComment rejects wrong schema version", () => {
  const out = parseWaveReadyLeaseEventsFromComment({
    body: `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify({ schema_version: "wrong/v2", action: "claim" })}`,
  });
  assert.deepEqual(out, []);
});

test("parseWaveReadyLeaseEventsFromComment rejects invalid action", () => {
  const out = parseWaveReadyLeaseEventsFromComment({
    body: `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify({
      schema_version: "wave_ready_lease_event/v1",
      action: "invalid",
      milestone_title: "m",
      ready_issue_number: 1,
    })}`,
  });
  assert.deepEqual(out, []);
});

test("parseWaveReadyLeaseEventsFromComment rejects event missing milestone", () => {
  const out = parseWaveReadyLeaseEventsFromComment({
    body: `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify({
      schema_version: "wave_ready_lease_event/v1",
      action: "claim",
      milestone_title: "",
      ready_issue_number: 1,
    })}`,
  });
  assert.deepEqual(out, []);
});

// --- Error path tests: buildWaveReadyLeaseEvent ---

test("buildWaveReadyLeaseEvent normalizes invalid action to claim", () => {
  const out = buildWaveReadyLeaseEvent({ action: "banana" });
  assert.equal(out.action, "claim");
});

test("buildWaveReadyLeaseEvent returns empty issue number for non-finite input", () => {
  const out = buildWaveReadyLeaseEvent({ readyIssueNumber: "abc" });
  assert.equal(out.ready_issue_number, "");
});

test("buildWaveReadyLeaseEvent returns empty issue number for negative input", () => {
  const out = buildWaveReadyLeaseEvent({ readyIssueNumber: -3 });
  assert.equal(out.ready_issue_number, "");
});

// --- Error path tests: collectActiveWaveLeasesFromIssues ---

test("collectActiveWaveLeasesFromIssues returns empty for non-wave-marker issues", () => {
  const out = collectActiveWaveLeasesFromIssues({
    openIssues: [{ number: 1, title: "Normal issue", labels: [], state: "OPEN" }],
  });
  assert.equal(out.active_lease_count, 0);
});

test("collectActiveWaveLeasesFromIssues skips closed issues", () => {
  const out = collectActiveWaveLeasesFromIssues({
    openIssues: [{ number: 1, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-1" }, state: "CLOSED" }],
  });
  assert.equal(out.active_lease_count, 0);
});

test("collectActiveWaveLeasesFromIssues skips marker missing milestone", () => {
  const out = collectActiveWaveLeasesFromIssues({
    openIssues: [{ number: 1, title: "Wave Ready: ", labels: [{ name: "wave-in-progress" }], state: "OPEN" }],
  });
  assert.equal(out.active_lease_count, 0);
});

test("collectActiveWaveLeasesFromIssues handles non-array input", () => {
  const out = collectActiveWaveLeasesFromIssues({ openIssues: "not_array" });
  assert.equal(out.active_lease_count, 0);
});

test("collectActiveWaveLeasesFromIssues expires stale explicit claim", () => {
  const openIssues = [issue(10, "Wave Ready: goal-1-wave-1", ["ready", "wave-in-progress"], "goal-1-wave-1")];
  const claimBody = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "claim", milestoneTitle: "goal-1-wave-1", readyIssueNumber: 10, runId: "r1",
    at: "2026-01-01T00:00:00.000Z",
  }));
  const out = collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue: new Map([["10", [{ created_at: "2026-01-01T00:00:01.000Z", body: claimBody }]]]),
    nowEpochMs: Date.parse("2026-01-01T02:00:00.000Z"),
    staleClaimMinutes: 30,
  });
  assert.equal(out.active_lease_count, 0);
  assert.equal(out.stale_candidate_count, 1);
  assert.equal(out.stale_candidates[0].source, "github_claim");
});

// --- Error path tests: collectActiveWaveLeasesFromRepo ---

test("collectActiveWaveLeasesFromRepo returns empty on missing repo", () => {
  const out = collectActiveWaveLeasesFromRepo({ repo: "" });
  assert.equal(out.active_lease_count, 0);
  assert.deepEqual(out.active_leases, []);
});

test("collectActiveWaveLeasesFromRepo handles comment fetch failure gracefully", () => {
  const openIssues = [issue(10, "Wave Ready: goal-1-wave-1", ["ready", "wave-in-progress"], "goal-1-wave-1")];
  const out = collectActiveWaveLeasesFromRepo({
    repo: "r/r",
    openIssues,
    execGhJson: () => [],
  });
  // No comments → implicit label fallback
  assert.equal(out.active_lease_count, 1);
  assert.equal(out.active_leases[0].source, "github_label");
});

test("claim/release helpers emit deterministic gh command sequence", () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    return { ok: true, stdout: "", stderr: "" };
  };

  const claim = claimReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: 150,
    milestoneTitle: "goal-3-wave-1",
    runId: "run-150",
    pipeline: "wave_execute",
    execGh,
  });
  assert.equal(claim.ok, true);

  const release = releaseReadyWaveClaim({
    repo: "recallnet/astrochicken",
    readyIssueNumber: 150,
    milestoneTitle: "goal-3-wave-1",
    runId: "run-150",
    pipeline: "wave_execute",
    reason: "completed",
    removeLabel: true,
    execGh,
  });
  assert.equal(release.ok, true);

  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [
    ["issue", "edit"],
    ["issue", "comment"],
    ["issue", "comment"],
    ["issue", "edit"],
  ]);
});
