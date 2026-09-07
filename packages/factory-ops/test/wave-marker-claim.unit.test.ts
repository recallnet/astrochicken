import test from "node:test";
import assert from "node:assert/strict";
import {
  WAVE_MARKER_CLAIM_SCHEMA_VERSION,
  acquireWaveMarkerClaim,
  buildDeterministicClaimToken,
  parseWaveMarkerClaimFromBody,
  releaseWaveMarkerClaim,
  upsertWaveMarkerClaimInBody,
  validateWaveMarkerClaimOwnership,
} from "../src/commands/wave-claim.ts";

function createCasIssueClient(initialIssue) {
  const state = {
    etag: 1,
    issue: structuredClone(initialIssue),
  };

  return {
    getIssue() {
      return {
        ok: true,
        etag: `"${state.etag}"`,
        issue: structuredClone(state.issue),
      };
    },
    updateIssueBody({ body, etag }) {
      if (String(etag || "") && String(etag) !== `"${state.etag}"`) {
        return { ok: false, precondition_failed: true, error: "etag_mismatch" };
      }
      state.issue.body = String(body || "");
      state.etag += 1;
      return { ok: true };
    },
    snapshot() {
      return structuredClone(state.issue);
    },
  };
}

function issue({ number = 1, milestone = "goal-1-wave-1", body = "", state = "open", labels = ["ready"] } = {}) {
  return {
    number,
    title: `Wave Ready: ${milestone}`,
    milestone: { title: milestone },
    labels: (Array.isArray(labels) ? labels : []).map((name) => ({ name })),
    body,
    state,
  };
}

function createLostWriteRaceClient(initialIssue, { winningClaim } = {}) {
  const state = {
    issue: structuredClone(initialIssue),
  };

  return {
    getIssue() {
      return {
        ok: true,
        etag: '"1"',
        issue: structuredClone(state.issue),
      };
    },
    updateIssueBody() {
      state.issue.body = upsertWaveMarkerClaimInBody(String(state.issue.body || ""), winningClaim);
      return { ok: true };
    },
    snapshot() {
      return structuredClone(state.issue);
    },
  };
}

test("acquireWaveMarkerClaim writes explicit claim contract and denies competing owner", () => {
  const client = createCasIssueClient(issue({ number: 400 }));

  const first = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 400,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: buildDeterministicClaimToken({ ownerId: "worker-a", runId: "run-a", issueNumber: 400, milestoneTitle: "goal-205-wave-2" }),
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  assert.equal(first.ok, true);
  assert.equal(first.acquired, true);
  assert.equal(first.claim.schema_version, WAVE_MARKER_CLAIM_SCHEMA_VERSION);
  assert.equal(first.claim.owner_id, "worker-a");
  assert.equal(first.claim.run_id, "run-a");
  assert.equal(first.claim.status, "active");
  assert.equal(Boolean(first.claim.lease_started_at), true);
  assert.equal(Boolean(first.claim.lease_expires_at), true);
  assert.equal(Boolean(first.claim.updated_at), true);

  const second = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 400,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-b",
    runId: "run-b",
    claimToken: buildDeterministicClaimToken({ ownerId: "worker-b", runId: "run-b", issueNumber: 400, milestoneTitle: "goal-205-wave-2" }),
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });

  assert.equal(second.ok, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "active_claim_owned_by_other");
});

test("acquireWaveMarkerClaim verifies persisted ownership after write to prevent lost-write races", () => {
  const winningClaim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_worker_b",
    claim_token: "wave_claim_worker_b",
    owner_id: "worker-b",
    run_id: "run-b",
    ready_issue_number: "499",
    milestone_title: "goal-205-wave-9",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:20:00.000Z",
    heartbeat_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    reclaim_count: 0,
  };

  const client = createLostWriteRaceClient(issue({ number: 499, milestone: "goal-205-wave-9" }), { winningClaim });

  const out = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 499,
    milestoneTitle: "goal-205-wave-9",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "wave_claim_worker_a",
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });

  assert.equal(out.ok, true);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "active_claim_owned_by_other");
  assert.equal(out.claim?.owner_id, "worker-b");
});

test("acquireWaveMarkerClaim is idempotent for same owner and token", () => {
  const client = createCasIssueClient(issue({ number: 401 }));
  const token = buildDeterministicClaimToken({ ownerId: "worker-a", runId: "run-a", issueNumber: 401, milestoneTitle: "goal-205-wave-2" });

  const first = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 401,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: token,
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  const second = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 401,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: token,
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:30.000Z"),
    client,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.acquired, true);
  assert.equal(second.reason, "claim_refreshed");
  assert.equal(second.claim.claim_token, token);
  assert.equal(second.claim.lease_started_at, first.claim.lease_started_at);
  assert.equal(second.claim.lease_expires_at > first.claim.lease_expires_at, true);
});

test("stale claim can be deterministically reclaimed and sweeper release is force-safe", () => {
  const staleClaim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_old",
    claim_token: "wave_claim_old",
    owner_id: "worker-old",
    run_id: "run-old",
    ready_issue_number: "402",
    milestone_title: "goal-205-wave-2",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:05:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const body = upsertWaveMarkerClaimInBody("Wave marker", staleClaim);
  const client = createCasIssueClient(issue({ number: 402, body }));

  const reclaimed = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 402,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-new",
    runId: "run-new",
    claimToken: "wave_claim_new",
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:10:00.000Z"),
    client,
  });

  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.reason, "claim_reclaimed_stale");
  assert.equal(reclaimed.claim.reclaim_count, 1);
  assert.equal(reclaimed.claim.reclaimed_from_owner_id, "worker-old");
  assert.equal(reclaimed.claim.reclaimed_from_run_id, "run-old");
  assert.equal(Boolean(reclaimed.claim.heartbeat_at), true);

  const wrongOwnerRelease = releaseWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 402,
    ownerId: "worker-old",
    runId: "run-old",
    claimToken: "wave_claim_old",
    reason: "wrong_owner",
    client,
  });
  assert.equal(wrongOwnerRelease.ok, true);
  assert.equal(wrongOwnerRelease.released, false);

  const forced = releaseWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 402,
    reason: "stale_wave_claim_expired",
    force: true,
    nowEpochMs: Date.parse("2026-01-01T00:20:00.000Z"),
    client,
  });
  assert.equal(forced.ok, true);
  assert.equal(forced.released, true);

  // After force release, the claim block is removed entirely from the body
  // so subsequent ticks don't see a stale "already claimed" block.
  const parsed = parseWaveMarkerClaimFromBody(client.snapshot().body, null);
  assert.equal(parsed, null, "claim block should be removed from body after release");
});

test("stale in-progress claim cannot be stolen while wave-in-progress label is present", () => {
  const staleClaim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_old",
    claim_token: "wave_claim_old",
    owner_id: "worker-old",
    run_id: "run-old",
    ready_issue_number: "404",
    milestone_title: "goal-205-wave-2",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:05:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const client = createCasIssueClient(issue({
    number: 404,
    labels: ["ready", "wave-in-progress"],
    body: upsertWaveMarkerClaimInBody("Wave marker", staleClaim),
  }));

  const denied = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 404,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-new",
    runId: "run-new",
    claimToken: "wave_claim_new",
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:10:00.000Z"),
    client,
  });

  assert.equal(denied.ok, true);
  assert.equal(denied.acquired, false);
  assert.equal(denied.reason, "stale_claim_blocked_by_wave_in_progress");
});

test("validateWaveMarkerClaimOwnership enforces token boundary", () => {
  const client = createCasIssueClient(issue({ number: 403 }));

  const claim = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 403,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "wave_claim_403",
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(claim.acquired, true);

  const valid = validateWaveMarkerClaimOwnership({
    repo: "recallnet/astrochicken",
    issueNumber: 403,
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "wave_claim_403",
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.valid, true);

  const invalid = validateWaveMarkerClaimOwnership({
    repo: "recallnet/astrochicken",
    issueNumber: 403,
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "other_token",
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });
  assert.equal(invalid.ok, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "claim_token_mismatch");
});
