import { waveClaimFixture } from "./wave-ready-fixtures.test-support.ts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  completeReadyWaveIssue,
  lockReadyWaveIssue,
  releaseReadyWaveClaim,
} from "../src/lib/wave-ready-claim-ops.ts";
import { WAVE_READY_LEASE_EVENT_PREFIX } from "../src/lib/wave-ready-lease.ts";

test("lockReadyWaveIssue requires successful claim before label mutation", () => {
  const ghCalls = [];
  const out = lockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "700",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_700",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimAcquire: () => ({ ok: true, acquired: false, reason: "active_claim_owned_by_other" }),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.lock_granted, "false");
  assert.equal(out.reason, "active_claim_owned_by_other");
  assert.equal(out.ready_issue_number, 700);
  assert.equal(out.milestone_title, "goal-205-wave-2");
  assert.equal(out.claim_token, "wave_claim_700");
  assert.deepEqual(ghCalls, []);
});

test("lockReadyWaveIssue releases claim when wave-in-progress label mutation fails", () => {
  const releaseCalls = [];
  const out = lockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "701",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_701",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimAcquire: () => (waveClaimFixture({ claimToken: "wave_claim_701", reason: "claim_refreshed" })),
    claimReleaser: (payload) => {
      releaseCalls.push(payload);
      return { ok: true, released: true, reason: "claim_released" };
    },
    execGh: () => ({ ok: false, stderr: "edit failed" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.lock_granted, "false");
  assert.equal(out.reason, "failed_to_set_wave_in_progress");
  assert.equal(out.claim_release.released, true);
  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0].reason, "failed_to_set_wave_in_progress");
});

test("lockReadyWaveIssue sets wave-in-progress when claim is valid", () => {
  const ghCalls = [];
  const out = lockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "701",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_701",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimAcquire: () => (waveClaimFixture({ claimToken: "wave_claim_701", reason: "claim_refreshed" })),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.lock_granted, "true");
  assert.equal(out.claim_token, "wave_claim_701");
  assert.equal(ghCalls.length, 1);
  assert.equal(ghCalls[0][1], "edit");
});

test("completeReadyWaveIssue short-circuits when ownership invalid", () => {
  const ghCalls = [];
  const out = completeReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "702",
    claimToken: "wave_claim_702",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimValidator: () => ({ ok: true, valid: false, reason: "claim_token_mismatch" }),
    claimReleaser: () => ({ ok: true, released: false, reason: "not_owner_no_release" }),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.completed, false);
  assert.equal(out.short_circuited, true);
  assert.equal(out.reason, "claim_token_mismatch");
  assert.deepEqual(ghCalls, []);
});

test("completeReadyWaveIssue closes marker and releases claim", () => {
  const ghCalls = [];
  const out = completeReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "703",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_703",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimValidator: () => ({ ok: true, valid: true, reason: "claim_valid" }),
    claimReleaser: () => ({ ok: true, released: true, reason: "claim_released" }),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.completed, true);
  assert.equal(out.claim_release.released, true);
  assert.equal(ghCalls.length, 3, "should write lease event + comment + close");
  // First call: structured lease release event
  assert.equal(ghCalls[0][1], "comment");
  assert.ok(
    ghCalls[0].some((arg) => typeof arg === "string" && arg.includes(WAVE_READY_LEASE_EVENT_PREFIX)),
    "first comment should be a structured lease release event",
  );
  assert.ok(
    ghCalls[0].some((arg) => typeof arg === "string" && arg.includes("wave_completed")),
    "lease event should have reason wave_completed",
  );
  // Second call: human-readable comment
  assert.equal(ghCalls[1][1], "comment");
  // Third call: close
  assert.equal(ghCalls[2][1], "close");
});

test("completeReadyWaveIssue refuses to close marker while milestone still has open feature work", () => {
  const ghCalls = [];
  const out = completeReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "703",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_703",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimValidator: () => ({ ok: true, valid: true, reason: "claim_valid" }),
    claimReleaser: () => ({ ok: true, released: true, reason: "claim_released" }),
    listMilestoneOpenIssuesFn: () => ([
      { number: 703, title: "Wave Ready: goal-205-wave-2", labels: [{ name: "ready" }] },
      { number: 801, title: "Feature still open", labels: [{ name: "feature" }] },
    ]),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.completed, false);
  assert.equal(out.reason, "milestone_open_issues_remaining");
  assert.equal(out.remaining_open_issue_count, 1);
  assert.deepEqual(ghCalls, []);
});

test("releaseReadyWaveClaim is idempotent no-op passthrough", () => {
  const out = releaseReadyWaveClaim({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "704",
    claimToken: "wave_claim_704",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimReleaser: () => ({ ok: true, released: false, reason: "claim_already_released", claim: { status: "released" } }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.released, false);
  assert.equal(out.reason, "claim_already_released");
});
