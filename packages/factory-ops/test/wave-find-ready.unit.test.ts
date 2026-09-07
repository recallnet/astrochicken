import test from "node:test";
import assert from "node:assert/strict";
import { pickAndClaimReadyWave, pickReadyWave, rankReadyWaves } from "../src/commands/wave-find-ready.ts";

test("pickReadyWave excludes wave-in-progress markers — already-claimed waves are not candidates", () => {
  const out = pickReadyWave([
    { number: 2, title: "Wave Ready: goal-2-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-2-wave-1" } },
    { number: 1, title: "Wave Ready: goal-1-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-2" } },
    { number: 3, title: "Wave Ready: goal-0-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-0-wave-1" } },
  ]);
  // wave-in-progress marker #3 must be excluded; first unclaimed marker wins
  assert.deepEqual(out, { milestone_title: "goal-1-wave-2", ready_issue_number: 1 });
});

test("pickReadyWave returns empty when all markers are wave-in-progress", () => {
  const out = pickReadyWave([
    { number: 3, title: "Wave Ready: goal-0-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-0-wave-1" } },
  ]);
  assert.deepEqual(out, { milestone_title: "", ready_issue_number: "" });
});

test("rankReadyWaves never returns wave-in-progress markers to prevent concurrent slot races", () => {
  const ranked = rankReadyWaves([
    { number: 10, title: "Wave Ready: goal-A-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-A-wave-1" } },
    { number: 11, title: "Wave Ready: goal-B-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-B-wave-1" } },
    { number: 12, title: "Wave Ready: goal-C-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-C-wave-1" } },
  ]);
  assert.equal(ranked.length, 1, "Only unclaimed markers should be ranked");
  assert.equal(ranked[0].milestone_title, "goal-B-wave-1");
});

test("pickAndClaimReadyWave emits marker only after successful claim", () => {
  const issues = [
    { number: 10, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-1" } },
  ];

  const claimAcquire = ({ ownerId }) => ({
    ok: true,
    acquired: ownerId === "worker-a",
    reason: ownerId === "worker-a" ? "claim_acquired" : "active_claim_owned_by_other",
    claim: {
      claim_token: "wave_claim_10",
      lease_expires_at: "2026-01-01T00:20:00.000Z",
    },
  });

  const winner = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-a",
    workerId: "worker-a",
    claimAcquire,
  });
  const loser = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-b",
    workerId: "worker-b",
    claimAcquire,
  });

  assert.equal(winner.milestone_title, "goal-1-wave-1");
  assert.equal(winner.ready_issue_number, 10);
  assert.equal(winner.claim_acquired, "true");

  assert.equal(loser.milestone_title, "");
  assert.equal(loser.ready_issue_number, "");
  assert.equal(loser.claim_acquired, "false");
  assert.equal(loser.claim_reason, "active_claim_owned_by_other");
});

test("pickAndClaimReadyWave continues to next candidate when first ready marker is already claimed by another worker", () => {
  const issues = [
    { number: 30, title: "Wave Ready: goal-3-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-3-wave-1" } },
    { number: 31, title: "Wave Ready: goal-4-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-4-wave-1" } },
  ];

  const claimAcquire = ({ issueNumber }) => {
    if (Number(issueNumber) === 30) {
      return { ok: true, acquired: false, reason: "active_claim_owned_by_other" };
    }
    return {
      ok: true,
      acquired: true,
      reason: "claim_acquired",
      claim: {
        claim_token: "wave_claim_31",
        lease_expires_at: "2026-01-01T00:20:00.000Z",
      },
    };
  };

  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-d",
    workerId: "worker-d",
    getMilestoneOpenIssues: () => [],
    claimAcquire,
  });

  assert.equal(out.milestone_title, "goal-4-wave-1");
  assert.equal(out.ready_issue_number, 31);
  assert.equal(out.claim_acquired, "true");
});

test("pickAndClaimReadyWave never attempts claim on wave-in-progress markers", () => {
  const issues = [
    { number: 20, title: "Wave Ready: goal-2-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-2-wave-1" } },
    { number: 21, title: "Wave Ready: goal-3-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-3-wave-1" } },
  ];

  const claimedIssues = [];
  const claimAcquire = ({ issueNumber }) => {
    claimedIssues.push(Number(issueNumber));
    return {
      ok: true,
      acquired: true,
      reason: "claim_acquired",
      claim: {
        claim_token: "wave_claim_21",
        lease_expires_at: "2026-01-01T00:20:00.000Z",
      },
    };
  };

  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-c",
    workerId: "worker-c",
    claimAcquire,
  });

  assert.equal(out.milestone_title, "goal-3-wave-1");
  assert.equal(out.ready_issue_number, 21);
  assert.equal(out.claim_acquired, "true");
  // Critical: claim was never even attempted on the in-progress marker
  assert.deepEqual(claimedIssues, [21], "Must not attempt claim on wave-in-progress marker #20");
});

test("pickAndClaimReadyWave dedupes duplicate markers for the same milestone before claiming", () => {
  const issues = [
    { number: 50, title: "Wave Ready: goal-5-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-5-wave-2" } },
    { number: 51, title: "Wave Ready: goal-5-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-5-wave-2" } },
    { number: 52, title: "Wave Ready: goal-5-wave-3", labels: [{ name: "ready" }], milestone: { title: "goal-5-wave-3" } },
  ];

  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-e",
    workerId: "worker-e",
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: Number(issueNumber) === 50,
        reason: Number(issueNumber) === 50 ? "claim_acquired" : "active_claim_owned_by_other",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
  });

  assert.equal(out.ready_issue_number, 50);
  assert.deepEqual(claimedIssues, [50]);
});

test("pickAndClaimReadyWave skips ready marker when milestone already has live run ownership", () => {
  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues: [
      { number: 60, title: "Wave Ready: goal-6-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-6-wave-1" } },
      { number: 61, title: "Wave Ready: goal-7-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-7-wave-1" } },
    ],
    runId: "run-f",
    workerId: "worker-f",
    activeMilestones: ["goal-6-wave-1"],
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: true,
        reason: "claim_acquired",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
  });

  assert.equal(out.milestone_title, "goal-7-wave-1");
  assert.equal(out.ready_issue_number, 61);
  assert.deepEqual(claimedIssues, [61]);
});

test("pickAndClaimReadyWave skips claim when prior wave is still open", () => {
  const issues = [
    { number: 70, title: "Wave Ready: goal-7-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-7-wave-2" } },
    { number: 71, title: "Wave Ready: goal-7-wave-1", labels: [{ name: "ready" }, { name: "wave-in-progress" }], milestone: { title: "goal-7-wave-1" } },
  ];

  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-g",
    workerId: "worker-g",
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: true,
        reason: "claim_acquired",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
    getMilestoneOpenIssues: (repo, milestoneTitle) => {
      assert.equal(repo, "recallnet/astrochicken");
      if (milestoneTitle === "goal-7-wave-1") {
        return [
          { number: 700, title: "Open blocker", labels: [{ name: "goal" }] },
        ];
      }
      return [];
    },
  });

  assert.equal(out.milestone_title, "");
  assert.equal(out.ready_issue_number, "");
  assert.equal(out.claim_acquired, "false");
  assert.equal(out.claim_reason, "prior_wave_open");
  assert.deepEqual(claimedIssues, []);
});

test("pickAndClaimReadyWave claims wave when prior wave has no remaining open issues", () => {
  const issues = [
    { number: 72, title: "Wave Ready: goal-8-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-8-wave-2" } },
  ];

  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-h",
    workerId: "worker-h",
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: true,
        reason: "claim_acquired",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
    getMilestoneOpenIssues: () => [],
  });

  assert.equal(out.milestone_title, "goal-8-wave-2");
  assert.equal(out.ready_issue_number, 72);
  assert.equal(out.claim_acquired, "true");
  assert.deepEqual(claimedIssues, [72]);
});

test("pickAndClaimReadyWave fails closed when prior-wave query returns null", () => {
  const issues = [
    { number: 80, title: "Wave Ready: goal-9-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-9-wave-2" } },
  ];

  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-i",
    workerId: "worker-i",
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: true,
        reason: "claim_acquired",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
    getMilestoneOpenIssues: () => null,
  });

  assert.equal(out.milestone_title, "");
  assert.equal(out.ready_issue_number, "");
  assert.equal(out.claim_acquired, "false");
  assert.equal(out.claim_reason, "prior_wave_open");
  assert.deepEqual(claimedIssues, []);
});

test("pickAndClaimReadyWave reports first candidate's denial reason, not last candidate's prior_wave_open", () => {
  // Scenario: wave-2 (first candidate) passes prior check but claim is denied.
  // Wave-3 (second candidate) fails prior check because wave-2 is still open.
  // The final claim_reason must reflect wave-2's actual denial, not wave-3's
  // prior_wave_open — otherwise operators see a misleading reason that hides
  // the real blocker.
  const issues = [
    { number: 90, title: "Wave Ready: goal-11-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-11-wave-2" } },
    { number: 91, title: "Wave Ready: goal-11-wave-3", labels: [{ name: "ready" }], milestone: { title: "goal-11-wave-3" } },
  ];

  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-mask",
    workerId: "worker-mask",
    claimAcquire: ({ issueNumber }) => {
      if (Number(issueNumber) === 90) {
        return { ok: true, acquired: false, reason: "active_claim_owned_by_other" };
      }
      return { ok: true, acquired: true, reason: "claim_acquired", claim: { claim_token: "t", lease_expires_at: "" } };
    },
    getMilestoneOpenIssues: (repo, title) => {
      // Wave-1 is complete (no open issues)
      if (title === "goal-11-wave-1") return [];
      // Wave-2 still has open issues (the ready marker itself)
      if (title === "goal-11-wave-2") return [{ number: 90, title: "Wave Ready: goal-11-wave-2", labels: [{ name: "ready" }] }];
      return [];
    },
  });

  assert.equal(out.claim_acquired, "false");
  // Must report the first actionable denial, not the trailing prior_wave_open
  assert.equal(out.claim_reason, "active_claim_owned_by_other",
    "claim_reason must reflect wave-2's denial (active_claim_owned_by_other), " +
    "not wave-3's prior_wave_open which merely masks the real blocker");
});

test("pickAndClaimReadyWave fails closed when prior-wave query function is not provided", () => {
  const issues = [
    { number: 81, title: "Wave Ready: goal-10-wave-2", labels: [{ name: "ready" }], milestone: { title: "goal-10-wave-2" } },
  ];

  const claimedIssues = [];
  const out = pickAndClaimReadyWave({
    repo: "recallnet/astrochicken",
    issues,
    runId: "run-j",
    workerId: "worker-j",
    claimAcquire: ({ issueNumber }) => {
      claimedIssues.push(Number(issueNumber));
      return {
        ok: true,
        acquired: true,
        reason: "claim_acquired",
        claim: {
          claim_token: `wave_claim_${issueNumber}`,
          lease_expires_at: "2026-01-01T00:20:00.000Z",
        },
      };
    },
    // Explicitly emulate the guard being miswired/missing.
    getMilestoneOpenIssues: null,
  });

  assert.equal(out.milestone_title, "");
  assert.equal(out.ready_issue_number, "");
  assert.equal(out.claim_acquired, "false");
  assert.equal(out.claim_reason, "prior_wave_open");
  assert.deepEqual(claimedIssues, []);
});
